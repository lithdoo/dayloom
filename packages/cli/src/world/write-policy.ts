import type { DayloomPatchChangeV1, DayloomPatchV1 } from '@dayloom/archive-protocol';

const ENTITY = '[a-z][a-z0-9-]*';

function exactOrEntity(path: string, patterns: readonly RegExp[], exact: readonly string[]): boolean {
  return exact.includes(path) || patterns.some((pattern) => pattern.test(path));
}

function initAllowed(path: string): boolean {
  return exactOrEntity(path, [
    new RegExp(`^characters/${ENTITY}/(?:profile\\.md|state\\.yaml|relationships\\.yaml|memory\\.md|timeline\\.md)$`),
    new RegExp(`^locations/${ENTITY}/(?:profile\\.md|state\\.yaml|memory\\.md|triggers\\.yaml|timeline\\.md)$`),
    new RegExp(`^arcs/${ENTITY}/(?:profile\\.md|state\\.yaml|timeline\\.md)$`),
    /^custom\/.+/,
  ], [
    'profile/dayloom.json',
    'canon/premise.md', 'canon/rules.md', 'canon/style.md', 'canon/user-role.md',
    'state/world.yaml', 'state/calendar.yaml', 'state/progress.yaml', 'state/variables.yaml',
    'characters/index.yaml', 'locations/index.yaml', 'arcs/index.yaml',
    'memory/short-term.md', 'memory/long-term.md', 'memory/facts.yaml',
    'memory/unresolved-threads.yaml', 'memory/important-events.yaml', 'story-seeds/active.yaml',
  ]);
}

function reviseAllowed(path: string): boolean {
  if (path === 'state/calendar.yaml' || path.startsWith('days/') || path.startsWith('profile/')) return false;
  return exactOrEntity(path, [
    new RegExp(`^characters/${ENTITY}/(?:profile\\.md|state\\.yaml|relationships\\.yaml|memory\\.md|timeline\\.md)$`),
    new RegExp(`^locations/${ENTITY}/(?:profile\\.md|state\\.yaml|memory\\.md|triggers\\.yaml|timeline\\.md)$`),
    new RegExp(`^arcs/${ENTITY}/(?:profile\\.md|state\\.yaml|timeline\\.md)$`),
    /^custom\/.+/,
  ], [
    'canon/premise.md', 'canon/rules.md', 'canon/style.md', 'canon/user-role.md',
    'state/world.yaml', 'state/progress.yaml', 'state/variables.yaml',
    'characters/index.yaml', 'locations/index.yaml', 'arcs/index.yaml',
    'memory/short-term.md', 'memory/long-term.md', 'memory/facts.yaml',
    'memory/unresolved-threads.yaml', 'memory/important-events.yaml', 'story-seeds/active.yaml',
  ]);
}

function settleAllowed(path: string, day: string): boolean {
  return exactOrEntity(path, [
    new RegExp(`^characters/${ENTITY}/(?:state\\.yaml|timeline\\.md)$`),
    new RegExp(`^locations/${ENTITY}/(?:state\\.yaml|timeline\\.md)$`),
    new RegExp(`^arcs/${ENTITY}/(?:state\\.yaml|timeline\\.md)$`),
  ], [
    'state/calendar.yaml', 'state/variables.yaml',
    'memory/facts.yaml', 'memory/important-events.yaml', 'story-seeds/active.yaml',
    `days/${day}/summary.md`, `days/${day}/diary.md`, `days/${day}/settlement.yaml`, `days/${day}/next-day-seed.yaml`,
  ]);
}

function assertRealDirection(change: DayloomPatchChangeV1, mode: 'add-only' | 'delete-only' | 'write'): void {
  if (mode === 'add-only' && (change.beforeBlobHash !== null || change.afterBlobHash === null)) {
    throw new Error(`init may only add World documents: ${change.path}`);
  }
  if (mode === 'delete-only' && (change.beforeBlobHash === null || change.afterBlobHash !== null)) {
    throw new Error(`abandon may only delete current-day documents: ${change.path}`);
  }
  if (mode === 'write' && change.afterBlobHash === null) {
    throw new Error(`settle may not delete World documents: ${change.path}`);
  }
}

export function assertPatchWritePolicyV1(patch: DayloomPatchV1): void {
  const beforeDay = patch.control.before?.day ?? null;
  const afterDay = patch.control.after.day;
  for (const change of patch.changes) {
    const path = change.path;
    if (patch.command === 'init') {
      assertRealDirection(change, 'add-only');
      if (!initAllowed(path) || path.startsWith('days/')) throw new Error(`init cannot write ${path}`);
      continue;
    }
    if (patch.command === 'plan') {
      if (afterDay === null) throw new Error('plan target day is missing.');
      const allowed = new Set([
        `days/${afterDay}/plan.json`,
        `days/${afterDay}/timeline.md`,
        `days/${afterDay}/dialogue/planning.md`,
        `days/${afterDay}/events/index.yaml`,
      ]);
      if (!allowed.has(path)) throw new Error(`plan cannot write ${path}`);
      continue;
    }
    if (patch.command === 'play') {
      if (beforeDay === null) throw new Error('play day is missing.');
      if (
        path !== `days/${beforeDay}/play.json` &&
        path !== `days/${beforeDay}/play-index.json` &&
        path !== `days/${beforeDay}/summary.md` &&
        path !== `days/${beforeDay}/timeline.md` &&
        !path.startsWith(`days/${beforeDay}/events/`)
      ) throw new Error(`play cannot write ${path}`);
      continue;
    }
    if (patch.command === 'revise') {
      if (!reviseAllowed(path)) throw new Error(`revise cannot write ${path}`);
      continue;
    }
    if (patch.command === 'settle') {
      if (beforeDay === null) throw new Error('settle day is missing.');
      assertRealDirection(change, 'write');
      if (!settleAllowed(path, beforeDay)) throw new Error(`settle cannot write ${path}`);
      continue;
    }
    if (beforeDay === null) throw new Error('abandon day is missing.');
    assertRealDirection(change, 'delete-only');
    if (!path.startsWith(`days/${beforeDay}/`)) throw new Error(`abandon cannot delete ${path}`);
  }
}
