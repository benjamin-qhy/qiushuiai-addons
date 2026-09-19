import { randomUUID } from "node:crypto";
import {
  pushEnabled,
  validateWireCallback,
  wireCallback,
} from "./push-policy.js";
import { resolveA2aSecret, type SecretResolver } from "./security.js";
import { partsText, SUPPORTED_MODES } from "./parts.js";
import {
  TaskPushNotificationConfig,
  type GetTaskPushNotificationConfigRequest,
  type DeleteTaskPushNotificationConfigRequest,
  type ListTaskPushNotificationConfigsRequest,
  type ListTaskPushNotificationConfigsResponse,
  AgentCard,
  Message,
  Task,
  TaskState,
  StreamResponse,
  Artifact,
  type SendMessageRequest,
  type GetTaskRequest,
  type ListTasksRequest,
  type ListTasksResponse,
  type CancelTaskRequest,
  type SubscribeToTaskRequest,
} from "@a2a-js/sdk";
import {
  type A2ARequestHandler,
  type ServerCallContext,
} from "@a2a-js/sdk/server";
import {
  TaskNotFoundError,
  TaskNotCancelableError,
  UnsupportedOperationError,
  PushNotificationNotSupportedError,
  ContentTypeNotSupportedError,
  RequestMalformedError,
} from "@a2a-js/sdk/errors";
import { createHash } from "node:crypto";
import { type A2aConfig } from "./config.js";
import { authorizeTarget } from "./security.js";
import { A2aTaskStore, type TaskRecord, isTerminalTask } from "./task-store.js";
import { type OperationAdapter } from "./runtime-api.js";
import { A2A_PROFILE } from "./profile.js";

export const REQUEST_SIGNAL = "a2a-request-signal";
const interrupted = new Set([
  TaskState.TASK_STATE_INPUT_REQUIRED,
  TaskState.TASK_STATE_AUTH_REQUIRED,
]);
function taskView(task: Task, history?: number, artifacts = true): Task {
  const copy = Task.fromJSON(Task.toJSON(task));
  if (history !== undefined) {
    if (!Number.isSafeInteger(history) || history < 0)
      throw new RequestMalformedError("Invalid historyLength");
    copy.history =
      history === 0 ? [] : copy.history.slice(-Math.min(history, 100));
  }
  if (!artifacts) copy.artifacts = [];
  return copy;
}

