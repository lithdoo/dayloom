import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { ValidationIssueV1 } from './diagnostics';
import { parseTurnVerdictV1, type TurnVerdictV1 } from './control-protocol';

export type OperationDispositionV1 = 'committed' | 'superseded' | 'discarded' | 'failed' | 'cancelled';
export type { TurnVerdictV1 } from './control-protocol';
export interface TurnAuditV1 {
  schemaVersion: 1; turnId: string; sessionId: string; userInput: string; baseConversationId: string; baseDraftHash: string;
  generationAttempts: Array<{ generationId: string; operationId: string; attempt: 1 | 2; responseText: string; complete: boolean; disposition: OperationDispositionV1; verdict: TurnVerdictV1 | null }>;
  acceptedGenerationId: string | null; draftVerdict: 'KEEP' | 'UPDATE' | null; resultDraftHash: string | null;
  curationAttempts: Array<{ operationId: string; attempt: 1 | 2; disposition: OperationDispositionV1; baseDraftHash: string; resultDraftHash: string | null; diagnostics: ValidationIssueV1[] }>;
  terminalStatus: 'committed' | 'draft-sync-pending' | 'policy-rejected' | 'abandoned-after-accept' | 'cancelled' | 'failed' | null;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const HASH = /^[0-9a-f]{64}$/;
const DISPOSITIONS = new Set<OperationDispositionV1>(['committed','superseded','discarded','failed','cancelled']);
const TERMINALS = new Set<NonNullable<TurnAuditV1['terminalStatus']>>(['committed','draft-sync-pending','policy-rejected','abandoned-after-accept','cancelled','failed']);

export async function writeTurnRecordV1(target: string, value: Readonly<TurnAuditV1>): Promise<void> {
  validateTurnRecord(value);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  if (bytes.byteLength > 3 * 1024 * 1024) throw new Error('Turn record exceeds 3 MiB.');
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${randomUUID()}`, handle = await open(temporary, 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temporary, target); } finally { await rm(temporary, { force: true }).catch(() => undefined); }
}

export async function readTurnRecordV1(target: string): Promise<Readonly<TurnAuditV1>> {
  const bytes = await readFile(target);
  if (bytes.byteLength > 3 * 1024 * 1024) throw new Error('Turn record exceeds 3 MiB.');
  const value = JSON.parse(bytes.toString('utf8')) as TurnAuditV1;
  validateTurnRecord(value);
  return Object.freeze(value);
}

function validateTurnRecord(value: unknown): asserts value is TurnAuditV1 {
  const root = exact(value, ['schemaVersion','turnId','sessionId','userInput','baseConversationId','baseDraftHash','generationAttempts','acceptedGenerationId','draftVerdict','resultDraftHash','curationAttempts','terminalStatus'], 'Turn record');
  if (root.schemaVersion !== 1) invalid('schemaVersion');
  for (const key of ['turnId','sessionId','baseConversationId']) if (typeof root[key] !== 'string' || !ID.test(root[key] as string)) invalid(key);
  if (typeof root.userInput !== 'string' || Buffer.byteLength(root.userInput) > 1024 * 1024) invalid('userInput');
  hash(root.baseDraftHash, 'baseDraftHash');
  if (!Array.isArray(root.generationAttempts) || root.generationAttempts.length > 2) invalid('generationAttempts');
  const generationIds = new Set<string>();
  for (const raw of root.generationAttempts) {
    const item = exact(raw, ['generationId','operationId','attempt','responseText','complete','disposition','verdict'], 'generation attempt');
    if (typeof item.generationId !== 'string' || !ID.test(item.generationId) || generationIds.has(item.generationId)) invalid('generationId');
    generationIds.add(item.generationId); id(item.operationId, 'operationId');
    if (item.attempt !== 1 && item.attempt !== 2) invalid('generation attempt');
    if (typeof item.responseText !== 'string' || Buffer.byteLength(item.responseText) > 1024 * 1024 || item.complete !== true || !DISPOSITIONS.has(item.disposition as OperationDispositionV1)) invalid('generation attempt');
    verdict(item.verdict);
  }
  nullableId(root.acceptedGenerationId, 'acceptedGenerationId');
  if (root.acceptedGenerationId !== null && !generationIds.has(root.acceptedGenerationId as string)) invalid('acceptedGenerationId');
  if (root.draftVerdict !== null && root.draftVerdict !== 'KEEP' && root.draftVerdict !== 'UPDATE') invalid('draftVerdict');
  nullableHash(root.resultDraftHash, 'resultDraftHash');
  if (!Array.isArray(root.curationAttempts) || root.curationAttempts.length > 64) invalid('curationAttempts');
  for (const raw of root.curationAttempts) {
    const item = exact(raw, ['operationId','attempt','disposition','baseDraftHash','resultDraftHash','diagnostics'], 'curation attempt');
    id(item.operationId, 'operationId'); if (item.attempt !== 1 && item.attempt !== 2) invalid('curation attempt');
    if (!DISPOSITIONS.has(item.disposition as OperationDispositionV1)) invalid('curation disposition');
    hash(item.baseDraftHash, 'curation baseDraftHash'); nullableHash(item.resultDraftHash, 'curation resultDraftHash');
    if (!Array.isArray(item.diagnostics) || item.diagnostics.length > 1024) invalid('curation diagnostics');
  }
  if (root.terminalStatus !== null && !TERMINALS.has(root.terminalStatus as NonNullable<TurnAuditV1['terminalStatus']>)) invalid('terminalStatus');
  if (root.terminalStatus === 'draft-sync-pending' && (root.acceptedGenerationId === null || root.draftVerdict !== 'UPDATE' || root.resultDraftHash !== null)) invalid('pending invariant');
  if (root.terminalStatus === 'committed' && root.draftVerdict === 'UPDATE' && root.resultDraftHash === null) invalid('committed invariant');
}

function verdict(value: unknown): void {
  if (value === null) return; try { parseTurnVerdictV1(value); } catch { invalid('verdict'); }
}
function exact(value: unknown, keys: readonly string[], label: string): Record<string, any> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is invalid.`); const item=value as Record<string,any>,actual=Object.keys(item).sort(),expected=[...keys].sort();if(actual.length!==expected.length||actual.some((key,index)=>key!==expected[index]))throw new Error(`${label} has unknown or missing fields.`);return item; }
function id(value: unknown, label: string): void { if (typeof value !== 'string' || !ID.test(value)) invalid(label); }
function nullableId(value: unknown, label: string): void { if (value !== null) id(value, label); }
function hash(value: unknown, label: string): void { if (typeof value !== 'string' || !HASH.test(value)) invalid(label); }
function nullableHash(value: unknown, label: string): void { if (value !== null) hash(value, label); }
function invalid(label: string): never { throw new Error(`Turn record ${label} is invalid.`); }
