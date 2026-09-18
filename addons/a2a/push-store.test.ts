import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { A2aPushStore, PUSH_MAX_ATTEMPTS } from "./push-store.js";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const cfg = {
  principal: "alice",
  taskId: "task1",
  id: "callback1",
  url: "https://callback.invalid/events",
  credentialKey: "push/callback",
  allowPrivate: false,
};
const payload = {
  statusUpdate: {
    taskId: "task1",
    contextId: "context",
    status: { state: "TASK_STATE_COMPLETED" },
  },
};
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "a2a-push-store-"));
  dirs.push(dir);
  const path = join(dir, "fixture.db");
  const db = new Database(path);
  db.exec(
    "CREATE TABLE owned(principal TEXT,task TEXT,PRIMARY KEY(principal,task));INSERT INTO owned VALUES('alice','task1');",
  );
  const requireTask = (p: string, t: string) => {
    if (!db.query("SELECT 1 FROM owned WHERE principal=? AND task=?").get(p, t))
      throw new Error("Task unavailable");
  };
  return { path, db, store: new A2aPushStore(db, requireTask) };
}

test("callback CRUD is owner-scoped, bounded, reference-only and revokes old pending attempts", () => {
  const f = setup();
  try {
    expect(() => f.store.upsert({ ...cfg, principal: "bob" })).toThrow(
      "unavailable",
    );
    expect(() =>
      f.store.upsert({ ...cfg, url: "https://user:secret@callback.invalid/" }),
    ).toThrow("URL");
    const first = f.store.upsert(cfg);
    expect(first.revision).toBe(1);
    expect(f.store.upsert(cfg).revision).toBe(1);
    const [id] = f.store.enqueue("alice", "task1", "event1", payload, 0);
    const attempt = f.store.claim(0)!;
    expect(attempt.id).toBe(id);
    const changed = f.store.upsert({ ...cfg, credentialKey: "push/rotated" });
    expect(changed.revision).toBe(2);
    expect(f.store.settle(id, attempt.lease!, true, true, 1)).toBe(false);
    expect(f.store.inspect("alice", "task1")[0].state).toBe("revoked");
    f.store.delete("alice", "task1", "callback1");
    expect(f.store.list("alice", "task1")).toEqual([]);
    expect(f.store.upsert(cfg).revision).toBe(3);
    expect(() => f.store.inspect("bob", "task1")).toThrow("unavailable");
  } finally {
    f.db.close();
  }
});

test("outbox enqueue is idempotent and participates in caller task transaction rollback", () => {
  const f = setup();
  try {
    f.store.upsert(cfg);
    const ids = f.store.enqueue("alice", "task1", "event", payload, 0);
    expect(f.store.enqueue("alice", "task1", "event", payload, 1)).toEqual(ids);
    expect(() =>
      f.store.enqueue("alice", "task1", "event", { task: { id: "task1" } }, 1),
    ).toThrow("conflicts");
    expect(() =>
      f.store.enqueue("alice", "task1", "other", { task: { id: "foreign" } }),
    ).toThrow("identity");
    expect(() =>
      f.db
        .transaction(() => {
          f.store.enqueue("alice", "task1", "rollback", payload, 0);
          throw new Error("rollback");
        })
        .immediate(),
    ).toThrow("rollback");
    expect(f.store.inspect("alice", "task1")).toHaveLength(1);
    expect(f.store.claim(0)?.attempts).toBe(1);
    expect(f.store.claim(0)).toBeNull();
  } finally {
    f.db.close();
  }
});

test("restart retries the same durable delivery identity and bytes, with bounded attempts and expiry", () => {
  const f = setup();
  f.store.upsert(cfg);
  f.store.enqueue("alice", "task1", "event", payload, 0);
  const first = f.store.claim(0)!;
  f.db.close();
  const db = new Database(f.path);
  const store = new A2aPushStore(db, (p, t) => {
    if (p !== "alice" || t !== "task1") throw new Error("Task unavailable");
  });
  try {
    expect(store.recover(1)).toBe(1);
    expect(store.settle(first.id, first.lease!, true, true, 1)).toBe(false);
    let current = store.claim(1)!;
    expect(current.id).toBe(first.id);
    expect(current.payload).toBe(first.payload);
    expect(current.attempts).toBe(2);
    let now = 1;
    while (current.attempts < PUSH_MAX_ATTEMPTS) {
      store.settle(current.id, current.lease!, false, true, now);
      expect(store.claim(now)).toBeNull();
      now += 60001;
      current = store.claim(now)!;
    }
    store.settle(current.id, current.lease!, false, true, now);
    expect(store.inspect("alice", "task1")[0].state).toBe("abandoned");
    expect(store.claim(now + 999999)).toBeNull();
    store.enqueue("alice", "task1", "expires", payload, 0);
    expect(store.claim(24 * 60 * 60 * 1000)).toBeNull();
  } finally {
    db.close();
  }
});
