export type MemoryType = 'decision' | 'architecture' | 'bugfix' | 'note';

export interface RawMemoryInput {
  type?: unknown;
  summary?: unknown;
  body?: unknown;
  tags?: unknown;
}

export interface SanitizedMemoryInput {
  type: MemoryType;
  summary: string;
  body: string;
  tags: string[];
}

const VALID_TYPES: ReadonlySet<string> = new Set(['decision', 'architecture', 'bugfix', 'note']);
const MAX_TAGS = 6;
const ALLOWED_TAG_CHARS = /[^a-z0-9\-_/@]/g;

export function sanitizeMemoryType(type: unknown): MemoryType {
  if (typeof type === 'string') {
    const normalized = type.trim().toLowerCase();
    if (VALID_TYPES.has(normalized)) {
      return normalized as MemoryType;
    }
  }
  return 'note';
}

export function sanitizeTags(tags: unknown): string[] {
  let list: unknown[] = [];
  if (Array.isArray(tags)) {
    list = tags;
  } else if (typeof tags === 'string') {
    list = tags.split(',');
  } else {
    return [];
  }

  const result: string[] = [];
  const seen = new Set<string>();

  for (const item of list) {
    if (typeof item !== 'string' && typeof item !== 'number') {
      continue;
    }
    const cleaned = String(item)
      .toLowerCase()
      .trim()
      .replace(ALLOWED_TAG_CHARS, '');

    if (cleaned.length > 0 && !seen.has(cleaned)) {
      seen.add(cleaned);
      result.push(cleaned);
      if (result.length >= MAX_TAGS) {
        break;
      }
    }
  }

  return result;
}

export function sanitizeMemoryInput(input: unknown): SanitizedMemoryInput {
  if (!input || typeof input !== 'object') {
    const summary = typeof input === 'string' && input.trim().length > 0
      ? input.trim()
      : '(No summary provided)';
    return {
      type: 'note',
      summary,
      body: '',
      tags: [],
    };
  }

  const raw = input as RawMemoryInput;
  const type = sanitizeMemoryType(raw.type);

  let summary = '(No summary provided)';
  if (typeof raw.summary === 'string' && raw.summary.trim().length > 0) {
    summary = raw.summary.trim();
  } else if (raw.summary !== null && raw.summary !== undefined && typeof raw.summary !== 'object') {
    const str = String(raw.summary).trim();
    if (str.length > 0) {
      summary = str;
    }
  }

  let body = '';
  if (typeof raw.body === 'string') {
    body = raw.body.trim();
  } else if (raw.body !== null && raw.body !== undefined && typeof raw.body !== 'object') {
    body = String(raw.body).trim();
  }

  const tags = sanitizeTags(raw.tags);

  return {
    type,
    summary,
    body,
    tags,
  };
}
