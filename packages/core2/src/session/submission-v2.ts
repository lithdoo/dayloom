import { parseInitSubmissionV1, parsePlanningSubmissionV1, type CanonSubmission } from './submission';
import { exact, isRecord } from '../world/read';

type Scalar = string | number | boolean | null;
export interface InitSubmissionV2 {
  version: 2; title: string; canon: CanonSubmission;
  worldState: { status: string; elapsed: string | null; variables: Record<string, Scalar> };
  characters: Array<{ key: string; profile: string; relationships: Array<{ characterKey: string; relation: string; status: string }>; status: string; locationKey: string | null; tags: string[] }>;
  locations: Array<{ key: string; profile: string; status: string; tags: string[]; triggers: Array<{ condition: string; effect: string }> }>;
  arcs: Array<{ key: string; profile: string; status: 'inactive' | 'active'; stage: string }>;
  initialFacts: Array<{ text: string }>;
  unresolvedThreads: Array<{ text: string }>;
  storySeeds: Array<{ text: string }>;
}
export interface PlanningSubmissionV2 {
  version: 2; intent: string; knownContext: string[]; constraints: string[]; openQuestions: string[]; maxEvents: number;
  beats: Array<{ key: string; intent: string; priority: 'required' | 'optional'; dependsOn: string[] }>;
}
export type DomainPatchV1 =
  | { op: 'set-world-variable'; key: string; expected: Scalar; value: Scalar }
  | { op: 'set-character-status'; characterId: string; expected: string; value: string }
  | { op: 'move-character'; characterId: string; expectedLocationId: string | null; locationId: string | null }
  | { op: 'set-location-status'; locationId: string; expected: string; value: string }
  | { op: 'set-arc-stage'; arcId: string; expected: string; value: string };
export interface PlaySubmissionV2 {
  version: 2;
  events: Array<{ beatId: string | null; title: string; locationId: string | null; participantIds: string[]; scene: string; dialogue: string; userAction: string; result: { summary: string; learnedFacts: string[]; timeAdvanced: string | null; completedBeatIds: string[]; skippedBeatIds: string[]; endDay: boolean }; proposedPatch: DomainPatchV1[] }>;
}
export type ReviseOperationV1 =
  | { op: 'replace-canon'; field: 'premise' | 'rules' | 'style' | 'userRole'; expected: string; value: string }
  | { op: 'replace-character-profile'; characterId: string; expected: string; value: string }
  | { op: 'replace-location-profile'; locationId: string; expected: string; value: string }
  | { op: 'replace-arc-profile'; arcId: string; expected: string; value: string }
  | { op: 'create-character'; profile: string; status: string; locationId: string | null; tags: string[]; relationships: Array<{ characterId: string; relation: string; status: string }> }
  | { op: 'create-location'; profile: string; status: string; tags: string[]; triggers: Array<{ condition: string; effect: string }> }
  | { op: 'create-arc'; profile: string; status: 'inactive' | 'active'; stage: string }
  | DomainPatchV1
  | { op: 'add-story-seed'; text: string }
  | { op: 'remove-story-seed'; seedId: string; expectedText: string };
export interface ReviseSubmissionV2 { version: 2; operations: ReviseOperationV1[] }

export function parseInitSubmissionV2(text: string): InitSubmissionV2 {
  const value = parseJson(text);
  if (isRecord(value) && value.version === 1) return upgradeInitV1(parseInitSubmissionV1(text));
  if (!isRecord(value) || !exact(value, ['version', 'title', 'canon', 'worldState', 'characters', 'locations', 'arcs', 'initialFacts', 'unresolvedThreads', 'storySeeds']) || value.version !== 2 || !nonempty(value.title)) throw new Error('InitSubmissionV2 is invalid.');
  const canon = parseCanon(value.canon), worldState = parseWorldState(value.worldState);
  if (!Array.isArray(value.characters) || !Array.isArray(value.locations) || !Array.isArray(value.arcs)) throw new Error('InitSubmissionV2 entity collections are invalid.');
  const characters = value.characters.map(parseCharacter), locations = value.locations.map(parseLocation), arcs = value.arcs.map(parseArc);
  uniqueKeys(characters, 'character'); uniqueKeys(locations, 'location'); uniqueKeys(arcs, 'arc');
  const characterKeys = new Set(characters.map((item) => item.key)), locationKeys = new Set(locations.map((item) => item.key));
  for (const character of characters) {
    if (character.locationKey !== null && !locationKeys.has(character.locationKey)) throw new Error('InitSubmissionV2 character location reference is invalid.');
    const targets = new Set<string>();
    for (const relation of character.relationships) {
      if (!characterKeys.has(relation.characterKey) || targets.has(relation.characterKey)) throw new Error('InitSubmissionV2 character relationship reference is invalid.');
      targets.add(relation.characterKey);
    }
  }
  return { version: 2, title: value.title, canon, worldState, characters, locations, arcs, initialFacts: parseTextItems(value.initialFacts, 'initialFacts'), unresolvedThreads: parseTextItems(value.unresolvedThreads, 'unresolvedThreads'), storySeeds: parseTextItems(value.storySeeds, 'storySeeds') };
}

