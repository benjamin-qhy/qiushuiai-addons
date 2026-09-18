import { Database } from "bun:sqlite";
import { randomUUID, createHash } from "node:crypto";

/** Internal operator-vetted callback. Credentials are references, never wire values. */
export interface PushCallback {
  principal: string;
  taskId: string;
  id: string;
  url: string;
  credentialKey: string;
  allowPrivate: boolean;
  revision: number;
}
export interface PushDelivery {
  id: string;
  principal: string;
  taskId: string;
  configId: string;
  revision: number;
  eventId: string;
  payload: string;
  payloadHash: string;
  state: "pending" | "sending" | "delivered" | "abandoned" | "revoked";
  attempts: number;
  nextAttempt: number;
  expiresAt: number;
  lease: string | null;
}
export const PUSH_MAX_ATTEMPTS = 5;
const MAX_PENDING = 1000,
  MAX_BYTES = 256 * 1024,
  TTL_MS = 24 * 60 * 60 * 1000;
function id(value: string): void {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 128 ||
    /[\r\n\0]/.test(value)
  )
    throw new Error("Invalid push identifier.");
}
function callbackValue(value: Omit<PushCallback, "revision">): void {
  for (const field of [value.principal, value.taskId, value.id]) id(field);
  const url = new URL(value.url);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.href !== value.url ||
    !(
      url.protocol === "https:" ||
      (value.allowPrivate && url.protocol === "http:")
    )
  )
    throw new Error("Invalid approved push URL.");
  if (!/^[A-Za-z0-9_][A-Za-z0-9_./-]{0,127}$/.test(value.credentialKey))
    throw new Error("Push credential reference required.");
  if (typeof value.allowPrivate !== "boolean")
    throw new Error("Explicit private-address policy required.");
}
export function validatePushPayload(taskId: string, payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("Invalid push StreamResponse.");
  const p = payload as Record<string, any>,
    keys = Object.keys(p);
  if (
    keys.length !== 1 ||
    !["task", "message", "statusUpdate", "artifactUpdate"].includes(keys[0])
  )
    throw new Error(
      "Push payload must have exactly one StreamResponse variant.",
    );
  const body = p[keys[0]];
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    (keys[0] === "task" ? body.id : body.taskId) !== taskId
  )
    throw new Error("Push task identity mismatch.");
  const json = JSON.stringify(payload);
  if (Buffer.byteLength(json) > MAX_BYTES)
    throw new Error("Push payload size limit.");
  return json;
}
function readCallback(r: any): PushCallback | null {
  return r
    ? {
        principal: r.principal,
        taskId: r.task_id,
        id: r.id,
        url: r.url,
        credentialKey: r.credential_key,
        allowPrivate: r.allow_private === 1,
        revision: r.revision,
      }
    : null;
}
function delivery(r: any): PushDelivery | null {
  return r
    ? {
        id: r.id,
        principal: r.principal,
        taskId: r.task_id,
        configId: r.config_id,
        revision: r.revision,
        eventId: r.event_id,
        payload: r.payload,
        payloadHash: r.payload_hash,
        state: r.state,
        attempts: r.attempts,
        nextAttempt: r.next_attempt,
        expiresAt: r.expires_at,
        lease: r.lease,
      }
    : null;
}

/** No networking or timers. Caller owns DB/transaction and verifies task/principal policy.
 * This store must share the task DB so sync + outbox enqueue can commit atomically.
 */
