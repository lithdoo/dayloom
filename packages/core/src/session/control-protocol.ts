import { z } from 'zod';

export const TURN_REJECTION_CODES_V1 = [
  'PHASE_DRIFT',
  'UNAUTHORIZED_PROGRESS',
  'USER_DECISION_INVENTED',
  'PUBLISHED_FACT_CONTRADICTION',
  'UNSUPPORTED_CLAIM',
  'OTHER_POLICY_VIOLATION',
] as const;

const printableEvidence = z.string().max(8 * 1024).refine((value) => value.trim() !== '' && !value.includes('\0'), 'Evidence must be non-empty printable text.');

const responseAccept = z.strictObject({ verdict: z.literal('ACCEPT') });
const responseReject = z.strictObject({ verdict: z.literal('REJECT'), code: z.enum(TURN_REJECTION_CODES_V1), evidence: printableEvidence });
const draftKeep = z.strictObject({ verdict: z.literal('KEEP'), evidence: printableEvidence.optional() });
const draftUpdate = z.strictObject({ verdict: z.literal('UPDATE'), evidence: printableEvidence });
const draftDefer = z.strictObject({ verdict: z.literal('DEFER') });

// McpServer expects an input shape. Keeping this boundary object-shaped makes
// tool discovery retain both parameters. The union below remains authoritative
// for the cross-field combinations when the tool executes.
export const TurnVerdictToolInputShapeV1 = Object.freeze({
  response_verdict: z.enum(['ACCEPT', 'REJECT']).describe('ACCEPT or REJECT.'),
  rejection_code: z.enum([...TURN_REJECTION_CODES_V1, 'NONE']).describe('Required for REJECT; otherwise NONE.'),
  response_evidence: z.string().max(8 * 1024).describe('Required for REJECT; otherwise an empty string.'),
  draft_verdict: z.enum(['KEEP', 'UPDATE', 'DEFER']).describe('KEEP/UPDATE for ACCEPT; DEFER for REJECT.'),
  draft_evidence: z.string().max(8 * 1024).describe('Required for UPDATE; optional for KEEP; empty for DEFER.'),
});
const TurnVerdictToolInputSchemaV1 = z.strictObject(TurnVerdictToolInputShapeV1);

export const TurnVerdictSchemaV1 = z.union([
  z.strictObject({
    response: responseAccept,
    draft: z.union([draftKeep, draftUpdate]),
  }),
  z.strictObject({
    response: responseReject,
    draft: draftDefer,
  }),
]);

export type TurnVerdictV1 = z.infer<typeof TurnVerdictSchemaV1>;

export function parseTurnVerdictV1(value: unknown): Readonly<TurnVerdictV1> {
  return Object.freeze(TurnVerdictSchemaV1.parse(value));
}

export function parseTurnVerdictToolInputV1(value: unknown): Readonly<TurnVerdictV1> {
  const input = TurnVerdictToolInputSchemaV1.parse(value);
  if (input.response_verdict === 'REJECT') {
    if (input.rejection_code === 'NONE' || input.response_evidence.trim() === '' || input.draft_verdict !== 'DEFER' || input.draft_evidence !== '') throw new Error('REJECT requires rejection_code, response_evidence, DEFER, and empty draft_evidence.');
    return parseTurnVerdictV1({ response: { verdict: 'REJECT', code: input.rejection_code, evidence: input.response_evidence }, draft: { verdict: 'DEFER' } });
  }
  if (input.rejection_code !== 'NONE' || input.response_evidence !== '' || input.draft_verdict === 'DEFER') throw new Error('ACCEPT requires NONE, empty response_evidence, and KEEP or UPDATE.');
  if (input.draft_verdict === 'UPDATE') {
    if (input.draft_evidence.trim() === '') throw new Error('UPDATE requires draft_evidence.');
    return parseTurnVerdictV1({ response: { verdict: 'ACCEPT' }, draft: { verdict: 'UPDATE', evidence: input.draft_evidence } });
  }
  return parseTurnVerdictV1({ response: { verdict: 'ACCEPT' }, draft: input.draft_evidence === '' ? { verdict: 'KEEP' } : { verdict: 'KEEP', evidence: input.draft_evidence } });
}
