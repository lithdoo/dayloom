import fs from 'fs';
import path from 'path';
import type { SettlementProposal } from './types';

export function readSettlementProposal(proposalPath: string): SettlementProposal {
  const resolved = path.resolve(proposalPath);
  if (!fs.existsSync(resolved)) throw new Error(`Settlement proposal not found: ${resolved}`);
  try { return JSON.parse(fs.readFileSync(resolved, 'utf8')) as SettlementProposal; }
  catch { throw new Error(`Settlement proposal is not valid JSON: ${resolved}`); }
}
