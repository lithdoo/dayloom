import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { CoreSessionKind } from '../state';
import type { ValidationIssueV1 } from './diagnostics';
import { installAggregateHeadV1, readAggregateHeadV1, type AggregateHeadV1 } from './aggregate-head';
import { INITIAL_BRIEF_V2, INITIAL_EVIDENCE_V2, materializeMarkdownDraftSnapshotV2, readMarkdownDraftSnapshotV2, renderLegacyDraftImportV1, verifySnapshotDirectoryV2, type DraftMetaV2, type DraftTechnicalCheckV2, type MarkdownDraftSnapshotV2, technicalCheckMarkdownDraftV2 } from './markdown-draft-snapshot';
import { lintDraftWorkspaceV1 } from './draft-format';
import { readTurnRecordV1, writeTurnRecordV1, type TurnAuditV1 } from './turn-record';

export interface DraftHandleV2 {
  readonly id: string; readonly root: string;
  readonly briefPath: 'brief.md'; readonly evidencePath: 'evidence.md';
  meta(): Readonly<DraftMetaV2>;
  head(): Promise<Readonly<AggregateHeadV1>>;
  snapshot(): Promise<Readonly<MarkdownDraftSnapshotV2>>;
  technicalCheck(snapshot: MarkdownDraftSnapshotV2, base: MarkdownDraftSnapshotV2, expectedEvidenceBlock: Uint8Array): Promise<DraftTechnicalCheckV2>;
  writeDiagnostics(items: readonly ValidationIssueV1[]): Promise<void>;
  prepareArchive(snapshot: MarkdownDraftSnapshotV2): Promise<{ commit(): Promise<string>; rollback(): Promise<void> }>;
}

export async function openDraftV2(input: { runtimeRoot: string; kind: CoreSessionKind; worldIdentity: string; baseCommitId: string | null; baseRootTreeHash: string | null; targetDay: string | null }): Promise<DraftHandleV2> {
  const drafts = path.join(input.runtimeRoot, 'drafts'), activeRoot = path.join(drafts, 'active'), staleRoot = path.join(drafts, 'stale'), archiveRoot = path.join(drafts, 'archive'), preparedRoot = path.join(drafts, 'prepared');
  await Promise.all([activeRoot, staleRoot, archiveRoot, preparedRoot, path.join(drafts, 'abandoned-sessions')].map((item) => mkdir(item, { recursive: true })));
  const identity = `${input.worldIdentity}\0${input.kind}\0${input.targetDay ?? 'global'}`, slot = createHash('sha256').update(identity).digest('hex'), root = path.join(activeRoot, slot);
  let meta = await readMeta(path.join(root, 'meta.json'));
  if (meta !== null && !matches(meta, input)) { await rename(root, path.join(staleRoot, `${meta.draftId}-${Date.now()}`)); meta = null; }
  if (meta === null) {
    const legacy = await readLegacyMeta(path.join(root, 'meta.json'));
    if (legacy !== null && await exists(path.join(root, 'head.json'))) {
      meta = await readPreparedMeta(path.join(root, 'meta.v2.prepared.json'));
      if (meta === null) throw new Error('DRAFT_MIGRATION_FAILED: Head exists but prepared V2 meta is missing.');
      await finishPostHeadMigration(root, meta);
    } else if (legacy !== null && !matches(legacy, input)) { await rename(root, path.join(staleRoot, `${legacy.draftId}-${Date.now()}`)); meta = await createFresh(root, input); }
    else if (legacy !== null) meta = await migrateLegacy(root, legacy, input);
    else meta = await createFresh(root, input);
  }
  await finishPostHeadMigration(root, meta);
  await recoverAggregateArtifacts(root,await readAggregateHeadV1(root),path.join(drafts,'abandoned-sessions'));
  let prepared = false;
  const handle: DraftHandleV2 = {
    id: meta.draftId, root, briefPath: 'brief.md', evidencePath: 'evidence.md', meta: () => Object.freeze({ ...meta! }),
    head: () => readAggregateHeadV1(root),
    async snapshot() { const head = await readAggregateHeadV1(root); return readMarkdownDraftSnapshotV2({ slotRoot: root, draftId: meta!.draftId, hash: head.draftHash, meta: meta! }); },
    async technicalCheck(snapshot, base, expectedEvidenceBlock) { return technicalCheckMarkdownDraftV2({ base, candidate: snapshot, expectedEvidenceBlock, currentHeadHash: (await readAggregateHeadV1(root)).draftHash }); },
    writeDiagnostics: (items) => writeAtomic(path.join(root, 'diagnostics.json'), Buffer.from(`${JSON.stringify(items, null, 2)}\n`)),
    async prepareArchive(snapshot) {
      if (prepared) throw new Error('Draft archive is already prepared.'); prepared = true;
      await verifySnapshotDirectoryV2(snapshot.root, snapshot.hash);
      const staging = path.join(preparedRoot, meta!.draftId), target = path.join(archiveRoot, meta!.draftId);
      await rm(staging, { recursive: true, force: true }); await mkdir(staging); await cp(path.join(root, 'meta.json'), path.join(staging, 'meta.json')); await cp(snapshot.root, path.join(staging, 'snapshot'), { recursive: true });
      try { await rename(staging, target); } catch (error) { prepared = false; await rm(staging, { recursive: true, force: true }); throw error; }
      let settled = false;
      return Object.freeze({ async commit() { if (settled) throw new Error('Prepared Draft archive is already settled.'); settled = true; await rm(root, { recursive: true, force: true }); return target; }, async rollback() { if (settled) return; settled = true; prepared = false; await rm(target, { recursive: true, force: true }); } });
    },
  };
  return Object.freeze(handle);
}

