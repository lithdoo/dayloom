import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { SESSION_FILE_LIMITS } from './file-limits';
import { sortDiagnosticsV1, type ValidationIssueV1 } from './diagnostics';
import type { CoreSessionKind } from '../state';
import { parseDomainPatchV1 } from '../world/domain-patch';

export type DraftDecisionV1 = 'confirmed' | 'proposed';
export interface DraftDocumentV1 extends Readonly<Record<string, unknown>> { readonly schemaVersion: 1; readonly kind: CoreSessionKind }
export type DraftLintResultV1 =
  | { readonly ok: true; readonly draft: DraftDocumentV1; readonly contentHashes: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly diagnostics: readonly ValidationIssueV1[] };

const stableKey = /^[a-z][a-z0-9-]{0,63}$/;
const topLevel: Record<CoreSessionKind, readonly string[]> = {
  init: ['schemaVersion', 'kind', 'title', 'canon', 'worldState', 'characters', 'locations', 'arcs', 'initialFacts', 'unresolvedThreads', 'storySeeds'],
  planning: ['schemaVersion', 'kind', 'targetDay', 'intent', 'knownContext', 'constraints', 'openQuestions', 'maxEvents', 'beats'],
  play: ['schemaVersion', 'kind', 'targetDay', 'events'],
  revise: ['schemaVersion', 'kind', 'operations'],
};

export async function lintDraftWorkspaceV1(root: string, expectedKind: CoreSessionKind): Promise<DraftLintResultV1> {
  const diagnostics: ValidationIssueV1[] = [], files: Array<{ relative: string; bytes: Uint8Array }> = [];
  try { await collect(root, root, files); }
  catch (error) { diagnostics.push(issue('DRAFT_FILESYSTEM_INVALID', null, message(error))); }
  if (files.length > SESSION_FILE_LIMITS.draftMaxFiles) diagnostics.push(issue('DRAFT_FILE_LIMIT', null, 'Draft exceeds the file-count limit.'));
  let total = 0;
  for (const file of files) {
    total += file.bytes.byteLength;
    if (file.bytes.byteLength > SESSION_FILE_LIMITS.draftMaxFileBytes) diagnostics.push(issue('DRAFT_FILE_BYTES', file.relative, 'Draft file exceeds the byte limit.'));
    try { new TextDecoder('utf-8', { fatal: true }).decode(file.bytes); } catch { diagnostics.push(issue('DRAFT_UTF8_INVALID', file.relative, 'Draft file must be valid UTF-8.')); }
  }
  if (total > SESSION_FILE_LIMITS.draftMaxTotalBytes) diagnostics.push(issue('DRAFT_TOTAL_BYTES', null, 'Draft exceeds the total-byte limit.'));
  const yamlFile = files.find((file) => file.relative === 'draft.yaml');
  if (!yamlFile) diagnostics.push(issue('DRAFT_MISSING', 'draft.yaml', 'Draft is missing draft.yaml.'));
  let draft: Record<string, unknown> | null = null;
  if (yamlFile) try {
    const document = YAML.parseDocument(new TextDecoder().decode(yamlFile.bytes), { uniqueKeys: true });
    if (document.errors.length > 0) throw document.errors[0];
    const value: unknown = document.toJS({ maxAliasCount: 0 });
    measure(value, 0);
    draft = record(value, 'draft.yaml');
    validateDraft(draft, expectedKind, diagnostics);
  } catch (error) { diagnostics.push(issue('DRAFT_YAML_INVALID', 'draft.yaml', message(error))); }
  const hashes: Record<string, string> = {};
  if (draft) {
    const refs = contentReferences(draft, expectedKind, diagnostics);
    for (const ref of refs) {
      const file = files.find((item) => item.relative === `content/${ref}`);
      if (!file) diagnostics.push(issue('DRAFT_CONTENT_MISSING', `content/${ref}`, 'Referenced Draft Markdown file is missing.'));
    }
    const crypto = await import('node:crypto');
    for (const file of files) hashes[file.relative] = crypto.createHash('sha256').update(file.bytes).digest('hex');
  }
  if (diagnostics.length > 0 || !draft) return Object.freeze({ ok: false, diagnostics: sortDiagnosticsV1(diagnostics) });
  return Object.freeze({ ok: true, draft: Object.freeze(draft) as DraftDocumentV1, contentHashes: Object.freeze(hashes) });
}