export function parsePlanningSubmissionV2(text: string): PlanningSubmissionV2 {
  const value = parseJson(text);
  if (isRecord(value) && value.version === 1) {
    const legacy = parsePlanningSubmissionV1(text);
    return { version: 2, intent: legacy.intent, knownContext: [], constraints: [], openQuestions: [], maxEvents: Math.max(1, legacy.beats.length), beats: legacy.beats.map((beat, index) => ({ key: `local${index + 1}`, intent: beat.intent, priority: 'required', dependsOn: [] })) };
  }
  if (!isRecord(value) || !exact(value, ['version', 'intent', 'knownContext', 'constraints', 'openQuestions', 'maxEvents', 'beats']) || value.version !== 2 || !nonempty(value.intent) || !Number.isSafeInteger(value.maxEvents) || (value.maxEvents as number) < 1 || !Array.isArray(value.beats)) throw new Error('PlanningSubmissionV2 is invalid.');
  const beats = value.beats.map((raw) => {
    if (!isRecord(raw) || !exact(raw, ['key', 'intent', 'priority', 'dependsOn']) || !nonempty(raw.key) || !nonempty(raw.intent) || !['required', 'optional'].includes(String(raw.priority))) throw new Error('PlanningSubmissionV2 beat is invalid.');
    return { key: raw.key, intent: raw.intent, priority: raw.priority as 'required' | 'optional', dependsOn: strings(raw.dependsOn, 'beat dependencies') };
  });
  uniqueKeys(beats, 'beat'); const positions = new Map(beats.map((beat, index) => [beat.key, index]));
  for (const [index, beat] of beats.entries()) for (const dependency of beat.dependsOn) if ((positions.get(dependency) ?? index) >= index) throw new Error('PlanningSubmissionV2 dependency must reference an earlier beat.');
  return { version: 2, intent: value.intent, knownContext: strings(value.knownContext, 'knownContext'), constraints: strings(value.constraints, 'constraints'), openQuestions: strings(value.openQuestions, 'openQuestions'), maxEvents: value.maxEvents as number, beats };
}

export function parsePlaySubmissionV2(text: string): PlaySubmissionV2 {
  const value = parseJson(text);
  if (!isRecord(value) || !exact(value, ['version', 'events']) || value.version !== 2 || !Array.isArray(value.events) || value.events.length === 0) throw new Error('PlaySubmissionV2 is invalid.');
  return { version: 2, events: value.events.map((raw) => {
    if (!isRecord(raw) || !exact(raw, ['beatId', 'title', 'locationId', 'participantIds', 'scene', 'dialogue', 'userAction', 'result', 'proposedPatch']) || !(raw.beatId === null || nonempty(raw.beatId)) || !nonempty(raw.title) || !(raw.locationId === null || nonempty(raw.locationId)) || typeof raw.scene !== 'string' || typeof raw.dialogue !== 'string' || !nonempty(raw.userAction) || !Array.isArray(raw.proposedPatch)) throw new Error('PlaySubmissionV2 event is invalid.');
    const result = parsePlayResult(raw.result);
    return { beatId: raw.beatId, title: raw.title, locationId: raw.locationId, participantIds: strings(raw.participantIds, 'participantIds'), scene: raw.scene, dialogue: raw.dialogue, userAction: raw.userAction, result, proposedPatch: raw.proposedPatch.map(parseDomainPatchV1) };
  }) };
}
export function parseReviseSubmissionV2(text: string): ReviseSubmissionV2 {
  const value = parseJson(text);
  if (!isRecord(value) || !exact(value, ['version', 'operations']) || value.version !== 2 || !Array.isArray(value.operations) || value.operations.length === 0) throw new Error('ReviseSubmissionV2 is invalid.');
  return { version: 2, operations: value.operations.map(parseReviseOperationV1) };
}
function parseReviseOperationV1(value: unknown): ReviseOperationV1 {
  if (!isRecord(value) || typeof value.op !== 'string') throw new Error('ReviseOperationV1 is invalid.');
  if (value.op === 'replace-canon' && exact(value, ['op', 'field', 'expected', 'value']) && ['premise', 'rules', 'style', 'userRole'].includes(String(value.field)) && typeof value.expected === 'string' && typeof value.value === 'string') return value as unknown as ReviseOperationV1;
  for (const [op, key] of [['replace-character-profile', 'characterId'], ['replace-location-profile', 'locationId'], ['replace-arc-profile', 'arcId']] as const) if (value.op === op && exact(value, ['op', key, 'expected', 'value']) && nonempty(value[key]) && typeof value.expected === 'string' && typeof value.value === 'string') return value as unknown as ReviseOperationV1;
  if (value.op === 'add-story-seed' && exact(value, ['op', 'text']) && nonempty(value.text)) return { op: value.op, text: value.text };
  if (value.op === 'remove-story-seed' && exact(value, ['op', 'seedId', 'expectedText']) && nonempty(value.seedId) && nonempty(value.expectedText)) return { op: value.op, seedId: value.seedId, expectedText: value.expectedText };
  if (value.op === 'create-character' && exact(value, ['op', 'profile', 'status', 'locationId', 'tags', 'relationships']) && typeof value.profile === 'string' && nonempty(value.status) && (value.locationId === null || nonempty(value.locationId)) && Array.isArray(value.relationships)) return { op: value.op, profile: value.profile, status: value.status, locationId: value.locationId, tags: strings(value.tags, 'character tags'), relationships: value.relationships.map((item) => { if (!isRecord(item) || !exact(item, ['characterId', 'relation', 'status']) || !nonempty(item.characterId) || !nonempty(item.relation) || !nonempty(item.status)) throw new Error('Revise create-character relationship is invalid.'); return { characterId: item.characterId, relation: item.relation, status: item.status }; }) };
  if (value.op === 'create-location' && exact(value, ['op', 'profile', 'status', 'tags', 'triggers']) && typeof value.profile === 'string' && nonempty(value.status) && Array.isArray(value.triggers)) return { op: value.op, profile: value.profile, status: value.status, tags: strings(value.tags, 'location tags'), triggers: value.triggers.map((item) => { if (!isRecord(item) || !exact(item, ['condition', 'effect']) || !nonempty(item.condition) || !nonempty(item.effect)) throw new Error('Revise create-location trigger is invalid.'); return { condition: item.condition, effect: item.effect }; }) };
  if (value.op === 'create-arc' && exact(value, ['op', 'profile', 'status', 'stage']) && typeof value.profile === 'string' && ['inactive', 'active'].includes(String(value.status)) && typeof value.stage === 'string') return { op: value.op, profile: value.profile, status: value.status as 'inactive' | 'active', stage: value.stage };
  return parseDomainPatchV1(value);
}

