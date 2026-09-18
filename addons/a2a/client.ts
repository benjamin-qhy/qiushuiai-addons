import { AgentCardCache } from "./card-cache.js";
import {
  AgentCard,
  Message,
  Task,
  StreamResponse,
  SendMessageRequest,
  GetTaskRequest,
  CancelTaskRequest,
  SubscribeToTaskRequest,
} from "@a2a-js/sdk";
import {
  ClientFactory,
  JsonRpcTransportFactory,
  type Client,
} from "@a2a-js/sdk/client";
import type { A2aConfig, A2aEndpoint } from "./config.js";
import { pinnedEndpointFetch } from "./pinned-fetch.js";
import { validateOutboundUrl, type SecretResolver } from "./security.js";
import { A2aClientStore } from "./client-store.js";
import { A2A_PROFILE } from "./profile.js";
import { createHash } from "node:crypto";
import { A2aArtifactAccumulator } from "./artifact-accumulator.js";
import { validateParts } from "./parts.js";

function validateRemoteResult(value: any): void {
  const message = value?.message;
  if (message) validateParts(message.parts);
  const task = value?.task ?? value;
  if (task?.status?.message) validateParts(task.status.message.parts);
  if (task?.artifacts) {
    if (!Array.isArray(task.artifacts) || task.artifacts.length > 16)
      throw new Error("Remote artifact limit");
    for (const artifact of task.artifacts) validateParts(artifact.parts);
  }
}

export function endpointIdentity(endpoint: A2aEndpoint): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        endpoint.alias,
        endpoint.cardUrl,
        endpoint.credentialKey ?? null,
      ]),
    )
    .digest("hex");
}
export interface A2aClientCall {
  scope: string;
  endpoint: string;
  signal?: AbortSignal;
}
export class A2aOutboundClient {
  private closed = false;
  private readonly cards = new AgentCardCache();
  private active = new Set<AbortController>();
  private waiters = new Set<() => void>();
  private callScope(call: A2aClientCall) {
    if (this.closed || this.active.size >= 16)
      throw new Error("A2A client stopped or concurrency limit.");
    const controller = new AbortController();
    this.active.add(controller);
    const abort = () =>
      controller.abort(call.signal?.reason ?? new Error("Caller aborted"));
    call.signal?.addEventListener("abort", abort, { once: true });
    if (call.signal?.aborted) abort();
    const timer = setTimeout(
      () => controller.abort(new Error("A2A client deadline")),
      30000,
    );
    return {
      call: { ...call, signal: controller.signal },
      finish: () => {
        clearTimeout(timer);
        call.signal?.removeEventListener("abort", abort);
        this.active.delete(controller);
        if (!this.active.size) {
          for (const resolve of this.waiters) resolve();
          this.waiters.clear();
        }
      },
    };
  }
  private async run<T>(
    call: A2aClientCall,
    fn: (bound: A2aClientCall) => Promise<T>,
  ): Promise<T> {
    const scope = this.callScope(call);
    try {
      return await fn(scope.call);
    } finally {
      scope.finish();
    }
  }
  shutdown() {
    this.closed = true;
    this.cards.clear();
    for (const controller of this.active)
      controller.abort(new Error("A2A client shutdown"));
    return this.active.size
      ? new Promise<void>((resolve) => this.waiters.add(resolve))
      : Promise.resolve();
  }

