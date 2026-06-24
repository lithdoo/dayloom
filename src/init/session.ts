import fs from 'fs';
import os from 'os';
import path from 'path';
import { PROMPTPILE_TOML } from './constants';
import { loadPrompt } from './prompts';
import type { InitSession } from './types';

const MESSAGE_PATTERN = /^\[(\d+)\](.+)\.md$/i;

export function scanMessageIndices(messagesDir: string): number[] {
  if (!fs.existsSync(messagesDir)) {
    return [];
  }
  const indices = new Set<number>();
  for (const name of fs.readdirSync(messagesDir)) {
    const m = name.match(MESSAGE_PATTERN);
    if (m) {
      indices.add(parseInt(m[1], 10));
    }
  }
  return [...indices].sort((a, b) => a - b);
}

export function appendUserMessage(messagesDir: string, content: string): string {
  const indices = scanMessageIndices(messagesDir);
  const maxIdx = indices.length > 0 ? Math.max(...indices) : -1;
  let nextIdx = maxIdx + 1;
  let filePath = path.join(messagesDir, `[${nextIdx}]user.md`);
  while (fs.existsSync(filePath)) {
    nextIdx += 1;
    filePath = path.join(messagesDir, `[${nextIdx}]user.md`);
  }
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

export function getLatestAssistantText(messagesDir: string): string {
  const files = fs
    .readdirSync(messagesDir)
    .filter(n => /^\[\d+\]assistant\.md$/i.test(n))
    .sort((a, b) => {
      const ia = parseInt(a.match(/^\[(\d+)\]/)![1], 10);
      const ib = parseInt(b.match(/^\[(\d+)\]/)![1], 10);
      return ia - ib;
    });
  if (files.length === 0) {
    throw new Error('No assistant message found in session');
  }
  const last = files[files.length - 1];
  return fs.readFileSync(path.join(messagesDir, last), 'utf8');
}

export function buildTranscript(messagesDir: string): string {
  const entries = fs
    .readdirSync(messagesDir)
    .map(name => {
      const m = name.match(MESSAGE_PATTERN);
      if (!m) {
        return null;
      }
      const idx = parseInt(m[1], 10);
      const role = m[2];
      const content = fs.readFileSync(path.join(messagesDir, name), 'utf8');
      return { idx, role, content };
    })
    .filter((e): e is { idx: number; role: string; content: string } => e !== null)
    .sort((a, b) => a.idx - b.idx || a.role.localeCompare(b.role));

  return entries
    .map(e => `## [${e.idx}] ${e.role}\n\n${e.content}`)
    .join('\n\n');
}

export function createSession(): InitSession {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'day-loom-init-'));
  const messagesDir = path.join(root, 'messages');
  fs.mkdirSync(messagesDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'promptpile.toml'), PROMPTPILE_TOML, 'utf8');

  const systemPrompt = loadPrompt('init-interviewer');
  fs.writeFileSync(path.join(messagesDir, '[0]system.md'), systemPrompt, 'utf8');

  return { root, messagesDir, round: 0 };
}

export function writeOpeningAssistant(
  messagesDir: string,
  opening: string
): void {
  fs.writeFileSync(path.join(messagesDir, '[1]assistant.md'), opening, 'utf8');
}

export function createFinalizeSession(transcript: string): InitSession {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'day-loom-finalize-'));
  const messagesDir = path.join(root, 'messages');
  fs.mkdirSync(messagesDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'promptpile.toml'), PROMPTPILE_TOML, 'utf8');

  fs.writeFileSync(
    path.join(messagesDir, '[0]system.md'),
    loadPrompt('init-finalize'),
    'utf8'
  );
  fs.writeFileSync(path.join(messagesDir, '[1]user.md'), transcript, 'utf8');

  return { root, messagesDir, round: 0 };
}
