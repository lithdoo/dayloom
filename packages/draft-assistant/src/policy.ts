import { lstatSync } from 'node:fs';
import type { ValidatedToolCallV1 } from './artifacts.js';
import { canonicalizeExistingPrefixV1, isPathInsideV1, resolveRelativeInsideV1 } from './paths.js';

export type DraftHookAuthorityV1 = { mode: 'files'; mcpRoot: string; files: readonly string[] } | { mode: 'directory'; mcpRoot: string; root: string };
export interface FileHookPolicyV1 { worldRoot: string | null; draft: DraftHookAuthorityV1 | null }

export function assertAuthorityPolicyV1(calls: readonly ValidatedToolCallV1[], policy: FileHookPolicyV1): void {
  for (const call of calls) {
    if (call.name.startsWith('mcp__world__')) {
      if (/write|create|delete/.test(call.name)) throw new Error('World is read-only.');
      assertPathV1(call, policy.worldRoot, null);
    } else if (call.name.startsWith('mcp__draft__')) {
      if (policy.draft === null) throw new Error('Draft tools are not available.');
      assertDraftV1(call, policy.draft);
    }
  }
}
function assertPathV1(call: ValidatedToolCallV1, root: string | null, required: string | null): void {
  if (root === null) throw new Error('File tools are not available.');
  const requested = pathArgumentV1(call);
  if (requested === null) { if (required !== null) throw new Error(`${call.name} requires a path.`); return; }
  const canonical = canonicalizeExistingPrefixV1(resolveRelativeInsideV1(root, requested));
  if (!isPathInsideV1(root, canonical) && canonical !== root) throw new Error('Path is outside its authority root.');
}
function assertDraftV1(call: ValidatedToolCallV1, draft: DraftHookAuthorityV1): void {
  const kind = call.name.slice('mcp__draft__'.length);
  const requested = pathArgumentV1(call);
  if (requested === null) {
    if (draft.mode === 'directory' && ['search_files', 'search_files_content', 'list_directory', 'directory_tree'].includes(kind)) return;
    throw new Error(`${call.name} requires a path.`);
  }
  const canonical = canonicalizeExistingPrefixV1(resolveRelativeInsideV1(draft.mcpRoot, requested));
  if (draft.mode === 'files') {
    if (!['read_file_lines', 'write_file'].includes(kind) || !draft.files.includes(canonical)) throw new Error('Draft file-set authority denied the call.');
  } else if ((!isPathInsideV1(draft.root, canonical) && canonical !== draft.root) || canonical === draft.root && ['write_file', 'delete_file'].includes(kind)) {
    throw new Error('Draft path is outside the Draft directory.');
  }
  if (kind === 'write_file') assertRegularOrMissingV1(canonical);
  if (kind === 'delete_file') {
    const stat = lstatSync(canonical);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('delete_file only accepts a regular file.');
  }
}
function pathArgumentV1(call: ValidatedToolCallV1): string | null {
  const value: unknown = JSON.parse(call.arguments);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ToolCall arguments must be an object.');
  const requested = (value as { path?: unknown }).path;
  if (requested === undefined) return null;
  if (typeof requested !== 'string') throw new Error('ToolCall path must be a string.');
  return requested;
}
function assertRegularOrMissingV1(target: string): void {
  try { const stat = lstatSync(target); if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Draft mutation must target a regular file.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
