import { A2aPushStore } from "./push-store.js";
import { Database } from "bun:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import {
  createHash,
  createHmac,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import {
  Message,
  Task,
  TaskState,
  Artifact,
  type ListTasksRequest,
  type TaskStatus,
} from "@a2a-js/sdk";
import {
  TaskNotFoundError,
  RequestMalformedError,
  UnsupportedOperationError,
} from "@a2a-js/sdk/errors";

export interface TaskRecord {
  id: string;
  principal: string;
  target: string;
  contextId: string;
  operationId: string | null;
  requestHash: string;
  messageId: string;
  task: Task;
  sequence: number;
}
export interface PublicOperation {
  id: string;
  status: string;
  sequence: number;
  output: string | null;
  reason: string | null;
  updatedAt: string;
}
const states: Record<string, TaskState> = {
  queued: TaskState.TASK_STATE_SUBMITTED,
  working: TaskState.TASK_STATE_WORKING,
  cancel_requested: TaskState.TASK_STATE_WORKING,
  approval_required: TaskState.TASK_STATE_INPUT_REQUIRED,
  input_required: TaskState.TASK_STATE_INPUT_REQUIRED,
  budget_blocked: TaskState.TASK_STATE_INPUT_REQUIRED,
  completed: TaskState.TASK_STATE_COMPLETED,
  failed: TaskState.TASK_STATE_FAILED,
  cancelled: TaskState.TASK_STATE_CANCELED,
  rejected: TaskState.TASK_STATE_REJECTED,
};
const terminal = new Set([
  TaskState.TASK_STATE_COMPLETED,
  TaskState.TASK_STATE_FAILED,
  TaskState.TASK_STATE_CANCELED,
  TaskState.TASK_STATE_REJECTED,
]);
export function isTerminalTask(task: Task): boolean {
  return terminal.has(task.status?.state ?? TaskState.TASK_STATE_UNSPECIFIED);
}
/** Protocol-only durable state, never QiushuiAI's messages database. */
export class A2aTaskStore {
  private readonly db: Database;
  readonly push: A2aPushStore;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, "tasks-v1.sqlite");
    this.db = new Database(path, { create: true });
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS contexts(id TEXT PRIMARY KEY, principal TEXT NOT NULL, target TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,principal TEXT NOT NULL,target TEXT NOT NULL,context_id TEXT NOT NULL REFERENCES contexts(id),operation_id TEXT,request_hash TEXT NOT NULL,message_id TEXT NOT NULL,task_json TEXT NOT NULL,sequence INTEGER NOT NULL,updated_at TEXT NOT NULL,UNIQUE(principal,message_id)) STRICT;
      CREATE TABLE IF NOT EXISTS messages(principal TEXT NOT NULL,message_id TEXT NOT NULL,task_id TEXT NOT NULL REFERENCES tasks(id),request_hash TEXT NOT NULL,outcome TEXT NOT NULL,PRIMARY KEY(principal,message_id)) STRICT;
    `);
    this.db
      .query("INSERT OR IGNORE INTO metadata VALUES(?,?)")
      .run("cursor-key", randomUUID() + randomUUID());
    this.push = new A2aPushStore(this.db, (principal, taskId) => {
      this.get(principal, taskId);
    });
  }
  private row(row: unknown): TaskRecord | null {
    if (!row) return null;
    const r = row as any;
    return {
      id: r.id,
      principal: r.principal,
      target: r.target,
      contextId: r.context_id,
      operationId: r.operation_id,
      requestHash: r.request_hash,
      messageId: r.message_id,
      task: Task.fromJSON(JSON.parse(r.task_json)),
      sequence: r.sequence,
    };
  }
  get(principal: string, id: string): TaskRecord {
    const row = this.row(
      this.db
        .query("SELECT * FROM tasks WHERE principal=? AND id=?")
        .get(principal, id),
    );
    if (!row) throw new TaskNotFoundError();
    return row;
  }
  reserve(
    principal: string,
    target: string,
    message: Message,
  ): { created: boolean; record: TaskRecord } {
    const hash = createHash("sha256")
      .update(JSON.stringify([target, Message.toJSON(message)]))
      .digest("hex");
    return this.db
      .transaction(() => {
        const prior = this.row(
          this.db
            .query("SELECT * FROM tasks WHERE principal=? AND message_id=?")
            .get(principal, message.messageId),
        );
        if (prior) {
          if (prior.requestHash !== hash)
            throw new RequestMalformedError("Message identity conflicts.");
          return { created: false, record: prior };
        }
        if (
          this.db
            .query("SELECT 1 FROM messages WHERE principal=? AND message_id=?")
            .get(principal, message.messageId)
        )
          throw new RequestMalformedError(
            "Message identity already used for continuation.",
          );
        if (message.taskId) throw new TaskNotFoundError();
        if (
          message.messageId.length > 128 ||
          Buffer.byteLength(JSON.stringify(Message.toJSON(message))) > 32 * 1024
        )
          throw new RequestMalformedError("Message limit.");
        const count = this.db
          .query("SELECT COUNT(*) AS n FROM tasks WHERE principal=?")
          .get(principal) as { n: number };
        if (count.n >= 1000)
          throw new UnsupportedOperationError("Task retention quota reached.");
        const contextId = message.contextId || randomUUID();
        if (message.contextId) {
          const context = this.db
            .query(
              "SELECT * FROM contexts WHERE principal=? AND target=? AND id=?",
            )
            .get(principal, target, contextId);
          if (!context) throw new TaskNotFoundError();
        } else
          this.db
            .query("INSERT INTO contexts VALUES(?,?,?)")
            .run(contextId, principal, target);
        const id = randomUUID(),
          now = new Date().toISOString();
        const task = Task.fromJSON({
          id,
          contextId,
          status: { state: "TASK_STATE_SUBMITTED", timestamp: now },
          history: [Message.toJSON(message)],
        });
        this.db
          .query("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?)")
          .run(
            id,
            principal,
            target,
            contextId,
            null,
            hash,
            message.messageId,
            JSON.stringify(Task.toJSON(task)),
            0,
            now,
          );
        return { created: true, record: this.get(principal, id) };
      })
      .immediate();
  }
  attachOperation(
    principal: string,
    id: string,
    operationId: string,
  ): TaskRecord {
    return this.db
      .transaction(() => {
        const record = this.get(principal, id);
        if (record.operationId && record.operationId !== operationId)
          throw new Error("Conflicting operation mapping.");
        this.db
          .query("UPDATE tasks SET operation_id=? WHERE principal=? AND id=?")
          .run(operationId, principal, id);
        return this.get(principal, id);
      })
      .immediate();
  }
  sync(principal: string, id: string, operation: PublicOperation): TaskRecord {
    return this.db
      .transaction(() => {
        const record = this.get(principal, id);
        if (record.operationId !== operation.id)
          throw new Error("Unmatched operation.");
        if (
          operation.sequence <= record.sequence ||
          isTerminalTask(record.task)
        )
          return record;
        const state = states[operation.status];
        if (state === undefined)
          throw new Error("Unknown runtime operation state.");
        const status: TaskStatus = {
          state,
          timestamp: operation.updatedAt,
          message: undefined,
        };
        if (operation.reason || operation.output) {
          status.message = Message.fromJSON({
            messageId: randomUUID(),
            contextId: record.contextId,
            taskId: id,
            role: "ROLE_AGENT",
            parts: [{ text: operation.output || operation.reason }],
          });
        }
        record.task.status = status;
        if (state === TaskState.TASK_STATE_COMPLETED && operation.output)
          record.task.artifacts = [
            Artifact.fromJSON({
              artifactId: "result",
              name: "Result",
              parts: [{ text: operation.output }],
            }),
          ];
        this.db
          .query(
            "UPDATE tasks SET task_json=?,sequence=?,updated_at=? WHERE id=? AND principal=?",
          )
          .run(
            JSON.stringify(Task.toJSON(record.task)),
            operation.sequence,
            operation.updatedAt,
            id,
            principal,
          );
        const taskJson = Task.toJSON(record.task) as any;
        if (record.task.artifacts.length)
          this.push.enqueueEvent(
            principal,
            id,
            "operation:" + operation.sequence + ":artifact",
            {
              artifactUpdate: {
                taskId: id,
                contextId: record.contextId,
                artifact: taskJson.artifacts[0],
                append: false,
                lastChunk: true,
              },
            },
          );
        this.push.enqueueEvent(
          principal,
          id,
          "operation:" + operation.sequence + ":status",
          {
            statusUpdate: {
              taskId: id,
              contextId: record.contextId,
              status: taskJson.status,
            },
          },
        );
        return this.get(principal, id);
      })
      .immediate();
  }
  reject(
    principal: string,
    id: string,
    state: "rejected" | "input_required",
    reason: string,
  ): TaskRecord {
    return this.db
      .transaction(() => {
        const record = this.get(principal, id);
        if (isTerminalTask(record.task)) return record;
        const now = new Date();
        record.task.status = {
          state:
            state === "rejected"
              ? TaskState.TASK_STATE_REJECTED
              : TaskState.TASK_STATE_INPUT_REQUIRED,
          timestamp: now.toISOString(),
          message: Message.fromJSON({
            messageId: randomUUID(),
            contextId: record.contextId,
            taskId: id,
            role: "ROLE_AGENT",
            parts: [{ text: reason }],
          }),
        };
        this.db
          .query(
            "UPDATE tasks SET task_json=?,updated_at=? WHERE id=? AND principal=?",
          )
          .run(
            JSON.stringify(Task.toJSON(record.task)),
            now.toISOString(),
            id,
            principal,
          );
        this.push.enqueueEvent(
          principal,
          id,
          "rejection:" +
            createHash("sha256")
              .update(JSON.stringify(Task.toJSON(record.task)))
              .digest("hex"),
          {
            statusUpdate: {
              taskId: id,
              contextId: record.contextId,
              status: (Task.toJSON(record.task) as any).status,
            },
          },
        );
        return this.get(principal, id);
      })
      .immediate();
  }
  list(principal: string, afterId: string | null, limit: number): TaskRecord[] {
    return this.db
      .query(
        "SELECT * FROM tasks WHERE principal=? AND id>? ORDER BY id LIMIT ?",
      )
      .all(principal, afterId || "", limit)
      .map((r) => this.row(r)!);
  }

  reserveContinuation(
    principal: string,
    id: string,
    message: Message,
  ): { created: boolean } {
    const hash = createHash("sha256")
      .update(JSON.stringify(Message.toJSON(message)))
      .digest("hex");
    return this.db
      .transaction(() => {
        const record = this.get(principal, id);
        const initial = this.db
          .query("SELECT id FROM tasks WHERE principal=? AND message_id=?")
          .get(principal, message.messageId);
        if (initial)
          throw new RequestMalformedError(
            "Message identity already used for admission.",
          );
        const prior = this.db
          .query("SELECT * FROM messages WHERE principal=? AND message_id=?")
          .get(principal, message.messageId) as any;
        if (prior) {
          if (prior.task_id !== id || prior.request_hash !== hash)
            throw new RequestMalformedError("Message identity conflicts.");
          if (prior.outcome !== "complete")
            throw new UnsupportedOperationError(
              "Continuation outcome pending or unknown; query task before retrying.",
            );
          return { created: false };
        }
        if (isTerminalTask(record.task))
          throw new UnsupportedOperationError("Terminal task cannot continue.");
        const json = JSON.stringify(Message.toJSON(message));
        if (
          Buffer.byteLength(json) > 32 * 1024 ||
          record.task.history.length >= 100
        )
          throw new RequestMalformedError("Task history limit.");
        this.db
          .query("INSERT INTO messages VALUES(?,?,?,?,?)")
          .run(principal, message.messageId, id, hash, "pending");
        record.task.history.push(message);
        this.db
          .query("UPDATE tasks SET task_json=? WHERE id=? AND principal=?")
          .run(JSON.stringify(Task.toJSON(record.task)), id, principal);
        return { created: true };
      })
      .immediate();
  }
  completedContinuation(
    principal: string,
    id: string,
    message: Message,
  ): boolean {
    const prior = this.db
      .query("SELECT * FROM messages WHERE principal=? AND message_id=?")
      .get(principal, message.messageId) as any;
    if (!prior) return false;
    const hash = createHash("sha256")
      .update(JSON.stringify(Message.toJSON(message)))
      .digest("hex");
    if (prior.task_id !== id || prior.request_hash !== hash)
      throw new RequestMalformedError("Message identity conflicts.");
    if (prior.outcome !== "complete")
      throw new UnsupportedOperationError(
        "Continuation outcome pending or unknown; query task before retrying.",
      );
    return true;
  }
  completeContinuation(principal: string, messageId: string): void {
    this.db
      .query(
        "UPDATE messages SET outcome='complete' WHERE principal=? AND message_id=? AND outcome='pending'",
      )
      .run(principal, messageId);
  }
  failContinuation(principal: string, messageId: string): void {
    this.db
      .query(
        "UPDATE messages SET outcome='unknown' WHERE principal=? AND message_id=? AND outcome='pending'",
      )
      .run(principal, messageId);
  }
  page(
    principal: string,
    target: string,
    params: ListTasksRequest,
    size: number,
  ): { records: TaskRecord[]; nextPageToken: string; total: number } {
    if (
      params.statusTimestampAfter &&
      !Number.isFinite(Date.parse(params.statusTimestampAfter))
    )
      throw new RequestMalformedError("Invalid status timestamp.");
    const filter = JSON.stringify([
      principal,
      target,
      params.contextId,
      params.status,
      params.statusTimestampAfter ?? null,
      params.includeArtifacts ?? false,
      params.historyLength ?? null,
      size,
    ]);
    let after: { id: string; time: string } | null = null;
    const key = (
      this.db
        .query("SELECT value FROM metadata WHERE key='cursor-key'")
        .get() as { value: string }
    ).value;
    if (params.pageToken) {
      try {
        const [encoded, tag, ...extra] = params.pageToken.split(".");
        if (extra.length || params.pageToken.length > 4096)
          throw new Error("invalid");
        const expected = createHmac("sha256", key).update(encoded).digest(),
          actual = Buffer.from(tag, "base64url");
        if (
          actual.length !== expected.length ||
          !timingSafeEqual(actual, expected)
        )
          throw new Error("invalid");
        const token = JSON.parse(Buffer.from(encoded, "base64url").toString());
        if (
          token.filter !== filter ||
          typeof token.id !== "string" ||
          typeof token.time !== "string"
        )
          throw new Error("invalid");
        after = token;
      } catch {
        throw new RequestMalformedError("Invalid page token.");
      }
    }
    // Bound total task metadata scanned; retention/quota prevents unbounded request work.
    const all = this.db
      .query(
        "SELECT * FROM tasks WHERE principal=? AND target=? ORDER BY updated_at DESC,id DESC LIMIT 1001",
      )
      .all(principal, target)
      .map((r) => this.row(r)!);
    if (all.length > 1000)
      throw new UnsupportedOperationError("Task listing quota exceeded.");
    const matching = all.filter(
      (r) =>
        (!params.contextId || r.contextId === params.contextId) &&
        (!params.status || r.task.status?.state === params.status) &&
        (!params.statusTimestampAfter ||
          String(r.task.status?.timestamp || "") >=
            params.statusTimestampAfter),
    );
    const eligible = matching.filter(
      (r) =>
        !after ||
        String(r.task.status?.timestamp || "") < after.time ||
        (r.task.status?.timestamp === after.time && r.id < after.id),
    );
    const records = eligible.slice(0, size);
    let nextPageToken = "";
    if (eligible.length > size) {
      const last = records.at(-1)!;
      const encoded = Buffer.from(
        JSON.stringify({
          filter,
          id: last.id,
          time: last.task.status?.timestamp || "",
        }),
      ).toString("base64url");
      nextPageToken =
        encoded +
        "." +
        createHmac("sha256", key).update(encoded).digest("base64url");
    }
    return { records, nextPageToken, total: matching.length };
  }
  pruneTerminal(principal: string, before: string): number {
    if (!Number.isFinite(Date.parse(before)))
      throw new Error("Valid retention timestamp required.");
    return this.db
      .transaction(() => {
        const candidates = this.db
          .query(
            "SELECT * FROM tasks WHERE principal=? AND updated_at<? LIMIT 1000",
          )
          .all(principal, before)
          .map((r) => this.row(r)!);
        let removed = 0;
        for (const record of candidates) {
          if (!isTerminalTask(record.task)) continue;
          this.push.pruneTask(principal, record.id);
          this.db
            .query("DELETE FROM messages WHERE principal=? AND task_id=?")
            .run(principal, record.id);
          this.db
            .query("DELETE FROM tasks WHERE principal=? AND id=?")
            .run(principal, record.id);
          removed++;
        }
        this.db
          .query(
            "DELETE FROM contexts WHERE principal=? AND id NOT IN (SELECT context_id FROM tasks)",
          )
          .run(principal);
        return removed;
      })
      .immediate();
  }
  close() {
    this.db.close();
  }
}
