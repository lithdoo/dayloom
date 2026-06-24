export interface SettlementPatch {
  op: 'replace' | 'append';
  path: string;
  content: string;
}

export interface NextDaySeed {
  summary: string;
  suggested_intents: string[];
  unresolved_threads: string[];
}

export interface SettlementNarrative {
  summary: string;
  diary: string;
  next_day_seed: {
    summary: string;
    suggested_intents: string[];
  };
}

export interface SettlementProposal {
  version: 1;
  day: string;
  summary: string;
  diary: string;
  state_patch: SettlementPatch[];
  next_day_seed: NextDaySeed;
}

export interface SettlementOptions {
  dryRun?: boolean;
  yes?: boolean;
  keepSession?: boolean;
  maxToolRounds?: number;
  mcpBaseUrl?: string;
  mcpToken?: string;
}

export interface WorldFileChange {
  relativePath: string;
  content: string;
}

export interface SettlementResult {
  worldRoot: string;
  day: string;
  nextDay: string;
  description: string;
  applied: boolean;
}

export interface SettlementSession {
  root: string;
  messagesDir: string;
  toolsFile: string;
  promptpileConfig: string;
  draftFile: string;
  playerContextRoot: string;
}
