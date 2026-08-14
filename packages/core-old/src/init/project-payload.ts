import type { EntityMeta, InitPayload } from './types';

export interface WorldFile {
  relativePath: string;
  content: string;
}

export function projectPayload(payload: InitPayload): WorldFile[] {
  const files: WorldFile[] = [
    {
      relativePath: 'manifest.yaml',
      content: [
        `id: ${payload.manifest.id}`,
        `protocol_version: "0.0.0"`,
        `created_at: ${new Date().toISOString()}`,
        `title: ${yamlString(payload.manifest.title)}`,
        '',
      ].join('\n'),
    },
    { relativePath: 'canon/premise.md', content: payload.canon['premise.md'] },
    { relativePath: 'canon/rules.md', content: payload.canon['rules.md'] },
    { relativePath: 'canon/style.md', content: payload.canon['style.md'] },
    { relativePath: 'canon/user_role.md', content: payload.canon['user_role.md'] },
    { relativePath: 'state/world.yaml', content: payload.state['world.yaml'] },
    {
      relativePath: 'characters/index.yaml',
      content: yamlIdList('characters', payload.characters.map(char => char.id)),
    },
  ];

  if (payload.state['calendar.yaml']) {
    files.push({
      relativePath: 'state/calendar.yaml',
      content: payload.state['calendar.yaml'],
    });
  }

  for (const char of payload.characters) {
    const dir = `characters/${char.id}`;
    files.push(
      { relativePath: `${dir}/profile.md`, content: char.profileMd },
      {
        relativePath: `${dir}/relationships.md`,
        content: char.relationshipsMd ?? '# Relationships\n\n',
      },
      {
        relativePath: `${dir}/meta.yaml`,
        content: entityMetaYaml(char.id, 'character', char.meta),
      },
      { relativePath: `${dir}/memory.md`, content: '' },
      { relativePath: `${dir}/timeline.md`, content: '' }
    );
  }

  if (payload.scenes?.length) {
    files.push({
      relativePath: 'scenes/index.yaml',
      content: yamlIdList('scenes', payload.scenes.map(scene => scene.id)),
    });
    for (const scene of payload.scenes) {
      const dir = `scenes/${scene.id}`;
      files.push(
        { relativePath: `${dir}/profile.md`, content: scene.profileMd },
        {
          relativePath: `${dir}/meta.yaml`,
          content: entityMetaYaml(scene.id, 'scene', scene.meta),
        },
        { relativePath: `${dir}/memory.md`, content: '' },
        { relativePath: `${dir}/triggers.yaml`, content: 'triggers: []\n' },
        { relativePath: `${dir}/timeline.md`, content: '' }
      );
    }
  }

  return files;
}

function yamlIdList(key: string, ids: string[]): string {
  return `${key}:\n${ids.map(id => `  - ${yamlString(id)}`).join('\n')}\n`;
}

function entityMetaYaml(id: string, type: string, meta?: EntityMeta): string {
  const tags = meta?.tags ?? [];
  return [
    `id: ${yamlScalar(id)}`,
    `type: ${type}`,
    `status: ${yamlScalar(meta?.status ?? 'active')}`,
    tags.length ? `tags:\n${tags.map(tag => `  - ${yamlScalar(tag)}`).join('\n')}` : 'tags: []',
    '',
  ].join('\n');
}

function yamlString(value: string): string {
  if (/[:#\n'"]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}
