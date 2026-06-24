import type { DailyPlan, WorldFileChange } from './types';

export function projectDailyPlan(plan: DailyPlan, transcript?: string, lastCommittedDay = 'null'): WorldFileChange[] {
  const dayDir = `days/${plan.day}`;
  const files: WorldFileChange[] = [
    { relativePath: `${dayDir}/meta.yaml`, content: [`day: ${plan.day}`, 'phase: planned', `created_at: ${new Date().toISOString()}`, ''].join('\n') },
    { relativePath: `${dayDir}/plan.user.md`, content: `${plan.user_intent.trim()}\n` },
    { relativePath: `${dayDir}/plan.initial.json`, content: `${JSON.stringify(plan, null, 2)}\n` },
    { relativePath: 'current.yaml', content: [`day: ${plan.day}`, 'phase: planned', `last_committed_day: ${lastCommittedDay}`, ''].join('\n') },
  ];
  if (transcript !== undefined) files.push({ relativePath: `${dayDir}/dialogue/plan-transcript.md`, content: transcript });
  return files;
}
