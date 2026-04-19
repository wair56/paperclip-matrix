export const DEFAULT_APP_PORT = 3010;
export const DEFAULT_APP_HOST = '127.0.0.1';

function parsePort(value, fallback = DEFAULT_APP_PORT) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getAppPort() {
  return parsePort(process.env.MATRIX_APP_PORT || process.env.PORT, DEFAULT_APP_PORT);
}

export function getAppHost() {
  const host = (process.env.MATRIX_APP_HOST || process.env.HOSTNAME || '').trim();
  return host || DEFAULT_APP_HOST;
}
