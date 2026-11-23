// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_REGEX = /\x1B(?:\][^\x07\x1B]*(?:\x07|\x1B\\)|\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/g;

const LOCAL_URL_REGEX = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\[::\]|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(?::\d{2,5})(?:\/[^\s"'<>)\]`]*)?/gi;

const PORT_CONFLICT_PATTERNS = [
  /EADDRINUSE[^\r\n]*?:(\d{2,5})(?!\.\d)\b/i,
  /EADDRINUSE[^\r\n]*?\bport\s+(\d{2,5})\b/i,
  /\bPort\s+(\d{2,5})\s+is already in use\b/i,
  /\baddress already in use[^\r\n]*?:(\d{2,5})(?!\.\d)\b/i,
  /\bport\s+(\d{2,5})\b[^\r\n]*?\balready in use\b/i,
];

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_REGEX, '');
}

function normalizeLocalUrl(rawUrl: string): string {
  const trimmed = rawUrl.replace(/[.,;:'")\]}>]+$/, '');
  return trimmed.replace(
    /^(https?:\/\/)(?:0\.0\.0\.0|\[::\])(?=:\d+)/i,
    '$1localhost',
  );
}

export function extractLocalUrls(rawText: string, existing: string[] = [], limit = 4): string[] {
  const clean = stripAnsi(rawText);
  const matches = clean.match(LOCAL_URL_REGEX);
  if (!matches) {
    return existing;
  }

  const next = [...existing];
  for (const match of matches) {
    const normalized = normalizeLocalUrl(match);
    if (!next.includes(normalized)) {
      next.push(normalized);
      if (next.length > limit) {
        next.shift();
      }
    }
  }
  return next;
}

export function extractPortConflict(rawText: string): number | null {
  const clean = stripAnsi(rawText);
  for (const pattern of PORT_CONFLICT_PATTERNS) {
    const match = pattern.exec(clean);
    if (!match) {
      continue;
    }
    const port = Number(match[1]);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) {
      return port;
    }
  }
  return null;
}

export function formatDuration(durationMs: number | null | undefined): string {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
    return '';
  }

  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }

  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function formatDisplayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}
