export interface ParsedArgv {
  worldRoot: string;
  llmConfigPath: string | null;
  help: boolean;
}

export function parseArgv(
  argv: readonly string[],
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): ParsedArgv {
  const args = argv.slice(2);
  let help = false;
  let worldRoot = cwd;
  let positionalSeen = false;
  let llmConfigPath: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--llm-config') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) throw new Error('--llm-config requires a path.');
      llmConfigPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (positionalSeen) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    worldRoot = arg;
    positionalSeen = true;
  }

  llmConfigPath ??= env.DAYLOOM_LLM_CONFIG?.trim() || null;
  if (!help && !llmConfigPath) {
    throw new Error('Missing LLM config. Use --llm-config <path> or DAYLOOM_LLM_CONFIG.');
  }
  return { worldRoot, llmConfigPath, help };
}

export function usage(): string {
  return [
    'Usage: dayloom-tui [worldRoot] --llm-config <path>',
    '',
    'Options:',
    '  --llm-config <path>  Promptpile caller LLM configuration.',
    '  -h, --help           Show help.',
    '',
    'Environment:',
    '  DAYLOOM_LLM_CONFIG   Fallback LLM configuration path.',
  ].join('\n');
}
