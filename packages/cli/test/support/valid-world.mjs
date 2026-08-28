import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const encoder = new TextEncoder();

export function validWorldFiles(title, overrides = {}) {
  const text = {
    'profile/dayloom.json': '{"schemaVersion":1,"profile":"dayloom","profileVersion":1}\n',
    'canon/premise.md': '# Premise\n',
    'canon/rules.md': '# Rules\n',
    'canon/style.md': '# Style\n',
    'canon/user-role.md': '# User role\n',
    'characters/index.yaml': 'schemaVersion: 1\nids: []\n',
    'locations/index.yaml': 'schemaVersion: 1\nids: []\n',
    'arcs/index.yaml': 'schemaVersion: 1\nids: []\n',
    'state/world.yaml': `schemaVersion: 1\ntitle: ${title}\nstatus: active\n`,
    'state/calendar.yaml': 'schemaVersion: 1\ncurrentDay: null\nelapsed: null\n',
    'state/progress.yaml': 'schemaVersion: 1\nactiveArcIds: []\n',
    'state/variables.yaml': 'schemaVersion: 1\nvariables: {}\n',
    'memory/short-term.md': '# Short-term memory\n',
    'memory/long-term.md': '# Long-term memory\n',
    'memory/facts.yaml': 'schemaVersion: 1\nfacts: []\n',
    'memory/unresolved-threads.yaml': 'schemaVersion: 1\nthreads: []\n',
    'memory/important-events.yaml': 'schemaVersion: 1\nevents: []\n',
    'story-seeds/active.yaml': 'schemaVersion: 1\nseeds: []\n',
    ...overrides,
  };
  return new Map(Object.entries(text).map(([documentPath, value]) => [documentPath, encoder.encode(value)]));
}

export async function writeWorldFiles(root, files) {
  for (const [documentPath, bytes] of files) {
    const target = path.join(root, ...documentPath.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}
