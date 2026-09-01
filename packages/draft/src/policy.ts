import { lstatSync } from 'node:fs';
import path from 'node:path';
import type { ValidatedToolCallV1 } from './artifacts.js';
import { canonicalizeExistingPrefixV1, isPathInsideV1, resolveRelativeInsideV1 } from './paths.js';

export type DraftHookAuthorityV1 =
  | { mode: 'files'; mcpRoot: string; files: readonly string[] }
  | { mode: 'directory'; mcpRoot: string; root: string };

export interface DraftHookPolicyV1 {
  worldRoot: string | null;
  draft: DraftHookAuthorityV1 | null;
}

const WORLD_WRITE = new Set([
  'mcp__world__write_file',
  'mcp__world__create_directory',
  'mcp__world__delete_file',
]);

export function assertAuthorityPolicyV1(calls: readonly ValidatedToolCallV1[], policy: DraftHookPolicyV1): void {
  for (const call of calls) {
    if (WORLD_WRITE.has(call.name) || call.name.startsWith('mcp__world__') && /write|create|delete/.test(call.name)) {
      throw new Error('World is read-only.');
    }
    if (call.name.startsWith('mcp__world__')) {
      assertWorldReadV1(call, policy.worldRoot);
      continue;
    }
    if (call.name.startsWith('mcp__draft__')) {
      if (policy.draft === null) throw new Error('Draft tools are not available.');
      assertDraftCallV1(call, policy.draft);
      continue;
    }
  }
}

function assertWorldReadV1(call: ValidatedToolCallV1, worldRoot: string | null): void {
  if (worldRoot === null) throw new Error('World tools are not available.');
  const requested = pathArgumentV1(call);
  if (requested === null) return;
  const absolute = resolveRelativeInsideV1(worldRoot, requested);
  const canonical = canonicalizeExistingPrefixV1(absolute);
  if (!isPathInsideV1(worldRoot, canonical) && canonical !== worldRoot) {
    throw new Error('World path is outside the World root.');
  }
}

function assertDraftCallV1(call: ValidatedToolCallV1, draft: DraftHookAuthorityV1): void {
  const kind = call.name.slice('mcp__draft__'.length);
  const requested = pathArgumentV1(call);
  if (requested === null) {
    if (
      draft.mode === 'directory' &&
      (kind === 'search_files' || kind === 'search_files_content' || kind === 'list_directory' || kind === 'directory_tree')
    ) return;
    throw new Error(`${call.name} requires a path.`);
  }
  const absolute = resolveRelativeInsideV1(draft.mcpRoot, requested);
  const canonical = canonicalizeExistingPrefixV1(absolute);

  if (draft.mode === 'files') {
    if (kind !== 'read_file_lines' && kind !== 'write_file') {
      throw new Error(`${call.name} is not granted for a Draft file set.`);
    }
    if (!draft.files.includes(canonical)) {
      throw new Error(`Draft file-set does not include ${canonical}.`);
    }
    if (kind === 'write_file') assertRegularOrMissingFileV1(canonical);
    return;
  }

  if (!isPathInsideV1(draft.root, canonical) || canonical === draft.root) {
    if (kind === 'list_directory' || kind === 'directory_tree' || kind === 'search_files' || kind === 'search_files_content') {
      if (canonical !== draft.root) throw new Error('Draft path is outside the Draft directory.');
      return;
    }
    throw new Error('Draft path is outside the Draft directory.');
  }
  if (kind === 'write_file') assertRegularOrMissingFileV1(canonical);
  if (kind === 'delete_file') assertExistingRegularFileV1(canonical);
}

function pathArgumentV1(call: ValidatedToolCallV1): string | null {
  const value: unknown = JSON.parse(call.arguments);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ToolCall arguments must be an object.');
  const requested = (value as { path?: unknown }).path;
  if (requested === undefined) return null;
  if (typeof requested !== 'string') throw new Error('ToolCall path must be a string.');
  return requested;
}

function assertRegularOrMissingFileV1(canonical: string): void {
  try {
    const stat = lstatSync(canonical);
    if (stat.isSymbolicLink()) throw new Error('Draft mutation cannot follow a symbolic link.');
    if (stat.isDirectory()) throw new Error('Draft file mutation cannot target a directory.');
    if (!stat.isFile()) throw new Error('Draft mutation must target a regular file.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}

function assertExistingRegularFileV1(canonical: string): void {
  const stat = lstatSync(canonical);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('delete_file only accepts a regular file.');
}
