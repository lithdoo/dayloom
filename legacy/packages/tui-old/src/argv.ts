import type { GameShellOptions } from '@dayloom/core-old';

export interface ParsedArgv {
  help: boolean;
  worldDir: string;
  locale?: string;
  autoStart: boolean;
  shellOptions: Omit<GameShellOptions, 'worldDir' | 'io' | 't' | 'autoStart'>;
}

export function formatHelp(): string {
  return [
    'Usage: dayloom-tui-old <world-dir> [options]',
    '',
    'Options:',
    '  --locale <code>',
    '  --no-auto-start',
    '  --quick',
    '  --dry-run',
    '  --yes',
    '  --keep-session',
    '  --id <id>',
    '  --title <title>',
    '  --max-rounds <n>',
    '  --max-tool-rounds <n>',
    '  --max-event-rounds <n>',
    '  --mcp-base-url <url>',
    '  --mcp-token <token>',
    '  --help',
  ].join('\n');
}

export function parseArgv(argv: readonly string[]): ParsedArgv {
  const args = argv.slice(2);
  const shellOptions: ParsedArgv['shellOptions'] = {};
  let worldDir: string | undefined;
  let locale: string | undefined;
  let autoStart = true;
  let help = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) continue;

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--no-auto-start') {
      autoStart = false;
      continue;
    }
    if (arg === '--quick') {
      shellOptions.quick = true;
      continue;
    }
    if (arg === '--dry-run') {
      shellOptions.dryRun = true;
      continue;
    }
    if (arg === '--yes' || arg === '-y') {
      shellOptions.yes = true;
      continue;
    }
    if (arg === '--keep-session') {
      shellOptions.keepSession = true;
      continue;
    }
    if (arg === '--locale') {
      locale = readValue(args, ++i, arg);
      continue;
    }
    if (arg === '--id') {
      shellOptions.id = readValue(args, ++i, arg);
      continue;
    }
    if (arg === '--title') {
      shellOptions.title = readValue(args, ++i, arg);
      continue;
    }
    if (arg === '--max-rounds') {
      shellOptions.maxRounds = readInteger(args, ++i, arg);
      continue;
    }
    if (arg === '--max-tool-rounds') {
      shellOptions.maxToolRounds = readInteger(args, ++i, arg);
      continue;
    }
    if (arg === '--max-event-rounds') {
      shellOptions.maxEventRounds = readInteger(args, ++i, arg);
      continue;
    }
    if (arg === '--mcp-base-url') {
      shellOptions.mcpBaseUrl = readValue(args, ++i, arg);
      continue;
    }
    if (arg === '--mcp-token') {
      shellOptions.mcpToken = readValue(args, ++i, arg);
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (worldDir) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    worldDir = arg;
  }

  return {
    help,
    worldDir: worldDir ?? '.',
    locale,
    autoStart,
    shellOptions,
  };
}

function readValue(args: readonly string[], index: number, option: string): string {
  const value = args[index];
  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

function readInteger(args: readonly string[], index: number, option: string): number {
  const value = readValue(args, index, option);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid integer for ${option}: ${value}`);
  }
  return parsed;
}
