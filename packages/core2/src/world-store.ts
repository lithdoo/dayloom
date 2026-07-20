import fs from 'fs';
import path from 'path';
import type { WorldPhase, WorldSnapshot } from './types';

/** Core2 原生 init payload。 */
export interface Core2InitPayload {
  /** world id。 */
  id: string;

  /** world 标题。 */
  title: string;

  /** 世界前提。 */
  premise?: string;

  /** 叙事规则。 */
  rules?: string;

  /** 文风说明。 */
  style?: string;

  /** 玩家角色说明。 */
  userRole?: string;
}

/** Core2 原生 planning payload。 */
export interface Core2PlanningPayload {
  /** day id。 */
  day: string;

  /** 用户意图。 */
  intent: string;

  /** 计划 beat。 */
  beats: Array<{
    /** beat id。 */
    id: string;

    /** beat 意图。 */
    intent: string;
  }>;
}

/** Core2 原生 revise payload。 */
export interface Core2RevisePayload {
  /** 修订摘要。 */
  summary: string;

  /** 要写入的文档片段。 */
  documents: Array<{
    /** 相对 worldRoot 的安全路径。 */
    path: string;

    /** 文件内容。 */
    content: string;
  }>;
}

/** Core2 world 文件仓库。 */
export class WorldStore {
  /** world 根目录。 */
  readonly worldRoot: string;

  constructor(worldRoot: string) {
    this.worldRoot = worldRoot;
  }

  /** 从 core2 原生文件读取最小 world 快照；无法识别时返回 invalid。 */
  readSnapshot(): WorldSnapshot {
    const manifestPath = path.join(this.worldRoot, 'manifest.json');
    const currentPath = path.join(this.worldRoot, 'current.json');
    const manifestExists = fs.existsSync(manifestPath);
    const currentExists = fs.existsSync(currentPath);

    if (!manifestExists && !currentExists) {
      return this.createSnapshot({
        phase: 'uninitialized',
        day: null,
        initialized: false,
        invalidReason: null,
      });
    }

    if (!manifestExists || !currentExists) {
      return this.invalidSnapshot('World manifest/current files are incomplete.');
    }

    try {
      const current = readJsonObject(currentPath);
      const phase = readPhase(current.phase);
      const day = current.day === null || typeof current.day === 'string' ? current.day : null;
      return this.createSnapshot({
        phase,
        day,
        initialized: phase !== 'uninitialized' && phase !== 'invalid',
        invalidReason: phase === 'invalid' ? 'World current phase is invalid.' : null,
      });
    } catch (error) {
      return this.invalidSnapshot(error instanceof Error ? error.message : String(error));
    }
  }

  /** 初始化 core2 原生 world 文件。 */
  initialize(payload: Core2InitPayload): void {
    if (fs.existsSync(path.join(this.worldRoot, 'manifest.json'))) {
      throw new Error(`World already initialized: ${this.worldRoot}`);
    }
    writeJson(path.join(this.worldRoot, 'manifest.json'), {
      version: 1,
      id: payload.id,
      title: payload.title,
      createdAt: new Date().toISOString(),
    });
    writeJson(path.join(this.worldRoot, 'current.json'), {
      day: null,
      phase: 'idle',
      lastCommittedDay: null,
    });
    writeText(path.join(this.worldRoot, 'canon', 'premise.md'), payload.premise ?? '');
    writeText(path.join(this.worldRoot, 'canon', 'rules.md'), payload.rules ?? '');
    writeText(path.join(this.worldRoot, 'canon', 'style.md'), payload.style ?? '');
    writeText(path.join(this.worldRoot, 'canon', 'user-role.md'), payload.userRole ?? '');
    appendJsonl(path.join(this.worldRoot, 'logs', 'state-changes.jsonl'), {
      type: 'world_initialized',
      id: payload.id,
      title: payload.title,
    });
  }

  /** 写入 core2 原生 daily plan。 */
  writePlan(payload: Core2PlanningPayload): void {
    const dayRoot = path.join(this.worldRoot, 'days', payload.day);
    writeJson(path.join(dayRoot, 'plan.initial.json'), payload);
    writeJson(path.join(dayRoot, 'meta.json'), {
      day: payload.day,
      phase: 'planned',
    });
    writeJson(path.join(this.worldRoot, 'current.json'), {
      day: payload.day,
      phase: 'planned',
      lastCommittedDay: null,
    });
    appendJsonl(path.join(this.worldRoot, 'logs', 'state-changes.jsonl'), {
      type: 'daily_plan_created',
      day: payload.day,
      beats: payload.beats.map((beat) => beat.id),
    });
  }

