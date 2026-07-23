import path from 'path';
import type { CoreFileSystem } from '../infrastructure/filesystem';
import type { JsonValue } from '../schemas/common';
import type { TranscriptEntry } from '../schemas/submissions';
import { validateTranscriptEntries } from '../schemas/validators';
import type { SessionWorkspace } from '../sessions/types';
import { writeJson } from './atomic-file';

/** Archive operation 内持久化 checkpoint/transcript 的 SessionWorkspace。 */
export class ArchiveSessionWorkspace implements SessionWorkspace {
  constructor(
    private readonly filesystem: CoreFileSystem,
    private readonly root: string,
  ) {}

  async appendTranscript(entry: TranscriptEntry): Promise<void> {
    const entries = await this.readTranscript();
    validateTranscriptEntries([...entries, entry]);
    const target = path.join(this.root, 'transcript.jsonl');
    const previous = entries.map((item) => JSON.stringify(item)).join('\n');
    const next = `${previous}${previous ? '\n' : ''}${JSON.stringify(entry)}\n`;
    await this.filesystem.writeText(target, next, { overwrite: true });
  }

  async writeCheckpoint(value: JsonValue): Promise<void> {
    await writeJson(this.filesystem, path.join(this.root, 'checkpoint.json'), value, true);
  }

  async readCheckpoint(): Promise<JsonValue | null> {
    const target = path.join(this.root, 'checkpoint.json');
    if (!(await this.filesystem.exists(target))) return null;
    return JSON.parse(await this.filesystem.readText(target)) as JsonValue;
  }

  private async readTranscript(): Promise<TranscriptEntry[]> {
    const target = path.join(this.root, 'transcript.jsonl');
    if (!(await this.filesystem.exists(target))) return [];
    const entries = (await this.filesystem.readText(target))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return validateTranscriptEntries(entries);
  }
}
