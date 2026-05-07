import type { FreshnessState } from './types.js';

export function freshnessState(generatedAt: string, freshUntil: string, now = new Date()): FreshnessState {
  const generated = Date.parse(generatedAt);
  const until = Date.parse(freshUntil);
  if (!Number.isFinite(generated) || !Number.isFinite(until)) return 'failed';
  return now.getTime() <= until ? 'fresh' : 'stale';
}

export function addDays(date: Date, days: number): string {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString();
}
