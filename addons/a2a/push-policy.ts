import { createHash, timingSafeEqual } from "node:crypto";
import { TaskPushNotificationConfig } from "@a2a-js/sdk";
import {
  PushNotificationNotSupportedError,
  RequestMalformedError,
  TaskNotFoundError,
} from "@a2a-js/sdk/errors";
import type { A2aConfig, PushCallbackGrant } from "./config.js";
import type { SecretResolver } from "./security.js";
import { authorizeTarget, validateOutboundUrl } from "./security.js";
import type { PushCallback } from "./push-store.js";

export function pushEnabled(config: A2aConfig): boolean {
  return !!(config.enabled && config.inbound && config.push?.enabled);
}
export function callbackGrant(
  config: A2aConfig,
  principal: string,
  target: string,
  url: string,
): PushCallbackGrant | null {
  if (!pushEnabled(config) || !authorizeTarget(config, principal, target))
    return null;
  return (
    config.push!.callbacks.find(
      (c) =>
        c.enabled &&
        c.principal === principal &&
        c.targets.includes(target) &&
        c.url === url,
    ) ?? null
  );
}
export function sameCredential(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}
export async function validateWireCallback(
  config: A2aConfig,
  principal: string,
  target: string,
  input: TaskPushNotificationConfig,
  secrets: SecretResolver,
): Promise<PushCallbackGrant> {
  if (!pushEnabled(config)) throw new PushNotificationNotSupportedError();
  if (
    input.tenant ||
    input.token ||
    !input.taskId ||
    input.taskId.length > 128 ||
    (input.id && !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.id))
  )
    throw new RequestMalformedError(
      "Invalid push configuration identity. Token field is unsupported; use Bearer authentication.",
    );
  const grant = callbackGrant(config, principal, target, input.url);
  if (!grant) throw new TaskNotFoundError();
  if (
    typeof input.authentication?.scheme !== "string" ||
    input.authentication.scheme.toLowerCase() !== "bearer" ||
    typeof input.authentication.credentials !== "string" ||
    !input.authentication.credentials ||
    input.authentication.credentials.length > 4096
  )
    throw new RequestMalformedError("Approved Bearer authentication required.");
  const credential = await secrets(grant.credentialKey);
  if (
    !credential ||
    credential.length < 24 ||
    !sameCredential(input.authentication.credentials, credential)
  )
    throw new RequestMalformedError(
      "Callback credential does not match approved policy.",
    );
  await validateOutboundUrl(
    {
      alias: grant.id,
      cardUrl: grant.url,
      allowPrivate: grant.allowPrivate,
      enabled: true,
    },
    new URL(grant.url),
  );
  return grant;
}
/** Current secret bytes never persisted or returned by config reads. */
export function wireCallback(
  callback: PushCallback,
): TaskPushNotificationConfig {
  return TaskPushNotificationConfig.fromJSON({
    id: callback.id,
    taskId: callback.taskId,
    url: callback.url,
    authentication: { scheme: "Bearer" },
  });
}
