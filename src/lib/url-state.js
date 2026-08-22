const SHEET_PREFIX = '#sheet=';
const MAX_HASH_LENGTH = 1_000_000;

/** A compact, versioned, URL-safe snapshot of the shareable sheet state. */
export function serializeSheetState({ lines, display }) {
  const payload = {
    v: 1,
    l: Array.isArray(lines) && lines.length ? lines.map((line) => String(line ?? '')) : [''],
    d: display === 'decimal' ? 'd' : 'e',
  };
  return `${SHEET_PREFIX}${encodeURIComponent(JSON.stringify(payload))}`;
}

/** Parse a sheet hash defensively; malformed or unsupported payloads are ignored. */
export function parseSheetStateHash(hash) {
  if (typeof hash !== 'string' || !hash.startsWith(SHEET_PREFIX)
    || hash.length > MAX_HASH_LENGTH) return null;
  try {
    const payload = JSON.parse(decodeURIComponent(hash.slice(SHEET_PREFIX.length)));
    if (payload?.v !== 1 || !Array.isArray(payload.l) || payload.l.length === 0
      || !payload.l.every((line) => typeof line === 'string')) return null;
    return {
      lines: payload.l,
      display: payload.d === 'd' ? 'decimal' : 'exact',
    };
  } catch {
    return null;
  }
}
