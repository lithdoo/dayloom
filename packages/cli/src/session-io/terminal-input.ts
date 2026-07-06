import readline from 'readline';

const ansi = {
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

export interface TerminalInputOptions {
  commandHint?: string;
  instruction: string;
  userPrompt: string;
}

export async function readTerminalInput(options: TerminalInputOptions): Promise<string> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const hint = options.commandHint?.trim();
  if (interactive && hint) process.stdout.write(`${ansi.dim}${hint}${ansi.reset}\n`);
  process.stdout.write(`${options.instruction}\n`);
  if (interactive) process.stdout.write(options.userPrompt);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines: string[] = [];
  for await (const line of rl) lines.push(line);
  rl.close();

  const text = lines.join('\n');
  if (interactive && hint) rewriteSingleLineInput(options, hint, lines);
  return text;
}

function rewriteSingleLineInput(options: TerminalInputOptions, hint: string, lines: string[]): void {
  if (lines.length !== 1) return;
  const answer = lines[0];
  const columns = process.stdout.columns ?? 80;
  if (
    hint.length >= columns ||
    options.instruction.length >= columns ||
    options.userPrompt.length + answer.length >= columns
  ) return;
  try {
    readline.moveCursor(process.stdout, 0, -3);
    readline.clearScreenDown(process.stdout);
    process.stdout.write(`${ansi.dim}${options.userPrompt}${ansi.reset}${ansi.cyan}${answer}${ansi.reset}\n`);
  } catch {
    // Terminal rewriting is cosmetic; never let it affect session input.
  }
}
