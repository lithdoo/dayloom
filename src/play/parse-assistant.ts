import type { EventResult, EventStatus, GeneratedEvent, ReplanPayload } from './types';
function block(text: string, label: string): string { const m = text.match(new RegExp('```(?:json\\s+)?' + label + '\\s*\\n([\\s\\S]*?)```', 'i')); if (!m) throw new Error('Assistant response missing ' + label + ' JSON block'); return m[1].trim(); }
function parse<T>(text: string, label: string): T { try { return JSON.parse(block(text, label)) as T; } catch (e) { throw new Error('Failed to parse ' + label + ': ' + (e instanceof Error ? e.message : String(e))); } }
export const parseGeneratedEvent = (text: string): GeneratedEvent => parse(text, 'play-event');
export function parseEventStatus(text: string): EventStatus {
  try {
    return parse(text, 'event-status');
  } catch (error) {
    const raw = block(text, 'event-status');
    const status = raw.match(/"status"\s*:\s*"(ongoing|resolved)"/)?.[1];
    const situation = raw.match(/"situation"\s*:\s*"([\s\S]*)"\s*,\s*"needs_user_action"\s*:/)?.[1];
    const needsUserAction = raw.match(/"needs_user_action"\s*:\s*(true|false)/)?.[1];
    const resolutionSummary = raw.match(/"resolution_summary"\s*:\s*"([\s\S]*)"\s*[,}]?\s*$/)?.[1];
    if (!status || situation === undefined || !needsUserAction) throw error;
    return {
      status: status as EventStatus['status'],
      situation,
      needs_user_action: needsUserAction === 'true',
      ...(resolutionSummary === undefined ? {} : { resolution_summary: resolutionSummary }),
      end_day: raw.match(/"end_day"\s*:\s*(true|false)/)?.[1] === 'true'
    };
  }
}
export const parseEventResult = (text: string): EventResult => parse(text, 'event-result');
export const parseReplan = (text: string): ReplanPayload => parse(text, 'play-replan');
