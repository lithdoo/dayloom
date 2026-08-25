import { cp, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import YAML from 'yaml';
import type { CoreSessionKind } from '../state';
import { lintDraftWorkspaceV1, type DraftLintResultV1 } from './draft-format';
import type { ValidationIssueV1 } from './diagnostics';

export type DraftStatusV1 = 'active' | 'submitting' | 'submit-failed' | 'archived';
export interface DraftMetaV1 {
  schemaVersion: 1; draftId: string; kind: CoreSessionKind; worldIdentity: string;
  baseCommitId: string | null; baseRootTreeHash: string | null; targetDay: string | null;
  status: DraftStatusV1; createdAt: string; updatedAt: string;
}
export interface DraftHandleV1 {
  readonly id: string; readonly root: string; readonly contentRoot: string;
  meta(): Readonly<DraftMetaV1>;
  lint(): Promise<DraftLintResultV1>;
  setStatus(status: DraftStatusV1): Promise<void>;
  writeDiagnostics(items: readonly ValidationIssueV1[]): Promise<void>;
  prepareArchive(): Promise<{ commit(): Promise<string>; rollback(): Promise<void> }>;
  archive(): Promise<string>;
}

export async function openDraftV1(input: {
  runtimeRoot: string; kind: CoreSessionKind; worldIdentity: string;
  baseCommitId: string | null; baseRootTreeHash: string | null; targetDay: string | null;
}): Promise<DraftHandleV1> {
  const drafts = path.join(input.runtimeRoot, 'drafts'), activeRoot = path.join(drafts, 'active'), staleRoot = path.join(drafts, 'stale'), archiveRoot = path.join(drafts, 'archive'), preparedRoot = path.join(drafts, 'prepared');
  await Promise.all([mkdir(activeRoot, { recursive: true }), mkdir(staleRoot, { recursive: true }), mkdir(archiveRoot, { recursive: true }), mkdir(preparedRoot, { recursive: true })]);
  const identity = `${input.worldIdentity}\0${input.kind}\0${input.targetDay ?? 'global'}`, slot = createHash('sha256').update(identity).digest('hex');
  const root = path.join(activeRoot, slot), metaPath = path.join(root, 'meta.json');
  let meta = await readMeta(metaPath);
  if (meta && (meta.kind !== input.kind || meta.worldIdentity !== input.worldIdentity || meta.targetDay !== input.targetDay || meta.baseCommitId !== input.baseCommitId || meta.baseRootTreeHash !== input.baseRootTreeHash)) {
    await rename(root, path.join(staleRoot, `${meta.draftId}-${Date.now()}`)); meta = null;
  }
  if (!meta) {
    const now = new Date().toISOString();
    meta = { schemaVersion: 1, draftId: `draft_${randomUUID().replaceAll('-', '')}`, kind: input.kind, worldIdentity: input.worldIdentity, baseCommitId: input.baseCommitId, baseRootTreeHash: input.baseRootTreeHash, targetDay: input.targetDay, status: 'active', createdAt: now, updatedAt: now };
    await mkdir(path.join(root, 'content'), { recursive: true });
    await writeAtomic(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
    await installSkeleton(root, input.kind, input.targetDay);
    await writeAtomic(path.join(root, 'diagnostics.json'), '[]\n');
  } else if (meta.status !== 'active' && meta.status !== 'submit-failed') throw new Error(`Draft ${meta.draftId} is not resumable.`);
  let current = meta;
  let prepared = false;
  const handle: DraftHandleV1 = {
    id: current.draftId, root, contentRoot: path.join(root, 'content'), meta: () => Object.freeze({ ...current }),
    lint: () => lintDraftWorkspaceV1(root, input.kind),
    async setStatus(status: DraftStatusV1) { current = { ...current, status, updatedAt: new Date().toISOString() }; await writeAtomic(metaPath, `${JSON.stringify(current, null, 2)}\n`); },
    async writeDiagnostics(items: readonly ValidationIssueV1[]) { await writeAtomic(path.join(root, 'diagnostics.json'), `${JSON.stringify(items, null, 2)}\n`); },
    async prepareArchive() {
      if (prepared) throw new Error('Draft archive is already prepared.'); prepared = true;
      const staging = path.join(preparedRoot, current.draftId), target = path.join(archiveRoot, current.draftId); await rm(staging, { recursive: true, force: true }); await cp(root, staging, { recursive: true, errorOnExist: true });
      const archived = { ...current, status: 'archived' as const, updatedAt: new Date().toISOString() }; await writeAtomic(path.join(staging, 'meta.json'), `${JSON.stringify(archived, null, 2)}\n`); try { await rename(staging, target); } catch (error) { await rm(staging, { recursive: true, force: true }).catch(() => undefined); prepared = false; throw error; }
      let settled = false;
      return Object.freeze({
        async commit() { if (settled) throw new Error('Prepared Draft archive is already settled.'); settled = true; current = archived; await rm(root, { recursive: true, force: true }).catch(() => undefined); return target; },
        async rollback() { if (settled) return; settled = true; prepared = false; await rm(target, { recursive: true, force: true }); },
      });
    },
    async archive() { const transaction = await handle.prepareArchive(); return transaction.commit(); },
  };
  return Object.freeze(handle);
}

async function installSkeleton(root: string, kind: CoreSessionKind, targetDay: string | null): Promise<void> {
  let value: Record<string, unknown>;
  if (kind === 'init') value = { schemaVersion: 1, kind, title: { decision: 'proposed', value: '' }, canon: { premise: { decision: 'proposed', path: 'canon/premise.md' }, rules: { decision: 'proposed', path: 'canon/rules.md' }, style: { decision: 'proposed', path: 'canon/style.md' }, userRole: { decision: 'proposed', path: 'canon/user-role.md' } }, worldState: { decision: 'proposed', value: { status: 'active', elapsed: null, variables: {} } }, characters: [], locations: [], arcs: [], initialFacts: [], unresolvedThreads: [], storySeeds: [] };
  else if (kind === 'planning') value = { schemaVersion: 1, kind, targetDay, intent: { decision: 'proposed', value: '' }, knownContext: { decision: 'proposed', value: [] }, constraints: { decision: 'proposed', value: [] }, openQuestions: { decision: 'proposed', value: [] }, maxEvents: { decision: 'proposed', value: 1 }, beats: [] };
  else if (kind === 'play') value = { schemaVersion: 1, kind, targetDay, events: [] };
  else value = { schemaVersion: 1, kind, operations: [] };
  await writeAtomic(path.join(root, 'draft.yaml'), YAML.stringify(value));
  if (kind === 'init') for (const relative of ['canon/premise.md', 'canon/rules.md', 'canon/style.md', 'canon/user-role.md']) { const target = path.join(root, 'content', ...relative.split('/')); await mkdir(path.dirname(target), { recursive: true }); await writeAtomic(target, ''); }
}

async function readMeta(target: string): Promise<DraftMetaV1 | null> {
  try { const value = JSON.parse(await readFile(target, 'utf8')) as DraftMetaV1; if (value.schemaVersion !== 1 || typeof value.draftId !== 'string') throw new Error('Draft meta is invalid.'); return value; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
async function writeAtomic(target: string, content: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true }); const temporary = `${target}.tmp-${randomUUID()}`; const handle = await open(temporary, 'wx');
  try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temporary, target); } finally { await rm(temporary, { force: true }).catch(() => undefined); }
}
