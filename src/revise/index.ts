import { applyChanges, describeChanges } from './apply-payload';
import { reviseWorldInteractive } from './dialogue-loop';
import { assertInitializedWorld, resolveWorldRoot } from './guard';
import { readRevisePayload } from './parse-payload';
import { projectRevisePayload } from './project-payload';
import type { ReviseOptions } from './types';
import { validateRevisePayload } from './validate-payload';

export interface ReviseWorldResult { worldRoot: string; description: string; revisionId?: string; }

export function reviseWorldFromProposal(dir: string, proposalPath: string, options: ReviseOptions = {}): ReviseWorldResult {
  const worldRoot = resolveWorldRoot(dir);
  assertInitializedWorld(worldRoot);
  const payload = readRevisePayload(proposalPath);
  validateRevisePayload(payload);
  const changes = projectRevisePayload(payload, worldRoot);
  const description = describeChanges(worldRoot, changes);
  if (options.dryRun) return { worldRoot, description };
  if (!options.yes) throw new Error('Applying a revision requires --yes. Use --dry-run to inspect changes.');
  return { worldRoot, description, revisionId: applyChanges(worldRoot, payload, changes) };
}

export { reviseWorldInteractive };
