import type { PlayPlanV0 } from '../world/read';
import { exact, isRecord } from '../world/read';

export interface PlaySubmissionV1 {
  version: 1; summary: string;
  beats: Array<{ id: string; status: 'pending' | 'completed' | 'skipped'; eventId: string | null }>;
  events: Array<{ id: string; beatId: string | null; userInput: string; assistantOutput: string }>;
}
export interface PlayDocuments { play: Uint8Array; summary: Uint8Array }

function nonempty(value: unknown): value is string { return typeof value === 'string' && value.trim() !== ''; }
function nullableId(value: unknown): value is string | null { return value === null || nonempty(value); }
export function parsePlaySubmissionV1(text: string): PlaySubmissionV1 {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('Submission is not valid JSON.'); }
  if (!isRecord(value) || !exact(value, ['version', 'summary', 'beats', 'events']) || value.version !== 1 || !nonempty(value.summary) || !Array.isArray(value.beats) || !Array.isArray(value.events)) throw new Error('PlaySubmissionV1 is invalid.');
  const beats = value.beats.map((item) => {
    if (!isRecord(item) || !exact(item, ['id', 'status', 'eventId']) || !nonempty(item.id) || !['pending', 'completed', 'skipped'].includes(item.status as string) || !nullableId(item.eventId)) throw new Error('PlaySubmissionV1 beat is invalid.');
    return { id: item.id, status: item.status as PlaySubmissionV1['beats'][number]['status'], eventId: item.eventId };
  });
  const events = value.events.map((item) => {
    if (!isRecord(item) || !exact(item, ['id', 'beatId', 'userInput', 'assistantOutput']) || !nonempty(item.id) || !nullableId(item.beatId) || !nonempty(item.userInput) || !nonempty(item.assistantOutput)) throw new Error('PlaySubmissionV1 event is invalid.');
    return { id: item.id, beatId: item.beatId, userInput: item.userInput, assistantOutput: item.assistantOutput };
  });
  return { version: 1, summary: value.summary, beats, events };
}

export function validateAndBuildPlayDocuments(plan: PlayPlanV0, submission: PlaySubmissionV1): PlayDocuments {
  if (submission.beats.length !== plan.beats.length || submission.beats.some((beat, index) => beat.id !== plan.beats[index].id)) throw new Error('Submission beats do not match the pinned plan.');
  const planIds = new Set(plan.beats.map((beat) => beat.id));
  const events = new Map<string, PlaySubmissionV1['events'][number]>();
  for (const event of submission.events) {
    if (events.has(event.id) || event.beatId !== null && !planIds.has(event.beatId)) throw new Error('Submission event references are invalid.');
    events.set(event.id, event);
  }
  for (const beat of submission.beats) {
    if (beat.eventId !== null) {
      const event = events.get(beat.eventId);
      if (!event || event.beatId !== beat.id) throw new Error('Submission beat event reference is invalid.');
    }
  }
  const persisted = {
    version: 1,
    beats: submission.beats.map((beat, index) => ({ id: beat.id, intent: plan.beats[index].intent, status: beat.status, eventId: beat.eventId })),
    events: submission.events.map((event) => ({ ...event })),
  };
  const encoder = new TextEncoder();
  return { play: encoder.encode(`${JSON.stringify(persisted, null, 2)}\n`), summary: encoder.encode(`${submission.summary.trimEnd()}\n`) };
}
