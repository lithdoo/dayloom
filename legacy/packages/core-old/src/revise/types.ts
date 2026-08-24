export type CanonSection = 'premise' | 'rules' | 'style' | 'user_role';

export interface EntityMeta { status?: string; tags?: string[]; }
export interface ReplaceCanonOperation { op: 'replace_canon'; section: CanonSection; content: string; }
export interface UpsertCharacterOperation { op: 'upsert_character'; id: string; profileMd: string; relationshipsMd?: string; meta?: EntityMeta; }
export interface UpsertSceneOperation { op: 'upsert_scene'; id: string; profileMd: string; meta?: EntityMeta; }
export type ReviseOperation = ReplaceCanonOperation | UpsertCharacterOperation | UpsertSceneOperation;
export interface RevisePayload { summary: string; operations: ReviseOperation[]; }
export interface PendingChange { target: Record<string, unknown>; instruction: string; }
export interface ReviseDraft { pending_changes: PendingChange[]; }
export interface ReviseOptions { dryRun?: boolean; yes?: boolean; keepSession?: boolean; maxToolRounds?: number; mcpBaseUrl?: string; mcpToken?: string; }
export interface ReviseSession { root: string; messagesDir: string; toolsFile: string; promptpileConfig: string; draftFile: string; }
export interface WorldFileChange { relativePath: string; content: string; }
export interface FileHashSnapshot { relativePath: string; exists: boolean; sha256?: string; }
export interface GatewayHandle { baseUrl: string; token?: string; stop(): Promise<void>; }
