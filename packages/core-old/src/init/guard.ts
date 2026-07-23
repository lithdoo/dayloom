import fs from 'fs';
import path from 'path';

export function resolveWorldRoot(dir: string): string {
  return path.resolve(dir);
}

export function isInitialized(worldRoot: string): boolean {
  return fs.existsSync(path.join(worldRoot, 'manifest.yaml'));
}

export function assertNotInitialized(worldRoot: string): void {
  if (isInitialized(worldRoot)) {
    throw new Error(
      `World save already initialized: ${worldRoot} (manifest.yaml exists)`
    );
  }
}

export function assertApiKey(): void {
  if (!process.env.DEEPSEEK_API_KEY?.trim()) {
    throw new Error(
      'DEEPSEEK_API_KEY is not set. Interactive init requires an API key.'
    );
  }
}

export function ensureWorldRootParent(worldRoot: string): void {
  fs.mkdirSync(path.dirname(worldRoot), { recursive: true });
}
