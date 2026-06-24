import fs from 'fs';
import path from 'path';
import type { SettlementPatch, SettlementProposal } from './types';

const DAY_ID = /^day_(\d{4})$/;
const REPLACE_PATHS = new Set([
  'state/world.yaml', 'state/calendar.yaml', 'state/progress.yaml', 'state/variables.yaml',
  'memory/facts.yaml', 'memory/important_events.yaml', 'memory/unresolved_threads.yaml',
]);
const APPEND_PATHS = [
  /^memory\/(?:short_term|long_term)\.md$/,
  /^characters\/[a-z][a-z0-9_]*\/(?:memory|timeline|relationships)\.md$/,
  /^scenes\/[a-z][a-z0-9_]*\/(?:memory|timeline)\.md$/,
  /^arcs\/[a-z][a-z0-9_]*\/timeline\.md$/,
];

export function validateSettlementProposal(proposal: SettlementProposal, expectedDay: string, worldRoot: string): void {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) throw new Error('Settlement proposal must be an object');
  if (proposal.version !== 1) throw new Error('Settlement proposal version must be 1');
  if (typeof proposal.day !== 'string' || !DAY_ID.test(proposal.day)) throw new Error('Settlement proposal day must be day_NNNN');
  if (proposal.day !== expectedDay) throw new Error(`Settlement proposal day mismatch: expected ${expectedDay}, got ${proposal.day}`);
  assertNonEmpty(proposal.summary, 'Settlement proposal summary');
  assertNonEmpty(proposal.diary, 'Settlement proposal diary');
  if (!Array.isArray(proposal.state_patch)) throw new Error('Settlement proposal state_patch must be an array');

  const patchedPaths = new Set<string>();
  proposal.state_patch.forEach((patch, index) => {
    validatePatch(patch, index, worldRoot);
    if (patchedPaths.has(patch.path)) throw new Error(`Settlement patch path is duplicated: ${patch.path}`);
    patchedPaths.add(patch.path);
  });

  const seed = proposal.next_day_seed;
  if (!seed || typeof seed !== 'object' || Array.isArray(seed)) throw new Error('Settlement proposal next_day_seed must be an object');
  assertNonEmpty(seed.summary, 'Settlement proposal next_day_seed.summary');
  assertStringArray(seed.suggested_intents, 'Settlement proposal next_day_seed.suggested_intents');
  assertStringArray(seed.unresolved_threads, 'Settlement proposal next_day_seed.unresolved_threads');
}

export function nextDayId(day: string): string {
  const match = day.match(DAY_ID);
  if (!match) throw new Error(`Invalid day id: ${day}`);
  const next = Number(match[1]) + 1;
  if (next > 9999) throw new Error(`Cannot advance beyond ${day}`);
  return `day_${String(next).padStart(4, '0')}`;
}

function validatePatch(patch: SettlementPatch, index: number, worldRoot: string): void {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error(`Settlement patch ${index} must be an object`);
  if (patch.op !== 'replace' && patch.op !== 'append') throw new Error(`Settlement patch ${index} has unsupported op`);
  if (typeof patch.path !== 'string' || !patch.path) throw new Error(`Settlement patch ${index} path must be non-empty`);
  if (path.isAbsolute(patch.path) || patch.path.includes('\\') || patch.path.split('/').includes('..')) throw new Error(`Settlement patch ${index} path is unsafe: ${patch.path}`);
  assertNonEmpty(patch.content, `Settlement patch ${index} content`);

  if (patch.op === 'replace') {
    if (!REPLACE_PATHS.has(patch.path)) throw new Error(`Settlement patch ${index} replace path is not allowed: ${patch.path}`);
    if (!fs.existsSync(path.join(worldRoot, patch.path))) throw new Error(`Settlement patch ${index} cannot replace missing file: ${patch.path}`);
    return;
  }
  if (!APPEND_PATHS.some(pattern => pattern.test(patch.path))) throw new Error(`Settlement patch ${index} append path is not allowed: ${patch.path}`);
  if (!fs.existsSync(path.join(worldRoot, patch.path))) throw new Error(`Settlement patch ${index} cannot append to missing file: ${patch.path}`);
}

function assertNonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) throw new Error(`${label} must be an array of non-empty strings`);
}

export function validateSettlementNarrative(narrative: import('./types').SettlementNarrative): void {
  if (!narrative || typeof narrative !== 'object' || Array.isArray(narrative)) throw new Error('Settlement narrative must be an object');
  assertNonEmpty(narrative.summary, 'Settlement narrative summary');
  assertNonEmpty(narrative.diary, 'Settlement narrative diary');
  const seed = narrative.next_day_seed;
  if (!seed || typeof seed !== 'object' || Array.isArray(seed)) throw new Error('Settlement narrative next_day_seed must be an object');
  assertNonEmpty(seed.summary, 'Settlement narrative next_day_seed.summary');
  assertStringArray(seed.suggested_intents, 'Settlement narrative next_day_seed.suggested_intents');
  if (seed.suggested_intents.length < 1 || seed.suggested_intents.length > 5) throw new Error('Settlement narrative suggested_intents must contain 1 to 5 items');
}
