import fs from 'fs';
import type { RevisePayload } from './types';

export function readRevisePayload(filePath: string): RevisePayload {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(
      `Failed to read revise proposal: ${err instanceof Error ? err.message : err}`
    );
  }

  try {
    return JSON.parse(raw) as RevisePayload;
  } catch (err) {
    throw new Error(
      `Failed to parse revise proposal JSON: ${err instanceof Error ? err.message : err}`
    );
  }
}
