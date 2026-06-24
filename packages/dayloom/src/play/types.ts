export type BeatStatus = 'pending' | 'active' | 'completed' | 'cancelled';
export type PlayStep = 'ready' | 'waiting_user' | 'resolving' | 'replanning' | 'complete';
export interface CurrentBeat { id: string; intent: string; priority: 'required' | 'optional'; status: BeatStatus; depends_on?: string[]; }
export interface CurrentPlan { day: string; user_intent: string; revision: number; max_events: number; beats: CurrentBeat[]; }
export interface PlayState { version: 1; day: string; phase: 'playing' | 'settling'; next_event_number: number; active_event: string | null; active_beat: string | null; step: PlayStep; completed_events: string[]; }
export interface GeneratedEvent { id: string; source_beat: string; title: string; scene_id?: string; opening: string; situation: string; suggested_actions: string[]; }
export interface EventStatus { status: 'ongoing' | 'resolved'; situation: string; needs_user_action: boolean; resolution_summary?: string; end_day?: boolean; }
export interface RuntimePatch { op: 'set'; key: string; value: string | number | boolean | null; }
export interface EventResult { event_id: string; source_beat: string; summary: string; protagonist_learned: string[]; time_advanced: string; completed_source_beat?: boolean; completed_beats?: string[]; cancelled_beats?: string[]; end_day?: boolean; state_patch: RuntimePatch[]; }
export type ReplanOperation = { op: 'complete' | 'cancel'; beat_id: string; reason?: string } | { op: 'modify'; beat_id: string; intent: string; reason: string } | { op: 'insert'; after?: string; intent: string; priority: 'required' | 'optional'; reason: string };
export interface ReplanPayload { operations: ReplanOperation[]; }
export interface PlayOptions { keepSession?: boolean; maxToolRounds?: number; maxEventRounds?: number; mcpBaseUrl?: string; mcpToken?: string; }
export interface PlayAiSession { root: string; messagesDir: string; toolsFile: string; promptpileConfig: string; draftFile: string; playerContextRoot: string; }
