import { cliErrorV1 } from './errors.js';

export type CliCommandV1 = 'init' | 'plan' | 'play' | 'revise' | 'settle' | 'abandon' | 'status' | 'verify';

export interface ParsedInvocationV1 {
  command: CliCommandV1;
  world: string;
  drafts: readonly string[];
  draftDir: string | null;
  baseCommitId: string | null;
  llmConfigPath: string | null;
  check: boolean;
  dryRun: boolean;
  json: boolean;
}

const COMMANDS = new Set<CliCommandV1>(['init', 'plan', 'play', 'revise', 'settle', 'abandon', 'status', 'verify']);
const DRAFT_DRIVEN = new Set<CliCommandV1>(['init', 'plan', 'play', 'revise']);
const MUTATIONS = new Set<CliCommandV1>(['init', 'plan', 'play', 'revise', 'settle', 'abandon']);

export function parseArgvV1(argv: readonly string[]): Readonly<ParsedInvocationV1> {
  const rawCommand = argv[0];
  if (!rawCommand || !COMMANDS.has(rawCommand as CliCommandV1)) {
    throw cliErrorV1('INVALID_ARGUMENT', 'Expected one of: init, plan, play, revise, settle, abandon, status, verify.');
  }
  const command = rawCommand as CliCommandV1;
  const world = argv[1];
  if (!world || world.startsWith('--')) throw cliErrorV1('INVALID_ARGUMENT', `${command} requires a World directory.`);

  const drafts: string[] = [];
  let draftDir: string | null = null;
  let baseCommitId: string | null = null;
  let llmConfigPath: string | null = null;
  let check = false;
  let dryRun = false;
  let json = false;

  const takeValue = (index: number, flag: string): string => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw cliErrorV1('INVALID_ARGUMENT', `${flag} requires a value.`);
    return value;
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--draft') {
      drafts.push(takeValue(index, arg));
      index += 1;
      continue;
    }
    if (arg === '--draft-dir') {
      if (draftDir !== null) throw cliErrorV1('INVALID_ARGUMENT', '--draft-dir may be provided only once.');
      draftDir = takeValue(index, arg);
      index += 1;
      continue;
    }
    if (arg === '--base') {
      if (baseCommitId !== null) throw cliErrorV1('INVALID_ARGUMENT', '--base may be provided only once.');
      baseCommitId = takeValue(index, arg);
      index += 1;
      continue;
    }
    if (arg === '--llm-config') {
      if (llmConfigPath !== null) throw cliErrorV1('INVALID_ARGUMENT', '--llm-config may be provided only once.');
      llmConfigPath = takeValue(index, arg);
      index += 1;
      continue;
    }
    if (arg === '--check') {
      if (check) throw cliErrorV1('INVALID_ARGUMENT', '--check may be provided only once.');
      check = true;
      continue;
    }
    if (arg === '--dry-run') {
      if (dryRun) throw cliErrorV1('INVALID_ARGUMENT', '--dry-run may be provided only once.');
      dryRun = true;
      continue;
    }
    if (arg === '--json') {
      if (json) throw cliErrorV1('INVALID_ARGUMENT', '--json may be provided only once.');
      json = true;
      continue;
    }
    throw cliErrorV1('INVALID_ARGUMENT', `Unknown argument: ${arg}.`);
  }

  if (check && dryRun) throw cliErrorV1('INVALID_ARGUMENT', '--check and --dry-run are mutually exclusive.');
  if (drafts.length > 0 && draftDir !== null) throw cliErrorV1('INVALID_ARGUMENT', '--draft and --draft-dir are mutually exclusive.');

  if (DRAFT_DRIVEN.has(command)) {
    if (drafts.length === 0 && draftDir === null) throw cliErrorV1('INVALID_ARGUMENT', `${command} requires --draft or --draft-dir.`);
    if (command === 'init' && baseCommitId !== null) throw cliErrorV1('INVALID_ARGUMENT', 'init does not accept --base.');
  } else if (drafts.length > 0 || draftDir !== null || llmConfigPath !== null || check) {
    throw cliErrorV1('INVALID_ARGUMENT', `${command} does not accept Draft or LLM options.`);
  }

  if ((command === 'status' || command === 'verify') && (baseCommitId !== null || dryRun)) {
    throw cliErrorV1('INVALID_ARGUMENT', `${command} accepts only <world> and --json.`);
  }
  if (!MUTATIONS.has(command) && dryRun) throw cliErrorV1('INVALID_ARGUMENT', `${command} does not accept --dry-run.`);

  return Object.freeze({
    command,
    world,
    drafts: Object.freeze([...drafts]),
    draftDir,
    baseCommitId,
    llmConfigPath,
    check,
    dryRun,
    json,
  });
}
