import fs from 'fs';
import path from 'path';
import type { SettlementProposal, WorldFileChange } from './types';

export function projectSettlement(worldRoot: string, proposal: SettlementProposal, nextDay: string, committedAt: string): WorldFileChange[] {
  const dayDir = `days/${proposal.day}`;
  const changes: WorldFileChange[] = [
    { relativePath: `${dayDir}/summary.md`, content: ensureNewline(proposal.summary) },
    { relativePath: `${dayDir}/ending/objective_summary.md`, content: ensureNewline(proposal.summary) },
    { relativePath: `${dayDir}/ending/diary.md`, content: ensureNewline(proposal.diary) },
    { relativePath: `${dayDir}/ending/state_patch.json`, content: json(proposal.state_patch) },
    { relativePath: `${dayDir}/ending/next_day_seed.json`, content: json(proposal.next_day_seed) },
    { relativePath: `${dayDir}/ending/settlement.json`, content: json(proposal) },
  ];

  for (const patch of proposal.state_patch) {
    const existing = fs.readFileSync(path.join(worldRoot, patch.path), 'utf8');
    changes.push({
      relativePath: patch.path,
      content: patch.op === 'replace' ? ensureNewline(patch.content) : appendContent(existing, patch.content),
    });
  }

  const logPath = path.join(worldRoot, 'logs', 'state_changes.jsonl');
  const existingLog = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  changes.push({
    relativePath: 'logs/state_changes.jsonl',
    content: `${existingLog}${JSON.stringify({ type: 'day_settled', day: proposal.day, next_day: nextDay, summary: proposal.summary })}\n`,
  });
  changes.push({
    relativePath: `${dayDir}/meta.yaml`,
    content: updateDayMeta(fs.readFileSync(path.join(worldRoot, dayDir, 'meta.yaml'), 'utf8'), committedAt),
  });
  changes.push({
    relativePath: `${dayDir}/ending/settle.state.json`,
    content: json({ version: 1, day: proposal.day, status: 'committed', next_day: nextDay, committed_at: committedAt }),
  });
  changes.push({ relativePath: 'current.yaml', content: [`day: ${nextDay}`, 'phase: idle', `last_committed_day: ${proposal.day}`, ''].join('\n') });
  return changes;
}

export function describeSettlementChanges(worldRoot: string, changes: WorldFileChange[]): string {
  return changes.map(change => `${fs.existsSync(path.join(worldRoot, change.relativePath)) ? 'update' : 'create'} ${change.relativePath}`).join('\n');
}

function appendContent(existing: string, addition: string): string {
  const base = existing.replace(/\s+$/, '');
  const next = addition.trim();
  return base ? `${base}\n\n${next}\n` : `${next}\n`;
}

function updateDayMeta(text: string, committedAt: string): string {
  let next = /^phase:/m.test(text) ? text.replace(/^phase:.*$/m, 'phase: settled') : `${text.replace(/\s*$/, '')}\nphase: settled\n`;
  next = /^settled_at:/m.test(next) ? next.replace(/^settled_at:.*$/m, `settled_at: ${committedAt}`) : `${next.replace(/\s*$/, '')}\nsettled_at: ${committedAt}\n`;
  return next;
}

function ensureNewline(value: string): string { return `${value.trim()}\n`; }
function json(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }
