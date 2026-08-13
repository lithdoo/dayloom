import type { SessionSubmission } from '../schemas/submissions';
import { DAYLOOM_CANON_PATHS, dayDocumentPath } from '../archive-v2';

export interface SubmissionDocument { path: string; text: string }
export function submissionDocuments(value: SessionSubmission): readonly SubmissionDocument[] {
  switch (value.kind) {
    case 'init': return [
      {path:DAYLOOM_CANON_PATHS.premise,text:value.canon.premise},
      {path:DAYLOOM_CANON_PATHS.rules,text:value.canon.rules},
      {path:DAYLOOM_CANON_PATHS.style,text:value.canon.style},
      {path:DAYLOOM_CANON_PATHS.userRole,text:value.canon.userRole},
    ];
    case 'planning': return [{path:dayDocumentPath(value.day,'plan'),text:JSON.stringify({intent:value.intent,beats:value.beats},null,2)}];
    case 'play': return [
      {path:dayDocumentPath(value.day,'play'),text:JSON.stringify({beats:value.beats,events:value.events,transcript:value.transcript},null,2)},
      {path:dayDocumentPath(value.day,'summary'),text:value.summary},
    ];
    case 'revise': return [
      {path:DAYLOOM_CANON_PATHS.premise,text:value.canon.premise},
      {path:DAYLOOM_CANON_PATHS.rules,text:value.canon.rules},
      {path:DAYLOOM_CANON_PATHS.style,text:value.canon.style},
      {path:DAYLOOM_CANON_PATHS.userRole,text:value.canon.userRole},
    ];
  }
}
