import fs from 'fs';
import os from 'os';
import path from 'path';
import { OPENING_ASSISTANT } from './constants';
import { loadDailyPrompt } from './prompts';
import type { DailyDraft, DailySession } from './types';

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

export function createDailySession(): DailySession {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'day-loom-daily-'));
  const messagesDir = path.join(root, 'messages');
  const toolsFile = path.join(root, 'readonly.tools.toml');
  const promptpileConfig = path.join(root, 'promptpile.toml');
  const draftFile = path.join(root, 'draft.json');
  const playerContextRoot = path.join(root, 'player-context');
  fs.mkdirSync(messagesDir, { recursive: true });
  fs.writeFileSync(promptpileConfig, promptpileToml(), 'utf8');
  fs.writeFileSync(path.join(messagesDir, '[0]system.md'), loadDailyPrompt('daily-dialogue'), 'utf8');
  fs.writeFileSync(path.join(messagesDir, '[1]assistant.md'), OPENING_ASSISTANT, 'utf8');
  writeDraft({ root, messagesDir, toolsFile, promptpileConfig, draftFile, playerContextRoot }, emptyDraft());
  return { root, messagesDir, toolsFile, promptpileConfig, draftFile, playerContextRoot };
}

export function createFinalizeSession(transcript: string, draft: DailyDraft, day: string): DailySession {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'day-loom-daily-finalize-'));
  const messagesDir = path.join(root, 'messages');
  const toolsFile = path.join(root, 'readonly.tools.toml');
  const promptpileConfig = path.join(root, 'promptpile.toml');
  const draftFile = path.join(root, 'draft.json');
  const playerContextRoot = path.join(root, 'player-context');
  fs.mkdirSync(messagesDir, { recursive: true });
  fs.writeFileSync(promptpileConfig, promptpileToml(), 'utf8');
  fs.writeFileSync(path.join(messagesDir, '[0]system.md'), loadDailyPrompt('daily-finalize-plan'), 'utf8');
  fs.writeFileSync(path.join(messagesDir, '[1]user.md'), `# Current day\n\n${day}\n\n# Transcript\n\n${transcript}\n\n# Draft\n\n${JSON.stringify(draft, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(messagesDir, '[2]user.md'), '请生成最终 daily-plan。', 'utf8');
  writeDraft({ root, messagesDir, toolsFile, promptpileConfig, draftFile, playerContextRoot }, draft);
  return { root, messagesDir, toolsFile, promptpileConfig, draftFile, playerContextRoot };
}

export function createIntentSession(input: { input: string; draft: DailyDraft; latestAssistantReply: string }): DailySession {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'day-loom-daily-intent-'));
  const messagesDir = path.join(root, 'messages');
  const toolsFile = path.join(root, 'readonly.tools.toml');
  const promptpileConfig = path.join(root, 'promptpile.toml');
  const draftFile = path.join(root, 'draft.json');
  const playerContextRoot = path.join(root, 'unused-context');
  fs.mkdirSync(messagesDir, { recursive: true });
  fs.writeFileSync(promptpileConfig, promptpileToml(), 'utf8');
  fs.writeFileSync(toolsFile, '', 'utf8');
  fs.writeFileSync(path.join(messagesDir, '[0]system.md'), loadDailyPrompt('daily-intent-router'), 'utf8');
  fs.writeFileSync(path.join(messagesDir, '[1]user.md'), JSON.stringify({
    latest_user_input: input.input,
    current_draft: input.draft,
    latest_assistant_reply: input.latestAssistantReply,
  }, null, 2), 'utf8');
  writeDraft({ root, messagesDir, toolsFile, promptpileConfig, draftFile, playerContextRoot }, input.draft);
  return { root, messagesDir, toolsFile, promptpileConfig, draftFile, playerContextRoot };
}

export function emptyDraft(): DailyDraft { return { user_intent: '', known_context: [], constraints: [], open_questions: [] }; }
export function readDraft(session: DailySession): DailyDraft { return JSON.parse(fs.readFileSync(session.draftFile, 'utf8')) as DailyDraft; }
export function writeDraft(session: DailySession, draft: DailyDraft): void { fs.writeFileSync(session.draftFile, `${JSON.stringify(draft, null, 2)}\n`, 'utf8'); }
export function cleanupSession(session: DailySession): void { if (fs.existsSync(session.root)) fs.rmSync(session.root, { recursive: true, force: true }); }

export function appendUserMessage(messagesDir: string, content: string): string {
  const indices = scanMessageIndices(messagesDir);
  const next = indices.length ? Math.max(...indices) + 1 : 0;
  const filePath = path.join(messagesDir, `[${next}]user.md`);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

export function getLatestAssistantText(messagesDir: string): string {
  const files = fs.readdirSync(messagesDir).filter(name => /^\[\d+\]assistant\.md$/i.test(name)).sort(byMessageIndex);
  if (!files.length) throw new Error('No assistant message found in daily session');
  return fs.readFileSync(path.join(messagesDir, files[files.length - 1]), 'utf8');
}

export function getLatestCallsFile(messagesDir: string): string | undefined {
  const files = fs.readdirSync(messagesDir).filter(name => /^\[\d+\]assistant\.calls\.jsonl$/i.test(name)).sort(byMessageIndex);
  if (!files.length) return undefined;
  const latest = path.join(messagesDir, files[files.length - 1]);
  return fs.existsSync(latest.replace(/\.calls\.jsonl$/i, '.result.jsonl')) ? undefined : latest;
}

export function buildTranscript(messagesDir: string): string {
  return fs.readdirSync(messagesDir)
    .map(name => { const m = name.match(MESSAGE_PATTERN); return m ? { idx: Number(m[1]), role: m[2], content: fs.readFileSync(path.join(messagesDir, name), 'utf8') } : null; })
    .filter((x): x is { idx: number; role: string; content: string } => x !== null)
    .sort((a, b) => a.idx - b.idx || a.role.localeCompare(b.role))
    .map(x => `## [${x.idx}] ${x.role}\n\n${x.content}`)
    .join('\n\n');
}

function scanMessageIndices(messagesDir: string): number[] { return fs.readdirSync(messagesDir).map(name => name.match(/^\[(\d+)\]/)?.[1]).filter((x): x is string => Boolean(x)).map(Number); }
function byMessageIndex(a: string, b: string): number { return Number(a.match(/^\[(\d+)\]/)![1]) - Number(b.match(/^\[(\d+)\]/)![1]); }