  /** 应用 core2 原生 revise payload。 */
  applyRevision(payload: Core2RevisePayload): void {
    for (const document of payload.documents) {
      const target = resolveSafePath(this.worldRoot, document.path);
      writeText(target, document.content);
    }
    appendJsonl(path.join(this.worldRoot, 'logs', 'state-changes.jsonl'), {
      type: 'world_revision',
      summary: payload.summary,
      changedFiles: payload.documents.map((document) => document.path),
    });
  }

  /** 结算当前 day，并推进到下一天 idle。 */
  settleDay(day: string): { nextDay: string } {
    const nextDay = nextDayId(day);
    writeJson(path.join(this.worldRoot, 'days', day, 'meta.json'), {
      day,
      phase: 'settled',
      settledAt: new Date().toISOString(),
    });
    writeJson(path.join(this.worldRoot, 'current.json'), {
      day: nextDay,
      phase: 'idle',
      lastCommittedDay: day,
    });
    appendJsonl(path.join(this.worldRoot, 'logs', 'state-changes.jsonl'), {
      type: 'day_settled',
      day,
      nextDay,
    });
    return { nextDay };
  }

  /** 放弃当前 day，使它不再被 current 指针引用。 */
  abandonDay(day: string): { previousDay: string | null } {
    const previousDay = previousDayId(day);
    writeJson(path.join(this.worldRoot, 'days', day, 'abandoned.json'), {
      day,
      abandonedAt: new Date().toISOString(),
    });
    writeJson(path.join(this.worldRoot, 'current.json'), {
      day: previousDay,
      phase: 'idle',
      lastCommittedDay: previousDay,
    });
    appendJsonl(path.join(this.worldRoot, 'logs', 'state-changes.jsonl'), {
      type: 'day_abandoned',
      day,
      previousDay,
    });
    return { previousDay };
  }

  private createSnapshot(snapshot: Omit<WorldSnapshot, 'worldRoot'>): WorldSnapshot {
    return {
      worldRoot: this.worldRoot,
      ...snapshot,
    };
  }

  private invalidSnapshot(reason: string): WorldSnapshot {
    return this.createSnapshot({
      phase: 'invalid',
      day: null,
      initialized: false,
      invalidReason: reason,
    });
  }
}

function readJsonObject(filePath: string): Record<string, unknown> {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`JSON file must contain an object: ${filePath}`);
  }
  return parsed as Record<string, unknown>;
}

function readPhase(value: unknown): WorldPhase {
  if (isWorldPhase(value)) {
    return value;
  }
  throw new Error(`Unknown world phase: ${String(value)}`);
}

function isWorldPhase(value: unknown): value is WorldPhase {
  return (
    value === 'uninitialized' ||
    value === 'initializing' ||
    value === 'idle' ||
    value === 'planning' ||
    value === 'planned' ||
    value === 'playing' ||
    value === 'awaiting-settle' ||
    value === 'revising' ||
    value === 'invalid'
  );
}

function writeJson(filePath: string, value: unknown): void {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function appendJsonl(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

function resolveSafePath(root: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Revision path must be relative: ${relativePath}`);
  }
  const resolved = path.resolve(root, relativePath);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
    throw new Error(`Revision path escapes world root: ${relativePath}`);
  }
  return resolved;
}

function nextDayId(day: string): string {
  const match = /^day_(\d+)$/.exec(day);
  if (!match) {
    throw new Error(`Cannot derive next day from id: ${day}`);
  }
  const width = match[1].length;
  const next = String(Number(match[1]) + 1).padStart(width, '0');
  return `day_${next}`;
}

function previousDayId(day: string): string | null {
  const match = /^day_(\d+)$/.exec(day);
  if (!match) {
    throw new Error(`Cannot derive previous day from id: ${day}`);
  }
  const previous = Number(match[1]) - 1;
  if (previous <= 0) {
    return null;
  }
  return `day_${String(previous).padStart(match[1].length, '0')}`;
}
