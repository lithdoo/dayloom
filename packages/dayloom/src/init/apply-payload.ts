import fs from 'fs';
import path from 'path';
import { projectPayload } from './project-payload';
import type { InitPayload } from './types';

function writeFileForce(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

export function applyPayload(worldRoot: string, payload: InitPayload): void {
  for (const file of projectPayload(payload)) {
    writeFileForce(path.join(worldRoot, file.relativePath), file.content);
  }
}
