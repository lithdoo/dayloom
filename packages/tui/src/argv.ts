export interface ParsedArgv {
  worldRoot: string;
  llmConfigPath: string | null;
  help: boolean;
}

export function parseArgv(argv: readonly string[], cwd = process.cwd()): ParsedArgv {
  const args = argv.slice(2);
  let help = false;
  let worldRoot = cwd;
  let positionalSeen = false;
  let llmConfigPath: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--help' || arg === '-h') { help = true; continue; }
    if (arg === '--llm-config') {
      if (llmConfigPath !== null) throw new Error('Duplicate option: --llm-config');
      const value = args[++index];
      if (value === undefined || value.startsWith('-') || value.trim() === '') throw new Error('Missing value for --llm-config');
      llmConfigPath = value;
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    if (positionalSeen) throw new Error(`Unexpected argument: ${arg}`);
    worldRoot = arg; positionalSeen = true;
  }
  return { worldRoot, llmConfigPath, help };
}

export function resolveLlmConfigPath(parsed: ParsedArgv, env: NodeJS.ProcessEnv = process.env): string {
  const candidate = parsed.llmConfigPath?.trim() || env.DAYLOOM_LLM_CONFIG?.trim();
  if (!candidate) throw new Error('Missing LLM config. Pass --llm-config <path> or set DAYLOOM_LLM_CONFIG.');
  return candidate;
}

export function usage(): string {
  return [
    'Usage: dayloom-tui [worldRoot] --llm-config <path>', '', 'Options:',
    '  --llm-config <path>  Caller-owned Promptpile LLM configuration.',
    '  -h, --help           Show help.',
  ].join('\n');
}
