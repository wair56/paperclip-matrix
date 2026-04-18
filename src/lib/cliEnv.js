export function hasNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function unquoteEnvValue(value) {
  if (value.length >= 2) {
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value[value.length - 1] === quote) {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function parseEnvText(input = '') {
  const envVars = {};
  const errors = [];

  for (const [index, rawLine] of String(input).split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const match = normalized.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      errors.push({ line: index + 1, raw: rawLine });
      continue;
    }

    const [, key, rawValue] = match;
    envVars[key] = unquoteEnvValue(rawValue.trim());
  }

  return { envVars, errors };
}

export function serializeEnvVars(envVars = {}) {
  return Object.entries(envVars)
    .filter(([key, value]) => hasNonEmptyString(key) && value != null && String(value).length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('\n');
}
