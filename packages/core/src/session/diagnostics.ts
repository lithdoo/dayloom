export type ValidationStageV1 = 'draft' | 'candidate' | 'review' | 'publish';
export type ValidationSeverityV1 = 'error' | 'advisory';
export interface ValidationIssueV1 {
  schemaVersion: 1; stage: ValidationStageV1; severity: ValidationSeverityV1; code: string;
  path: string | null; constraint: string; expected?: string; actual?: string; repairHint?: string;
}

export function sortDiagnosticsV1(items: readonly ValidationIssueV1[]): readonly ValidationIssueV1[] {
  const severity = { error: 0, advisory: 1 }, stage = { draft: 0, candidate: 1, review: 2, publish: 3 };
  return Object.freeze(items.map(limitIssue).sort((left, right) => severity[left.severity] - severity[right.severity]
    || stage[left.stage] - stage[right.stage]
    || (left.path ?? '').localeCompare(right.path ?? '', 'en')
    || left.code.localeCompare(right.code, 'en')
    || left.constraint.localeCompare(right.constraint, 'en')).slice(0, SESSION_FILE_LIMITS.diagnosticsMaxItems));
}

function limitIssue(issue: ValidationIssueV1): ValidationIssueV1 {
  const limit = (value: string | undefined) => value === undefined ? undefined : utf8Prefix(value, SESSION_FILE_LIMITS.diagnosticMessageMaxBytes);
  return Object.freeze({ ...issue, constraint: limit(issue.constraint)!, ...(issue.expected === undefined ? {} : { expected: limit(issue.expected) }), ...(issue.actual === undefined ? {} : { actual: limit(issue.actual) }), ...(issue.repairHint === undefined ? {} : { repairHint: limit(issue.repairHint) }) });
}
function utf8Prefix(value: string, maxBytes: number): string { const bytes = Buffer.from(value, 'utf8'); if (bytes.byteLength <= maxBytes) return value; let end = maxBytes; while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1; return bytes.subarray(0, end).toString('utf8'); }
import { SESSION_FILE_LIMITS } from './file-limits';
