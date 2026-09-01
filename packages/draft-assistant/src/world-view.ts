import path from 'node:path';
import { materializeWorkspaceV1, type PublishedHeadV1 } from '@dayloom/cli';

export async function materializeWorldViewV1(input: {
  archiveRoot: string;
  head: PublishedHeadV1;
  operationRoot: string;
}): Promise<string> {
  const worldViewRoot = path.join(input.operationRoot, 'world-view');
  await materializeWorkspaceV1({ worldRoot: input.archiveRoot, tree: input.head.tree, workspaceRoot: worldViewRoot });
  return worldViewRoot;
}
