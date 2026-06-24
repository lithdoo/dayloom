import fs from 'fs';
import os from 'os';
import path from 'path';
import { OPENING_ASSISTANT } from './constants';
import { loadRevisePrompt } from './prompts';
import type { ReviseDraft, ReviseSession } from './types';

const MESSAGE_PATTERN = /^\[(\d+)\](.+)\.(md|json)$/i;

function promptpileToml(): string {
  return `[[llm_api]]
name = "deepseek"
model = "deepseek-chat"
base_url = "https://api.deepseek.com/v1"
api_key_env = "DEEPSEEK_API_KEY"

[promptpile]
llm_api = "deepseek"
dir = "./messages"
tools_file = "./readonly.tools.toml"
quiet = true
`;
}

export function createReviseSession(): ReviseSession {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'day-loom-revise-'));
  const messagesDir = path.join(root, 'messages');
  const toolsFile = path.join(root, 'readonly.tools.toml');
  const promptpileConfig = path.join(root, 'promptpile.toml');
  const draftFile = path.join(root, 'draft.json');
  fs.mkdirSync(messagesDir, { recursive: true });
  fs.writeFileSync(promptpileConfig, promptpileToml(), 'utf8');
  fs.writeFileSync(path.join(messagesDir, '[0]system.md'), loadRevisePrompt('revise-dialogue'), 'utf8');
  fs.writeFileSync(path.join(messagesDir, '[1]assistant.md'), OPENING_ASSISTANT, 'utf8');
  writeDraft({ root, messagesDir, toolsFile, promptpileConfig, draftFile }, { pending_changes: [] });
  return { root, messagesDir, toolsFile, promptpileConfig, draftFile };
}

export function createFinalizeSession(transcript: string, draft: ReviseDraft): ReviseSession {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'day-loom-revise-finalize-'));
  const messagesDir = path.join(root, 'messages');
  const toolsFile = path.join(root, 'readonly.tools.toml');
  const promptpileConfig = path.join(root, 'promptpile.toml');
  const draftFile = path.join(root, 'draft.json');
  fs.mkdirSync(messagesDir, { recursive: true });
  fs.writeFileSync(promptpileConfig, promptpileToml(), 'utf8');
  fs.writeFileSync(path.join(messagesDir, '[0]system.md'), loadRevisePrompt('revise-finalize'), 'utf8');
  fs.writeFileSync(path.join(messagesDir, '[1]user.md'), `# Transcript\n\n${transcript}\n\n# Pending changes\n\n${JSON.stringify(draft, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(messagesDir, '[2]user.md'), '请生成最终 revise-payload。', 'utf8');
  writeDraft({ root, messagesDir, toolsFile, promptpileConfig, draftFile }, draft);
  return { root, messagesDir, toolsFile, promptpileConfig, draftFile };
}

export function scanMessageIndices(messagesDir: string): number[] {
  const indices = new Set<number>();
  for (const name of fs.readdirSync(messagesDir)) {
    const m = name.match(MESSAGE_PATTERN);
    if (m) indices.add(parseInt(m[1], 10));
  }
  return [...indices].sort((a, b) => a - b);
}

export function appendUserMessage(messagesDir: string, content: string): string {
  const indices = scanMessageIndices(messagesDir);
  const next = indices.length ? Math.max(...indices) + 1 : 0;
  const filePath = path.join(messagesDir, `[${next}]user.md`);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

export function getLatestAssistantText(messagesDir: string): string {
  const files = fs.readdirSync(messagesDir)
    .filter(name => /^\[\d+\]assistant\.md$/i.test(name))
    .sort((a, b) => Number(a.match(/^\[(\d+)\]/)![1]) - Number(b.match(/^\[(\d+)\]/)![1]));
  if (!files.length) throw new Error('No assistant message found in revise session');
  return fs.readFileSync(path.join(messagesDir, files[files.length - 1]), 'utf8');
}

export function getLatestCallsFile(messagesDir: string): string | undefined {
  const files = fs.readdirSync(messagesDir)
    .filter(name => /^\[\d+\]assistant\.calls\.jsonl$/i.test(name))
    .sort((a, b) => Number(a.match(/^\[(\d+)\]/)![1]) - Number(b.match(/^\[(\d+)\]/)![1]));
  if (!files.length) return undefined;
  const latest = path.join(messagesDir, files[files.length - 1]);
  const result = latest.replace(/\.calls\.jsonl$/i, '.result.jsonl');
  return fs.existsSync(result) ? undefined : latest;
}

export function buildTranscript(messagesDir: string): string {
  return fs.readdirSync(messagesDir)
    .map(name => {
      const m = name.match(MESSAGE_PATTERN);
      if (!m) return null;
      return { idx: Number(m[1]), role: m[2], content: fs.readFileSync(path.join(messagesDir, name), 'utf8') };
    })
    .filter((x): x is { idx: number; role: string; content: string } => x !== null)
    .sort((a, b) => a.idx - b.idx || a.role.localeCompare(b.role))
    .map(x => `## [${x.idx}] ${x.role}\n\n${x.content}`)
    .join('\n\n');
}

export function readDraft(session: ReviseSession): ReviseDraft {
  return JSON.parse(fs.readFileSync(session.draftFile, 'utf8')) as ReviseDraft;
}

export function writeDraft(session: ReviseSession, draft: ReviseDraft): void {
  fs.writeFileSync(session.draftFile, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
}

export function cleanupSession(session: ReviseSession): void {
  if (fs.existsSync(session.root)) fs.rmSync(session.root, { recursive: true, force: true });
}
