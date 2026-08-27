import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { CoreSessionKind } from '../state';
import type { ValidationIssueV1 } from './diagnostics';

export const INITIAL_BRIEF_V2 = '# Dayloom Draft Brief\n\n## Current goal\n\n## Agreed intent\n\n## Proposed or unresolved\n\n## Requested archive changes\n\n## Submission notes\n\n';
export const INITIAL_EVIDENCE_V2 = '# Dayloom Evidence\n\n> Core-owned append-only evidence. Assistant text is not user confirmation.\n\n';

const BRIEF_MAX_BYTES = 8 * 1024 * 1024;
const EVIDENCE_MAX_BYTES = 32 * 1024 * 1024;
const TOTAL_MAX_BYTES = 40 * 1024 * 1024;
const USER_INPUT_MAX_BYTES = 1024 * 1024;
const ACCEPTED_RESPONSE_MAX_BYTES = 1024 * 1024;
const CURATOR_NOTE_MAX_BYTES = 16 * 1024;
const HASH = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export interface DraftMetaV2 {
  schemaVersion: 2;
  draftId: string;
  sourceFormat: 'markdown-v2' | 'submission-v1-import';
  kind: CoreSessionKind;
  worldIdentity: string;
  baseCommitId: string | null;
  baseRootTreeHash: string | null;
  targetDay: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MarkdownDraftSnapshotV2 {
  draftId: string;
  hash: string;
  root: string;
  briefPath: 'brief.md';
  evidencePath: 'evidence.md';
  meta: Readonly<DraftMetaV2>;
}

export interface EvidenceBlockInputV1 {
  turnId: string;
  generationId: string;
  userInput: string;
  acceptedResponse: string;
  curatorNote: string;
}

export interface LegacyDraftSourceV1 { path: string; content: Uint8Array }
export interface LegacyDraftRenderV1 { brief: Uint8Array; evidence: Uint8Array; manifest: readonly { path: string; bytes: number; sha256: string }[] }

export type DraftTechnicalCheckV2 = { ok: true } | { ok: false; diagnostics: readonly ValidationIssueV1[] };

export function renderEvidenceBlockV1(input: EvidenceBlockInputV1): Uint8Array {
  requireSafeId(input.turnId, 'turnId');
  requireSafeId(input.generationId, 'generationId');
  const fields = [
    ['user-input', encodeText(input.userInput, USER_INPUT_MAX_BYTES, 'userInput')],
    ['accepted-response', encodeText(input.acceptedResponse, ACCEPTED_RESPONSE_MAX_BYTES, 'acceptedResponse')],
    ['curator-note', encodeText(input.curatorNote, CURATOR_NOTE_MAX_BYTES, 'curatorNote')],
  ] as const;
  const chunks: Buffer[] = [Buffer.from(`## Turn \`${input.turnId}\`\n\nGeneration: \`${input.generationId}\`\n\n`, 'utf8')];
  for (const [name, content] of fields) {
    const fence = chooseFence(content);
    chunks.push(Buffer.from(`### ${name}\n\nBytes: ${content.byteLength}\nSHA-256: ${sha256(content)}\n\n${fence}text\n`, 'utf8'));
    chunks.push(content, Buffer.from(`\n${fence}\n`, 'utf8'));
  }
  return Buffer.concat(chunks);
}

export function renderLegacyDraftImportV1(sources: readonly LegacyDraftSourceV1[]): LegacyDraftRenderV1 {
  if (sources.length === 0 || sources[0].path !== 'draft.yaml') throw new Error('Legacy import must start with draft.yaml.');
  const ordered = [sources[0], ...sources.slice(1).sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)))];
  const seen = new Set<string>();
  const manifest = ordered.map((source) => {
    if (seen.has(source.path)) throw new Error(`Duplicate Legacy source: ${source.path}.`); seen.add(source.path);
    if (!isLegacyPath(source.path) || (source.path !== 'draft.yaml' && (!source.path.startsWith('content/') || !source.path.endsWith('.md')))) throw new Error(`Invalid Legacy source path: ${source.path}.`);
    validateUtf8(source.content, source.path);
    return Object.freeze({ path: source.path, bytes: source.content.byteLength, sha256: sha256(source.content) });
  });
  const brief: Buffer[] = [Buffer.from('# Imported Session Submission V1 Draft\n\n> Lossless mechanical import; not a new Draft schema.\n\n')];
  for (let index = 0; index < ordered.length; index += 1) {
    const source = ordered[index], item = manifest[index], fence = chooseFence(source.content), language = source.path === 'draft.yaml' ? 'yaml' : 'markdown';
    brief.push(Buffer.from(`## Source: \`${source.path}\`\n\nBytes: ${item.bytes}\nSHA-256: ${item.sha256}\n\n${fence}${language}\n`), Buffer.from(source.content), Buffer.from(`\n${fence}\n\n`));
  }
  const evidence: Buffer[] = [Buffer.from(INITIAL_EVIDENCE_V2), Buffer.from('## Legacy Import\n\n')];
  for (const item of manifest) evidence.push(Buffer.from(`- Path: \`${item.path}\`\n  Bytes: ${item.bytes}\n  SHA-256: ${item.sha256}\n`));
  evidence.push(Buffer.from('\n'));
  return Object.freeze({ brief: Buffer.concat(brief), evidence: Buffer.concat(evidence), manifest: Object.freeze(manifest) });
}

