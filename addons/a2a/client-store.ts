import { Database } from "bun:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

/** Idempotency/remote correlation only; credentials and provider billing are not stored. */
export class A2aClientStore {
  private readonly db: Database;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, "outbound-v1.sqlite");
    this.db = new Database(path, { create: true });
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS sends(scope TEXT NOT NULL,endpoint TEXT NOT NULL,message_id TEXT NOT NULL,hash TEXT NOT NULL,state TEXT NOT NULL,result TEXT,PRIMARY KEY(scope,endpoint,message_id)) STRICT;
    CREATE TABLE IF NOT EXISTS tasks(scope TEXT NOT NULL,endpoint TEXT NOT NULL,task_id TEXT NOT NULL,context_id TEXT NOT NULL,PRIMARY KEY(scope,endpoint,task_id)) STRICT;
  `);
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS push_inbox(receiver TEXT NOT NULL,delivery_id TEXT NOT NULL,payload_hash TEXT NOT NULL,task_id TEXT NOT NULL,received_at INTEGER NOT NULL,PRIMARY KEY(receiver,delivery_id)) STRICT;`,
    );
    // An unfinished request can have reached the peer. Never replay it automatically.
    this.db
      .query("UPDATE sends SET state='unknown' WHERE state='sending'")
      .run();
  }
  reserve(
    scope: string,
    endpoint: string,
    messageId: string,
    payload: unknown,
  ): { created: boolean; result: unknown } {
    const hash = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
    return this.db
      .transaction(() => {
        const existing = this.db
          .query(
            "SELECT * FROM sends WHERE scope=? AND endpoint=? AND message_id=?",
          )
          .get(scope, endpoint, messageId) as any;
        if (existing) {
          if (existing.hash !== hash)
            throw new Error("Message ID conflicts with a different request.");
          if (existing.state !== "complete")
            throw new Error(
              "Remote outcome is pending or unknown; do not resubmit. Inspect the peer task.",
            );
          return { created: false, result: JSON.parse(existing.result) };
        }
        const count = this.db
          .query("SELECT count(*) AS n FROM sends WHERE scope=?")
          .get(scope) as { n: number };
        if (count.n >= 1000) throw new Error("Outbound history quota reached.");
        this.db
          .query("INSERT INTO sends VALUES(?,?,?,?,?,NULL)")
          .run(scope, endpoint, messageId, hash, "sending");
        return { created: true, result: null };
      })
      .immediate();
  }
  complete(scope: string, endpoint: string, messageId: string, result: any) {
    const json = JSON.stringify(result);
    if (Buffer.byteLength(json) > 256 * 1024)
      throw new Error("Remote result limit.");
    this.db
      .transaction(() => {
        this.db
          .query(
            "UPDATE sends SET state='complete',result=? WHERE scope=? AND endpoint=? AND message_id=?",
          )
          .run(json, scope, endpoint, messageId);
        if (result?.task?.id)
          this.db
            .query("INSERT OR IGNORE INTO tasks VALUES(?,?,?,?)")
            .run(scope, endpoint, result.task.id, result.task.contextId || "");
      })
      .immediate();
  }
  unknown(scope: string, endpoint: string, messageId: string) {
    this.db
      .query(
        "UPDATE sends SET state='unknown' WHERE scope=? AND endpoint=? AND message_id=?",
      )
      .run(scope, endpoint, messageId);
  }
  owns(scope: string, endpoint: string, id: string): boolean {
    return !!this.db
      .query("SELECT 1 FROM tasks WHERE scope=? AND endpoint=? AND task_id=?")
      .get(scope, endpoint, id);
  }
  ownsContext(scope: string, endpoint: string, id: string): boolean {
    return !!this.db
      .query(
        "SELECT 1 FROM tasks WHERE scope=? AND endpoint=? AND context_id=?",
      )
      .get(scope, endpoint, id);
  }
  remember(scope: string, endpoint: string, id: string, contextId: string) {
    this.db
      .query("INSERT OR IGNORE INTO tasks VALUES(?,?,?,?)")
      .run(scope, endpoint, id, contextId);
  }
  list(scope: string, endpoint: string) {
    return this.db
      .query(
        "SELECT task_id AS taskId,context_id AS contextId FROM tasks WHERE scope=? AND endpoint=? ORDER BY task_id LIMIT 100",
      )
      .all(scope, endpoint);
  }
  receivePush(
    receiver: string,
    endpoint: string,
    deliveryId: string,
    taskId: string,
    payload: string,
    now = Date.now(),
  ): boolean {
    return this.db
      .transaction(() => {
        if (
          !this.db
            .query("SELECT 1 FROM tasks WHERE endpoint=? AND task_id=?")
            .get(endpoint, taskId)
        )
          throw new Error("Unknown remote task.");
        const hash = createHash("sha256").update(payload).digest("hex");
        const prior = this.db
          .query(
            "SELECT payload_hash FROM push_inbox WHERE receiver=? AND delivery_id=?",
          )
          .get(receiver, deliveryId) as { payload_hash: string } | null;
        if (prior) {
          if (prior.payload_hash !== hash)
            throw new Error("Conflicting push replay.");
          return false;
        }
        this.db
          .query("DELETE FROM push_inbox WHERE received_at<?")
          .run(now - 7 * 24 * 60 * 60 * 1000);
        const count = this.db
          .query("SELECT count(*) n FROM push_inbox WHERE receiver=?")
          .get(receiver) as { n: number };
        if (count.n >= 1000) throw new Error("Push inbox quota.");
        this.db
          .query("INSERT INTO push_inbox VALUES(?,?,?,?,?)")
          .run(receiver, deliveryId, hash, taskId, now);
        return true;
      })
      .immediate();
  }
  close() {
    this.db.close();
  }
}
