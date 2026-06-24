import fs from 'fs';
import path from 'path';
import type { InitSession } from './types';

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export function archiveTranscript(
  session: InitSession,
  worldRoot: string
): void {
  const dest = path.join(worldRoot, '.loom', 'init-transcript');
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  copyDir(session.root, dest);
}