function parsePlayResult(value: unknown): PlaySubmissionV2['events'][number]['result'] {
  if (!isRecord(value) || !exact(value, ['summary', 'learnedFacts', 'timeAdvanced', 'completedBeatIds', 'skippedBeatIds', 'endDay']) || !nonempty(value.summary) || !(value.timeAdvanced === null || nonempty(value.timeAdvanced)) || typeof value.endDay !== 'boolean') throw new Error('PlaySubmissionV2 result is invalid.');
  return { summary: value.summary, learnedFacts: strings(value.learnedFacts, 'learnedFacts'), timeAdvanced: value.timeAdvanced, completedBeatIds: strings(value.completedBeatIds, 'completedBeatIds'), skippedBeatIds: strings(value.skippedBeatIds, 'skippedBeatIds'), endDay: value.endDay };
}
export function parseDomainPatchV1(value: unknown): DomainPatchV1 {
  if (!isRecord(value) || typeof value.op !== 'string') throw new Error('DomainPatchV1 is invalid.');
  if (value.op === 'set-world-variable' && exact(value, ['op', 'key', 'expected', 'value']) && nonempty(value.key) && scalar(value.expected) && scalar(value.value)) return { op: value.op, key: value.key, expected: value.expected, value: value.value };
  if (value.op === 'set-character-status' && exact(value, ['op', 'characterId', 'expected', 'value']) && nonempty(value.characterId) && nonempty(value.expected) && nonempty(value.value)) return { op: value.op, characterId: value.characterId, expected: value.expected, value: value.value };
  if (value.op === 'move-character' && exact(value, ['op', 'characterId', 'expectedLocationId', 'locationId']) && nonempty(value.characterId) && (value.expectedLocationId === null || nonempty(value.expectedLocationId)) && (value.locationId === null || nonempty(value.locationId))) return { op: value.op, characterId: value.characterId, expectedLocationId: value.expectedLocationId, locationId: value.locationId };
  if (value.op === 'set-location-status' && exact(value, ['op', 'locationId', 'expected', 'value']) && nonempty(value.locationId) && nonempty(value.expected) && nonempty(value.value)) return { op: value.op, locationId: value.locationId, expected: value.expected, value: value.value };
  if (value.op === 'set-arc-stage' && exact(value, ['op', 'arcId', 'expected', 'value']) && nonempty(value.arcId) && nonempty(value.expected) && nonempty(value.value)) return { op: value.op, arcId: value.arcId, expected: value.expected, value: value.value };
  throw new Error('DomainPatchV1 is invalid.');
}

