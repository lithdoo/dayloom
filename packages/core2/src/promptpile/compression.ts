import type { ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  heuristicTokenizer,
  runCompressionBeforeCompletion,
  type SemanticSummaryProvider,
  type SemanticSummaryRequest,
} from 'promptpile-compress';
import { CoreOperationError } from '../errors';
import type { ProcessResult, ProcessRunner } from './conversation';

export const CORE2_SEMANTIC_SUMMARY_PROVIDER_ID = 'dayloom-core2-semantic-summary-v1';

export const CORE2_COMPRESSION_POLICY = Object.freeze({
  threshold: 32_000,
  keepRecent: 4,
  strategy: 'sliding-window' as const,
  tokenizer: heuristicTokenizer,
  summary: Object.freeze({
    kind: 'semantic' as const,
    maxOutputTokens: 2_048,
    timeoutMs: 60_000,
  }),
});

interface ProviderOptions {
  runner: ProcessRunner;
  promptpileBin: string;
  requestsDir: string;
  summaryConfigPath: string;
  summaryPromptPath: string;
  onChildStart: (child: ChildProcess) => void;
  onChildEnd: (child: ChildProcess) => void;
}

export interface Core2SemanticSummaryProviderHandle {
  provider: SemanticSummaryProvider;
  drain(): Promise<void>;
}

function abortError(): Error {
  const error = new Error('Semantic summary request was aborted.');
  error.name = 'AbortError';
  return error;
}

async function runProviderChild(
  options: ProviderOptions,
  args: readonly string[],
  signal: AbortSignal,
  stdin?: string,
): Promise<ProcessResult> {
  let child: ChildProcess | null = null;
  let abortListener: (() => void) | null = null;
  try {
    return await options.runner.run(options.promptpileBin, args, {
      stdin,
      onChild: (started) => {
        child = started;
        options.onChildStart(started);
        abortListener = () => { started.kill(); };
        if (signal.aborted) abortListener();
        else signal.addEventListener('abort', abortListener, { once: true });
      },
    });
  } finally {
    if (abortListener) signal.removeEventListener('abort', abortListener);
    if (child) options.onChildEnd(child);
  }
}

async function summarizeWithPromptpile(options: ProviderOptions, request: SemanticSummaryRequest, signal: AbortSignal): Promise<unknown> {
  const requestDir = await mkdtemp(path.join(options.requestsDir, 'request-'));
  try {
    const appended = await runProviderChild(
      options,
      ['conversation', 'append-user', '-d', requestDir, '--quiet'],
      signal,
      JSON.stringify(request),
    );
    if (appended.code !== 0) throw new Error(appended.stderr || 'Promptpile summary request append failed.');
    if (signal.aborted) throw abortError();

    const completed = await runProviderChild(options, [
      '--config', options.summaryConfigPath,
      '-d', requestDir,
      '--insert-files', options.summaryPromptPath,
      '--disable-tool',
      '--temperature', '0',
    ], signal);
    if (completed.code !== 0) throw new Error(completed.stderr || 'Promptpile semantic summary failed.');
    if (signal.aborted) throw abortError();
    const output = completed.stdout.trim();
    if (output === '') throw new Error('Promptpile semantic summary returned empty stdout.');
    let parsed: unknown;
    try { parsed = JSON.parse(output); }
    catch (error) { throw new Error('Promptpile semantic summary returned malformed JSON.', { cause: error }); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Promptpile semantic summary must return a JSON object.');
    return parsed;
  } finally {
    await rm(requestDir, { recursive: true, force: true });
  }
}

export function createCore2SemanticSummaryProvider(options: ProviderOptions): Core2SemanticSummaryProviderHandle {
  let inFlight: Promise<unknown> | null = null;
  const provider: SemanticSummaryProvider = {
    id: CORE2_SEMANTIC_SUMMARY_PROVIDER_ID,
    summarize(request, signal) {
      const task = summarizeWithPromptpile(options, request, signal);
      inFlight = task;
      void task.finally(() => {
        if (inFlight === task) inFlight = null;
      }).catch(() => {});
      return task;
    },
  };
  return {
    provider,
    async drain() {
      const task = inFlight;
      if (task) await task.catch(() => {});
    },
  };
}

export interface RunCompressedCompletionOptions<T> extends ProviderOptions {
  conversationDir: string;
  completion: () => Promise<T>;
}

export async function runCompressedCompletion<T>(options: RunCompressedCompletionOptions<T>): Promise<T> {
  const providerHandle = createCore2SemanticSummaryProvider(options);
  let completionError: unknown;
  let result: Awaited<ReturnType<typeof runCompressionBeforeCompletion<T>>>;
  try {
    result = await runCompressionBeforeCompletion({
      compression: {
        ...CORE2_COMPRESSION_POLICY,
        directory: options.conversationDir,
        summary: { ...CORE2_COMPRESSION_POLICY.summary, provider: providerHandle.provider },
      },
      completion: async () => {
        try { return await options.completion(); }
        catch (error) { completionError = error; throw error; }
      },
    });
  } finally {
    await providerHandle.drain();
  }
  if (result.ok) return result.completion;
  const lifecycleError = result.report.error;
  if (lifecycleError?.code === 'INVALID_OPTIONS') {
    throw new CoreOperationError('INTERNAL_ERROR', 'Core2 compression policy is invalid.');
  }
  if (lifecycleError?.code === 'COMPLETION_FAILED') {
    throw new CoreOperationError(
      'AGENT_FAILED',
      completionError instanceof Error ? completionError.message : 'Agent completion failed.',
      completionError === undefined ? undefined : { cause: completionError },
    );
  }
  throw new CoreOperationError(
    'CONVERSATION_FAILED',
    lifecycleError?.message || 'Conversation compression lifecycle failed.',
  );
}
