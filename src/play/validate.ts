import type { CurrentPlan, EventResult, EventStatus, GeneratedEvent, ReplanPayload } from './types';
const ID = /^[a-z][a-z0-9_]*$/; const EVENT_ID = /^event_\d{3}$/; const TIME = /^\d+(?:m|h)$/;
function nonEmpty(v: unknown, label: string): asserts v is string { if (typeof v !== 'string' || !v.trim()) throw new Error(label + ' must be non-empty'); }
function strings(v: unknown, label: string): asserts v is string[] { if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) throw new Error(label + ' must be a string array'); }
export function validateGeneratedEvent(v: GeneratedEvent, expectedEvent: string, beat: string): void { if (v.id !== expectedEvent || !EVENT_ID.test(v.id)) throw new Error('Invalid event id'); if (v.source_beat !== beat) throw new Error('Event source beat mismatch'); nonEmpty(v.title, 'Event title'); nonEmpty(v.opening, 'Event opening'); nonEmpty(v.situation, 'Event situation'); strings(v.suggested_actions, 'Event suggested_actions'); if (v.suggested_actions.length > 5) throw new Error('Event suggested_actions exceeds 5'); for (const key of ['outcome','result','success','failure','reward']) if (key in (v as unknown as Record<string, unknown>)) throw new Error('Generated event contains forbidden result field: ' + key); }
export function validateEventStatus(v: EventStatus): void {
  if (v.status !== 'ongoing' && v.status !== 'resolved') throw new Error('Invalid event status');
  nonEmpty(v.situation, 'Event status situation');
  if (typeof v.needs_user_action !== 'boolean') throw new Error('needs_user_action must be boolean');
  if (v.end_day === undefined) v.end_day = false;
  if (typeof v.end_day !== 'boolean') throw new Error('end_day must be boolean');
  if (v.status === 'resolved') nonEmpty(v.resolution_summary, 'resolution_summary');
  if (v.end_day && (v.status !== 'resolved' || v.needs_user_action)) throw new Error('end_day requires a resolved event without further user action');
}
export function normalizeTimeAdvanced(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value) + 'm';
  if (typeof value !== 'string') throw new Error('time_advanced must be a duration string or minute count');
  const compact = value.trim().toLowerCase().replace(/[约大概左右\s]/g, '');
  if (TIME.test(compact)) return compact;
  const compound = compact.match(/^(?:(\d+(?:\.\d+)?)h(?:ours?)?)?(?:(\d+)m(?:in(?:ute)?s?)?)?$/);
  if (compound && (compound[1] || compound[2])) {
    const minutes = Math.round(Number(compound[1] ?? 0) * 60 + Number(compound[2] ?? 0));
    if (minutes > 0) return minutes + 'm';
  }
  const chinese = compact.match(/^(?:(\d+(?:\.\d+)?)小时)?(?:(\d+)分钟)?$/);
  if (chinese && (chinese[1] || chinese[2])) {
    const minutes = Math.round(Number(chinese[1] ?? 0) * 60 + Number(chinese[2] ?? 0));
    if (minutes > 0) return minutes + 'm';
  }
  throw new Error('time_advanced must describe a positive duration, such as 30m, 1h30m, or 1小时30分钟');
}
export function validateEventResult(v: EventResult, eventId: string, beatId: string, plan?: CurrentPlan): void {
  if (v.event_id !== eventId || v.source_beat !== beatId) throw new Error('Event result identity mismatch');
  nonEmpty(v.summary, 'Event result summary');
  strings(v.protagonist_learned, 'protagonist_learned');
  v.time_advanced = normalizeTimeAdvanced(v.time_advanced);
  if (v.completed_source_beat !== undefined && typeof v.completed_source_beat !== 'boolean') throw new Error('completed_source_beat must be boolean');
  if (v.completed_beats === undefined) v.completed_beats = v.completed_source_beat === false ? [] : [beatId];
  if (v.cancelled_beats === undefined) v.cancelled_beats = [];
  if (v.end_day === undefined) v.end_day = false;
  strings(v.completed_beats, 'completed_beats');
  strings(v.cancelled_beats, 'cancelled_beats');
  if (typeof v.end_day !== 'boolean') throw new Error('end_day must be boolean');
  v.completed_source_beat = v.completed_beats.includes(beatId);
  const completed = new Set(v.completed_beats);
  if (v.cancelled_beats.some(id => completed.has(id))) throw new Error('completed_beats and cancelled_beats overlap');
  if (plan) {
    const valid = new Set(plan.beats.map(beat => beat.id));
    for (const id of [...v.completed_beats, ...v.cancelled_beats]) if (!valid.has(id)) throw new Error('Unknown beat in event result: ' + id);
  }
  if (!Array.isArray(v.state_patch) || v.state_patch.length > 20) throw new Error('Invalid state_patch');
  for (const patch of v.state_patch) {
    if (patch.op !== 'set' || !ID.test(patch.key)) throw new Error('Invalid runtime patch');
    if (!['string','number','boolean'].includes(typeof patch.value) && patch.value !== null) throw new Error('Invalid runtime patch value');
  }
}
export function normalizeReplanPayload(v: ReplanPayload, plan: CurrentPlan): { payload: ReplanPayload; warnings: string[] } {
  if (!Array.isArray(v.operations)) return { payload: v, warnings: [] };
  const validIds = new Set(plan.beats.map(beat => beat.id));
  let insertSlots = Math.max(0, plan.max_events - plan.beats.length);
  const warnings: string[] = [];
  const operations: ReplanPayload['operations'] = [];
  for (const original of v.operations) {
    const op = JSON.parse(JSON.stringify(original)) as ReplanPayload['operations'][number];
    if (op.op !== 'insert') { operations.push(op); continue; }
    if (insertSlots === 0) { warnings.push('Dropped insert because max_events has no remaining slots'); continue; }
    if (op.after && !validIds.has(op.after)) { warnings.push('Removed unknown insertion anchor ' + op.after + '; appending the beat instead'); delete op.after; }
    operations.push(op); insertSlots--;
  }
  return { payload: { operations }, warnings };
}
export function validateReplan(v: ReplanPayload, plan: CurrentPlan): void {
  if (!Array.isArray(v.operations) || v.operations.length > 10) throw new Error('Invalid replan operations');
  const byId = new Map(plan.beats.map(beat => [beat.id, beat]));
  const touched = new Set<string>();
  let inserts = 0;
  for (const op of v.operations) {
    if (op.op === 'insert') {
      nonEmpty(op.intent, 'Inserted beat intent'); nonEmpty(op.reason, 'Inserted beat reason');
      if (op.after && !byId.has(op.after)) throw new Error('Unknown insertion anchor: ' + op.after);
      if (op.priority !== 'required' && op.priority !== 'optional') throw new Error('Invalid inserted beat priority');
      inserts++; continue;
    }
    if (touched.has(op.beat_id)) throw new Error('Multiple replan operations for beat: ' + op.beat_id);
    touched.add(op.beat_id);
    const beat = byId.get(op.beat_id);
    if (!beat) throw new Error('Unknown beat in replan: ' + op.beat_id);
    if (beat.status === 'completed' || beat.status === 'cancelled') throw new Error('Cannot change finished beat: ' + op.beat_id);
    if (op.op === 'modify') { nonEmpty(op.intent, 'Modified beat intent'); nonEmpty(op.reason, 'Modified beat reason'); }
    if (op.op === 'cancel') nonEmpty(op.reason, 'Cancelled beat reason');
  }
  if (plan.beats.length + inserts > plan.max_events) throw new Error('Replan exceeds max_events');
}
