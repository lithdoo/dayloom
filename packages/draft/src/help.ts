import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DraftCommandV1 } from './argv.js';

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

export function commandAppendixV1(command: DraftCommandV1): string {
  if (command === 'init') {
    return `INIT: capture the user's intended initial World. Draft the premise, rules, tone, user role, and any starting entities as semantic notes. Do not emit Archive files, Patch JSON, or a mutation plan.`;
  }
  if (command === 'plan') {
    return `PLAN: capture the user's intent for the next day. Draft goals, scenes, beats, and constraints. Do not write days/** or control files.`;
  }
  if (command === 'play') {
    return `PLAY: capture the user's play of the current day. Draft what happened, dialogue, choices, and unresolved threads. Do not write event YAML or settlement records.`;
  }
  return `REVISE: capture the user's intended long-term World revisions. Draft which canon, entities, or memory should change. Do not edit profile/**, days/**, or Archive protocol files.`;
}