function caller(context: ServerCallContext): string {
  if (!context.user?.isAuthenticated || !context.user.userName)
    throw new TaskNotFoundError();
  return context.user.userName;
}
export class A2aRequestHandler implements A2ARequestHandler {
  constructor(
    private readonly target: string,
    private readonly config: () => A2aConfig,
    private readonly store: A2aTaskStore,
    private readonly operations: OperationAdapter,
    private readonly secrets: SecretResolver = resolveA2aSecret,
  ) {}
  private owner(context: ServerCallContext) {
    const id = caller(context);
    if (!authorizeTarget(this.config(), id, this.target))
      throw new TaskNotFoundError();
    return id;
  }
  async getAgentCard(): Promise<AgentCard> {
    const config = this.config(),
      agent = config.agents.find((a) => a.enabled && a.id === this.target);
    if (!config.enabled || !config.inbound || !agent)
      throw new TaskNotFoundError();
    return AgentCard.fromJSON({
      name: agent.name,
      description: agent.description,
      version: "0.4.1",
      supportedInterfaces: [
        {
          url: new URL(
            `/api/addons/a2a/agents/${this.target}/rpc`,
            config.publicBaseUrl,
          ).href,
          protocolBinding: "JSONRPC",
          protocolVersion: A2A_PROFILE.wireVersion,
        },
      ],
      capabilities: {
        streaming: true,
        pushNotifications: pushEnabled(config),
        extendedAgentCard: false,
      },
      defaultInputModes: SUPPORTED_MODES,
      defaultOutputModes: ["text/plain"],
      skills: [
        {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          tags: ["configured"],
        },
      ],
      securitySchemes: {
        bearer: { httpAuthSecurityScheme: { scheme: "bearer" } },
      },
      securityRequirements: [{ schemes: { bearer: { list: [] } } }],
    });
  }
  private checked(principal: string, id: string): TaskRecord {
    const record = this.store.get(principal, id);
    if (record.target !== this.target) throw new TaskNotFoundError();
    return record;
  }
  private async refresh(principal: string, id: string): Promise<TaskRecord> {
    const record = this.checked(principal, id);
    if (!record.operationId) return record;
    const client = this.operations.forPrincipal(principal);
    if (
      pushEnabled(this.config()) &&
      this.store.push.list(principal, id).length &&
      client.events
    ) {
      const batch = await client.events(record.operationId, record.sequence);
      for (const event of batch.events)
        this.store.sync(principal, id, event.snapshot);
      return this.store.sync(principal, id, batch.snapshot);
    }
    const operation = await client.get(record.operationId);
    return this.store.sync(principal, id, operation);
  }
  private async admit(
    params: SendMessageRequest,
    context: ServerCallContext,
  ): Promise<TaskRecord> {
    const principal = this.owner(context),
      message = params.message;
    if (!message || !message.messageId || !message.parts.length)
      throw new RequestMalformedError("Message required");
    const accepted = params.configuration?.acceptedOutputModes;
    if (
      accepted?.length &&
      !accepted.includes("text/plain") &&
      !accepted.includes("*/*")
    )
      throw new ContentTypeNotSupportedError(
        "Only text/plain output is supported.",
      );
    const signal = context.state.get(REQUEST_SIGNAL) as AbortSignal | undefined;
    signal?.throwIfAborted();
    const text = partsText(message);
    if (!text.trim()) throw new RequestMalformedError("Text input required");
    if (message.taskId) {
      const current = await this.refresh(principal, message.taskId);
      if (message.contextId && message.contextId !== current.contextId)
        throw new TaskNotFoundError();
      // Check prior successful continuation before terminal rejection; retries are harmless.
      if (this.store.completedContinuation(principal, current.id, message))
        return current;
      if (isTerminalTask(current.task))
        throw new UnsupportedOperationError("Task is not continuable");
      if (!current.operationId) {
        // Approval/budget denial before admission is retryable with a new continuation.
        this.store.reserveContinuation(principal, current.id, message);
        const key = createHash("sha256")
          .update("a2a:" + current.id)
          .digest("hex");
        try {
          const receipt = await this.operations.forPrincipal(principal).admit({
            target: this.target,
            idempotencyKey: key,
            text: partsText(current.task.history[0]),
          });
          if (!receipt.operation) {
            this.store.completeContinuation(principal, message.messageId);
            return this.store.reject(
              principal,
              current.id,
              receipt.admission === "rejected" ? "rejected" : "input_required",
              receipt.admission,
            );
          }
          this.store.attachOperation(
            principal,
            current.id,
            receipt.operation.id,
          );
          this.store.completeContinuation(principal, message.messageId);
          return this.store.sync(principal, current.id, receipt.operation);
        } catch (error) {
          this.store.failContinuation(principal, message.messageId);
          throw error;
        }
      }
      const continuation = this.store.reserveContinuation(
        principal,
        current.id,
        message,
      );
      if (!continuation.created) return this.refresh(principal, current.id);
      const client = this.operations.forPrincipal(principal);
      try {
        const op = await client.get(current.operationId);
        if (op.status === "budget_blocked" || op.status === "approval_required")
          await client.resume(current.operationId);
        else if (op.status === "input_required")
          await client.continue(current.operationId, text);
        else throw new UnsupportedOperationError("Task is not awaiting input");
        this.store.completeContinuation(principal, message.messageId);
      } catch (error) {
        this.store.failContinuation(principal, message.messageId);
        throw error;
      }
      return this.refresh(principal, current.id);
    }
    const suppliedPush = params.configuration?.taskPushNotificationConfig;
    if (suppliedPush)
      await validateWireCallback(
        this.config(),
        principal,
        this.target,
        { ...suppliedPush, taskId: "pending" },
        this.secrets,
      );
    const reserved = this.store.reserve(principal, this.target, message),
      record = reserved.record;
    if (suppliedPush)
      await this.createTaskPushNotificationConfig(
        {
          ...suppliedPush,
          taskId: record.id,
          id: suppliedPush.id || "send-default",
        },
        context,
      );
    if (record.operationId || isTerminalTask(record.task))
      return this.refresh(principal, record.id);
    // Stable key derives from principal-scoped task ID; ambiguous admission retry finds the same core operation.
    const key = createHash("sha256")
      .update("a2a:" + record.id)
      .digest("hex");
    const receipt = await this.operations
      .forPrincipal(principal)
      .admit({ target: this.target, idempotencyKey: key, text });
    if (!receipt.operation)
      return this.store.reject(
        principal,
        record.id,
        receipt.admission === "rejected" ? "rejected" : "input_required",
        receipt.admission,
      );
    this.store.attachOperation(principal, record.id, receipt.operation.id);
    return this.store.sync(principal, record.id, receipt.operation);
  }
  private async wait(
    principal: string,
    id: string,
    context: ServerCallContext,
  ): Promise<Task> {
    const signal = context.state.get(REQUEST_SIGNAL) as AbortSignal | undefined;
    for (;;) {
      signal?.throwIfAborted();
      if (!authorizeTarget(this.config(), principal, this.target))
        throw new TaskNotFoundError();
      const record = await this.refresh(principal, id);
      if (
        isTerminalTask(record.task) ||
        interrupted.has(record.task.status!.state)
      )
        return record.task;
      await pause(signal);
    }
  }
  async sendMessage(
    params: SendMessageRequest,
    context: ServerCallContext,
  ): Promise<Task | Message> {
    const principal = this.owner(context),
      record = await this.admit(params, context);
    const task = params.configuration?.returnImmediately
      ? record.task
      : await this.wait(principal, record.id, context);
    return taskView(task, params.configuration?.historyLength);
  }
  async *sendMessageStream(
    params: SendMessageRequest,
    context: ServerCallContext,
  ): AsyncGenerator<StreamResponse> {
    const principal = this.owner(context),
      record = await this.admit(params, context);
    yield* this.stream(
      principal,
      record.id,
      context,
      params.configuration?.historyLength,
    );
  }
  private async *stream(
    principal: string,
    id: string,
    context: ServerCallContext,
    history?: number,
  ): AsyncGenerator<StreamResponse> {
    const signal = context.state.get(REQUEST_SIGNAL) as AbortSignal | undefined;
    let record = await this.refresh(principal, id),
      sequence = record.sequence;
    yield StreamResponse.fromJSON({
      task: Task.toJSON(taskView(record.task, history)),
    });
    while (!isTerminalTask(record.task)) {
      await pause(signal);
      if (!authorizeTarget(this.config(), principal, this.target))
        throw new TaskNotFoundError();
      record = await this.refresh(principal, id);
      if (record.sequence <= sequence) continue;
      sequence = record.sequence;
      if (record.task.artifacts.length)
        yield StreamResponse.fromJSON({
          artifactUpdate: {
            taskId: id,
            contextId: record.contextId,
            artifact: Artifact.toJSON(record.task.artifacts[0]),
            append: false,
            lastChunk: true,
          },
        });
      yield StreamResponse.fromJSON({
        statusUpdate: {
          taskId: id,
          contextId: record.contextId,
          status: (Task.toJSON(record.task) as any).status,
        },
      });
    }
  }
  async getTask(
    params: GetTaskRequest,
    context: ServerCallContext,
  ): Promise<Task> {
    return taskView(
      (await this.refresh(this.owner(context), params.id)).task,
      params.historyLength,
    );
  }
  async cancelTask(
    params: CancelTaskRequest,
    context: ServerCallContext,
  ): Promise<Task> {
    const principal = this.owner(context),
      record = await this.refresh(principal, params.id);
    if (!record.operationId || isTerminalTask(record.task)) {
      if (record.task.status?.state === TaskState.TASK_STATE_CANCELED)
        return record.task;
      throw new TaskNotCancelableError();
    }
    const result = await this.operations
      .forPrincipal(principal)
      .cancel(record.operationId);
    if (result.outcome === "not_cancellable")
      throw new TaskNotCancelableError();
    if (result.outcome === "cancelled")
      return this.store.sync(principal, record.id, result.operation).task;
    const final = await this.wait(principal, record.id, context);
    if (final.status?.state !== TaskState.TASK_STATE_CANCELED)
      throw new TaskNotCancelableError();
    return final;
  }
  async *resubscribe(
    params: SubscribeToTaskRequest,
    context: ServerCallContext,
  ): AsyncGenerator<StreamResponse> {
    yield* this.stream(this.owner(context), params.id, context);
  }
  async listTasks(
    params: ListTasksRequest,
    context: ServerCallContext,
  ): Promise<ListTasksResponse> {
    const principal = this.owner(context),
      size = params.pageSize ?? 50;
    if (!Number.isSafeInteger(size) || size < 1 || size > 100)
      throw new RequestMalformedError("Invalid pageSize");
    // Reconcile before filtering/sorting; task persistence must not depend on active streams.
    for (const record of this.store.list(principal, null, 1000))
      if (record.target === this.target && !isTerminalTask(record.task))
        await this.refresh(principal, record.id);
    const listed = this.store.page(principal, this.target, params, size);
    return {
      tasks: await Promise.all(
        listed.records.map(async (r) =>
          taskView(
            (await this.refresh(principal, r.id)).task,
            params.historyLength,
            params.includeArtifacts === true,
          ),
        ),
      ),
      nextPageToken: listed.nextPageToken,
      pageSize: size,
      totalSize: listed.total,
    };
  }
  async getAuthenticatedExtendedAgentCard(): Promise<never> {
    throw new UnsupportedOperationError();
  }