function validateDraft(value: Record<string, unknown>, kind: CoreSessionKind, diagnostics: ValidationIssueV1[]): void {
  exact(value, topLevel[kind], 'draft.yaml', diagnostics);
  if (value.schemaVersion !== 1) diagnostics.push(issue('DRAFT_VERSION', 'draft.yaml', 'schemaVersion must equal 1.'));
  if (value.kind !== kind) diagnostics.push(issue('DRAFT_KIND', 'draft.yaml', `kind must equal ${kind}.`));
  if (kind === 'init') validateInit(value, diagnostics);
  if (kind === 'planning') validatePlanning(value, diagnostics);
  if (kind === 'play') validatePlay(value, diagnostics);
  if (kind === 'revise') validateRevise(value, diagnostics);
}

function validateInit(value: Record<string, unknown>, diagnostics: ValidationIssueV1[]): void {
  const title = decisionValue(value.title, 'title', diagnostics); if (title && typeof title.value !== 'string') diagnostics.push(issue('DRAFT_VALUE_TYPE', 'draft.yaml', 'title.value must be a string.'));
  const canon = safeRecord(value.canon, 'canon', diagnostics);
  if (canon) { exact(canon, ['premise', 'rules', 'style', 'userRole'], 'canon', diagnostics); for (const key of ['premise', 'rules', 'style', 'userRole']) textRef(canon[key], `canon.${key}`, diagnostics); }
  const worldState = decisionValue(value.worldState, 'worldState', diagnostics), state = worldState ? safeRecord(worldState.value, 'worldState.value', diagnostics) : null;
  if (state) { exact(state, ['status', 'elapsed', 'variables'], 'worldState.value', diagnostics); if (typeof state.status !== 'string' || !(state.elapsed === null || typeof state.elapsed === 'string') || !plainScalarRecord(state.variables)) diagnostics.push(issue('DRAFT_VALUE_TYPE', 'draft.yaml', 'worldState.value has invalid field types.')); }
  const locations = keyed(value.locations, 'locations', diagnostics), characters = keyed(value.characters, 'characters', diagnostics), arcs = keyed(value.arcs, 'arcs', diagnostics);
  const locationKeys = new Set(locations), characterKeys = new Set(characters);
  for (const [index, item] of array(value.characters, 'characters', diagnostics).entries()) {
    const entity = safeRecord(item, `characters[${index}]`, diagnostics); if (!entity) continue; exact(entity, ['decision', 'key', 'profile', 'relationships', 'status', 'locationKey', 'tags'], `characters[${index}]`, diagnostics); decision(entity, `characters[${index}]`, diagnostics);
    if (typeof entity.profile !== 'string') diagnostics.push(issue('DRAFT_PROFILE_PATH', 'draft.yaml', `characters[${index}].profile must be a path.`));
    if (typeof entity.status !== 'string' || !(entity.locationKey === null || typeof entity.locationKey === 'string') || !stringList(entity.tags)) diagnostics.push(issue('DRAFT_VALUE_TYPE', 'draft.yaml', `characters[${index}] has invalid field types.`));
    if (entity.locationKey !== null && !locationKeys.has(String(entity.locationKey))) diagnostics.push(issue('DRAFT_REFERENCE', 'draft.yaml', `characters[${index}] references an unknown location key.`));
    for (const relation of array(entity.relationships, `characters[${index}].relationships`, diagnostics)) { const row = safeRecord(relation, 'relationship', diagnostics); if (row) { exact(row, ['characterKey', 'relation', 'status'], 'relationship', diagnostics); if (![row.characterKey, row.relation, row.status].every((item) => typeof item === 'string')) diagnostics.push(issue('DRAFT_VALUE_TYPE', 'draft.yaml', 'Relationship has invalid field types.')); if (!characterKeys.has(String(row.characterKey))) diagnostics.push(issue('DRAFT_REFERENCE', 'draft.yaml', 'Relationship references an unknown character key.')); } }
  }
  for (const [index, item] of array(value.locations, 'locations', diagnostics).entries()) { const entity = safeRecord(item, `locations[${index}]`, diagnostics); if (entity) { exact(entity, ['decision', 'key', 'profile', 'status', 'tags', 'triggers'], `locations[${index}]`, diagnostics); decision(entity, `locations[${index}]`, diagnostics); if (typeof entity.profile !== 'string') diagnostics.push(issue('DRAFT_PROFILE_PATH', 'draft.yaml', `locations[${index}].profile must be a path.`)); if (typeof entity.status !== 'string' || !stringList(entity.tags)) diagnostics.push(issue('DRAFT_VALUE_TYPE', 'draft.yaml', `locations[${index}] has invalid field types.`)); for (const trigger of array(entity.triggers, 'triggers', diagnostics)) { const row = safeRecord(trigger, 'trigger', diagnostics); if (row) { exact(row, ['condition', 'effect'], 'trigger', diagnostics); if (typeof row.condition !== 'string' || typeof row.effect !== 'string') diagnostics.push(issue('DRAFT_VALUE_TYPE', 'draft.yaml', 'Trigger has invalid field types.')); } } } }
  for (const [index, item] of array(value.arcs, 'arcs', diagnostics).entries()) { const entity = safeRecord(item, `arcs[${index}]`, diagnostics); if (entity) { exact(entity, ['decision', 'key', 'profile', 'status', 'stage'], `arcs[${index}]`, diagnostics); decision(entity, `arcs[${index}]`, diagnostics); if (typeof entity.profile !== 'string') diagnostics.push(issue('DRAFT_PROFILE_PATH', 'draft.yaml', `arcs[${index}].profile must be a path.`)); if (!['inactive', 'active'].includes(String(entity.status)) || typeof entity.stage !== 'string') diagnostics.push(issue('DRAFT_VALUE_TYPE', 'draft.yaml', `arcs[${index}] has invalid field types.`)); } }
  for (const key of ['initialFacts', 'unresolvedThreads', 'storySeeds']) for (const [index, item] of array(value[key], key, diagnostics).entries()) { const row = safeRecord(item, `${key}[${index}]`, diagnostics); if (row) { exact(row, ['decision', 'text'], `${key}[${index}]`, diagnostics); decision(row, `${key}[${index}]`, diagnostics); if (typeof row.text !== 'string') diagnostics.push(issue('DRAFT_VALUE_TYPE', 'draft.yaml', `${key}[${index}].text must be a string.`)); } }
}

