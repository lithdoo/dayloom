import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import type { Readable } from 'stream';
import { createRuntimeError } from '../errors';
import type {
  ConversationClient,
  ConversationMessage,
  ConversationRequest,
} from './conversation-client';

/** Promptpile 对话 client 配置。 */
export interface PromptpileConversationClientOptions {
  /** Chat Completions API 名称。 */
  apiName?: string;

  /** 模型名称。 */
  model?: string;

  /** OpenAI-compatible API base URL。 */
  baseUrl?: string;

  /** 保存 API key 的环境变量名。 */
  apiKeyEnv?: string;

  /** 可选 promptpile 可执行文件；默认优先解析包内脚本。 */
  promptpileBin?: string;
}

/** 创建使用 Promptpile CLI 的自然语言流式 client。 */
export function createPromptpileConversationClient(
  options: PromptpileConversationClientOptions = {},
): ConversationClient {
  const config = {
    apiName: options.apiName ?? process.env.DAYLOOM_LLM_API_NAME ?? 'deepseek',
    model: options.model ?? process.env.DAYLOOM_LLM_MODEL ?? 'deepseek-chat',
    baseUrl: options.baseUrl ?? process.env.DAYLOOM_LLM_BASE_URL ?? 'https://api.deepseek.com/v1',
    apiKeyEnv: options.apiKeyEnv ?? process.env.DAYLOOM_LLM_API_KEY_ENV ?? 'DEEPSEEK_API_KEY',
    promptpileBin: options.promptpileBin ?? process.env.PROMPTPILE_BIN,
  };

  return {
    streamReply: (request) => streamPromptpile(request, config),
  };
}

interface ResolvedPromptpileConfig {
  apiName: string;
  model: string;
  baseUrl: string;
  apiKeyEnv: string;
  promptpileBin?: string;
}

async function* streamPromptpile(
  request: ConversationRequest,
  config: ResolvedPromptpileConfig,
): AsyncIterable<string> {
  if (request.signal.aborted) {
    throw abortError();
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dayloom-core-${request.kind}-`));
  const messagesDir = path.join(root, 'messages');
  fs.mkdirSync(messagesDir, { recursive: true });
  writePromptpileConfig(path.join(root, 'promptpile.toml'), config);
  writeMessages(messagesDir, request.systemPrompt, request.messages);

  const spawnConfig = resolvePromptpileSpawn(config.promptpileBin);
  const child = spawn(spawnConfig.command, [
    ...spawnConfig.argvPrefix,
    '--config',
    'promptpile.toml',
    '-d',
    'messages',
    '--continue',
    '--disable-tool',
    '--quiet',
    '--output-pile-fd',
    '3',
    '--output-pile-format',
    'json',
  ], {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  let spawnError: Error | null = null;
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });
  child.on('error', (error) => {
    spawnError = error;
  });

  const onAbort = () => {
    child.kill('SIGTERM');
  };
  request.signal.addEventListener('abort', onAbort, { once: true });

  const output = child.stdio[3] as Readable | null | undefined;
  const close = new Promise<number | null>((resolve) => {
    child.once('close', resolve);
  });

  try {
    if (!output) {
      throw createRuntimeError('AI_CALL_FAILED', 'Promptpile output stream was not created.');
    }
    output.setEncoding('utf8');
    let buffer = '';
    for await (const chunk of output) {
      buffer += String(chunk);
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const delta = parsePromptpileEvent(line);
        if (delta !== null) yield delta;
      }
    }
    if (buffer.trim() !== '') {
      const delta = parsePromptpileEvent(buffer);
      if (delta !== null) yield delta;
    }

    const status = await close;
    if (request.signal.aborted) {
      throw abortError();
    }
    const processError = spawnError as Error | null;
    if (processError) {
      throw createRuntimeError('AI_CALL_FAILED', 'Failed to start Promptpile.', {
        message: processError.message,
      });
    }
    if (status !== 0) {
      throw createRuntimeError('AI_CALL_FAILED', `Promptpile exited with code ${String(status)}.`, {
        stderr: stderr.trim().slice(-1000),
      });
    }
  } catch (error) {
    child.kill('SIGTERM');
    await close;
    if (request.signal.aborted) {
      throw abortError();
    }
    throw error;
  } finally {
    request.signal.removeEventListener('abort', onAbort);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writePromptpileConfig(filePath: string, config: ResolvedPromptpileConfig): void {
  const source = [
    '[[llm_api]]',
    `name = ${tomlString(config.apiName)}`,
    `model = ${tomlString(config.model)}`,
    `base_url = ${tomlString(config.baseUrl)}`,
    `api_key_env = ${tomlString(config.apiKeyEnv)}`,
    '',
    '[promptpile]',
    `llm_api = ${tomlString(config.apiName)}`,
    'dir = "./messages"',
    'quiet = true',
    '',
  ].join('\n');
  fs.writeFileSync(filePath, source, 'utf8');
}

function writeMessages(
  messagesDir: string,
  systemPrompt: string,
  messages: readonly ConversationMessage[],
): void {
  fs.writeFileSync(path.join(messagesDir, '[0]system.md'), systemPrompt, 'utf8');
  messages.forEach((message, index) => {
    const sequence = index + 1;
    fs.writeFileSync(
      path.join(messagesDir, `[${sequence}]${message.role}.md`),
      message.text,
      'utf8',
    );
  });
}

function parsePromptpileEvent(rawLine: string): string | null {
  const line = rawLine.trim();
  if (!line) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw createRuntimeError('AI_CALL_FAILED', 'Promptpile returned invalid stream JSON.', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    throw createRuntimeError('AI_CALL_FAILED', 'Promptpile returned an invalid stream event.');
  }
  if (parsed.type === 'assistant_delta') {
    if (typeof parsed.content !== 'string') {
      throw createRuntimeError('AI_CALL_FAILED', 'Promptpile assistant delta has no content.');
    }
    return parsed.content;
  }
  if (parsed.type === 'assistant_done') {
    return null;
  }
  if (parsed.type === 'error') {
    throw createRuntimeError(
      'AI_CALL_FAILED',
      typeof parsed.message === 'string' ? parsed.message : 'Promptpile stream failed.',
    );
  }
  throw createRuntimeError('AI_CALL_FAILED', `Unknown Promptpile event: ${parsed.type}`);
}

function resolvePromptpileSpawn(bin: string | undefined): {
  command: string;
  argvPrefix: string[];
} {
  if (bin?.trim()) {
    const command = bin.trim();
    if (/\.[cm]?js$/i.test(command)) return { command: process.execPath, argvPrefix: [command] };
    return { command, argvPrefix: [] };
  }
  try {
    const packagePath = require.resolve('promptpile/package.json');
    const script = path.join(path.dirname(packagePath), 'dist', 'index.js');
    if (fs.existsSync(script)) {
      return { command: process.execPath, argvPrefix: [script] };
    }
  } catch {
    // Fall through to PATH lookup for development environments.
  }
  return { command: 'promptpile', argvPrefix: [] };
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function abortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
