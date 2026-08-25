import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { ValidatedToolCall } from './archive-retrieval-artifacts';

export interface WorkspacePolicyV1 {
  readonly serverId: 'draft' | 'candidate'; readonly root: string;
  readonly maxFiles: number; readonly maxFileBytes: number; readonly maxTotalBytes: number;
  readonly writeAllowed?: boolean;
  readonly writePrefix?: string;
}

export function assertWorkspaceCallPolicyV1(calls: readonly ValidatedToolCall[], policies: readonly WorkspacePolicyV1[]): void {
  const byId = new Map(policies.map((policy) => [policy.serverId, policy]));
  const reads = new Set<string>(), sizes = new Map<string, Map<string, number>>();
  for (const policy of policies) sizes.set(policy.serverId, workspaceSizes(policy));
  for (const call of calls) {
    const match = /^mcp__(draft|candidate)__(write_file|list_directory|directory_tree|read_file_lines)$/.exec(call.name);
    if (!match) continue;
    const policy = byId.get(match[1] as 'draft' | 'candidate');
    if (!policy) throw new Error(`Tool ${call.name} has no workspace policy.`);
    const args = callArguments(call), rawPath = args.path;
    if (typeof rawPath !== 'string') throw new Error(`${call.name} requires a string path.`);
    if ((match[2] === 'list_directory' || match[2] === 'directory_tree') && rawPath === '.') continue;
    const relative = normalizeRelative(rawPath);
    if (policy.serverId === 'draft' && relative !== 'draft.yaml' && !/^content\/[A-Za-z0-9._/-]+\.md$/.test(relative)) throw new Error(`Draft tool path is not writable/readable: ${relative}`);
    if (policy.serverId === 'candidate' && !/^[A-Za-z0-9._/-]+\.(?:md|json|yaml)$/.test(relative)) throw new Error(`Candidate tool path is invalid: ${relative}`);
    const identity = `${policy.serverId}:${relative}`;
    if (match[2] === 'read_file_lines') reads.add(identity);
    if (match[2] === 'write_file') {
      if (policy.writeAllowed === false) throw new Error(`${call.name} is read-only in this phase.`);
      if (policy.writePrefix !== undefined && !relative.startsWith(policy.writePrefix)) throw new Error(`${call.name} cannot write Core-owned paths.`);
      if (typeof args.content !== 'string') throw new Error(`${call.name} requires string content.`);
      if (Buffer.byteLength(args.content, 'utf8') > policy.maxFileBytes) throw new Error(`${call.name} content exceeds the byte limit.`);
      const workspace = sizes.get(policy.serverId)!, existing = workspace.has(relative);
      if (existing && !reads.delete(identity)) throw new Error(`${call.name} must read an existing file before writing it.`);
      workspace.set(relative, Buffer.byteLength(args.content, 'utf8'));
      const total = [...workspace.values()].reduce((sum, bytes) => sum + bytes, 0);
      if (workspace.size > policy.maxFiles || total > policy.maxTotalBytes) throw new Error(`${call.name} would exceed workspace resource limits.`);
    }
  }
}

function workspaceSizes(policy: WorkspacePolicyV1): Map<string, number> {
  const result = new Map<string, number>(), root = realpathSync(policy.root);
  const visit = (directory: string) => { for (const entry of readdirSync(directory, { withFileTypes: true })) { const target = path.join(directory, entry.name), relative = path.relative(root, target).split(path.sep).join('/'); if (entry.isDirectory()) visit(target); else { const stat = lstatSync(target); if (stat.isFile() && !stat.isSymbolicLink()) result.set(relative, stat.size); } } };
  visit(root); return result;
}

export function assertWorkspaceTreeV1(policy: WorkspacePolicyV1): void {
  const root = realpathSync(policy.root); if (!lstatSync(root).isDirectory()) throw new Error('Workspace root must be a directory.');
  let files = 0, total = 0;
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name), relative = path.relative(root, target);
      if (entry.isSymbolicLink() || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Workspace contains an unsafe entry.');
      if (entry.isDirectory()) { visit(target); continue; }
      const stat = lstatSync(target); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Workspace contains a non-regular file.');
      files += 1; total += stat.size;
      if (stat.size > policy.maxFileBytes) throw new Error('Workspace file exceeds the byte limit.');
      new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(target));
    }
  };
  visit(root);
  if (files > policy.maxFiles || total > policy.maxTotalBytes) throw new Error('Workspace exceeds its resource limits.');
}

function callArguments(call: ValidatedToolCall): Record<string, unknown> {
  const fn = call.raw.function;
  if (!fn || typeof fn !== 'object' || Array.isArray(fn) || typeof (fn as Record<string, unknown>).arguments !== 'string') throw new Error('ToolCall arguments are malformed.');
  const value: unknown = JSON.parse((fn as Record<string, string>).arguments);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ToolCall arguments must be an object.');
  return value as Record<string, unknown>;
}
function normalizeRelative(raw: string): string {
  const value = raw.replaceAll('\\', '/');
  if (value === '' || value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.split('/').some((part) => part === '' || part === '.' || part === '..')) throw new Error('Workspace path must be a normalized relative path.');
  return value;
}
