import { draftErrorV1 } from '@dayloom/draft';

export type AssistantCommandV1 = 'init' | 'plan' | 'play' | 'revise';
export type AssistantOutputFormatV1 = 'terminal' | 'stream-json';

export type ParsedAssistantArgvV1 =
  | { mode: 'help' }
  | { mode: 'version' }
  | ParsedAssistantInvocationV1;

export interface ParsedAssistantInvocationV1 {
  mode: 'run';
  command: AssistantCommandV1 | null;
  world: string | null;
  drafts: readonly string[];
  draftDir: string | null;
  conversation: string;
  llmConfig: string;
  message: string;
  outputFormat: AssistantOutputFormatV1;
}

const COMMANDS = new Set<AssistantCommandV1>(['init', 'plan', 'play', 'revise']);
const OUTPUT_FORMATS = new Set<AssistantOutputFormatV1>(['terminal', 'stream-json']);

export function parseAssistantArgvV1(argv: readonly string[]): ParsedAssistantArgvV1 {
  let command: AssistantCommandV1 | null = null;
  const drafts: string[] = [];
  const singleton = new Map<string, string>();
  let help = false;
  let version = false;
  let index = 0;

  if (argv[0] !== undefined && !argv[0].startsWith('--')) {
    if (!COMMANDS.has(argv[0] as AssistantCommandV1)) {
      throw draftErrorV1('INVALID_ARGUMENT', `Unknown command: ${argv[0]}. Expected init, plan, play, or revise.`);
    }
    command = argv[0] as AssistantCommandV1;
    index = 1;
  }

  const takeValue = (flag: string): string => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw draftErrorV1('INVALID_ARGUMENT', `${flag} requires a value.`);
    }
    index += 1;
    return value;
  };
  const takeSingleton = (flag: string): void => {
    if (singleton.has(flag)) throw draftErrorV1('INVALID_ARGUMENT', `${flag} may be provided only once.`);
    singleton.set(flag, takeValue(flag));
  };

  for (; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--help') {
      if (help) throw draftErrorV1('INVALID_ARGUMENT', '--help may be provided only once.');
      help = true;
    } else if (arg === '--version') {
      if (version) throw draftErrorV1('INVALID_ARGUMENT', '--version may be provided only once.');
      version = true;
    } else if (arg === '--draft') {
      drafts.push(takeValue(arg));
    } else if (['--world', '--draft-dir', '--conversation', '--llm-config', '--message', '--output-format'].includes(arg)) {
      takeSingleton(arg);
    } else {
      throw draftErrorV1('INVALID_ARGUMENT', `Unknown argument: ${arg}.`);
    }
  }

  if (help && version) throw draftErrorV1('INVALID_ARGUMENT', '--help and --version are mutually exclusive.');
  if (help) return Object.freeze({ mode: 'help' });
  if (version) return Object.freeze({ mode: 'version' });

  const world = singleton.get('--world') ?? null;
  if (command === 'init' && world !== null) throw draftErrorV1('INVALID_ARGUMENT', 'init does not accept --world.');
  if (command !== null && command !== 'init' && world === null) {
    throw draftErrorV1('INVALID_ARGUMENT', `${command} requires --world.`);
  }
  const draftDir = singleton.get('--draft-dir') ?? null;
  if (drafts.length > 0 && draftDir !== null) {
    throw draftErrorV1('INVALID_ARGUMENT', '--draft and --draft-dir are mutually exclusive.');
  }
  if (drafts.length === 0 && draftDir === null) {
    throw draftErrorV1('INVALID_ARGUMENT', 'Exactly one of --draft or --draft-dir is required.');
  }

  const required = (flag: string): string => {
    const value = singleton.get(flag);
    if (value === undefined) throw draftErrorV1('INVALID_ARGUMENT', `${flag} is required.`);
    return value;
  };
  const message = required('--message');
  if (message.trim() === '') throw draftErrorV1('INVALID_ARGUMENT', '--message must not be empty.');
  const rawFormat = singleton.get('--output-format') ?? 'terminal';
  if (!OUTPUT_FORMATS.has(rawFormat as AssistantOutputFormatV1)) {
    throw draftErrorV1('INVALID_ARGUMENT', '--output-format must be terminal or stream-json.');
  }

  return Object.freeze({
    mode: 'run', command, world, drafts: Object.freeze([...drafts]), draftDir,
    conversation: required('--conversation'), llmConfig: required('--llm-config'), message,
    outputFormat: rawFormat as AssistantOutputFormatV1,
  });
}
