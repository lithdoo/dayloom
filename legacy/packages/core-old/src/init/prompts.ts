import fs from 'fs';
import path from 'path';

const PROMPTS_DIR = path.resolve(__dirname, '../../prompts');

export function loadPrompt(name: string): string {
  const filePath = path.join(PROMPTS_DIR, `${name}.system.md`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Prompt not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}
