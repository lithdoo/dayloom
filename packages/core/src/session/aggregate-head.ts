import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { readMarkdownDraftSnapshotV2 } from './markdown-draft-snapshot';

const HASH = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export interface AggregateHeadV1 {
  schemaVersion: 1;
  revision: number;
  draftHash: string;
  activeSession: null | {
    sessionId: string;
    conversationId: string;
    pendingDraftSync: null | {
      turnId: string;
      acceptedGenerationId: string;
      baseDraftHash: string;
      verdict: 'UPDATE';
    };
  };
}

export class AggregateHeadError extends Error {
  constructor(readonly code: 'DRAFT_CONFLICT' | 'DRAFT_INVALID', message: string, options?: ErrorOptions) { super(message, options); this.name = 'AggregateHeadError'; }
}

export function parseAggregateHeadV1(value: unknown): Readonly<AggregateHeadV1> {
  const root = exactObject(value, ['schemaVersion', 'revision', 'draftHash', 'activeSession'], 'AggregateHeadV1');
  if (root.schemaVersion !== 1) invalid('AggregateHeadV1.schemaVersion must be 1.');
  if (!Number.isSafeInteger(root.revision) || (root.revision as number) < 0) invalid('AggregateHeadV1.revision must be a non-negative safe integer.');
  requireHash(root.draftHash, 'draftHash');
  let activeSession: AggregateHeadV1['activeSession'] = null;
  if (root.activeSession !== null) {
    const active = exactObject(root.activeSession, ['sessionId', 'conversationId', 'pendingDraftSync'], 'activeSession');
    requireId(active.sessionId, 'sessionId'); requireId(active.conversationId, 'conversationId');
    let pending: NonNullable<AggregateHeadV1['activeSession']>['pendingDraftSync'] = null;
    if (active.pendingDraftSync !== null) {
      const item = exactObject(active.pendingDraftSync, ['turnId', 'acceptedGenerationId', 'baseDraftHash', 'verdict'], 'pendingDraftSync');
      requireId(item.turnId, 'turnId'); requireId(item.acceptedGenerationId, 'acceptedGenerationId'); requireHash(item.baseDraftHash, 'baseDraftHash');
      if (item.verdict !== 'UPDATE') invalid('pendingDraftSync.verdict must be UPDATE.');
      pending = Object.freeze({ turnId: item.turnId as string, acceptedGenerationId: item.acceptedGenerationId as string, baseDraftHash: item.baseDraftHash as string, verdict: 'UPDATE' });
    }
    activeSession = Object.freeze({ sessionId: active.sessionId as string, conversationId: active.conversationId as string, pendingDraftSync: pending });
  }
  return Object.freeze({ schemaVersion: 1, revision: root.revision as number, draftHash: root.draftHash as string, activeSession });
}

export async function readAggregateHeadV1(slotRoot: string): Promise<Readonly<AggregateHeadV1>> {
  let value: unknown;
  try { value = JSON.parse(await readFile(path.join(slotRoot, 'head.json'), 'utf8')); }
  catch (error) { throw new AggregateHeadError('DRAFT_INVALID', 'Aggregate Head cannot be read.', { cause: error }); }
  return parseAggregateHeadV1(value);
}

export async function installAggregateHeadV1(input: { slotRoot: string; head: Readonly<AggregateHeadV1> }): Promise<void> {
  const head = parseAggregateHeadV1(input.head);
  if (head.revision !== 0 || head.activeSession !== null) invalid('Initial Aggregate Head must have revision 0 and no active Session.');
  await validateReferences(input.slotRoot, head);
  await mkdir(input.slotRoot, { recursive: true });
  const target = path.join(input.slotRoot, 'head.json');
  const handle = await open(target, 'wx');
  try { await handle.writeFile(serialize(head), 'utf8'); await handle.sync(); } finally { await handle.close(); }
}

export async function compareAndSwapAggregateHeadV1(input: {
  slotRoot: string;
  expectedRevision: number;
  next: Readonly<AggregateHeadV1>;
}): Promise<Readonly<AggregateHeadV1>> {
  return withHeadLock(input.slotRoot, () => compareAndSwapUnlocked(input));
}

const headLocks = new Map<string, Promise<void>>();
async function withHeadLock<T>(slotRoot: string, action: () => Promise<T>): Promise<T> {
  const key = path.resolve(slotRoot).toLowerCase(), previous = headLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  headLocks.set(key, queued);
  await previous;
  try { return await action(); }
  finally { release(); if (headLocks.get(key) === queued) headLocks.delete(key); }
}

async function compareAndSwapUnlocked(input: { slotRoot: string; expectedRevision: number; next: Readonly<AggregateHeadV1> }): Promise<Readonly<AggregateHeadV1>> {
  const current = await readAggregateHeadV1(input.slotRoot);
  if (current.revision !== input.expectedRevision) throw new AggregateHeadError('DRAFT_CONFLICT', `Aggregate Head revision changed from ${input.expectedRevision} to ${current.revision}.`);
  const next = parseAggregateHeadV1(input.next);
  if (next.revision !== input.expectedRevision + 1) invalid('Next Aggregate Head revision must increment exactly once.');
  await validateReferences(input.slotRoot, next);
  const target = path.join(input.slotRoot, 'head.json'), temporary = path.join(input.slotRoot, `.head.json.tmp-${randomUUID()}`);
  const handle = await open(temporary, 'wx');
  try { await handle.writeFile(serialize(next), 'utf8'); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temporary, target); } finally { await rm(temporary, { force: true }).catch(() => undefined); }
  return next;
}

async function validateReferences(slotRoot: string, head: Readonly<AggregateHeadV1>): Promise<void> {
  await readMarkdownDraftSnapshotV2({ slotRoot, draftId: 'reference-check', hash: head.draftHash, meta: {
    schemaVersion: 2, draftId: 'reference-check', sourceFormat: 'markdown-v2', kind: 'revise', worldIdentity: 'reference-check', baseCommitId: null, baseRootTreeHash: null, targetDay: null, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  } }).catch((error) => { throw new AggregateHeadError('DRAFT_INVALID', 'Aggregate Head references an invalid Draft snapshot.', { cause: error }); });
  if (head.activeSession === null) return;
  const conversation = path.join(slotRoot, 'sessions', head.activeSession.sessionId, 'conversations', head.activeSession.conversationId);
  try { if (!(await lstat(conversation)).isDirectory()) throw new Error('not a directory'); }
  catch (error) { throw new AggregateHeadError('DRAFT_INVALID', 'Aggregate Head references a missing Conversation revision.', { cause: error }); }
  if (head.activeSession.pendingDraftSync !== null && head.activeSession.pendingDraftSync.baseDraftHash !== head.draftHash) throw new AggregateHeadError('DRAFT_INVALID', 'Pending Draft Sync base hash must equal the current Draft hash.');
}

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object.`);
  const result = value as Record<string, unknown>, actual = Object.keys(result).sort(), expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) invalid(`${label} has unknown or missing fields.`);
  return result;
}
function requireHash(value: unknown, label: string): asserts value is string { if (typeof value !== 'string' || !HASH.test(value)) invalid(`${label} must be a lowercase SHA-256 hash.`); }
function requireId(value: unknown, label: string): asserts value is string { if (typeof value !== 'string' || !SAFE_ID.test(value)) invalid(`${label} is invalid.`); }
function invalid(message: string): never { throw new AggregateHeadError('DRAFT_INVALID', message); }
function serialize(value: Readonly<AggregateHeadV1>): string { return `${JSON.stringify(value, null, 2)}\n`; }