function validatePlanning(value: Record<string, unknown>, diagnostics: ValidationIssueV1[]): void {
  if (!/^day[1-9][0-9]*$/.test(String(value.targetDay))) diagnostics.push(issue('DRAFT_DAY', 'draft.yaml', 'targetDay is invalid.'));
  for (const key of ['intent', 'knownContext', 'constraints', 'openQuestions', 'maxEvents']) { const row = decisionValue(value[key], key, diagnostics); if (!row) continue; const valid = key === 'intent' ? typeof row.value === 'string' : key === 'maxEvents' ? Number.isSafeInteger(row.value) && Number(row.value) > 0 : stringList(row.value); if (!valid) diagnostics.push(issue('DRAFT_VALUE_TYPE', 'draft.yaml', `${key}.value has an invalid type.`)); }
  const keys = new Set<string>();
  for (const [index, item] of array(value.beats, 'beats', diagnostics).entries()) {
    const beat = safeRecord(item, `beats[${index}]`, diagnostics); if (!beat) continue; exact(beat, ['decision', 'key', 'intent', 'priority', 'dependsOn'], `beats[${index}]`, diagnostics); decision(beat, `beats[${index}]`, diagnostics);
    if (typeof beat.intent !== 'string' || !['required', 'optional'].includes(String(beat.priority)) || !stringList(beat.dependsOn)) diagnostics.push(issue('DRAFT_VALUE_TYPE', 'draft.yaml', `beats[${index}] has invalid field types.`));
    const key = String(beat.key); if (!stableKey.test(key) || keys.has(key)) diagnostics.push(issue('DRAFT_STABLE_KEY', 'draft.yaml', `beats[${index}].key is invalid or duplicated.`));
    for (const dependency of array(beat.dependsOn, `beats[${index}].dependsOn`, diagnostics)) if (!keys.has(String(dependency))) diagnostics.push(issue('DRAFT_DEPENDENCY', 'draft.yaml', `beats[${index}] depends on a non-previous key.`));
    keys.add(key);
  }
}