export function hashMarkdownDraftV2(brief: Uint8Array, evidence: Uint8Array): string {
  validateDraftBytes(brief, evidence);
  const digest = createHash('sha256');
  for (const [relative, content] of [['brief.md', brief], ['evidence.md', evidence]] as const) {
    const name = Buffer.from(relative, 'utf8');
    const pathLength = Buffer.alloc(4); pathLength.writeUInt32BE(name.byteLength);
    const contentLength = Buffer.alloc(8); contentLength.writeBigUInt64BE(BigInt(content.byteLength));
    digest.update(pathLength).update(name).update(contentLength).update(content);
  }
  return digest.digest('hex');
}

export async function materializeMarkdownDraftSnapshotV2(input: {
  slotRoot: string;
  draftId: string;
  meta: Readonly<DraftMetaV2>;
  brief: Uint8Array;
  evidence: Uint8Array;
}): Promise<Readonly<MarkdownDraftSnapshotV2>> {
  const hash = hashMarkdownDraftV2(input.brief, input.evidence);
  const snapshotsRoot = path.join(input.slotRoot, 'snapshots');
  const target = path.join(snapshotsRoot, hash);
  await mkdir(snapshotsRoot, { recursive: true });
  if (await exists(target)) {
    await verifySnapshotDirectoryV2(target, hash);
    if (!bytesEqual(await readFile(path.join(target, 'brief.md')), input.brief)
      || !bytesEqual(await readFile(path.join(target, 'evidence.md')), input.evidence)) throw new Error(`Draft snapshot collision at ${hash}.`);
  } else {
    const prepared = path.join(snapshotsRoot, `${hash}.prepared-${randomUUID()}`);
    try {
      await mkdir(prepared);
      await writeNewFile(path.join(prepared, 'brief.md'), input.brief);
      await writeNewFile(path.join(prepared, 'evidence.md'), input.evidence);
      await verifySnapshotDirectoryV2(prepared, hash);
      try { await renameDirectoryAtomically(prepared, target); }
      catch (error) {
        if (!(await exists(target))) throw error;
        await verifySnapshotDirectoryV2(target, hash);
        if (!bytesEqual(await readFile(path.join(target, 'brief.md')), input.brief)
          || !bytesEqual(await readFile(path.join(target, 'evidence.md')), input.evidence)) throw error;
      }
    } finally { await rm(prepared, { recursive: true, force: true }).catch(() => undefined); }
  }
  return Object.freeze({ draftId: input.draftId, hash, root: target, briefPath: 'brief.md', evidencePath: 'evidence.md', meta: Object.freeze({ ...input.meta }) });
}

export async function readMarkdownDraftSnapshotV2(input: {
  slotRoot: string; draftId: string; hash: string; meta: Readonly<DraftMetaV2>;
}): Promise<Readonly<MarkdownDraftSnapshotV2>> {
  if (!HASH.test(input.hash)) throw new Error('Draft snapshot hash is invalid.');
  const root = path.join(input.slotRoot, 'snapshots', input.hash);
  await verifySnapshotDirectoryV2(root, input.hash);
  return Object.freeze({ draftId: input.draftId, hash: input.hash, root, briefPath: 'brief.md', evidencePath: 'evidence.md', meta: Object.freeze({ ...input.meta }) });
}

export async function verifySnapshotDirectoryV2(root: string, expectedHash?: string): Promise<string> {
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.length !== 2 || entries.some((entry) => !entry.isFile() || (entry.name !== 'brief.md' && entry.name !== 'evidence.md'))) throw new Error('Draft snapshot must contain only brief.md and evidence.md as regular files.');
  const briefPath = path.join(root, 'brief.md'), evidencePath = path.join(root, 'evidence.md');
  if (!(await lstat(briefPath)).isFile() || !(await lstat(evidencePath)).isFile()) throw new Error('Draft snapshot files must be regular files.');
  const hash = hashMarkdownDraftV2(await readFile(briefPath), await readFile(evidencePath));
  if (expectedHash !== undefined && hash !== expectedHash) throw new Error(`Draft snapshot hash mismatch: expected ${expectedHash}, got ${hash}.`);
  return hash;
}

