import type { PlayPlanV0 } from '../world/read';
import { exact, isRecord } from '../world/read';

export interface PlaySubmissionV1 {
  version: 1; summary: string;
  beats: Array<{ id: string; status: 'pending' | 'completed' | 'skipped'; eventId: string | null }>;
  events: Array<{ id: string; beatId: string | null; userInput: string; assistantOutput: string }>;
}
export interface PlayDocuments { play: Uint8Array; summary: Uint8Array }
export interface InitSubmissionV1 { version: 1; title: string; canon: CanonSubmission }
export interface PlanningSubmissionV1 { version: 1; intent: string; beats: Array<{ intent: string }> }
export interface ReviseSubmissionV1 { version: 1; canon: CanonSubmission }
export interface CanonSubmission { premise: string; rules: string; style: string; userRole: string }

function nonempty(value: unknown): value is string { return typeof value === 'string' && value.trim() !== ''; }
function nullableId(value: unknown): value is string | null { return value === null || nonempty(value); }
export function parsePlaySubmissionV1(text: string): PlaySubmissionV1 {
  const value = parseJson(text);
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

export function parseInitSubmissionV1(text: string): InitSubmissionV1 {
  const value = parseJson(text);
  if (!isRecord(value) || !exact(value, ['version', 'title', 'canon']) || value.version !== 1 || !nonempty(value.title)) throw new Error('InitSubmissionV1 is invalid.');
  return { version: 1, title: value.title, canon: parseCanon(value.canon) };
}
export function parsePlanningSubmissionV1(text: string): PlanningSubmissionV1 {
  const value = parseJson(text);
  if (!isRecord(value) || !exact(value, ['version', 'intent', 'beats']) || value.version !== 1 || !nonempty(value.intent) || !Array.isArray(value.beats)) throw new Error('PlanningSubmissionV1 is invalid.');
  const beats = value.beats.map((beat) => {
    if (!isRecord(beat) || !exact(beat, ['intent']) || !nonempty(beat.intent)) throw new Error('PlanningSubmissionV1 beat is invalid.');
    return { intent: beat.intent };
  });
  return { version: 1, intent: value.intent, beats };
}
export function parseReviseSubmissionV1(text: string): ReviseSubmissionV1 {
  const value = parseJson(text);
  if (!isRecord(value) || !exact(value, ['version', 'canon']) || value.version !== 1) throw new Error('ReviseSubmissionV1 is invalid.');
  return { version: 1, canon: parseCanon(value.canon) };
}
function parseCanon(value: unknown): CanonSubmission {
  if (!isRecord(value) || !exact(value, ['premise', 'rules', 'style', 'userRole']) || !Object.values(value).every((item) => typeof item === 'string')) throw new Error('Canon submission is invalid.');
  return value as unknown as CanonSubmission;
}
function parseJson(text: string): unknown { try { return JSON.parse(text); } catch { throw new Error('Submission is not valid JSON.'); } }

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
