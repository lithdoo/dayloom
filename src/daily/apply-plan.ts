import fs from 'fs';
import path from 'path';
import type { DailyPlan, WorldFileChange } from './types';

export function describeChanges(worldRoot: string, changes: WorldFileChange[]): string {
  return changes.map(change => `${fs.existsSync(path.join(worldRoot, change.relativePath)) ? 'update' : 'create'} ${change.relativePath}`).join('\n');
}

export function applyDailyPlan(worldRoot: string, plan: DailyPlan, changes: WorldFileChange[]): void {
  for (const change of changes) {
    const filePath = path.join(worldRoot, change.relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, change.content, 'utf8');
  }
  appendStateChange(worldRoot, { type: 'daily_plan_created', day: plan.day, summary: plan.user_intent, beats: plan.planned_beats.map(beat => beat.id) });
}

function appendStateChange(worldRoot: string, entry: object): void {
  const logPath = path.join(worldRoot, 'logs', 'state_changes.jsonl');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
}
