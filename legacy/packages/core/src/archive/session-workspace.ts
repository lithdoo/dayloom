import path from 'path';
import type { CoreFileSystem } from '../infrastructure/filesystem';
import type { JsonValue } from '../schemas/common';
import type { TranscriptEntry } from '../schemas/submissions';
import { validateTranscriptEntries } from '../schemas/validators';
import type { SessionWorkspace } from '../sessions/types';
import { encodeJson, writeAtomicText } from './atomic-file';

/** Archive operation 内持久化 checkpoint/transcript 的 SessionWorkspace。 */
export class ArchiveSessionWorkspace implements SessionWorkspace {
  constructor(
    private readonly filesystem: CoreFileSystem,
    private readonly root: string,
    private readonly archiveRoot?: string,
  ) {}

  async appendTranscript(entry: TranscriptEntry): Promise<void> {
    const entries = await this.readTranscript();
    validateTranscriptEntries([...entries, entry]);
    const target = path.join(this.root, 'transcript.jsonl');
    await this.assertPhysicalPath(target);
    await this.assertPhysicalPath(`${target}.tmp`);
    const previous = entries.map((item) => JSON.stringify(item)).join('\n');
    const next = `${previous}${previous ? '\n' : ''}${JSON.stringify(entry)}\n`;
    await writeAtomicText(this.filesystem, target, `${target}.tmp`, next);
  }

  async writeCheckpoint(value: JsonValue): Promise<void> {
    const target = path.join(this.root, 'checkpoint.json');
    await this.assertPhysicalPath(target);
    await this.assertPhysicalPath(`${target}.tmp`);
    await writeAtomicText(this.filesystem, target, `${target}.tmp`, encodeJson(value));
  }

  async readCheckpoint(): Promise<JsonValue | null> {
    const target = path.join(this.root, 'checkpoint.json');
    if (!(await this.filesystem.exists(target))) return null;
    await this.assertPhysicalPath(target);
    return JSON.parse(await this.filesystem.readText(target)) as JsonValue;
  }

  private async readTranscript(): Promise<TranscriptEntry[]> {
    const target = path.join(this.root, 'transcript.jsonl');
    if (!(await this.filesystem.exists(target))) return [];
    await this.assertPhysicalPath(target);
    const entries = (await this.filesystem.readText(target))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return validateTranscriptEntries(entries);
  }

  private async assertPhysicalPath(target: string): Promise<void> {
    if (!this.archiveRoot) return;
    const root = await this.filesystem.realPath(this.archiveRoot);
    let existing = target;
    while (!(await this.filesystem.exists(existing))) existing = path.dirname(existing);
    const physical = await this.filesystem.realPath(existing);
    const relative = path.relative(root, physical);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Session workspace resolves outside the archive root.');
    }
  }
}
