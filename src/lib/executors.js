const EXECUTOR_SPECS = {
  'claude-local': {
    family: 'claude',
    binaryName: 'claude',
    adapterType: 'claude_local',
  },
  'codex-local': {
    family: 'codex',
    binaryName: 'codex',
    adapterType: 'codex_local',
  },
  'gemini-local': {
    family: 'gemini',
    binaryName: 'gemini',
    adapterType: 'gemini_local',
  },
  'cursor-local': {
    family: 'cursor',
    binaryName: 'agent',
    adapterType: 'cursor',
  },
  'opencode-local': {
    family: 'opencode',
    binaryName: 'opencode',
    adapterType: 'opencode_local',
  },
  'pi-local': {
    family: 'pi',
    binaryName: 'pi',
    adapterType: 'pi_local',
  },
  'hermes-local': {
    family: 'hermes',
    binaryName: 'hermes',
    adapterType: 'hermes_local',
  },
  'openclaw-gateway': {
    family: 'openclaw',
    binaryName: 'openclaw',
    adapterType: 'openclaw_gateway',
  },
};

const ADAPTER_TYPE_TO_EXECUTOR = Object.fromEntries(
  Object.entries(EXECUTOR_SPECS).map(([executorName, spec]) => [spec.adapterType, executorName])
);

export function getExecutorSpec(executorName = 'claude-local') {
  if (EXECUTOR_SPECS[executorName]) return EXECUTOR_SPECS[executorName];
  const family = executorName.split('-')[0] || 'claude';
  return {
    family,
    binaryName: family,
    adapterType: executorName.replace(/-/g, '_'),
  };
}

export function getExecutorBinaryName(executorName) {
  return getExecutorSpec(executorName).binaryName;
}

export function getExecutorFamily(executorName) {
  return getExecutorSpec(executorName).family;
}

export function getExecutorAdapterType(executorName) {
  return getExecutorSpec(executorName).adapterType;
}

export function getExecutorNameFromAdapterType(adapterType, fallback = 'claude-local') {
  if (!adapterType) return fallback;
  if (ADAPTER_TYPE_TO_EXECUTOR[adapterType]) return ADAPTER_TYPE_TO_EXECUTOR[adapterType];
  return adapterType.replace(/_/g, '-');
}
