import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { draftErrorV1 } from './errors.js';
import { canonicalizeExistingPrefixV1, commonDirectoryAncestorV1, isPathInsideV1 } from './paths.js';

export interface CanonicalDraftFileV1 {
  requested: string;
  canonical: string;
  exists: boolean;
}

export type DraftAuthorityV1 =
  | { mode: 'files'; files: readonly CanonicalDraftFileV1[]; mcpRoot: string }
  | { mode: 'directory'; root: string };

export interface WorldAuthorityV1 {
  requested: string;
  canonical: string;
  kind: 'missing' | 'directory';
}

export interface ConversationAuthorityV1 {
  requested: string;
  canonical: string;
  exists: boolean;
}

export interface ResolvedAuthorityV1 {
  world: WorldAuthorityV1;
  draft: DraftAuthorityV1;
  conversation: ConversationAuthorityV1;
  llmConfig: string;
}

export async function resolveAuthorityV1(input: {
  cwd?: string;
  world: string;
  drafts: readonly string[];
  draftDir: string | null;
  conversation: string;
  llmConfig: string;
}): Promise<Readonly<ResolvedAuthorityV1>> {
  const cwd = input.cwd ?? process.cwd();
  const world = await resolveWorldV1(path.resolve(cwd, input.world));
  const draft = input.draftDir !== null
    ? await resolveDraftDirectoryV1(path.resolve(cwd, input.draftDir))
    : await resolveDraftFilesV1(input.drafts.map((file) => path.resolve(cwd, file)));
  const conversation = await resolveConversationV1(path.resolve(cwd, input.conversation));
  const llmConfig = await resolveLlmConfigFileV1(path.resolve(cwd, input.llmConfig));

  assertDisjointV1(world, draft, conversation);

  return Object.freeze({ world, draft, conversation, llmConfig });
}

async function resolveWorldV1(target: string): Promise<WorldAuthorityV1> {
  const kind = await kindV1(target);
  if (kind === 'missing') {
    return Object.freeze({ requested: target, canonical: path.resolve(target), kind: 'missing' });
  }
  if (kind === 'symlink') {
    let real: string;
    try { real = await realpath(target); }
    catch { throw draftErrorV1('AUTHORITY_INVALID', `World path cannot be canonicalized: ${target}.`); }
    const realKind = await kindV1(real);
    if (realKind !== 'directory') throw draftErrorV1('WORLD_INVALID', 'World root is not a directory.');
    return Object.freeze({ requested: target, canonical: real, kind: 'directory' });
  }
  if (kind !== 'directory') throw draftErrorV1('WORLD_INVALID', 'World root is not a directory.');
  return Object.freeze({ requested: target, canonical: await realpath(target), kind: 'directory' });
}

async function resolveDraftFilesV1(files: readonly string[]): Promise<DraftAuthorityV1> {
  if (files.length === 0) throw draftErrorV1('INVALID_ARGUMENT', 'At least one --draft file is required.');
  const resolved: CanonicalDraftFileV1[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const entry = await resolveDraftFileV1(file);
    if (seen.has(entry.canonical)) {
      throw draftErrorV1('AUTHORITY_INVALID', `Duplicate Draft file after canonicalization: ${file}.`);
    }
    seen.add(entry.canonical);
    resolved.push(entry);
  }
  let mcpRoot: string;
  try {
    mcpRoot = commonDirectoryAncestorV1(resolved.map((file) => path.dirname(file.canonical)));
  } catch {
    throw draftErrorV1('AUTHORITY_INVALID', 'Draft files do not share a common directory ancestor.');
  }
  const mcpKind = await kindV1(mcpRoot);
  if (mcpKind !== 'directory') throw draftErrorV1('AUTHORITY_INVALID', 'Draft file parent directory is not a real directory.');
  return Object.freeze({
    mode: 'files',
    files: Object.freeze(resolved.map((file) => Object.freeze(file))),
    mcpRoot: await realpath(mcpRoot),
  });
}

async function resolveDraftFileV1(target: string): Promise<CanonicalDraftFileV1> {
  const kind = await kindV1(target);
  if (kind === 'symlink') throw draftErrorV1('AUTHORITY_INVALID', `Draft file must be a regular file: ${target}.`);
  if (kind === 'directory' || kind === 'other') {
    throw draftErrorV1('AUTHORITY_INVALID', `Draft file must be a regular file: ${target}.`);
  }
  if (kind === 'file') {
    const real = await realpath(target);
    const after = await kindV1(real);
    if (after !== 'file') throw draftErrorV1('AUTHORITY_INVALID', `Draft file must be a regular file: ${target}.`);
    return Object.freeze({ requested: target, canonical: real, exists: true });
  }

  const parent = path.dirname(target);
  const base = path.basename(target);
  if (base === '' || base === '.' || base === '..') {
    throw draftErrorV1('AUTHORITY_INVALID', `Draft file path is invalid: ${target}.`);
  }
  const parentKind = await kindV1(parent);
  if (parentKind === 'missing') {
    throw draftErrorV1('AUTHORITY_INVALID', `Draft file parent directory does not exist: ${target}.`);
  }
  let parentReal: string;
  try { parentReal = await realpath(parent); }
  catch { throw draftErrorV1('AUTHORITY_INVALID', `Draft file parent directory cannot be canonicalized: ${target}.`); }
  const parentRealKind = await kindV1(parentReal);
  if (parentRealKind !== 'directory') {
    throw draftErrorV1('AUTHORITY_INVALID', `Draft file parent directory is not a directory: ${target}.`);
  }
  return Object.freeze({
    requested: target,
    canonical: path.join(parentReal, base),
    exists: false,
  });
}

