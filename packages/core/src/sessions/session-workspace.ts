import type { JsonValue } from '../schemas/common';
import type { TranscriptEntry } from '../schemas/submissions';
import type { SessionWorkspace } from '../types';

/** 不写入正式 archive 的内存 Session workspace。 */
export class MemorySessionWorkspace implements SessionWorkspace {
  private readonly transcript: TranscriptEntry[] = [];
  private checkpoint: JsonValue | null = null;

  async appendTranscript(entry: TranscriptEntry): Promise<void> {
    this.transcript.push(cloneSerializable(entry));
  }

  async writeCheckpoint(value: JsonValue): Promise<void> {
    this.checkpoint = cloneJson(value);
  }

  async readCheckpoint(): Promise<JsonValue | null> {
    return this.checkpoint === null ? null : cloneJson(this.checkpoint);
  }

  /** 返回 transcript 副本，供测试和未来 archive adapter 读取。 */
  getTranscript(): TranscriptEntry[] {
    return this.transcript.map(cloneSerializable);
  }
}

/** 创建隔离的内存 Session workspace。 */
export function createMemorySessionWorkspace(): MemorySessionWorkspace {
  return new MemorySessionWorkspace();
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
