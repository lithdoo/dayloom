import type { PlanningSubmission, PlaySubmission } from '../../schemas/submissions';
import type { DayDraft, DayRevisionData } from '../../archive';

export function plannedDayDraft(
  submission: PlanningSubmission,
  parentRevision: string | null,
): DayDraft {
  return {
    day: submission.day,
    parentRevision,
    status: 'planned',
    plan: {
      day: submission.day,
      intent: submission.intent,
      beats: submission.beats.map((beat) => ({ ...beat, status: 'pending', eventId: null })),
    },
  };
}

export function playedDayDraft(
  submission: PlaySubmission,
  previous: DayRevisionData,
): DayDraft {
  return {
    day: submission.day,
    parentRevision: previous.meta.revision,
    status: 'awaiting-settle',
    plan: { day: submission.day, intent: previous.plan.intent, beats: submission.beats },
    play: { day: submission.day, summary: submission.summary, eventIds: submission.events.map((event) => event.id) },
    events: submission.events.map((event) => ({ ...event, status: 'completed' })),
    transcript: submission.transcript,
  };
}

export function copyDayRevision(previous: DayRevisionData): Pick<
  DayDraft,
  'plan' | 'play' | 'events' | 'transcript'
> {
  return {
    plan: previous.plan,
    ...(previous.play ? { play: previous.play } : {}),
    ...(previous.events.length > 0 ? { events: previous.events } : {}),
    ...(previous.play ? { transcript: previous.transcript } : {}),
  };
}
