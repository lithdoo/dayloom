import fs from 'fs';
import os from 'os';
import path from 'path';
import type { SettlementSession } from './types';

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

export function createSettlementSession(systemPrompt: string, userContent: string, toolsSource: string): SettlementSession {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'day-loom-settle-'));
  const messagesDir = path.join(root, 'messages');
  const session: SettlementSession = {
    root,
    messagesDir,
    toolsFile: path.join(root, 'readonly.tools.toml'),
    promptpileConfig: path.join(root, 'promptpile.toml'),
    draftFile: path.join(root, 'unused.json'),
    playerContextRoot: path.join(root, 'unused-context'),
  };
  fs.mkdirSync(messagesDir, { recursive: true });
  fs.writeFileSync(session.promptpileConfig, promptpileToml(), 'utf8');
  fs.copyFileSync(toolsSource, session.toolsFile);
  fs.writeFileSync(path.join(messagesDir, '[0]system.md'), systemPrompt, 'utf8');
  fs.writeFileSync(path.join(messagesDir, '[1]user.md'), userContent, 'utf8');
  return session;
}

export function cleanupSettlementSession(session: SettlementSession): void {
  fs.rmSync(session.root, { recursive: true, force: true });
}
