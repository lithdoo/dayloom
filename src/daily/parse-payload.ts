import fs from 'fs';
import type { DailyPlan } from './types';

export function readDailyPlan(filePath: string): DailyPlan {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as DailyPlan;
}
