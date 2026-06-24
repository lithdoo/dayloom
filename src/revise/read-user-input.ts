import readline from 'readline';

export async function readReviseUserInput(): Promise<string | undefined> {
  while (true) {
    const text = (await readMultilineInput()).trim();
    if (text) return text;
    if (await askYesNo('Empty input. Save draft and exit revise session? (Y/N): ')) return undefined;
  }
}

export function askYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

async function readMultilineInput(): Promise<string> {
  process.stdout.write('\nEnter your message. Finish with Ctrl+Z then Enter (Windows), or Ctrl+D (macOS/Linux).\n');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines: string[] = [];
  for await (const line of rl) lines.push(line);
  rl.close();
  return lines.join('\n');
}