async function resolveDraftDirectoryV1(target: string): Promise<DraftAuthorityV1> {
  const kind = await kindV1(target);
  if (kind === 'missing') throw draftErrorV1('AUTHORITY_INVALID', `Draft directory does not exist: ${target}.`);
  let real: string;
  try { real = await realpath(target); }
  catch { throw draftErrorV1('AUTHORITY_INVALID', `Draft directory cannot be canonicalized: ${target}.`); }
  const realKind = await kindV1(real);
  if (realKind !== 'directory') throw draftErrorV1('AUTHORITY_INVALID', `Draft directory must be a real directory: ${target}.`);
  return Object.freeze({ mode: 'directory', root: real });
}

async function resolveConversationV1(target: string): Promise<ConversationAuthorityV1> {
  const kind = await kindV1(target);
  if (kind === 'missing') {
    const parent = path.dirname(target);
    const parentKind = await kindV1(parent);
    if (parentKind === 'missing') {
      throw draftErrorV1('AUTHORITY_INVALID', `Conversation parent directory does not exist: ${target}.`);
    }
    let parentReal: string;
    try { parentReal = await realpath(parent); }
    catch { throw draftErrorV1('AUTHORITY_INVALID', `Conversation path cannot be canonicalized: ${target}.`); }
    return Object.freeze({
      requested: target,
      canonical: path.join(parentReal, path.basename(target)),
      exists: false,
    });
  }
  if (kind === 'symlink') {
    let real: string;
    try { real = await realpath(target); }
    catch { throw draftErrorV1('AUTHORITY_INVALID', `Conversation path cannot be canonicalized: ${target}.`); }
    if ((await kindV1(real)) !== 'directory') {
      throw draftErrorV1('AUTHORITY_INVALID', `Conversation must be a directory: ${target}.`);
    }
    return Object.freeze({ requested: target, canonical: real, exists: true });
  }
  if (kind !== 'directory') throw draftErrorV1('AUTHORITY_INVALID', `Conversation must be a directory: ${target}.`);
  return Object.freeze({ requested: target, canonical: await realpath(target), exists: true });
}

async function resolveLlmConfigFileV1(target: string): Promise<string> {
  const kind = await kindV1(target);
  if (kind === 'missing') throw draftErrorV1('LLM_CONFIG_INVALID', `LLM config does not exist: ${target}.`);
  if (kind === 'symlink' || kind !== 'file') {
    throw draftErrorV1('LLM_CONFIG_INVALID', `LLM config must be a regular file: ${target}.`);
  }
  return realpath(target);
}

function assertDisjointV1(
  world: WorldAuthorityV1,
  draft: DraftAuthorityV1,
  conversation: ConversationAuthorityV1,
): void {
  const worldRoot = world.canonical;
  if (draft.mode === 'files') {
    for (const file of draft.files) {
      if (overlapsV1(worldRoot, file.canonical)) {
        throw draftErrorV1('AUTHORITY_INVALID', 'World and Draft authority overlap.');
      }
      if (overlapsV1(conversation.canonical, file.canonical)) {
        throw draftErrorV1('AUTHORITY_INVALID', 'Conversation and Draft authority overlap.');
      }
    }
  } else {
    if (overlapsV1(worldRoot, draft.root)) {
      throw draftErrorV1('AUTHORITY_INVALID', 'World and Draft authority overlap.');
    }
    if (overlapsV1(conversation.canonical, draft.root)) {
      throw draftErrorV1('AUTHORITY_INVALID', 'Conversation and Draft authority overlap.');
    }
  }
  if (overlapsV1(worldRoot, conversation.canonical)) {
    throw draftErrorV1('AUTHORITY_INVALID', 'World and Conversation authority overlap.');
  }
}

function overlapsV1(left: string, right: string): boolean {
  return isPathInsideV1(left, right) || isPathInsideV1(right, left);
}

async function kindV1(target: string): Promise<'missing' | 'file' | 'directory' | 'symlink' | 'other'> {
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink()) return 'symlink';
    if (stat.isFile()) return 'file';
    if (stat.isDirectory()) return 'directory';
    return 'other';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
}

export function assertCanonicalStillInsideV1(root: string, candidate: string): string {
  const canonical = canonicalizeExistingPrefixV1(candidate);
  if (!isPathInsideV1(root, canonical) && canonical !== root) {
    throw draftErrorV1('AUTHORITY_INVALID', 'Canonical path escaped its authority root.');
  }
  return canonical;
}
