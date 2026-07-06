import type { DailyDraft, DailyPlan } from './types';

function extractBlock(text: string, label: string): string | null {
  const m = text.match(new RegExp('```(?:json\\s+)?' + label + '\\s*\\n([\\s\\S]*?)```', 'i'));
  return m ? m[1].trim() : null;
}

export function parseDailyStatus(text: string): DailyDraft | undefined {
  const raw = extractBlock(text, 'daily-status');
  if (!raw) return undefined;
  const parsed = JSON.parse(raw) as DailyDraft;
  if (!parsed || typeof parsed !== 'object') throw new Error('daily-status must be an object');
  if (typeof parsed.user_intent !== 'string') throw new Error('daily-status user_intent must be a string');
  for (const key of ['known_context', 'constraints', 'open_questions'] as const) {
    if (!Array.isArray(parsed[key]) || parsed[key].some(item => typeof item !== 'string')) throw new Error(`daily-status ${key} must be a string array`);
  }
  return parsed;
}

export function parseDailyPlan(text: string): DailyPlan {
  const raw = extractBlock(text, 'daily-plan');
  if (!raw) throw new Error('Assistant response missing daily-plan JSON block');
  try { return JSON.parse(raw) as DailyPlan; }
  catch (err) { throw new Error(`Failed to parse daily-plan JSON: ${err instanceof Error ? err.message : err}`); }
}

export function stripDailyStatus(text: string): string {
  return text.replace(/```(?:json\s+)?daily-status\s*\n[\s\S]*?```/gi, '').trim();
}