function validatePlay(value: Record<string, unknown>, diagnostics: ValidationIssueV1[]): void {
  if (!/^day[1-9][0-9]*$/.test(String(value.targetDay))) diagnostics.push(issue('DRAFT_DAY', 'draft.yaml', 'targetDay is invalid.'));
  for (const [index, item] of array(value.events, 'events', diagnostics).entries()) {
    const event = safeRecord(item, `events[${index}]`, diagnostics); if (!event) continue; exact(event, ['decision', 'key', 'beatId', 'title', 'locationId', 'participantIds', 'scene', 'dialogue', 'userAction', 'result', 'proposedPatch'], `events[${index}]`, diagnostics); decision(event, `events[${index}]`, diagnostics);
    if (event.key !== `e${String(index + 1).padStart(3, '0')}`) diagnostics.push(issue('DRAFT_EVENT_ORDER', 'draft.yaml', `events[${index}].key is invalid.`));
    if (!(event.beatId === null || typeof event.beatId === 'string') || typeof event.title !== 'string' || !(event.locationId === null || typeof event.locationId === 'string') || !stringList(event.participantIds)) diagnostics.push(issue('DRAFT_VALUE_TYPE', 'draft.yaml', `events[${index}] has invalid field types.`));
    for (const key of ['scene', 'dialogue', 'userAction']) if (typeof event[key] !== 'string') diagnostics.push(issue('DRAFT_CONTENT_PATH', 'draft.yaml', `events[${index}].${key} must be a path.`));
    const result = safeRecord(event.result, `events[${index}].result`, diagnostics); if (result) { exact(result, ['summary', 'learnedFacts', 'timeAdvanced', 'completedBeatIds', 'skippedBeatIds', 'endDay'], `events[${index}].result`, diagnostics); if (typeof result.summary !== 'string' || !stringList(result.learnedFacts) || !(result.timeAdvanced === null || typeof result.timeAdvanced === 'string') || !stringList(result.completedBeatIds) || !stringList(result.skippedBeatIds) || typeof result.endDay !== 'boolean') diagnostics.push(issue('DRAFT_VALUE_TYPE', 'draft.yaml', `events[${index}].result has invalid field types.`)); }
    for (const patch of array(event.proposedPatch, `events[${index}].proposedPatch`, diagnostics)) try { parseDomainPatchV1(patch); } catch (error) { diagnostics.push(issue('DRAFT_PATCH', 'draft.yaml', message(error))); }
  }
}

function validateRevise(value: Record<string, unknown>, diagnostics: ValidationIssueV1[]): void {
  const allowed = new Set(['replace-canon', 'replace-character-profile', 'replace-location-profile', 'replace-arc-profile', 'create-character', 'create-location', 'create-arc', 'set-world-variable', 'set-character-status', 'move-character', 'set-location-status', 'set-arc-stage', 'add-story-seed', 'remove-story-seed']);
  for (const [index, item] of array(value.operations, 'operations', diagnostics).entries()) { const operation = safeRecord(item, `operations[${index}]`, diagnostics); if (!operation) continue; decision(operation, `operations[${index}]`, diagnostics); if (!allowed.has(String(operation.op))) diagnostics.push(issue('DRAFT_OPERATION', 'draft.yaml', `operations[${index}].op is invalid.`)); if (String(operation.op).startsWith('replace-') && (typeof operation.expected !== 'string' || typeof operation.value !== 'string')) diagnostics.push(issue('DRAFT_PRECONDITION', 'draft.yaml', `operations[${index}] requires expected/value paths.`)); validateReviseOperation(operation, index, diagnostics); }
}

