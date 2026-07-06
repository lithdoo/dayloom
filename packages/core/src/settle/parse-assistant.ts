import type { SettlementNarrative } from './types';

export function parseSettlementNarrative(text: string): SettlementNarrative {
  const match = text.match(/```(?:json\s+)?settlement-narrative\s*\n([\s\S]*?)```/i);
  if (!match) throw new Error('Assistant response missing settlement-narrative JSON block');
  try { return JSON.parse(match[1].trim()) as SettlementNarrative; }
  catch (error) { throw new Error(`Failed to parse settlement-narrative JSON: ${error instanceof Error ? error.message : error}`); }
}
