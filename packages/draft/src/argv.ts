import { draftErrorV1 } from './errors.js';

export type DraftCommandV1 = 'init' | 'plan' | 'play' | 'revise';
export type OutputFormatV1 = 'terminal' | 'stream-json';

export interface ParsedDraftHelpV1 {
  mode: 'help';
}

export interface ParsedDraftVersionV1 {
  mode: 'version';
}

export interface ParsedDraftInvocationV1 {
  mode: 'run';
  command: DraftCommandV1 | null;
  world: string;
  drafts: readonly string[];
  draftDir: string | null;
  conversation: string;
  llmConfig: string;
  message: string;
  outputFormat: OutputFormatV1;
}

export type ParsedDraftArgvV1 = ParsedDraftHelpV1 | ParsedDraftVersionV1 | ParsedDraftInvocationV1;

const COMMANDS = new Set<DraftCommandV1>(['init', 'plan', 'play', 'revise']);
const OUTPUT_FORMATS = new Set<OutputFormatV1>(['terminal', 'stream-json']);

export function parseArgvV1(argv: readonly string[]): ParsedDraftArgvV1 {
  let command: DraftCommandV1 | null = null;
  const drafts: string[] = [];
  let world: string | null = null;
  let draftDir: string | null = null;
  let conversation: string | null = null;
  let llmConfig: string | null = null;
  let message: string | null = null;
  let outputFormat: OutputFormatV1 | null = null;
  let help = false;
  let version = false;

  const takeValue = (index: number, flag: string): string => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw draftErrorV1('INVALID_ARGUMENT', `${flag} requires a value.`);
    }
    return value;
  };

  let index = 0;
  if (argv[0] !== undefined && !argv[0].startsWith('--')) {
    const raw = argv[0];
    if (!COMMANDS.has(raw as DraftCommandV1)) {
      throw draftErrorV1('INVALID_ARGUMENT', `Unknown command: ${raw}. Expected init, plan, play, or revise.`);
    }
    command = raw as DraftCommandV1;
    index = 1;
  }

  for (; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--help') {
      if (help) throw draftErrorV1('INVALID_ARGUMENT', '--help may be provided only once.');
      help = true;
      continue;
    }
    if (arg === '--version') {
      if (version) throw draftErrorV1('INVALID_ARGUMENT', '--version may be provided only once.');
      version = true;
      continue;
    }
    if (arg === '--world') {
      if (world !== null) throw draftErrorV1('INVALID_ARGUMENT', '--world may be provided only once.');
      world = takeValue(index, arg);
      index += 1;
      continue;
    }
    if (arg === '--draft') {
      drafts.push(takeValue(index, arg));
      index += 1;
      continue;
    }
    if (arg === '--draft-dir') {
      if (draftDir !== null) throw draftErrorV1('INVALID_ARGUMENT', '--draft-dir may be provided only once.');
      draftDir = takeValue(index, arg);
      index += 1;
      continue;
    }
    if (arg === '--conversation') {
      if (conversation !== null) throw draftErrorV1('INVALID_ARGUMENT', '--conversation may be provided only once.');
      conversation = takeValue(index, arg);
      index += 1;
      continue;
    }
    if (arg === '--llm-config') {
      if (llmConfig !== null) throw draftErrorV1('INVALID_ARGUMENT', '--llm-config may be provided only once.');
      llmConfig = takeValue(index, arg);
      index += 1;
      continue;
    }
    if (arg === '--message') {
      if (message !== null) throw draftErrorV1('INVALID_ARGUMENT', '--message may be provided only once.');
      message = takeValue(index, arg);
      index += 1;
      continue;
    }
    if (arg === '--output-format') {
      if (outputFormat !== null) throw draftErrorV1('INVALID_ARGUMENT', '--output-format may be provided only once.');
      const value = takeValue(index, arg);
      if (!OUTPUT_FORMATS.has(value as OutputFormatV1)) {
        throw draftErrorV1('INVALID_ARGUMENT', '--output-format must be terminal or stream-json.');
      }
      outputFormat = value as OutputFormatV1;
      index += 1;
      continue;
    }
    throw draftErrorV1('INVALID_ARGUMENT', `Unknown argument: ${arg}.`);
  }

  if (help && version) throw draftErrorV1('INVALID_ARGUMENT', '--help and --version are mutually exclusive.');
  if (help) return Object.freeze({ mode: 'help' });
  if (version) return Object.freeze({ mode: 'version' });

  if (world === null) throw draftErrorV1('INVALID_ARGUMENT', '--world is required.');
  if (conversation === null) throw draftErrorV1('INVALID_ARGUMENT', '--conversation is required.');
  if (llmConfig === null) throw draftErrorV1('INVALID_ARGUMENT', '--llm-config is required.');
  if (message === null) throw draftErrorV1('INVALID_ARGUMENT', '--message is required.');
  if (message.trim() === '') throw draftErrorV1('INVALID_ARGUMENT', '--message must not be empty.');
  if (drafts.length > 0 && draftDir !== null) {
    throw draftErrorV1('INVALID_ARGUMENT', '--draft and --draft-dir are mutually exclusive.');
  }
  if (drafts.length === 0 && draftDir === null) {
    throw draftErrorV1('INVALID_ARGUMENT', 'Exactly one of --draft or --draft-dir is required.');
  }

  return Object.freeze({
    mode: 'run',
    command,
    world,
    drafts: Object.freeze([...drafts]),
    draftDir,
    conversation,
    llmConfig,
    message,
    outputFormat: outputFormat ?? 'terminal',
  });
}
