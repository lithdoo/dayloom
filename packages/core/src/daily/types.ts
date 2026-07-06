export type DailyAction = 'continue' | 'pending' | 'start' | 'cancel' | 'exit';

export interface DailyIntent {
  action: DailyAction;
  confidence: number;
  reason: string;
}

export interface DailyBeat {
  id: string;
  intent: string;
  priority: 'required' | 'optional';
  status: 'tentative';
  depends_on?: string[];
}

export interface DailyPlan {
  day: string;
  user_intent: string;
  known_context: string[];
  constraints: string[];
  planned_beats: DailyBeat[];
  open_questions: string[];
  max_events: number;
}

export interface DailyDraft {
  user_intent: string;
  known_context: string[];
  constraints: string[];
  open_questions: string[];
}

export interface DailyOptions {
  dryRun?: boolean;
  yes?: boolean;
  keepSession?: boolean;
  maxToolRounds?: number;
  mcpBaseUrl?: string;
  mcpToken?: string;
}

export interface DailySession {
  root: string;
  messagesDir: string;
  toolsFile: string;
  promptpileConfig: string;
  draftFile: string;
  playerContextRoot: string;
}

export interface WorldFileChange { relativePath: string; content: string; }
export interface GatewayHandle { baseUrl: string; token?: string; stop(): Promise<void>; }
