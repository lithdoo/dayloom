import fs from 'fs';
import os from 'os';
import path from 'path';
import { connectOrStartGateway } from '../daily/mcp-gateway';
import { assertAllowedPlayerContextRoot, exportReadonlyTools } from '../daily/mcp-tools';
import { callSettlementAi } from './ai';
import { applySettlement } from './apply';
import { buildSettlementPlayerContext, buildSettlementPromptInput } from './context';
import { buildProgramSettlementProposal } from './derive';
import { assertNextDayAvailable, assertSettlementCanStart, resolveWorldRoot } from './guard';
import { parseSettlementNarrative } from './parse-assistant';
import { readSettlementProposal } from './parse-payload';
import { describeSettlementChanges, projectSettlement } from './project';
import type { SettlementOptions, SettlementResult } from './types';
import { nextDayId, validateSettlementNarrative, validateSettlementProposal } from './validate';
import { withLoading } from '../utils/loading';

export function settleFromProposal(dir: string, proposalPath: string, options: SettlementOptions = {}): SettlementResult {
  const worldRoot = resolveWorldRoot(dir);
  const { day } = assertSettlementCanStart(worldRoot);
  const nextDay = nextDayId(day);
  assertNextDayAvailable(worldRoot, nextDay);
  const proposal = readSettlementProposal(proposalPath);
  validateSettlementProposal(proposal, day, worldRoot);
  const changes = projectSettlement(worldRoot, proposal, nextDay, new Date().toISOString());
  const description = describeSettlementChanges(worldRoot, changes);
  if (options.dryRun) return { worldRoot, day, nextDay, description, applied: false };
  if (!options.yes) throw new Error('Applying a settlement requires --yes. Use --dry-run to inspect changes.');
  applySettlement(worldRoot, proposal, changes, nextDay);
  return { worldRoot, day, nextDay, description, applied: true };
}

export async function settleWithAi(dir: string, options: SettlementOptions = {}): Promise<SettlementResult & { proposalPath?: string }> {
  if (!process.env.DEEPSEEK_API_KEY?.trim()) throw new Error('DEEPSEEK_API_KEY is not set. AI settlement requires an API key.');
  const worldRoot = resolveWorldRoot(dir);
  const { day } = assertSettlementCanStart(worldRoot);
  const nextDay = nextDayId(day);
  assertNextDayAvailable(worldRoot, nextDay);

  const serviceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'day-loom-settle-service-'));
  const contextRoot = path.join(serviceRoot, 'player-context');
  const toolsFile = path.join(serviceRoot, 'readonly.tools.toml');
  let gateway: Awaited<ReturnType<typeof connectOrStartGateway>> | undefined;
  try {
    await withLoading('正在准备结算上下文...', async loading => {
      buildSettlementPlayerContext(worldRoot, day, contextRoot);
      loading.update('正在启动只读服务...');
      gateway = await connectOrStartGateway(serviceRoot, contextRoot, options.mcpBaseUrl, options.mcpToken);
      loading.update('正在准备只读工具...');
      await exportReadonlyTools(gateway.baseUrl, gateway.token, toolsFile);
      await assertAllowedPlayerContextRoot(gateway.baseUrl, gateway.token, contextRoot, serviceRoot);
    });
    const reply = await withLoading('正在生成结算提案...', () =>
      callSettlementAi(buildSettlementPromptInput(worldRoot, day), toolsFile, gateway!.baseUrl, gateway!.token, options.maxToolRounds ?? 8, options.keepSession));
    const narrative = parseSettlementNarrative(reply);
    validateSettlementNarrative(narrative);
    const proposal = buildProgramSettlementProposal(worldRoot, day, narrative);
    validateSettlementProposal(proposal, day, worldRoot);
    const changes = projectSettlement(worldRoot, proposal, nextDay, new Date().toISOString());
    const description = describeSettlementChanges(worldRoot, changes);

    if (options.dryRun) return { worldRoot, day, nextDay, description, applied: false };
    if (!options.yes) {
      const proposalPath = path.join(worldRoot, 'days', day, 'ending', 'settlement.proposal.json');
      writeJsonAtomic(proposalPath, proposal);
      return { worldRoot, day, nextDay, description, applied: false, proposalPath };
    }
    applySettlement(worldRoot, proposal, changes, nextDay);
    return { worldRoot, day, nextDay, description, applied: true };
  } finally {
    if (gateway) await gateway.stop();
    if (options.keepSession) process.stderr.write(`Settlement service session preserved at: ${serviceRoot}\n`);
    else fs.rmSync(serviceRoot, { recursive: true, force: true });
  }
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

export * from './types';