export class A2aPushStore {
  constructor(
    private readonly db: Database,
    private readonly requireTask: (principal: string, taskId: string) => void,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS a2a_push_configs(
    principal TEXT NOT NULL,task_id TEXT NOT NULL,id TEXT NOT NULL,url TEXT NOT NULL,credential_key TEXT NOT NULL,allow_private INTEGER NOT NULL,revision INTEGER NOT NULL,
    PRIMARY KEY(principal,task_id,id)) STRICT;
    CREATE TABLE IF NOT EXISTS a2a_push_revisions(principal TEXT NOT NULL,task_id TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(principal,task_id,id)) STRICT;
    CREATE TABLE IF NOT EXISTS a2a_push_outbox(
    id TEXT PRIMARY KEY,principal TEXT NOT NULL,task_id TEXT NOT NULL,config_id TEXT NOT NULL,revision INTEGER NOT NULL,event_id TEXT NOT NULL,payload TEXT NOT NULL,payload_hash TEXT NOT NULL,
    state TEXT NOT NULL,attempts INTEGER NOT NULL,next_attempt INTEGER NOT NULL,expires_at INTEGER NOT NULL,lease TEXT,
    UNIQUE(principal,task_id,config_id,revision,event_id)) STRICT;
    CREATE INDEX IF NOT EXISTS a2a_push_due ON a2a_push_outbox(state,next_attempt);`);
  }
  upsert(value: Omit<PushCallback, "revision">): PushCallback {
    callbackValue(value);
    return this.db
      .transaction(() => {
        this.requireTask(value.principal, value.taskId);
        const previous = this.get(value.principal, value.taskId, value.id);
        if (
          previous &&
          previous.url === value.url &&
          previous.credentialKey === value.credentialKey &&
          previous.allowPrivate === value.allowPrivate
        )
          return previous;
        const count = this.db
          .query(
            "SELECT count(*) n FROM a2a_push_configs WHERE principal=? AND task_id=?",
          )
          .get(value.principal, value.taskId) as { n: number };
        if (!previous && count.n >= 4) throw new Error("Push callback limit.");
        const prior = this.db
          .query(
            "SELECT revision FROM a2a_push_revisions WHERE principal=? AND task_id=? AND id=?",
          )
          .get(value.principal, value.taskId, value.id) as {
          revision: number;
        } | null;
        const revision = (prior?.revision ?? 0) + 1;
        this.db
          .query("INSERT OR REPLACE INTO a2a_push_revisions VALUES(?,?,?,?)")
          .run(value.principal, value.taskId, value.id, revision);
        this.revokeDeliveries(value.principal, value.taskId, value.id);
        this.db
          .query(
            "INSERT OR REPLACE INTO a2a_push_configs VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            value.principal,
            value.taskId,
            value.id,
            value.url,
            value.credentialKey,
            value.allowPrivate ? 1 : 0,
            revision,
          );
        return { ...value, revision };
      })
      .immediate();
  }
  get(
    principal: string,
    taskId: string,
    configId: string,
  ): PushCallback | null {
    this.requireTask(principal, taskId);
    return readCallback(
      this.db
        .query(
          "SELECT * FROM a2a_push_configs WHERE principal=? AND task_id=? AND id=?",
        )
        .get(principal, taskId, configId),
    );
  }
  list(principal: string, taskId: string): PushCallback[] {
    this.requireTask(principal, taskId);
    return this.db
      .query(
        "SELECT * FROM a2a_push_configs WHERE principal=? AND task_id=? ORDER BY id",
      )
      .all(principal, taskId)
      .map((r) => readCallback(r)!);
  }
  delete(principal: string, taskId: string, configId: string): void {
    this.db
      .transaction(() => {
        this.requireTask(principal, taskId);
        this.revokeDeliveries(principal, taskId, configId);
        this.db
          .query(
            "DELETE FROM a2a_push_configs WHERE principal=? AND task_id=? AND id=?",
          )
          .run(principal, taskId, configId);
      })
      .immediate();
  }
  private revokeDeliveries(
    principal: string,
    taskId: string,
    configId: string,
  ) {
    this.db
      .query(
        "UPDATE a2a_push_outbox SET state='revoked',lease=NULL WHERE principal=? AND task_id=? AND config_id=? AND state IN ('pending','sending')",
      )
      .run(principal, taskId, configId);
  }
  enqueue(
    principal: string,
    taskId: string,
    eventId: string,
    payload: unknown,
    now = Date.now(),
  ): string[] {
    id(eventId);
    const text = validatePushPayload(taskId, payload),
      hash = createHash("sha256").update(text).digest("hex");
    return this.db
      .transaction(() => {
        const callbacks = this.list(principal, taskId),
          ids: string[] = [];
        const count = this.db
          .query(
            "SELECT count(*) n FROM a2a_push_outbox WHERE principal=? AND state IN ('pending','sending')",
          )
          .get(principal) as { n: number };
        for (const cfg of callbacks) {
          const prior = delivery(
            this.db
              .query(
                "SELECT * FROM a2a_push_outbox WHERE principal=? AND task_id=? AND config_id=? AND revision=? AND event_id=?",
              )
              .get(principal, taskId, cfg.id, cfg.revision, eventId),
          );
          if (prior) {
            if (prior.payloadHash !== hash)
              throw new Error("Push event identity conflicts.");
            ids.push(prior.id);
            continue;
          }
          if (count.n++ >= MAX_PENDING)
            throw new Error("Push pending quota exceeded.");
          const deliveryId = randomUUID();
          this.db
            .query(
              "INSERT INTO a2a_push_outbox VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            )
            .run(
              deliveryId,
              principal,
              taskId,
              cfg.id,
              cfg.revision,
              eventId,
              text,
              hash,
              "pending",
              0,
              now,
              now + TTL_MS,
              null,
            );
          ids.push(deliveryId);
        }
        return ids;
      })
      .immediate();
  }
  claim(now = Date.now()): PushDelivery | null {
    return this.db
      .transaction(() => {
        this.db
          .query(
            "UPDATE a2a_push_outbox SET state='abandoned',lease=NULL WHERE state='pending' AND (expires_at<=? OR attempts>=?)",
          )
          .run(now, PUSH_MAX_ATTEMPTS);
        const row = delivery(
          this.db
            .query(
              "SELECT * FROM a2a_push_outbox WHERE state='pending' AND next_attempt<=? ORDER BY next_attempt,id LIMIT 1",
            )
            .get(now),
        );
        if (!row) return null;
        const cfg = readCallback(
          this.db
            .query(
              "SELECT * FROM a2a_push_configs WHERE principal=? AND task_id=? AND id=?",
            )
            .get(row.principal, row.taskId, row.configId),
        );
        if (!cfg || cfg.revision !== row.revision) {
          this.db
            .query("UPDATE a2a_push_outbox SET state='revoked' WHERE id=?")
            .run(row.id);
          return null;
        }
        const lease = randomUUID();
        this.db
          .query(
            "UPDATE a2a_push_outbox SET state='sending',attempts=attempts+1,lease=? WHERE id=?",
          )
          .run(lease, row.id);
        return {
          ...row,
          state: "sending" as const,
          attempts: row.attempts + 1,
          lease,
        };
      })
      .immediate();
  }
  settle(
    id: string,
    lease: string,
    success: boolean,
    retryable: boolean,
    now = Date.now(),
  ): boolean {
    return this.db
      .transaction(() => {
        const row = delivery(
          this.db
            .query(
              "SELECT * FROM a2a_push_outbox WHERE id=? AND lease=? AND state='sending'",
            )
            .get(id, lease),
        );
        if (!row) return false;
        const stop =
          !retryable ||
          row.attempts >= PUSH_MAX_ATTEMPTS ||
          row.expiresAt <= now;
        const state = success ? "delivered" : stop ? "abandoned" : "pending";
        const delay = Math.min(
          60000,
          1000 * 2 ** Math.max(0, row.attempts - 1),
        );
        this.db
          .query(
            "UPDATE a2a_push_outbox SET state=?,next_attempt=?,lease=NULL WHERE id=? AND lease=?",
          )
          .run(state, now + delay, id, lease);
        return true;
      })
      .immediate();
  }
  /** Single-owner startup only. Retry the same bytes/ID after uncertain delivery; clients must deduplicate. */
  recover(now = Date.now()): number {
    return this.db
      .query(
        "UPDATE a2a_push_outbox SET state=CASE WHEN expires_at<=? OR attempts>=? THEN 'abandoned' ELSE 'pending' END,next_attempt=?,lease=NULL WHERE state='sending'",
      )
      .run(now, PUSH_MAX_ATTEMPTS, now).changes;
  }
  inspect(principal: string, taskId: string): PushDelivery[] {
    this.requireTask(principal, taskId);
    return this.db
      .query(
        "SELECT * FROM a2a_push_outbox WHERE principal=? AND task_id=? ORDER BY id LIMIT 1000",
      )
      .all(principal, taskId)
      .map((r) => delivery(r)!);
  }
}
