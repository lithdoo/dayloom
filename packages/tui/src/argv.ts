export interface ParsedArgv {
  worldRoot: string;
  help: boolean;
}

export function parseArgv(argv: readonly string[], cwd = process.cwd()): ParsedArgv {
  const args = argv.slice(2);
  let help = false;
  let worldRoot = cwd;
  let positionalSeen = false;

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      help = true;
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

  return { worldRoot, help };
}

export function usage(): string {
  return ['Usage: dayloom-tui [worldRoot]', '', 'Options:', '  -h, --help  Show help.'].join('\n');
}
