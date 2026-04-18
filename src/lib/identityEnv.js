import { hasNonEmptyString, serializeEnvVars } from './cliEnv';

function safeParseObject(jsonText) {
  if (!hasNonEmptyString(jsonText)) return {};
  try {
    const parsed = JSON.parse(jsonText);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function sanitizeEnvObject(input = {}) {
  const result = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
  for (const [key, value] of Object.entries(input)) {
    if (!hasNonEmptyString(key)) continue;
    if (value == null) continue;
    const normalized = String(value);
    if (normalized.length === 0) continue;
    result[key] = normalized;
  }
  return result;
}

export function parseIdentityEnvJson(jsonText) {
  return sanitizeEnvObject(safeParseObject(jsonText));
}

export function resolveIdentityCloudEnv(row = {}) {
  return parseIdentityEnvJson(row.cloudEnvJson || '');
}

export function resolveIdentityLocalEnv(row = {}) {
  if (hasNonEmptyString(row.localEnvJson)) {
    return parseIdentityEnvJson(row.localEnvJson);
  }
  if (!hasNonEmptyString(row.cloudEnvJson) && hasNonEmptyString(row.envJson)) {
    return parseIdentityEnvJson(row.envJson);
  }
  return {};
}

export function buildMergedIdentityEnv(row = {}) {
  return {
    ...resolveIdentityCloudEnv(row),
    ...resolveIdentityLocalEnv(row),
  };
}

export function stringifyEnvObject(envObject = {}) {
  const sanitized = sanitizeEnvObject(envObject);
  return Object.keys(sanitized).length > 0 ? JSON.stringify(sanitized) : null;
}

export function buildIdentityEnvStorage({ row = {}, nextCloudEnv = null, nextLocalEnv = null } = {}) {
  const cloudEnv = nextCloudEnv ? sanitizeEnvObject(nextCloudEnv) : resolveIdentityCloudEnv(row);
  const localEnv = nextLocalEnv ? sanitizeEnvObject(nextLocalEnv) : resolveIdentityLocalEnv(row);
  const mergedEnv = { ...cloudEnv, ...localEnv };
  return {
    cloudEnv,
    localEnv,
    mergedEnv,
    cloudEnvJson: stringifyEnvObject(cloudEnv),
    localEnvJson: stringifyEnvObject(localEnv),
    envJson: stringifyEnvObject(mergedEnv),
    localEnvText: serializeEnvVars(localEnv),
    mergedEnvText: serializeEnvVars(mergedEnv),
  };
}
