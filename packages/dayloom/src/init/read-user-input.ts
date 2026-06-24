import readline from 'readline';
import { InitCancelledError } from './errors';

async function readMultilineInput(): Promise<string> {
  process.stdout.write(
    '\nEnter your reply. Finish with Ctrl+Z then Enter (Windows), or Ctrl+D (macOS/Linux).\n'
  );

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const lines: string[] = [];
  for await (const line of rl) {
    lines.push(line);
  }

  rl.close();
  return lines.join('\n');
}

function askExitOnEmpty(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question('Empty input. Exit? (Y/N): ', answer => {
      rl.close();
      resolve(/^y$/i.test(answer.trim()));
    });
  });
}

export async function readUserInput(): Promise<string> {
  while (true) {
    const text = (await readMultilineInput()).trim();
    if (text) {
      return text;
    }
    if (await askExitOnEmpty()) {
      throw new InitCancelledError();
    }
  }
}
