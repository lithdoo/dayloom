import type { CanonDocuments } from '../schemas/submissions';
import type {
  AbandonedDocument,
  DayRevisionMeta,
  PlanDocument,
  PlayDocument,
  PlayEventDocument,
  SettlementDocument,
} from '../schemas/archive';
import type { TranscriptEntry } from '../schemas/submissions';
import type { WorldSnapshot } from '../types';

/** Session 可读取的当前 day 完整快照。 */
export interface SessionDayContext {
  meta: DayRevisionMeta;
  plan: PlanDocument;
  play: PlayDocument | null;
  events: PlayEventDocument[];
  transcript: TranscriptEntry[];
  settlement: SettlementDocument | null;
  abandoned: AbandonedDocument | null;
}

/** Session 构造 prompt 和 submission 时可读取的结构化 World 数据。 */
export interface SessionWorldContext {
  canon: CanonDocuments | null;
  day: SessionDayContext | null;
}

/** Session 使用的只读数据端口；具体存档布局由外部 adapter 隐藏。 */
export interface SessionWorldReadModel {
  read(snapshot: Readonly<WorldSnapshot>): Promise<SessionWorldContext>;
}
