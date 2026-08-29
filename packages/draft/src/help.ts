import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function packageVersionV1(): string {
  const metadata = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version?: unknown };
  if (typeof metadata.version !== 'string' || metadata.version.trim() === '') {
    throw new Error('Invalid @dayloom/draft package version.');
  }
  return metadata.version;
}

export function helpTextV1(): string {
  return `Usage: dayloom-draft [command] [options]

Interactive Draft primitive: one user message, one Promptpile React turn.

Commands (optional):
  init | plan | play | revise
  Omitted command is inferred only when exactly one of these is available.

Options:
  --world <dir>                         World directory (required)
  --draft <file>                        Repeatable Draft file set (mutually exclusive with --draft-dir)
  --draft-dir <dir>                     Draft directory subtree
  --conversation <dir>                  Promptpile Conversation directory (required)
  --llm-config <file>                   Promptpile LLM config (required)
  --message <text>                      User message to append (required)
  --output-format <terminal|stream-json>
                                        Native Promptpile React output; default terminal
  --help                                Show this help
  --version                             Show version
`;
}
