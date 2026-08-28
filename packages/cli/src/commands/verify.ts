import { verifyPublishedArchiveV1, type VerifyResultV1 } from '../world/verify.js';

export async function runVerifyV1(worldRoot: string): Promise<VerifyResultV1> {
  return verifyPublishedArchiveV1(worldRoot);
}
