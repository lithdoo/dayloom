import fs from 'fs';
import path from 'path';

export function resolveWorldRoot(dir: string): string {
  return path.resolve(dir);
}

export function assertInitializedWorld(worldRoot: string): void {
  if (!fs.existsSync(path.join(worldRoot, 'manifest.yaml'))) {
    throw new Error(`World save is not initialized: ${worldRoot}`);
  }
}
