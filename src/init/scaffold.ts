import fs from 'fs';
import path from 'path';
import { PROTOCOL_VERSION } from './constants';

function writeFileIfMissing(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) {
    throw new Error(`Refusing to overwrite existing file: ${filePath}`);
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export interface ScaffoldMeta {
  id: string;
  title: string;
  createdAt?: string;
}

export function scaffoldEmptyWorld(
  worldRoot: string,
  meta: ScaffoldMeta
): void {
  const createdAt = meta.createdAt ?? new Date().toISOString();

  ensureDir(worldRoot);

  const files: Array<[string, string]> = [
    [
      'manifest.yaml',
      [
        `id: ${meta.id}`,
        `protocol_version: "${PROTOCOL_VERSION}"`,
        `created_at: ${createdAt}`,
        `title: ${meta.title}`,
        '',
      ].join('\n'),
    ],
    [
      'current.yaml',
      ['day: day_0001', 'phase: idle', 'last_committed_day: null', ''].join('\n'),
    ],
    ['config.yaml', '# day-loom runtime config\n\n'],
    ['canon/premise.md', ''],
    ['canon/rules.md', ''],
    ['canon/style.md', ''],
    ['canon/user_role.md', ''],
    ['state/world.yaml', 'title: ""\n'],
    ['state/calendar.yaml', 'current_day: day_0001\n'],
    ['state/progress.yaml', 'arcs_active: []\n'],
    ['state/variables.yaml', 'variables: {}\n'],
    ['characters/index.yaml', 'characters: []\n'],
    ['scenes/index.yaml', 'scenes: []\n'],
    ['arcs/index.yaml', 'arcs: []\n'],
    ['memory/short_term.md', ''],
    ['memory/long_term.md', ''],
    ['memory/facts.yaml', 'facts: []\n'],
    ['memory/unresolved_threads.yaml', 'threads: []\n'],
    ['memory/important_events.yaml', 'events: []\n'],
    ['logs/state_changes.jsonl', ''],
    ['logs/generation_trace.md', ''],
    ['logs/errors.md', ''],
  ];

  for (const [rel, content] of files) {
    const filePath = path.join(worldRoot, rel);
    ensureDir(path.dirname(filePath));
    writeFileIfMissing(filePath, content);
  }

  ensureDir(path.join(worldRoot, 'days'));
  ensureDir(path.join(worldRoot, 'exports', 'diaries'));
  ensureDir(path.join(worldRoot, 'exports', 'summaries'));
}
