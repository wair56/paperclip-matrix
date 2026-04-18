if (!globalThis.__matrixRunRegistry) {
  globalThis.__matrixRunRegistry = new Map();
}

const registry = globalThis.__matrixRunRegistry;

export function registerRunningProcess(runId, record) {
  if (!runId || !record) return;
  registry.set(runId, record);
}

export function getRunningProcess(runId) {
  if (!runId) return null;
  return registry.get(runId) || null;
}

export function unregisterRunningProcess(runId) {
  if (!runId) return;
  registry.delete(runId);
}

export function listRunningProcesses() {
  return Array.from(registry.entries());
}