export async function technicalCheckMarkdownDraftV2(input: {
  base: Readonly<MarkdownDraftSnapshotV2>;
  candidate: Readonly<MarkdownDraftSnapshotV2>;
  expectedEvidenceBlock: Uint8Array;
  currentHeadHash: string;
}): Promise<DraftTechnicalCheckV2> {
  const diagnostics: ValidationIssueV1[] = [];
  let baseBrief: Buffer, baseEvidence: Buffer, candidateBrief: Buffer, candidateEvidence: Buffer;
  try {
    await verifySnapshotDirectoryV2(input.base.root, input.base.hash);
    await verifySnapshotDirectoryV2(input.candidate.root, input.candidate.hash);
    [baseBrief, baseEvidence, candidateBrief, candidateEvidence] = await Promise.all([
      readFile(path.join(input.base.root, 'brief.md')), readFile(path.join(input.base.root, 'evidence.md')),
      readFile(path.join(input.candidate.root, 'brief.md')), readFile(path.join(input.candidate.root, 'evidence.md')),
    ]);
  } catch (error) { return failed('DRAFT_SNAPSHOT_INVALID', error instanceof Error ? error.message : String(error)); }
  if (bytesEqual(baseBrief, candidateBrief)) diagnostics.push(issue('DRAFT_BRIEF_UNCHANGED', 'brief.md must have a non-empty byte change.'));
  if (!candidateEvidence.subarray(0, baseEvidence.byteLength).equals(baseEvidence)) diagnostics.push(issue('DRAFT_EVIDENCE_REWRITTEN', 'evidence.md must preserve the entire base as an exact byte prefix.'));
  else if (!candidateEvidence.subarray(baseEvidence.byteLength).equals(input.expectedEvidenceBlock)) diagnostics.push(issue('DRAFT_EVIDENCE_SUFFIX', 'evidence.md must append exactly the Core-rendered evidence block.'));
  if (input.currentHeadHash !== input.base.hash) diagnostics.push(issue('DRAFT_CONFLICT', 'Aggregate Head no longer references the checked base Draft.'));
  return diagnostics.length === 0 ? Object.freeze({ ok: true as const }) : Object.freeze({ ok: false as const, diagnostics: Object.freeze(diagnostics) });
}

function validateDraftBytes(brief: Uint8Array, evidence: Uint8Array): void {
  validateUtf8(brief, 'brief.md'); validateUtf8(evidence, 'evidence.md');
  if (brief.byteLength > BRIEF_MAX_BYTES) throw new Error('brief.md exceeds 8 MiB.');
  if (evidence.byteLength > EVIDENCE_MAX_BYTES) throw new Error('evidence.md exceeds 32 MiB.');
  if (brief.byteLength + evidence.byteLength > TOTAL_MAX_BYTES) throw new Error('Draft snapshot exceeds 40 MiB.');
}
function validateUtf8(value: Uint8Array, label: string): void {
  if (value.includes(0)) throw new Error(`${label} contains NUL.`);
  try { new TextDecoder('utf-8', { fatal: true }).decode(value); } catch { throw new Error(`${label} is not valid UTF-8.`); }
}
function encodeText(value: string, maxBytes: number, label: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  validateUtf8(bytes, label);
  if (new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== value) throw new Error(`${label} contains an invalid Unicode scalar sequence.`);
  if (bytes.byteLength > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes.`);
  return bytes;
}
function chooseFence(content: Uint8Array): string {
  const text = new TextDecoder().decode(content);
  const backticks = longestRun(text, '`'), tildes = longestRun(text, '~');
  const character = backticks <= tildes ? '`' : '~';
  return character.repeat(Math.max(3, Math.min(backticks, tildes) + 1));
}
function longestRun(value: string, character: string): number {
  let longest = 0, current = 0;
  for (const item of value) { current = item === character ? current + 1 : 0; longest = Math.max(longest, current); }
  return longest;
}
function sha256(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function bytesEqual(left: Uint8Array, right: Uint8Array): boolean { return Buffer.from(left).equals(Buffer.from(right)); }
function requireSafeId(value: string, label: string): void { if (!SAFE_ID.test(value)) throw new Error(`${label} is invalid.`); }
function isLegacyPath(value: string): boolean { return value.length > 0 && value.length <= 240 && /^[A-Za-z0-9._/-]+$/.test(value) && !value.startsWith('/') && !value.endsWith('/') && !value.includes('//') && value.split('/').every((part) => part !== '.' && part !== '..'); }
async function exists(target: string): Promise<boolean> { try { await lstat(target); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
async function writeNewFile(target: string, content: Uint8Array): Promise<void> { const handle = await open(target, 'wx'); try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); } }
async function renameDirectoryAtomically(source: string, target: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try { await rename(source, target); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code !== 'EPERM' && code !== 'EBUSY') || attempt >= 9 || await exists(target)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
}
function issue(code: string, constraint: string): ValidationIssueV1 { return Object.freeze({ schemaVersion: 1, stage: 'draft', severity: 'error', code, path: null, constraint }); }
function failed(code: string, constraint: string): DraftTechnicalCheckV2 { return Object.freeze({ ok: false, diagnostics: Object.freeze([issue(code, constraint)]) }); }