function contentReferences(draft: Record<string, unknown>, kind: CoreSessionKind, diagnostics: ValidationIssueV1[]): string[] {
  const refs: string[] = [];
  const add = (raw: unknown) => { if (typeof raw !== 'string' || !/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+\.md$/.test(raw)) diagnostics.push(issue('DRAFT_CONTENT_PATH', 'draft.yaml', `Invalid content path: ${String(raw)}`)); else refs.push(raw); };
  if (kind === 'init') {
    const canon = safeRecord(draft.canon, 'canon', diagnostics); if (canon) for (const key of ['premise', 'rules', 'style', 'userRole']) { const ref = safeRecord(canon[key], `canon.${key}`, diagnostics); if (ref) add(ref.path); }
    for (const collection of ['characters', 'locations', 'arcs']) for (const item of array(draft[collection], collection, diagnostics)) { const entity = safeRecord(item, collection, diagnostics); if (entity) add(entity.profile); }
  }
  if (kind === 'play') for (const item of array(draft.events, 'events', diagnostics)) { const event = safeRecord(item, 'event', diagnostics); if (event) for (const key of ['scene', 'dialogue', 'userAction']) add(event[key]); }
  if (kind === 'revise') for (const item of array(draft.operations, 'operations', diagnostics)) { const operation = safeRecord(item, 'operation', diagnostics); if (!operation) continue; if (typeof operation.profile === 'string') add(operation.profile); if (String(operation.op).startsWith('replace-')) { add(operation.expected); add(operation.value); } }
  if (new Set(refs).size !== refs.length) diagnostics.push(issue('DRAFT_CONTENT_OWNERSHIP', 'draft.yaml', 'Each Markdown content path must have exactly one semantic owner.'));
  return refs;
}

