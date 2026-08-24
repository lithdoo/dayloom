import type { PlanningSubmissionV2 } from '../../session/submission-v2';
import type { WorldChange } from '../publish';
import { jsonDocument, markdown, yamlDocument } from './encode';

export function buildPlanningMutationV1(day: string, submission: PlanningSubmissionV2): WorldChange[] {
  const ids = new Map(submission.beats.map((beat, index) => [beat.key, `beat${index + 1}`]));
  return [
    jsonDocument(`days/${day}/plan.json`, { version: 1, intent: submission.intent, knownContext: submission.knownContext, constraints: submission.constraints, openQuestions: submission.openQuestions, maxEvents: submission.maxEvents, beats: submission.beats.map((beat) => ({ id: ids.get(beat.key)!, intent: beat.intent, priority: beat.priority, dependsOn: beat.dependsOn.map((key) => ids.get(key)!) })) }),
    markdown(`days/${day}/timeline.md`, ''), markdown(`days/${day}/dialogue/planning.md`, ''), yamlDocument(`days/${day}/events/index.yaml`, { schemaVersion: 1, ids: [] }),
  ];
}