  constructor(
    private readonly config: () => A2aConfig,
    private readonly store: A2aClientStore,
    private readonly secrets: SecretResolver,
    private readonly guard: () => void = () => {},
  ) {}
  private endpoint(alias: string): A2aEndpoint {
    this.guard();
    const config = this.config(),
      endpoint = config.endpoints.find((e) => e.alias === alias && e.enabled);
    if (!config.enabled || !config.outbound || !endpoint)
      throw new Error("A2A outbound endpoint disabled or unapproved.");
    return endpoint;
  }
  private storageEndpoint(alias: string): string {
    const endpoint = this.endpoint(alias);
    return endpointIdentity(endpoint);
  }
  private async connection(call: A2aClientCall): Promise<{
    client: Client;
    card: AgentCard;
    rawCard: Record<string, unknown>;
  }> {
    if (!call.scope || call.scope.length > 256)
      throw new Error("Calling work scope required.");
    const endpoint = this.endpoint(call.endpoint),
      fetcher = pinnedEndpointFetch(endpoint, this.secrets);
    const raw = await this.cards.get(
      endpoint,
      call.scope,
      fetcher,
      this.secrets,
      call.signal,
    );
    call.signal?.throwIfAborted();
    if (
      JSON.stringify(this.endpoint(call.endpoint)) !== JSON.stringify(endpoint)
    )
      throw new Error("Agent Card policy changed during discovery.");
    const card = AgentCard.fromJSON(raw);
    const selected = card.supportedInterfaces.find(
      (i) =>
        i.protocolBinding === "JSONRPC" &&
        i.protocolVersion === "1.0" &&
        !i.tenant,
    );
    if (!selected)
      throw new Error(
        "Peer does not expose the pinned A2A v1 JSON-RPC profile.",
      );
    await validateOutboundUrl(endpoint, new URL(selected.url));
    // A peer card cannot select another origin or elevate supported auth/capabilities.
    if (card.securityRequirements.length && !endpoint.credentialKey)
      throw new Error("Peer requires an approved credential reference.");
    for (const requirement of card.securityRequirements)
      for (const name of Object.keys(requirement.schemes)) {
        const scheme = card.securitySchemes[name]?.scheme;
        if (
          scheme?.$case !== "httpAuthSecurityScheme" ||
          scheme.value.scheme.toLowerCase() !== "bearer"
        )
          throw new Error("Peer requires unsupported authentication.");
      }
    const pinned = { ...card, supportedInterfaces: [selected] };
    const guarded = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const current = this.endpoint(call.endpoint);
      if (JSON.stringify(current) !== JSON.stringify(endpoint))
        throw new Error("A2A endpoint grant changed.");
      call.signal?.throwIfAborted();
      return fetcher(input, { ...init, signal: call.signal ?? init?.signal });
    }) as typeof fetch;
    const client = await new ClientFactory({
      transports: [new JsonRpcTransportFactory({ fetchImpl: guarded })],
      clientConfig: { polling: true },
    }).createFromAgentCard(pinned);
    return { client, card: pinned, rawCard: raw };
  }
  discover(call: A2aClientCall) {
    return this.run(call, (bound) => this.discoverInternal(bound));
  }
  private async discoverInternal(call: A2aClientCall) {
    const { rawCard } = await this.connection(call);
    // Preserve signed wire field presence; SDK serialization can omit required defaults.
    return rawCard;
  }
  send(
    call: A2aClientCall,
    input: {
      messageId: string;
      text: string;
      taskId?: string;
      contextId?: string;
    },
  ) {
    return this.run(call, (bound) => this.sendInternal(bound, input));
  }
  private async sendInternal(
    call: A2aClientCall,
    input: {
      messageId: string;
      text: string;
      taskId?: string;
      contextId?: string;
    },
  ) {
    if (
      !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.messageId) ||
      !input.text.trim() ||
      Buffer.byteLength(input.text) > 32 * 1024
    )
      throw new Error("Invalid bounded A2A message.");
    if (
      input.taskId &&
      !this.store.owns(
        call.scope,
        this.storageEndpoint(call.endpoint),
        input.taskId,
      )
    )
      throw new Error("Remote task does not belong to this calling scope.");
    if (
      input.contextId &&
      !this.store.ownsContext(
        call.scope,
        this.storageEndpoint(call.endpoint),
        input.contextId,
      )
    )
      throw new Error("Remote context does not belong to this calling scope.");
    const storageEndpoint = this.storageEndpoint(call.endpoint);
    const { client } = await this.connection(call);
    const params = SendMessageRequest.fromJSON({
      message: {
        messageId: input.messageId,
        role: "ROLE_USER",
        parts: [{ text: input.text }],
        taskId: input.taskId,
        contextId: input.contextId,
      },
      configuration: {
        returnImmediately: true,
        acceptedOutputModes: ["text/plain"],
        historyLength: 10,
      },
    });
    const reserved = this.store.reserve(
      call.scope,
      storageEndpoint,
      input.messageId,
      SendMessageRequest.toJSON(params),
    );
    if (!reserved.created) return reserved.result;
    try {
      const result = await client.sendMessage(params, { signal: call.signal });
      const wire =
        "messageId" in result
          ? { message: Message.toJSON(result) }
          : { task: Task.toJSON(result) };
      validateRemoteResult(wire);
      this.store.complete(call.scope, storageEndpoint, input.messageId, wire);
      return wire;
    } catch {
      this.store.unknown(call.scope, storageEndpoint, input.messageId);
      throw new Error(
        "Remote send failed; outcome may be unknown. Do not blindly resend.",
      );
    }
  }
  private owned(call: A2aClientCall, id: string) {
    if (!this.store.owns(call.scope, this.storageEndpoint(call.endpoint), id))
      throw new Error("Remote task does not belong to this calling scope.");
  }
  list(call: A2aClientCall) {
    this.endpoint(call.endpoint);
    return this.store.list(call.scope, this.storageEndpoint(call.endpoint));
  }
  get(call: A2aClientCall, id: string) {
    return this.run(call, (bound) => this.getInternal(bound, id));
  }
  private async getInternal(call: A2aClientCall, id: string) {
    this.owned(call, id);
    const { client } = await this.connection(call);
    const task = Task.toJSON(
      await client.getTask(GetTaskRequest.fromJSON({ id, historyLength: 10 }), {
        signal: call.signal,
      }),
    );
    validateRemoteResult(task);
    return task;
  }
  cancel(call: A2aClientCall, id: string) {
    return this.run(call, (bound) => this.cancelInternal(bound, id));
  }
  private async cancelInternal(call: A2aClientCall, id: string) {
    this.owned(call, id);
    const { client } = await this.connection(call);
    return Task.toJSON(
      await client.cancelTask(CancelTaskRequest.fromJSON({ id }), {
        signal: call.signal,
      }),
    );
  }
  async *subscribe(call: A2aClientCall, id: string) {
    const scope = this.callScope(call);
    try {
      yield* this.subscribeInternal(scope.call, id);
    } finally {
      scope.finish();
    }
  }
  private async *subscribeInternal(call: A2aClientCall, id: string) {
    this.owned(call, id);
    const { client, card } = await this.connection(call);
    if (!card.capabilities?.streaming)
      throw new Error("Peer streaming is unsupported.");
    let bytes = 0;
    const artifacts = new A2aArtifactAccumulator();
    for await (const event of client.resubscribeTask(
      SubscribeToTaskRequest.fromJSON({ id }),
      { signal: call.signal },
    )) {
      this.endpoint(call.endpoint);
      const wire = StreamResponse.toJSON(event) as any;
      if (wire.task) validateRemoteResult(wire.task);
      if (wire.statusUpdate?.status?.message)
        validateParts(wire.statusUpdate.status.message.parts);
      if (wire.artifactUpdate) artifacts.apply(wire.artifactUpdate);
      bytes += Buffer.byteLength(JSON.stringify(wire));
      if (bytes > A2A_PROFILE.maxStreamBytes)
        throw new Error("Remote stream limit.");
      yield wire;
    }
  }
}
