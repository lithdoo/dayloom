import path from 'node:path';
import { materializePublishedTreeV1, type PublishedHeadV1 } from './world.js';

export async function materializeWorldViewV1(input: {
  archiveRoot: string;
  head: PublishedHeadV1;
  operationRoot: string;
}): Promise<string> {
  const worldViewRoot = path.join(input.operationRoot, 'world-view');
  await materializePublishedTreeV1({ worldRoot: input.archiveRoot, tree: input.head.tree, targetRoot: worldViewRoot });
  return worldViewRoot;
}
