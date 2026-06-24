import fs from 'fs';
import path from 'path';
import type { EntityMeta, RevisePayload, WorldFileChange } from './types';

export function projectRevisePayload(payload: RevisePayload, worldRoot?: string): WorldFileChange[] {
  const changes = new Map<string, WorldFileChange>();
  const characterIds = new Set(readIndexIds(worldRoot, 'characters'));
  const sceneIds = new Set(readIndexIds(worldRoot, 'scenes'));
  const put = (relativePath: string, content: string): void => { changes.set(relativePath, { relativePath, content }); };
  const putIfMissing = (relativePath: string, content: string): void => {
    if (!worldRoot || !fs.existsSync(path.join(worldRoot, relativePath))) put(relativePath, content);
  };

  for (const operation of payload.operations) {
    if (operation.op === 'replace_canon') {
      put(`canon/${operation.section}.md`, operation.content);
    } else if (operation.op === 'upsert_character') {
      characterIds.add(operation.id);
      const dir = `characters/${operation.id}`;
      put(`${dir}/profile.md`, operation.profileMd);
      if (operation.relationshipsMd !== undefined) put(`${dir}/relationships.md`, operation.relationshipsMd);
      else putIfMissing(`${dir}/relationships.md`, '# Relationships\n\n');
      put(`${dir}/meta.yaml`, entityMetaYaml(operation.id, 'character', operation.meta));
      putIfMissing(`${dir}/memory.md`, '');
      putIfMissing(`${dir}/timeline.md`, '');
    } else if (operation.op === 'upsert_scene') {
      sceneIds.add(operation.id);
      const dir = `scenes/${operation.id}`;
      put(`${dir}/profile.md`, operation.profileMd);
      put(`${dir}/meta.yaml`, entityMetaYaml(operation.id, 'scene', operation.meta));
      putIfMissing(`${dir}/memory.md`, '');
      putIfMissing(`${dir}/triggers.yaml`, 'triggers: []\n');
      putIfMissing(`${dir}/timeline.md`, '');
    }
  }
  if ([...payload.operations].some(op => op.op === 'upsert_character')) put('characters/index.yaml', yamlIdList('characters', [...characterIds]));
  if ([...payload.operations].some(op => op.op === 'upsert_scene')) put('scenes/index.yaml', yamlIdList('scenes', [...sceneIds]));
  return [...changes.values()];
}

function readIndexIds(worldRoot: string | undefined, key: string): string[] {
  if (!worldRoot) return [];
  const filePath = path.join(worldRoot, key, 'index.yaml');
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).map(line => line.match(/^\s*-\s+(.+?)\s*$/)?.[1]).filter((id): id is string => Boolean(id)).map(id => id.replace(/^['"]|['"]$/g, ''));
}

function yamlIdList(key: string, ids: string[]): string { return `${key}:\n${ids.map(id => `  - ${JSON.stringify(id)}`).join('\n')}\n`; }
function entityMetaYaml(id: string, type: string, meta?: EntityMeta): string {
  const tags = meta?.tags ?? [];
  return [`id: ${JSON.stringify(id)}`, `type: ${type}`, `status: ${JSON.stringify(meta?.status ?? 'active')}`, tags.length ? `tags:\n${tags.map(tag => `  - ${JSON.stringify(tag)}`).join('\n')}` : 'tags: []', ''].join('\n');
}
