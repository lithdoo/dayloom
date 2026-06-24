import type { DailyPlan } from './types';

const DAY_ID = /^day_\d{4}$/;
const BEAT_ID = /^beat_\d{2}$/;
const FORBIDDEN_KEYS = new Set(['outcome', 'result', 'results', 'reward', 'rewards', 'success', 'failure']);

export function validateDailyPlan(plan: DailyPlan, expectedDay?: string): void {
  if (!plan || typeof plan !== 'object') throw new Error('Daily plan must be an object');
  if (typeof plan.day !== 'string' || !DAY_ID.test(plan.day)) throw new Error('Daily plan day must be day_NNNN');
  if (expectedDay && plan.day !== expectedDay) throw new Error(`Daily plan day mismatch: expected ${expectedDay}, got ${plan.day}`);
  assertNonEmpty(plan.user_intent, 'Daily plan user_intent');
  assertStringArray(plan.known_context, 'Daily plan known_context');
  assertStringArray(plan.constraints, 'Daily plan constraints');
  assertStringArray(plan.open_questions, 'Daily plan open_questions');
  if (!Number.isInteger(plan.max_events) || plan.max_events < 1 || plan.max_events > 5) throw new Error('Daily plan max_events must be between 1 and 5');
  if (!Array.isArray(plan.planned_beats) || plan.planned_beats.length < 1 || plan.planned_beats.length > 5) throw new Error('Daily plan planned_beats must contain 1 to 5 beats');
  for (const [index, beat] of plan.planned_beats.entries()) {
    if (!beat || typeof beat !== 'object') throw new Error(`Daily beat ${index} must be an object`);
    for (const key of Object.keys(beat)) if (FORBIDDEN_KEYS.has(key)) throw new Error(`Daily beat ${index} contains forbidden result field: ${key}`);
    if (typeof beat.id !== 'string' || !BEAT_ID.test(beat.id)) throw new Error(`Daily beat ${index} id must be beat_NN`);
    assertNonEmpty(beat.intent, `Daily beat ${index} intent`);
    if (beat.priority !== 'required' && beat.priority !== 'optional') throw new Error(`Daily beat ${index} priority is invalid`);
    if (beat.status !== 'tentative') throw new Error(`Daily beat ${index} status must be tentative`);
    if (beat.depends_on !== undefined) assertStringArray(beat.depends_on, `Daily beat ${index} depends_on`);
  }
}

function assertNonEmpty(value: unknown, label: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
}

function assertStringArray(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${label} must be a string array`);
}
