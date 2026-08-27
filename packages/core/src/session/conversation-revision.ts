import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { exportVisibleTranscriptV1, type VisibleTranscriptV1 } from '../world/builders/audit';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export interface ConversationRevisionV1 { conversationId: string; root: string }

export async function materializeConversationRevisionV1(input: { sessionRoot: string; conversationId: string; source: string }): Promise<Readonly<ConversationRevisionV1>> {
  requireId(input.conversationId); await validateTree(input.source);
  const root = path.join(input.sessionRoot, 'conversations'), target = path.join(root, input.conversationId), prepared = path.join(root, `${input.conversationId}.prepared-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  if (await exists(target)) { await assertTreesEqual(input.source, target); return Object.freeze({ conversationId: input.conversationId, root: target }); }
  try { await cp(input.source, prepared, { recursive: true, errorOnExist: true }); await validateTree(prepared); await rename(prepared, target); }
  catch (error) { if (!(await exists(target))) throw error; await assertTreesEqual(input.source, target); }
  finally { await rm(prepared, { recursive: true, force: true }).catch(() => undefined); }
  return Object.freeze({ conversationId: input.conversationId, root: target });
}

export async function forkConversationAttemptV1(input: { baseRoot: string; attemptRoot: string }): Promise<void> {
  await validateTree(input.baseRoot); await rm(input.attemptRoot, { recursive: true, force: true }); await mkdir(path.dirname(input.attemptRoot), { recursive: true }); await cp(input.baseRoot, input.attemptRoot, { recursive: true }); await validateTree(input.attemptRoot);
}

export async function validateConversationPromotionV1(input: { baseRoot: string; attemptRoot: string; userText: string; finalText: string }): Promise<Readonly<VisibleTranscriptV1>> {
  const base = await exportVisibleTranscriptV1(input.baseRoot, ''), attempt = await exportVisibleTranscriptV1(input.attemptRoot, '');
  if (attempt.turns.length !== base.turns.length + 2) throw new Error('Conversation promotion must add exactly one user/assistant pair.');
  for (let index = 0; index < base.turns.length; index += 1) if (base.turns[index].role !== attempt.turns[index].role || base.turns[index].content !== attempt.turns[index].content) throw new Error('Conversation promotion changed accepted visible history.');
  const user = attempt.turns.at(-2), assistant = attempt.turns.at(-1);
  if (user?.role !== 'user' || user.content !== input.userText || assistant?.role !== 'assistant' || assistant.content !== input.finalText) throw new Error('Conversation promotion does not contain the exact accepted turn.');
  return attempt;
}

async function validateTree(root: string): Promise<void> { for (const entry of await readdir(root, { withFileTypes: true })) { const target = path.join(root, entry.name); if (entry.isSymbolicLink()) throw new Error('Conversation revision cannot contain symbolic links.'); if (entry.isDirectory()) await validateTree(target); else if (!entry.isFile() || !(await lstat(target)).isFile()) throw new Error('Conversation revision contains a non-regular entry.'); } }
async function tree(root: string, prefix = ''): Promise<Array<[string, Buffer]>> { const result: Array<[string, Buffer]> = []; for (const entry of await readdir(path.join(root, ...prefix.split('/').filter(Boolean)), { withFileTypes: true })) { const relative = prefix ? `${prefix}/${entry.name}` : entry.name; if (entry.isDirectory()) result.push(...await tree(root, relative)); else result.push([relative, await readFile(path.join(root, ...relative.split('/')))]); } return result.sort((a, b) => a[0].localeCompare(b[0], 'en')); }
async function assertTreesEqual(left: string, right: string): Promise<void> { const a = await tree(left), b = await tree(right); if (a.length !== b.length || a.some((item, index) => item[0] !== b[index][0] || !item[1].equals(b[index][1]))) throw new Error('Conversation revision collision.'); }
async function exists(target: string): Promise<boolean> { try { await lstat(target); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
function requireId(value: string): void { if (!ID.test(value)) throw new Error('Conversation ID is invalid.'); }
