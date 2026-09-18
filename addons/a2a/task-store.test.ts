import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Message, TaskState } from "@a2a-js/sdk";
import { A2aTaskStore } from "./task-store.js";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function directory() {
  const d = mkdtempSync(join(tmpdir(), "a2a-tasks-"));
  dirs.push(d);
  return d;
}
const message = (id: string, text = "input", contextId = "") =>
  Message.fromJSON({
    messageId: id,
    role: "ROLE_USER",
    contextId,
    parts: [{ text }],
  });

test("caller-scoped message dedup and task/context identity are durable across reopen", () => {
  const dir = directory();
  let store = new A2aTaskStore(dir);
  const first = store.reserve("alice", "echo", message("msg1"));
  expect(first.created).toBe(true);
  expect(store.reserve("alice", "echo", message("msg1")).record.id).toBe(
    first.record.id,
  );
  expect(() =>
    store.reserve("alice", "echo", message("msg1", "conflict")),
  ).toThrow("conflicts");
  expect(() => store.get("bob", first.record.id)).toThrow();
  expect(() =>
    store.reserve(
      "bob",
      "echo",
      message("msg2", "input", first.record.contextId),
    ),
  ).toThrow();
  store.attachOperation("alice", first.record.id, "operation-1");
  store.close();
  store = new A2aTaskStore(dir);
  try {
    expect(store.get("alice", first.record.id).operationId).toBe("operation-1");
    expect(store.reserve("alice", "echo", message("msg1")).created).toBe(false);
    const continued = store.reserve(
      "alice",
      "echo",
      message("msg2", "new task", first.record.contextId),
    );
    expect(continued.record.id).not.toBe(first.record.id);
    expect(continued.record.contextId).toBe(first.record.contextId);
    expect(store.list("alice", null, 10)).toHaveLength(2);
    expect(store.list("bob", null, 10)).toHaveLength(0);
  } finally {
    store.close();
  }
});

test("runtime states map to A2A with immutable terminal result and bounded public text artifact", () => {
  const store = new A2aTaskStore(directory());
  try {
    const r = store.reserve("alice", "echo", message("states")).record;
    store.attachOperation("alice", r.id, "op");
    store.sync("alice", r.id, {
      id: "op",
      sequence: 2,
      status: "budget_blocked",
      reason: "budget_boundary",
      output: null,
      updatedAt: new Date().toISOString(),
    });
    expect(store.get("alice", r.id).task.status?.state).toBe(
      TaskState.TASK_STATE_INPUT_REQUIRED,
    );
    store.sync("alice", r.id, {
      id: "op",
      sequence: 3,
      status: "completed",
      reason: null,
      output: "public answer",
      updatedAt: new Date().toISOString(),
    });
    const task = store.get("alice", r.id).task;
    expect(task.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    expect(task.artifacts[0].parts[0].content?.value).toBe("public answer");
    store.sync("alice", r.id, {
      id: "op",
      sequence: 4,
      status: "failed",
      reason: "late_failure",
      output: null,
      updatedAt: new Date().toISOString(),
    });
    expect(store.get("alice", r.id).task.status?.state).toBe(
      TaskState.TASK_STATE_COMPLETED,
    );
    expect(() =>
      store.sync("alice", r.id, {
        id: "other",
        sequence: 4,
        status: "completed",
        reason: null,
        output: "foreign",
        updatedAt: new Date().toISOString(),
      }),
    ).toThrow("Unmatched");
  } finally {
    store.close();
  }
});

test("retention removes only terminal tasks in the chosen principal namespace", () => {
  const store = new A2aTaskStore(directory());
  try {
    const a = store.reserve("alice", "echo", message("prune-a")).record;
    const b = store.reserve("bob", "echo", message("prune-b")).record;
    const active = store.reserve("alice", "echo", message("active")).record;
    store.reject("alice", a.id, "rejected", "policy denied");
    store.reject("bob", b.id, "rejected", "policy denied");
    expect(
      store.pruneTerminal("alice", new Date(Date.now() + 1000).toISOString()),
    ).toBe(1);
    expect(() => store.get("alice", a.id)).toThrow();
    expect(store.get("bob", b.id)).toBeDefined();
    expect(store.get("alice", active.id)).toBeDefined();
  } finally {
    store.close();
  }
});

test("uncertain continuation is never blindly replayed after reopening", () => {
  const dir = directory();
  let store = new A2aTaskStore(dir);
  const record = store.reserve("alice", "echo", message("initial")).record;
  store.attachOperation("alice", record.id, "operation");
  store.sync("alice", record.id, {
    id: "operation",
    status: "input_required",
    sequence: 2,
    reason: null,
    output: "value?",
    updatedAt: new Date().toISOString(),
  });
  const next = Message.fromJSON({
    messageId: "next",
    taskId: record.id,
    contextId: record.contextId,
    role: "ROLE_USER",
    parts: [{ text: "value" }],
  });
  store.reserveContinuation("alice", record.id, next);
  store.close();
  store = new A2aTaskStore(dir);
  try {
    expect(() => store.reserveContinuation("alice", record.id, next)).toThrow(
      "pending or unknown",
    );
  } finally {
    store.close();
  }
});

test("a completed continuation message ID cannot be reused to create a new task", () => {
  const store = new A2aTaskStore(directory());
  try {
    const task = store.reserve(
      "alice",
      "echo",
      message("initial-collision"),
    ).record;
    store.reject("alice", task.id, "input_required", "approval");
    const next = Message.fromJSON({
      messageId: "continuation-id",
      taskId: task.id,
      role: "ROLE_USER",
      parts: [{ text: "answer" }],
    });
    store.reserveContinuation("alice", task.id, next);
    store.completeContinuation("alice", "continuation-id");
    expect(() =>
      store.reserve("alice", "echo", message("continuation-id")),
    ).toThrow("continuation");
  } finally {
    store.close();
  }
});
