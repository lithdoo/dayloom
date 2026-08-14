import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const protocol = require('@dayloom/archive-protocol');
const root = path.resolve(process.argv[2] ?? '');

if (!process.argv[2]) throw new Error('World directory argument is required.');

await mkdir(root, { recursive: true });
const existing = await readdir(root);
if (existing.includes('manifest.json')) process.exit(0);
if (existing.length !== 0) {
  throw new Error(`Refusing to initialize a non-empty World directory: ${root}`);
}

const documents = new Map([
  ['canon/premise.md', Buffer.from('A new world waiting to be explored.\n')],
  ['canon/rules.md', Buffer.from('Keep the world coherent and respond to the player naturally.\n')],
  ['canon/style.md', Buffer.from('Write clear, vivid, and concise prose.\n')],
  ['canon/user-role.md', Buffer.from('The user plays the protagonist.\n')],
  ['days/day1/plan.json', Buffer.from(`${JSON.stringify({
    intent: 'Begin the story',
    beats: [{ id: 'beat1', intent: 'Introduce the world and invite the first action' }],
  }, null, 2)}\n`)],
]);

async function write(relativePath, data) {
  const target = path.join(root, ...relativePath.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, data);
}

const entries = [];
for (const [documentPath, bytes] of documents) {
  const blobHash = protocol.hashBlobV1(bytes);
  await write(protocol.formatBlobObjectPathV1(blobHash), bytes);
  entries.push({
    path: documentPath,
    blobHash,
    mediaType: documentPath.endsWith('.json') ? 'application/json' : 'text/markdown',
    bytes: bytes.length,
  });
}

const tree = protocol.createRootTreeV1(entries);
const rootTreeHash = protocol.hashRootTreeV1(tree);
await write(protocol.formatTreeObjectPathV1(rootTreeHash), protocol.encodeRootTreeCanonicalV1(tree));

const createdAt = new Date().toISOString();
const commit = protocol.parseArchiveCommitV2({
  schemaVersion: 2,
  id: 'commit_initial',
  revision: 1,
  parentCommitId: null,
  operationId: 'op_initial',
  createdAt,
  rootTreeHash,
  control: { phase: 'planned', day: 'day1', lastSettledDay: null },
});

await write(protocol.formatCommitObjectPathV2(commit.id), `${JSON.stringify(commit, null, 2)}\n`);
await write('manifest.json', `${JSON.stringify({
  schemaVersion: 2,
  worldId: 'world_default',
  title: 'Default World',
  createdAt,
}, null, 2)}\n`);
await write('current.json', `${JSON.stringify({
  schemaVersion: 2,
  revision: 1,
  commitId: commit.id,
  updatedAt: createdAt,
}, null, 2)}\n`);

console.log(`Initialized default World: ${root}`);