  async createTaskPushNotificationConfig(
    params: TaskPushNotificationConfig,
    context: ServerCallContext,
  ): Promise<TaskPushNotificationConfig> {
    const principal = this.owner(context);
    if (!pushEnabled(this.config()))
      throw new PushNotificationNotSupportedError();
    const task = this.checked(principal, params.taskId);
    const grant = await validateWireCallback(
      this.config(),
      principal,
      this.target,
      params,
      this.secrets,
    );
    (
      context.state.get(REQUEST_SIGNAL) as AbortSignal | undefined
    )?.throwIfAborted();
    this.owner(context);
    if (
      JSON.stringify(
        this.config().push?.callbacks.find((c) => c.id === grant.id),
      ) !== JSON.stringify(grant)
    )
      throw new TaskNotFoundError();
    return this.store.push.transaction(() => {
      const callbackId = params.id || randomUUID();
      const previous = this.store.push.get(principal, task.id, callbackId);
      const callback = this.store.push.upsert({
        principal,
        taskId: task.id,
        id: callbackId,
        url: grant.url,
        credentialKey: grant.credentialKey,
        allowPrivate: grant.allowPrivate,
      });
      if (!previous || previous.revision !== callback.revision)
        this.store.push.enqueue(
          principal,
          task.id,
          "initial:" + callback.id + ":" + callback.revision,
          { task: Task.toJSON(taskView(task.task, 0)) },
          Date.now(),
          callback.id,
        );
      return wireCallback(callback);
    });
  }
  async getTaskPushNotificationConfig(
    params: GetTaskPushNotificationConfigRequest,
    context: ServerCallContext,
  ): Promise<TaskPushNotificationConfig> {
    const principal = this.owner(context);
    if (!pushEnabled(this.config()))
      throw new PushNotificationNotSupportedError();
    this.checked(principal, params.taskId);
    const callback = this.store.push.get(principal, params.taskId, params.id);
    if (!callback) throw new TaskNotFoundError();
    return wireCallback(callback);
  }
  async listTaskPushNotificationConfigs(
    params: ListTaskPushNotificationConfigsRequest,
    context: ServerCallContext,
  ): Promise<ListTaskPushNotificationConfigsResponse> {
    const principal = this.owner(context);
    if (!pushEnabled(this.config()))
      throw new PushNotificationNotSupportedError();
    this.checked(principal, params.taskId);
    try {
      const page = this.store.push.page(
        principal,
        params.taskId,
        params.pageSize || 4,
        params.pageToken,
      );
      return {
        configs: page.configs.map(wireCallback),
        nextPageToken: page.nextPageToken,
      };
    } catch {
      throw new RequestMalformedError("Invalid push pagination.");
    }
  }
  async deleteTaskPushNotificationConfig(
    params: DeleteTaskPushNotificationConfigRequest,
    context: ServerCallContext,
  ): Promise<void> {
    const principal = this.owner(context);
    if (!pushEnabled(this.config()))
      throw new PushNotificationNotSupportedError();
    this.checked(principal, params.taskId);
    this.store.push.delete(principal, params.taskId, params.id);
  }
}
async function pause(signal?: AbortSignal) {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new Error("Request closed"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, 100);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
