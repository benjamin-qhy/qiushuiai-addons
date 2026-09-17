import {
  startA2aRuntime,
  a2aServiceStatus,
  requireA2aService,
} from "./service.js";

// Runtime entries load before sessions; disabled state has no listeners/databases.
// The namespaced guarded handler exists only when host operations v1 is present.
startA2aRuntime();
export function getA2aRuntimeStatus() {
  return a2aServiceStatus();
}
export function requireA2aExecutionReady() {
  const service = requireA2aService();
  if (!service.config().enabled) throw new Error("A2A execution is disabled.");
  return service;
}