async function collect(root: string, directory: string, output: Array<{ relative: string; bytes: Uint8Array }>): Promise<void> {
  const rootPath = path.resolve(root);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name), relative = path.relative(rootPath, target).split(path.sep).join('/');
    if (entry.isSymbolicLink()) throw new Error(`Draft contains a symbolic link: ${relative}`);
    if (entry.isDirectory()) { await collect(rootPath, target, output); continue; }
    const stat = await lstat(target); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Draft entry must be a regular file: ${relative}`);
    output.push({ relative, bytes: await readFile(target) });
  }
}

function record(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`); return value as Record<string, unknown>; }
function safeRecord(value: unknown, label: string, diagnostics: ValidationIssueV1[]): Record<string, unknown> | null { try { return record(value, label); } catch (error) { diagnostics.push(issue('DRAFT_SHAPE', 'draft.yaml', message(error))); return null; } }
function array(value: unknown, label: string, diagnostics: ValidationIssueV1[]): unknown[] { if (!Array.isArray(value)) { diagnostics.push(issue('DRAFT_SHAPE', 'draft.yaml', `${label} must be an array.`)); return []; } return value; }
function exact(value: Record<string, unknown>, keys: readonly string[], label: string, diagnostics: ValidationIssueV1[]): void { if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) diagnostics.push(issue('DRAFT_EXACT_KEYS', 'draft.yaml', `${label} has invalid keys.`)); }
function decision(value: Record<string, unknown>, label: string, diagnostics: ValidationIssueV1[]): void { if (!['confirmed', 'proposed'].includes(String(value.decision))) diagnostics.push(issue('DRAFT_DECISION', 'draft.yaml', `${label}.decision is invalid.`)); }
function decisionValue(value: unknown, label: string, diagnostics: ValidationIssueV1[]): Record<string, unknown> | null { const row = safeRecord(value, label, diagnostics); if (!row) return null; exact(row, ['decision', 'value'], label, diagnostics); decision(row, label, diagnostics); return row; }
function textRef(value: unknown, label: string, diagnostics: ValidationIssueV1[]): void { const row = safeRecord(value, label, diagnostics); if (!row) return; exact(row, ['decision', 'path'], label, diagnostics); decision(row, label, diagnostics); if (typeof row.path !== 'string') diagnostics.push(issue('DRAFT_CONTENT_PATH', 'draft.yaml', `${label}.path must be a string.`)); }
function keyed(value: unknown, label: string, diagnostics: ValidationIssueV1[]): string[] { const keys: string[] = []; for (const [index, item] of array(value, label, diagnostics).entries()) { const row = safeRecord(item, `${label}[${index}]`, diagnostics); if (!row) continue; const key = String(row.key); if (!stableKey.test(key) || keys.includes(key)) diagnostics.push(issue('DRAFT_STABLE_KEY', 'draft.yaml', `${label}[${index}].key is invalid or duplicated.`)); keys.push(key); } return keys; }
function issue(code: string, pathValue: string | null, constraint: string): ValidationIssueV1 { return Object.freeze({ schemaVersion: 1, stage: 'draft', severity: 'error', code, path: pathValue, constraint }); }
function message(error: unknown): string { return error instanceof Error ? error.message : 'Draft validation failed.'; }
function stringList(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string') && new Set(value).size === value.length; }
function plainScalarRecord(value: unknown): boolean { return !!value && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(([key, item]) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(key) && (item === null || ['string', 'number', 'boolean'].includes(typeof item)) && !(typeof item === 'number' && !Number.isFinite(item))); }
function measure(value: unknown, depth: number): number { if (depth > SESSION_FILE_LIMITS.yamlMaxDepth) throw new Error('Draft YAML exceeds the maximum depth.'); if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Draft YAML contains a non-finite number.'); if (!value || typeof value !== 'object') return 1; let count = 1; for (const item of Array.isArray(value) ? value : Object.values(value)) { count += measure(item, depth + 1); if (count > SESSION_FILE_LIMITS.collectionMaxItems) throw new Error('Draft YAML exceeds the collection-item limit.'); } return count; }
function validateReviseOperation(operation: Record<string, unknown>, index: number, diagnostics: ValidationIssueV1[]): void {
  const common = ['decision', 'op'], op = String(operation.op), byOp: Record<string, string[]> = {
    'replace-canon': ['field', 'expected', 'value'], 'replace-character-profile': ['characterId', 'expected', 'value'], 'replace-location-profile': ['locationId', 'expected', 'value'], 'replace-arc-profile': ['arcId', 'expected', 'value'],
    'create-character': ['key', 'profile', 'status', 'locationId', 'tags', 'relationships'], 'create-location': ['key', 'profile', 'status', 'tags', 'triggers'], 'create-arc': ['key', 'profile', 'status', 'stage'],
    'set-world-variable': ['key', 'expected', 'value'], 'set-character-status': ['characterId', 'expected', 'value'], 'move-character': ['characterId', 'expectedLocationId', 'locationId'], 'set-location-status': ['locationId', 'expected', 'value'], 'set-arc-stage': ['arcId', 'expected', 'value'], 'add-story-seed': ['text'], 'remove-story-seed': ['seedId', 'expectedText'],
  };
  if (byOp[op]) exact(operation, [...common, ...byOp[op]], `operations[${index}]`, diagnostics);
  const withoutDecision = { ...operation }; delete withoutDecision.decision;
  if (['set-world-variable', 'set-character-status', 'move-character', 'set-location-status', 'set-arc-stage'].includes(op)) try { parseDomainPatchV1(withoutDecision); } catch (error) { diagnostics.push(issue('DRAFT_OPERATION_SHAPE', 'draft.yaml', message(error))); }
  if (op === 'replace-canon' && !['premise', 'rules', 'style', 'userRole'].includes(String(operation.field))) diagnostics.push(issue('DRAFT_OPERATION_SHAPE', 'draft.yaml', `operations[${index}].field is invalid.`));
  if (op.startsWith('create-') && !stableKey.test(String(operation.key))) diagnostics.push(issue('DRAFT_STABLE_KEY', 'draft.yaml', `operations[${index}].key is invalid.`));
}
