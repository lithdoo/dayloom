import type { SessionSubmission } from '../schemas/submissions';
import { DAYLOOM_CANON_PATHS, dayDocumentPath } from '../archive-v2';

export interface SubmissionDocument { path: string; text: string; mediaType: 'text/markdown' | 'application/json' }
export function submissionDocuments(value: SessionSubmission): readonly SubmissionDocument[] {
  switch (value.kind) {
    case 'init': return [
      {path:DAYLOOM_CANON_PATHS.premise,text:value.canon.premise,mediaType:'text/markdown'},
      {path:DAYLOOM_CANON_PATHS.rules,text:value.canon.rules,mediaType:'text/markdown'},
      {path:DAYLOOM_CANON_PATHS.style,text:value.canon.style,mediaType:'text/markdown'},
      {path:DAYLOOM_CANON_PATHS.userRole,text:value.canon.userRole,mediaType:'text/markdown'},
    ];
    case 'planning': return [{path:dayDocumentPath(value.day,'plan'),text:JSON.stringify({intent:value.intent,beats:value.beats},null,2),mediaType:'application/json'}];
    case 'play': return [
      {path:dayDocumentPath(value.day,'play'),text:JSON.stringify({beats:value.beats,events:value.events,transcript:value.transcript},null,2),mediaType:'application/json'},
      {path:dayDocumentPath(value.day,'summary'),text:value.summary,mediaType:'text/markdown'},
    ];
    case 'revise': return [
      {path:DAYLOOM_CANON_PATHS.premise,text:value.canon.premise,mediaType:'text/markdown'},
      {path:DAYLOOM_CANON_PATHS.rules,text:value.canon.rules,mediaType:'text/markdown'},
      {path:DAYLOOM_CANON_PATHS.style,text:value.canon.style,mediaType:'text/markdown'},
      {path:DAYLOOM_CANON_PATHS.userRole,text:value.canon.userRole,mediaType:'text/markdown'},
    ];
  }
}
