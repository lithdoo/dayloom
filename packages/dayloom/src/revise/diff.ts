import fs from 'fs';
import path from 'path';
import type { WorldFileChange } from './types';

export function buildUnifiedDiff(worldRoot: string, changes: WorldFileChange[]): string {
  return changes.map(change => {
    const filePath = path.join(worldRoot, change.relativePath);
    const before = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    if (before === change.content) return '';
    return [
      `--- a/${change.relativePath}`,
      `+++ b/${change.relativePath}`,
      '@@',
      ...before.split('\n').filter((_, i, arr) => i < arr.length - 1 || arr[i] !== '').map(line => `-${line}`),
      ...change.content.split('\n').filter((_, i, arr) => i < arr.length - 1 || arr[i] !== '').map(line => `+${line}`),
      '',
    ].join('\n');
  }).filter(Boolean).join('\n');
}
