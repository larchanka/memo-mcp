import type { MemoryType } from './sanitize.js';

const MS_PER_DAY = 86_400_000;
const HALF_LIFE_DAYS = 30;

function parseTimestamp(timestamp: string | Date): number {
  if (timestamp instanceof Date) {
    return timestamp.getTime();
  }
  let str = String(timestamp).trim();
  if (!str.includes('T') && str.includes(' ')) {
    str = str.replace(' ', 'T') + 'Z';
  } else if (!str.endsWith('Z') && !str.includes('+') && !str.includes('-', 10)) {
    str = str + 'Z';
  }
  const time = Date.parse(str);
  return Number.isNaN(time) ? Date.now() : time;
}

export function calculateDeltaDays(createdAt: string | Date, now: Date = new Date()): number {
  const createdMs = parseTimestamp(createdAt);
  const nowMs = now.getTime();
  const diffMs = nowMs - createdMs;
  if (diffMs <= 0) {
    return 0;
  }
  return diffMs / MS_PER_DAY;
}

export function calculateDecayMultiplier(
  type: MemoryType,
  deltaDays: number,
  deepHistory = false
): number {
  if (deepHistory) {
    return 1.0;
  }
  if (type === 'decision' || type === 'architecture') {
    return 1.0;
  }
  const safeDays = Math.max(0, deltaDays);
  return Math.pow(0.5, safeDays / HALF_LIFE_DAYS);
}

export function calculateFinalScore(
  rawBm25: number,
  type: MemoryType,
  deltaDays: number,
  deepHistory = false
): number {
  const relevanceRaw = -1 * rawBm25;
  const decayMultiplier = calculateDecayMultiplier(type, deltaDays, deepHistory);
  return relevanceRaw * decayMultiplier;
}
