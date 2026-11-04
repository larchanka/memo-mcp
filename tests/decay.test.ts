import { describe, it, expect } from 'vitest';
import {
  calculateDeltaDays,
  calculateDecayMultiplier,
  calculateFinalScore,
} from '../src/engine/decay.js';

describe('Exponential Time-Decay Scoring Engine', () => {
  describe('calculateDeltaDays', () => {
    it('calculates exact delta days between timestamps', () => {
      const now = new Date('2026-11-04T12:00:00Z');
      const thirtyDaysAgo = new Date('2026-10-05T12:00:00Z');

      const delta = calculateDeltaDays(thirtyDaysAgo, now);
      expect(delta).toBeCloseTo(30, 4);
    });

    it('parses SQLite CURRENT_TIMESTAMP format (YYYY-MM-DD HH:MM:SS) in UTC', () => {
      const now = new Date('2026-11-04T12:00:00Z');
      const sqliteTimestamp = '2026-10-25 12:00:00';

      const delta = calculateDeltaDays(sqliteTimestamp, now);
      expect(delta).toBeCloseTo(10, 4);
    });

    it('clamps negative delta / future clock skew to 0', () => {
      const now = new Date('2026-11-04T12:00:00Z');
      const future = new Date('2026-11-05T12:00:00Z');

      const delta = calculateDeltaDays(future, now);
      expect(delta).toBe(0);
    });

    it('defaults now parameter to current system time if omitted', () => {
      const justNow = new Date(Date.now() - 1000);
      const delta = calculateDeltaDays(justNow);
      expect(delta).toBeGreaterThanOrEqual(0);
      expect(delta).toBeLessThan(0.01);
    });
  });

  describe('calculateDecayMultiplier', () => {
    it('returns 1.0 when deep_history is true regardless of type or age', () => {
      expect(calculateDecayMultiplier('bugfix', 30, true)).toBe(1.0);
      expect(calculateDecayMultiplier('note', 120, true)).toBe(1.0);
      expect(calculateDecayMultiplier('decision', 365, true)).toBe(1.0);
      expect(calculateDecayMultiplier('architecture', 500, true)).toBe(1.0);
    });

    it('returns 1.0 permanently for decision and architecture types', () => {
      expect(calculateDecayMultiplier('decision', 0)).toBe(1.0);
      expect(calculateDecayMultiplier('decision', 30)).toBe(1.0);
      expect(calculateDecayMultiplier('decision', 365)).toBe(1.0);

      expect(calculateDecayMultiplier('architecture', 0)).toBe(1.0);
      expect(calculateDecayMultiplier('architecture', 60)).toBe(1.0);
      expect(calculateDecayMultiplier('architecture', 1000)).toBe(1.0);
    });

    it('applies 30-day half-life exponential decay for bugfix and note', () => {
      // 0 days: (0.5)^0 = 1.0
      expect(calculateDecayMultiplier('bugfix', 0)).toBe(1.0);
      expect(calculateDecayMultiplier('note', 0)).toBe(1.0);

      // 30 days: (0.5)^1 = 0.5
      expect(calculateDecayMultiplier('bugfix', 30)).toBeCloseTo(0.5, 5);
      expect(calculateDecayMultiplier('note', 30)).toBeCloseTo(0.5, 5);

      // 60 days: (0.5)^2 = 0.25
      expect(calculateDecayMultiplier('bugfix', 60)).toBeCloseTo(0.25, 5);
      expect(calculateDecayMultiplier('note', 60)).toBeCloseTo(0.25, 5);

      // 90 days: (0.5)^3 = 0.125
      expect(calculateDecayMultiplier('bugfix', 90)).toBeCloseTo(0.125, 5);
      expect(calculateDecayMultiplier('note', 90)).toBeCloseTo(0.125, 5);

      // 15 days (half of half-life): (0.5)^(0.5) ~ 0.7071
      expect(calculateDecayMultiplier('note', 15)).toBeCloseTo(Math.SQRT1_2, 4);
    });
  });

  describe('calculateFinalScore', () => {
    it('converts negative SQLite BM25 to positive raw relevance and scales with decay', () => {
      // BM25 = -10.0 -> Raw Relevance = +10.0
      // 30-day old note -> Decay = 0.5 -> Score = 5.0
      const scoreNote30d = calculateFinalScore(-10.0, 'note', 30, false);
      expect(scoreNote30d).toBeCloseTo(5.0, 5);

      // 30-day old decision -> Decay = 1.0 -> Score = 10.0
      const scoreDecision30d = calculateFinalScore(-10.0, 'decision', 30, false);
      expect(scoreDecision30d).toBeCloseTo(10.0, 5);

      // 30-day old note with deep_history = true -> Decay = 1.0 -> Score = 10.0
      const scoreDeepHistory = calculateFinalScore(-10.0, 'note', 30, true);
      expect(scoreDeepHistory).toBeCloseTo(10.0, 5);
    });
  });
});