async function createFresh(root: string, input: Parameters<typeof openDraftV2>[0]): Promise<DraftMetaV2> {
  const now = new Date().toISOString(), meta: DraftMetaV2 = { schemaVersion: 2, draftId: `draft_${randomUUID().replaceAll('-', '')}`, sourceFormat: 'markdown-v2', kind: input.kind, worldIdentity: input.worldIdentity, baseCommitId: input.baseCommitId, baseRootTreeHash: input.baseRootTreeHash, targetDay: input.targetDay, createdAt: now, updatedAt: now };
  await mkdir(root, { recursive: true });
  const snapshot = await materializeMarkdownDraftSnapshotV2({ slotRoot: root, draftId: meta.draftId, meta, brief: Buffer.from(INITIAL_BRIEF_V2), evidence: Buffer.from(INITIAL_EVIDENCE_V2) });
  await writeAtomic(path.join(root, 'meta.json'), Buffer.from(`${JSON.stringify(meta, null, 2)}\n`)); await writeAtomic(path.join(root, 'diagnostics.json'), Buffer.from('[]\n'));
  await installAggregateHeadV1({ slotRoot: root, head: { schemaVersion: 1, revision: 0, draftHash: snapshot.hash, activeSession: null } }); return meta;
}

async function migrateLegacy(root: string, legacy: LegacyMeta, input: Parameters<typeof openDraftV2>[0]): Promise<DraftMetaV2> {
  const lint = await lintDraftWorkspaceV1(root, input.kind); if (!lint.ok) throw new Error('DRAFT_MIGRATION_FAILED: Legacy Draft is invalid.');
  const sources = [{ path: 'draft.yaml', content: await readFile(path.join(root, 'draft.yaml')) }];
  const contentRoot = path.join(root, 'content'); if (await exists(contentRoot)) for (const relative of await markdownFiles(contentRoot)) sources.push({ path: `content/${relative}`, content: await readFile(path.join(contentRoot, ...relative.split('/'))) });
  const rendered = renderLegacyDraftImportV1(sources), now = new Date().toISOString(), meta: DraftMetaV2 = { schemaVersion: 2, draftId: legacy.draftId, sourceFormat: 'submission-v1-import', kind: legacy.kind, worldIdentity: legacy.worldIdentity, baseCommitId: legacy.baseCommitId, baseRootTreeHash: legacy.baseRootTreeHash, targetDay: legacy.targetDay, createdAt: legacy.createdAt, updatedAt: now };
  const snapshot = await materializeMarkdownDraftSnapshotV2({ slotRoot: root, draftId: meta.draftId, meta, brief: rendered.brief, evidence: rendered.evidence });
  await writeNew(path.join(root, 'meta.v2.prepared.json'), Buffer.from(`${JSON.stringify({ ...meta, legacyImportManifest: rendered.manifest }, null, 2)}\n`));
  await installAggregateHeadV1({ slotRoot: root, head: { schemaVersion: 1, revision: 0, draftHash: snapshot.hash, activeSession: null } }); await finishPostHeadMigration(root, meta); return meta;
}
async function finishPostHeadMigration(root: string, meta: DraftMetaV2): Promise<void> {
  const prepared = path.join(root, 'meta.v2.prepared.json'); if (!(await exists(prepared))) return;
  await writeAtomic(path.join(root, 'meta.json'), Buffer.from(`${JSON.stringify(meta, null, 2)}\n`)); const legacyRoot = path.join(root, 'legacy-v1'); await mkdir(legacyRoot, { recursive: true });
  for (const name of ['draft.yaml', 'content']) if (await exists(path.join(root, name)) && !(await exists(path.join(legacyRoot, name)))) await rename(path.join(root, name), path.join(legacyRoot, name)); await rm(prepared, { force: true });
}
async function recoverAggregateArtifacts(root: string, head: Readonly<AggregateHeadV1>, abandonedRoot: string): Promise<void> {
  const snapshots = path.join(root, 'snapshots');
  for (const entry of await readdir(snapshots, { withFileTypes: true })) if (entry.name !== head.draftHash) await rm(path.join(snapshots, entry.name), { recursive: true, force: true });
  const sessions = path.join(root, 'sessions');
  if (!(await exists(sessions))) return;
  for (const entry of await readdir(sessions, { withFileTypes: true })) {
    if (!entry.isDirectory()) throw new Error('Draft sessions root contains a non-directory entry.');
    const sessionRoot = path.join(sessions, entry.name);
    if (entry.name !== head.activeSession?.sessionId) {
      await reconcileAbandonedTurnRecords(sessionRoot);
      await mkdir(abandonedRoot, { recursive: true });
      const target = path.join(abandonedRoot, entry.name);
      if (await exists(target)) await rm(sessionRoot, { recursive: true, force: true }); else await rename(sessionRoot, target);
      continue;
    }
    await reconcileActiveTurnRecords(sessionRoot, head, path.join(snapshots, head.draftHash, 'evidence.md'));
    const conversations = path.join(sessionRoot, 'conversations');
    if (await exists(conversations)) for (const conversation of await readdir(conversations, { withFileTypes: true })) if (conversation.name !== head.activeSession?.conversationId) await rm(path.join(conversations, conversation.name), { recursive: true, force: true });
  }
}
async function reconcileActiveTurnRecords(sessionRoot: string, head: Readonly<AggregateHeadV1>, evidencePath: string): Promise<void> {
  const turnsRoot = path.join(sessionRoot, 'turns');
  if (!(await exists(turnsRoot))) return;
  const pending = head.activeSession?.pendingDraftSync ?? null;
  const evidence = pending === null ? await readFile(evidencePath, 'utf8') : '';
  for (const entry of await readdir(turnsRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const target = path.join(turnsRoot, entry.name), record = structuredClone(await readTurnRecordV1(target)) as TurnAuditV1;
    if (pending?.turnId === record.turnId && record.acceptedGenerationId === pending.acceptedGenerationId && record.terminalStatus !== 'draft-sync-pending') {
      record.terminalStatus = 'draft-sync-pending'; await writeTurnRecordV1(target, record); continue;
    }
    if (pending === null && record.acceptedGenerationId !== null && record.draftVerdict === 'UPDATE' && record.resultDraftHash === null && (record.terminalStatus === null || record.terminalStatus === 'draft-sync-pending')) {
      if (!evidence.includes(`## Turn \`${record.turnId}\``)) throw new Error('Aggregate Head and Turn evidence disagree during recovery.');
      record.resultDraftHash = head.draftHash; record.terminalStatus = 'committed'; await writeTurnRecordV1(target, record);
    }
  }
}
async function reconcileAbandonedTurnRecords(sessionRoot: string): Promise<void> {
  const turnsRoot = path.join(sessionRoot, 'turns');
  if (!(await exists(turnsRoot))) return;
  for (const entry of await readdir(turnsRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const target = path.join(turnsRoot, entry.name), record = structuredClone(await readTurnRecordV1(target)) as TurnAuditV1;
    if (record.terminalStatus === 'draft-sync-pending') { record.terminalStatus = 'abandoned-after-accept'; await writeTurnRecordV1(target, record); }
  }
}
type LegacyMeta = { schemaVersion: 1; draftId: string; kind: CoreSessionKind; worldIdentity: string; baseCommitId: string | null; baseRootTreeHash: string | null; targetDay: string | null; createdAt: string; updatedAt: string };
async function readMeta(target: string): Promise<DraftMetaV2 | null> {
  try { const value = JSON.parse(await readFile(target, 'utf8')); return value.schemaVersion === 2 ? parseMetaV2(value) : null; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
async function readLegacyMeta(target: string): Promise<LegacyMeta | null> {
  try { const value = JSON.parse(await readFile(target, 'utf8')); return value.schemaVersion === 1 ? parseLegacyMeta(value) : null; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
async function readPreparedMeta(target: string): Promise<DraftMetaV2 | null> {
  try {
    const value = JSON.parse(await readFile(target, 'utf8'));
    if (value.schemaVersion !== 2) return null;
    const { legacyImportManifest, ...meta } = value;
    if (!Array.isArray(legacyImportManifest)) throw new Error('Prepared Draft migration manifest is invalid.');
    return parseMetaV2(meta);
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
function parseMetaV2(value: unknown): DraftMetaV2 {
  const item = exactObject(value, ['schemaVersion','draftId','sourceFormat','kind','worldIdentity','baseCommitId','baseRootTreeHash','targetDay','createdAt','updatedAt'], 'Draft V2 meta');
  if (item.schemaVersion !== 2 || !['markdown-v2','submission-v1-import'].includes(String(item.sourceFormat))) throw new Error('Draft V2 meta header is invalid.');
  validateCommonMeta(item);
  return item as unknown as DraftMetaV2;
}
function parseLegacyMeta(value: unknown): LegacyMeta {
  const item = exactObject(value, ['schemaVersion','draftId','kind','worldIdentity','baseCommitId','baseRootTreeHash','targetDay','status','createdAt','updatedAt'], 'Legacy Draft meta');
  if (item.schemaVersion !== 1 || !['active','submit-failed'].includes(String(item.status))) throw new Error('Legacy Draft meta is not resumable.');
  validateCommonMeta(item);
  const { status: _status, ...meta } = item;
  return meta as unknown as LegacyMeta;
}
function validateCommonMeta(item: Record<string, unknown>): void {
  if (typeof item.draftId !== 'string' || item.draftId === '' || !['init','planning','play','revise'].includes(String(item.kind)) || typeof item.worldIdentity !== 'string' || item.worldIdentity === '') throw new Error('Draft meta identity is invalid.');
  for (const key of ['baseCommitId','baseRootTreeHash','targetDay']) if (item[key] !== null && typeof item[key] !== 'string') throw new Error(`Draft meta ${key} is invalid.`);
  for (const key of ['createdAt','updatedAt']) if (typeof item[key] !== 'string' || !Number.isFinite(Date.parse(item[key] as string))) throw new Error(`Draft meta ${key} is invalid.`);
}
function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const item = value as Record<string, unknown>, actual = Object.keys(item).sort(), expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key,index) => key !== expected[index])) throw new Error(`${label} has unknown or missing fields.`);
  return item;
}
function matches(meta: DraftMetaV2 | LegacyMeta, input: Parameters<typeof openDraftV2>[0]): boolean { return meta.kind === input.kind && meta.worldIdentity === input.worldIdentity && meta.baseCommitId === input.baseCommitId && meta.baseRootTreeHash === input.baseRootTreeHash && meta.targetDay === input.targetDay; }
async function markdownFiles(root: string, prefix = ''): Promise<string[]> { const result: string[] = []; for (const entry of await readdir(path.join(root, ...prefix.split('/').filter(Boolean)), { withFileTypes: true })) { const relative = prefix ? `${prefix}/${entry.name}` : entry.name; if (entry.isDirectory()) result.push(...await markdownFiles(root, relative)); else if (entry.isFile() && entry.name.endsWith('.md')) result.push(relative); else throw new Error('DRAFT_MIGRATION_FAILED: unsupported Legacy content.'); } return result.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))); }
async function exists(target: string): Promise<boolean> { try { await lstat(target); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
async function writeNew(target: string, content: Uint8Array): Promise<void> { const handle = await open(target, 'wx'); try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); } }
async function writeAtomic(target: string, content: Uint8Array): Promise<void> { await mkdir(path.dirname(target), { recursive: true }); const temporary = `${target}.tmp-${randomUUID()}`; await writeNew(temporary, content); try { await rename(temporary, target); } finally { await rm(temporary, { force: true }).catch(() => undefined); } }
