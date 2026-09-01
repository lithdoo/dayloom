import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { assistantErrorV1 } from './errors.js';
import { commonDirectoryAncestorV1, isPathInsideV1 } from './paths.js';

export interface CanonicalDraftFileV1 { requested: string; canonical: string; exists: boolean }
export type DraftAuthorityV1 =
  | { mode: 'files'; files: readonly CanonicalDraftFileV1[]; mcpRoot: string }
  | { mode: 'directory'; root: string };
export interface ConversationAuthorityV1 { requested: string; canonical: string; exists: boolean }
export interface ResolvedAssistantAuthorityV1 {
  draft: DraftAuthorityV1; conversation: ConversationAuthorityV1; llmConfig: string; archiveRoot: string | null;
}

export async function resolveAssistantAuthorityV1(input: {
  cwd?: string; worldRoot: string | null; drafts: readonly string[]; draftDir: string | null;
  conversation: string; llmConfig: string;
}): Promise<Readonly<ResolvedAssistantAuthorityV1>> {
  const cwd = input.cwd ?? process.cwd();
  const draft = input.draftDir !== null
    ? await resolveDraftDirectoryV1(path.resolve(cwd, input.draftDir))
    : await resolveDraftFilesV1(input.drafts.map((file) => path.resolve(cwd, file)));
  const conversation = await resolveConversationV1(path.resolve(cwd, input.conversation));
  const llmConfig = await resolveLlmConfigFileV1(path.resolve(cwd, input.llmConfig));
  assertDraftInputsDisjointV1(draft, conversation, llmConfig);
  const archiveRoot = input.worldRoot === null ? null : await realpath(input.worldRoot);
  if (archiveRoot !== null) assertWorldDisjointV1(archiveRoot, draft, conversation);
  return Object.freeze({ draft, conversation, llmConfig, archiveRoot });
}

async function resolveDraftFilesV1(files: readonly string[]): Promise<DraftAuthorityV1> {
  if (files.length === 0) throw assistantErrorV1('INVALID_ARGUMENT', 'At least one --draft file is required.');
  const resolved: CanonicalDraftFileV1[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const entry = await resolveDraftFileV1(file);
    if (seen.has(entry.canonical)) throw assistantErrorV1('AUTHORITY_INVALID', `Duplicate Draft file after canonicalization: ${file}.`);
    seen.add(entry.canonical);
    resolved.push(entry);
  }
  let mcpRoot: string;
  try { mcpRoot = commonDirectoryAncestorV1(resolved.map((file) => path.dirname(file.canonical))); }
  catch { throw assistantErrorV1('AUTHORITY_INVALID', 'Draft files do not share a common directory ancestor.'); }
  if (await kindV1(mcpRoot) !== 'directory') throw assistantErrorV1('AUTHORITY_INVALID', 'Draft file parent directory is not a real directory.');
  return Object.freeze({ mode: 'files', files: Object.freeze(resolved.map((file) => Object.freeze(file))), mcpRoot: await realpath(mcpRoot) });
}

async function resolveDraftFileV1(target: string): Promise<CanonicalDraftFileV1> {
  const kind = await kindV1(target);
  if (kind === 'symlink' || kind === 'directory' || kind === 'other') throw assistantErrorV1('AUTHORITY_INVALID', `Draft file must be a regular file: ${target}.`);
  if (kind === 'file') return Object.freeze({ requested: target, canonical: await realpath(target), exists: true });
  const parent = path.dirname(target);
  if (await kindV1(parent) === 'missing') throw assistantErrorV1('AUTHORITY_INVALID', `Draft file parent directory does not exist: ${target}.`);
  let parentReal: string;
  try { parentReal = await realpath(parent); }
  catch { throw assistantErrorV1('AUTHORITY_INVALID', `Draft file parent directory cannot be canonicalized: ${target}.`); }
  if (await kindV1(parentReal) !== 'directory') throw assistantErrorV1('AUTHORITY_INVALID', `Draft file parent directory is not a directory: ${target}.`);
  return Object.freeze({ requested: target, canonical: path.join(parentReal, path.basename(target)), exists: false });
}

async function resolveDraftDirectoryV1(target: string): Promise<DraftAuthorityV1> {
  if (await kindV1(target) === 'missing') throw assistantErrorV1('AUTHORITY_INVALID', `Draft directory does not exist: ${target}.`);
  let real: string;
  try { real = await realpath(target); }
  catch { throw assistantErrorV1('AUTHORITY_INVALID', `Draft directory cannot be canonicalized: ${target}.`); }
  if (await kindV1(real) !== 'directory') throw assistantErrorV1('AUTHORITY_INVALID', `Draft directory must be a real directory: ${target}.`);
  return Object.freeze({ mode: 'directory', root: real });
}

async function resolveConversationV1(target: string): Promise<ConversationAuthorityV1> {
  const kind = await kindV1(target);
  if (kind === 'missing') {
    const parent = path.dirname(target);
    if (await kindV1(parent) === 'missing') throw assistantErrorV1('AUTHORITY_INVALID', `Conversation parent directory does not exist: ${target}.`);
    let parentReal: string;
    try { parentReal = await realpath(parent); }
    catch { throw assistantErrorV1('AUTHORITY_INVALID', `Conversation path cannot be canonicalized: ${target}.`); }
    return Object.freeze({ requested: target, canonical: path.join(parentReal, path.basename(target)), exists: false });
  }
  let real: string;
  try { real = await realpath(target); }
  catch { throw assistantErrorV1('AUTHORITY_INVALID', `Conversation path cannot be canonicalized: ${target}.`); }
  if (await kindV1(real) !== 'directory') throw assistantErrorV1('AUTHORITY_INVALID', `Conversation must be a directory: ${target}.`);
  return Object.freeze({ requested: target, canonical: real, exists: true });
}

async function resolveLlmConfigFileV1(target: string): Promise<string> {
  if (await kindV1(target) !== 'file') throw assistantErrorV1('LLM_CONFIG_INVALID', `LLM config must be a regular file: ${target}.`);
  return realpath(target);
}

function assertDraftInputsDisjointV1(draft: DraftAuthorityV1, conversation: ConversationAuthorityV1, llmConfig: string): void {
  const targets = draft.mode === 'files' ? draft.files.map((file) => file.canonical) : [draft.root];
  for (const target of targets) {
    if (overlapsV1(conversation.canonical, target)) throw assistantErrorV1('AUTHORITY_INVALID', 'Conversation and Draft authority overlap.');
    if (target === llmConfig || draft.mode === 'directory' && isPathInsideV1(draft.root, llmConfig)) throw assistantErrorV1('AUTHORITY_INVALID', 'Draft authority must not include the LLM config.');
  }
}
function assertWorldDisjointV1(world: string, draft: DraftAuthorityV1, conversation: ConversationAuthorityV1): void {
  const targets = draft.mode === 'files' ? draft.files.map((file) => file.canonical) : [draft.root];
  if (targets.some((target) => overlapsV1(world, target))) throw assistantErrorV1('AUTHORITY_INVALID', 'World and Draft authority overlap.');
  if (overlapsV1(world, conversation.canonical)) throw assistantErrorV1('AUTHORITY_INVALID', 'World and Conversation authority overlap.');
}
function overlapsV1(left: string, right: string): boolean { return isPathInsideV1(left, right) || isPathInsideV1(right, left); }
async function kindV1(target: string): Promise<'missing' | 'file' | 'directory' | 'symlink' | 'other'> {
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink()) return 'symlink';
    if (stat.isFile()) return 'file';
    if (stat.isDirectory()) return 'directory';
    return 'other';
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'; throw error; }
}