function upgradeInitV1(value: { title: string; canon: CanonSubmission }): InitSubmissionV2 {
  return { version: 2, title: value.title, canon: value.canon, worldState: { status: 'active', elapsed: null, variables: {} }, characters: [], locations: [], arcs: [], initialFacts: [], unresolvedThreads: [], storySeeds: [] };
}
function parseCanon(value: unknown): CanonSubmission {
  if (!isRecord(value) || !exact(value, ['premise', 'rules', 'style', 'userRole']) || !Object.values(value).every((item) => typeof item === 'string')) throw new Error('InitSubmissionV2 canon is invalid.');
  return value as unknown as CanonSubmission;
}
function parseWorldState(value: unknown): InitSubmissionV2['worldState'] {
  if (!isRecord(value) || !exact(value, ['status', 'elapsed', 'variables']) || !nonempty(value.status) || !(value.elapsed === null || nonempty(value.elapsed)) || !isRecord(value.variables)) throw new Error('InitSubmissionV2 worldState is invalid.');
  const variables: Record<string, Scalar> = {};
  for (const [key, item] of Object.entries(value.variables)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key) || !scalar(item)) throw new Error('InitSubmissionV2 variable is invalid.'); variables[key] = item;
  }
  return { status: value.status, elapsed: value.elapsed, variables };
}
function parseCharacter(value: unknown): InitSubmissionV2['characters'][number] {
  if (!isRecord(value) || !exact(value, ['key', 'profile', 'relationships', 'status', 'locationKey', 'tags']) || !nonempty(value.key) || typeof value.profile !== 'string' || !Array.isArray(value.relationships) || !nonempty(value.status) || !(value.locationKey === null || nonempty(value.locationKey))) throw new Error('InitSubmissionV2 character is invalid.');
  return { key: value.key, profile: value.profile, status: value.status, locationKey: value.locationKey, tags: strings(value.tags, 'character tags'), relationships: value.relationships.map((raw) => {
    if (!isRecord(raw) || !exact(raw, ['characterKey', 'relation', 'status']) || !nonempty(raw.characterKey) || !nonempty(raw.relation) || !nonempty(raw.status)) throw new Error('InitSubmissionV2 relationship is invalid.');
    return { characterKey: raw.characterKey, relation: raw.relation, status: raw.status };
  }) };
}
function parseLocation(value: unknown): InitSubmissionV2['locations'][number] {
  if (!isRecord(value) || !exact(value, ['key', 'profile', 'status', 'tags', 'triggers']) || !nonempty(value.key) || typeof value.profile !== 'string' || !nonempty(value.status) || !Array.isArray(value.triggers)) throw new Error('InitSubmissionV2 location is invalid.');
  return { key: value.key, profile: value.profile, status: value.status, tags: strings(value.tags, 'location tags'), triggers: value.triggers.map((raw) => {
    if (!isRecord(raw) || !exact(raw, ['condition', 'effect']) || !nonempty(raw.condition) || !nonempty(raw.effect)) throw new Error('InitSubmissionV2 trigger is invalid.'); return { condition: raw.condition, effect: raw.effect };
  }) };
}
function parseArc(value: unknown): InitSubmissionV2['arcs'][number] {
  if (!isRecord(value) || !exact(value, ['key', 'profile', 'status', 'stage']) || !nonempty(value.key) || typeof value.profile !== 'string' || !['inactive', 'active'].includes(String(value.status)) || typeof value.stage !== 'string') throw new Error('InitSubmissionV2 arc is invalid.');
  return { key: value.key, profile: value.profile, status: value.status as 'inactive' | 'active', stage: value.stage };
}
function parseTextItems(value: unknown, field: string): Array<{ text: string }> {
  if (!Array.isArray(value)) throw new Error(`InitSubmissionV2 ${field} is invalid.`);
  return value.map((raw) => { if (!isRecord(raw) || !exact(raw, ['text']) || !nonempty(raw.text)) throw new Error(`InitSubmissionV2 ${field} item is invalid.`); return { text: raw.text }; });
}
function strings(value: unknown, field: string): string[] { if (!Array.isArray(value) || value.some((item) => !nonempty(item)) || new Set(value).size !== value.length) throw new Error(`InitSubmissionV2 ${field} is invalid.`); return value as string[]; }
function uniqueKeys(values: Array<{ key: string }>, kind: string): void { if (new Set(values.map((item) => item.key)).size !== values.length) throw new Error(`InitSubmissionV2 ${kind} keys must be unique.`); }
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.trim() !== ''; }
function scalar(value: unknown): value is Scalar { return value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value); }
function parseJson(text: string): unknown { try { return JSON.parse(text); } catch { throw new Error('Submission is not valid JSON.'); } }
