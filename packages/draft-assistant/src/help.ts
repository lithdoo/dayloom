import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function packageVersionV1(): string {
  const metadata = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version?: unknown };
  if (typeof metadata.version !== 'string' || metadata.version.trim() === '') throw new Error('Invalid package version.');
  return metadata.version;
}

export function helpTextV1(): string {
  return `Usage:
  dayloom-draft-assistant [init] (--draft <file>... | --draft-dir <dir>) --conversation <dir> --llm-config <file> --message <text>
  dayloom-draft-assistant [plan|play|revise] --world <archive> (--draft <file>... | --draft-dir <dir>) --conversation <dir> --llm-config <file> --message <text>

Options:
  --world <archive>                    Required for plan/play/revise; forbidden for init
  --draft <file>                       Repeatable exact Draft file authority
  --draft-dir <dir>                    Draft subtree authority
  --conversation <dir>                 Promptpile Conversation directory
  --llm-config <file>                  Promptpile LLM config
  --message <text>                     One user message
  --output-format terminal|stream-json Dialogue output; default terminal
  --help                               Show help without starting React
  --version                            Show version without starting React
`;
}
