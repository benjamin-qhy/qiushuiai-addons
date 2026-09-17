import { profileStatus } from "./profile.js";

// Startup performs no I/O: no listener, route, transport, database or timer.
// Enabling is deliberately unavailable until the core operations and add-on policy exist.
export function getA2aRuntimeStatus() {
  return profileStatus();
}
export function requireA2aExecutionReady(): never {
  throw new Error(
    "A2A execution is disabled: principal policy and durable operation capabilities are not implemented.",
  );
}
