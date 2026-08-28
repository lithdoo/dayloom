import { exactKeysV1, failV1, recordV1, schemaVersionV1, sameJsonV1 } from './common.js';

export type DayloomCommandV1 = 'init' | 'plan' | 'play' | 'revise' | 'settle' | 'abandon';
export type PublishedWorldPhaseV1 = 'idle' | 'planned' | 'awaiting-settle';

export interface WorldControlV1 {
  phase: PublishedWorldPhaseV1;
  day: string | null;
  lastSettledDay: string | null;
}

export function parseDayIdV1(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^day[1-9][0-9]*$/.test(value)) {
    failV1('ARCHIVE_PROTOCOL_INVALID', `${field} must be day<positive integer>.`);
  }
  return value;
}

export function parseWorldControlV1(value: unknown, field = 'control'): Readonly<WorldControlV1> {
  const o = recordV1(value, 'WorldControlV1');
  exactKeysV1(o, ['phase', 'day', 'lastSettledDay'], 'WorldControlV1');
  if (o.phase !== 'idle' && o.phase !== 'planned' && o.phase !== 'awaiting-settle') {
    failV1('ARCHIVE_PROTOCOL_INVALID', `${field}.phase is invalid.`);
  }
  const day = o.day === null ? null : parseDayIdV1(o.day, `${field}.day`);
  const lastSettledDay = o.lastSettledDay === null ? null : parseDayIdV1(o.lastSettledDay, `${field}.lastSettledDay`);
  if ((o.phase === 'planned' || o.phase === 'awaiting-settle') && day === null) {
    failV1('ARCHIVE_PROTOCOL_INVALID', `${field}.day is required for phase ${o.phase}.`);
  }
  if (o.phase === 'idle' && day !== null) {
    failV1('ARCHIVE_PROTOCOL_INVALID', `${field}.day must be null for idle phase.`);
  }
  return Object.freeze({ phase: o.phase, day, lastSettledDay });
}

export function nextDayV1(lastSettledDay: string | null): string {
  if (lastSettledDay === null) return 'day1';
  const parsed = parseDayIdV1(lastSettledDay, 'lastSettledDay');
  return `day${Number(parsed.slice(3)) + 1}`;
}

export function buildTargetControlV1(command: DayloomCommandV1, before: WorldControlV1 | null): Readonly<WorldControlV1> {
  if (command === 'init') {
    if (before !== null) failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', 'init requires no base control.');
    return Object.freeze({ phase: 'idle', day: null, lastSettledDay: null });
  }
  if (before === null) failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', `${command} requires a base control.`);
  const base = parseWorldControlV1(before);
  if (command === 'plan') {
    if (base.phase !== 'idle') failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', 'plan requires idle phase.');
    return Object.freeze({ phase: 'planned', day: nextDayV1(base.lastSettledDay), lastSettledDay: base.lastSettledDay });
  }
  if (command === 'play') {
    if (base.phase !== 'planned' || base.day === null) failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', 'play requires planned phase.');
    return Object.freeze({ phase: 'awaiting-settle', day: base.day, lastSettledDay: base.lastSettledDay });
  }
  if (command === 'revise') {
    if (base.phase !== 'idle') failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', 'revise requires idle phase.');
    return base;
  }
  if (command === 'settle') {
    if (base.phase !== 'awaiting-settle' || base.day === null) failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', 'settle requires awaiting-settle phase.');
    return Object.freeze({ phase: 'idle', day: null, lastSettledDay: base.day });
  }
  if ((base.phase !== 'planned' && base.phase !== 'awaiting-settle') || base.day === null) {
    failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', 'abandon requires planned or awaiting-settle phase.');
  }
  return Object.freeze({ phase: 'idle', day: null, lastSettledDay: base.lastSettledDay });
}

export function validateControlTransitionV1(
  command: DayloomCommandV1,
  before: WorldControlV1 | null,
  after: WorldControlV1,
): void {
  const expected = buildTargetControlV1(command, before);
  const actual = parseWorldControlV1(after);
  if (!sameJsonV1(expected, actual)) {
    failV1('ARCHIVE_PROTOCOL_REFERENCE_INVALID', `Control transition is invalid for ${command}.`);
  }
}

export function controlChangedV1(before: WorldControlV1 | null, after: WorldControlV1): boolean {
  return !sameJsonV1(before, after);
}

void schemaVersionV1;
