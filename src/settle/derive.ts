import fs from 'fs';
import path from 'path';
import type { SettlementNarrative, SettlementPatch, SettlementProposal } from './types';

export function buildProgramSettlementProposal(worldRoot: string, day: string, narrative: SettlementNarrative): SettlementProposal {
  return {
    version: 1,
    day,
    summary: narrative.summary.trim(),
    diary: narrative.diary.trim(),
    state_patch: deriveStatePatch(worldRoot, day, narrative.summary),
    next_day_seed: {
      summary: narrative.next_day_seed.summary.trim(),
      suggested_intents: narrative.next_day_seed.suggested_intents.map(value => value.trim()),
      unresolved_threads: readUnresolvedThreads(worldRoot),
    },
  };
}

export function deriveStatePatch(worldRoot: string, day: string, summary: string): SettlementPatch[] {
  const shortTerm = path.join(worldRoot, 'memory', 'short_term.md');
  if (!fs.existsSync(shortTerm)) return [];
  return [{ op: 'append', path: 'memory/short_term.md', content: `## ${day}\n\n${summary.trim()}` }];
}

export function readUnresolvedThreads(worldRoot: string): string[] {
  const filePath = path.join(worldRoot, 'memory', 'unresolved_threads.yaml');
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  if (/^threads:\s*\[\s*\]\s*$/m.test(text)) return [];
  const lines = text.split(/\r?\n/);
  const values: string[] = [];
  for (const line of lines) {
    const id = line.match(/^\s*-\s+id:\s*(.+?)\s*$/)?.[1]?.trim();
    if (id) { values.push(unquote(id)); continue; }
    const scalar = line.match(/^\s*-\s+([^:#][^:#]*)\s*$/)?.[1]?.trim();
    if (scalar) values.push(unquote(scalar));
  }
  return [...new Set(values)];
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
}
