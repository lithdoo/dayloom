import fs from 'fs';
import type { InitSession } from './types';

export function cleanupSession(session: InitSession): void {
  if (fs.existsSync(session.root)) {
    fs.rmSync(session.root, { recursive: true, force: true });
  }
}
