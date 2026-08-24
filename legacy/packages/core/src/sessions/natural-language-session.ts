import { createRuntimeError } from '../errors';
import type { RuntimeInput, SessionContext, SessionKind, SessionSubmitResult } from '../types';
import type { ResolvedPlanBeat } from '../schemas/submissions';
import type {
  ConversationClient,
  ConversationMessage,
  ConversationRequest,
} from './conversation-client';
import { parseGeneratedInit, parseGeneratedPlanning, parseGeneratedRevise } from './generated-payload';
import {
  createHandlerSessionFactory,
  type HandlerSessionEmitter,
  type HandlerSessionHandler,
} from './handler-session';
import type { SessionWorldContext, SessionWorldReadModel } from './world-read-model';

/** 自然语言业务 Session 工厂配置。 */
export interface NaturalLanguageSessionFactoryOptions {
  /** 提供与具体存档布局无关的只读 World 数据。 */
  readModel: SessionWorldReadModel;

  /** 实际调用模型的 provider client。 */
  client: ConversationClient;
}

/** 创建 init/planning/play/revise 自然语言业务 Session 工厂。 */
export function createNaturalLanguageSessionFactory(
  options: NaturalLanguageSessionFactoryOptions,
) {
  return createHandlerSessionFactory((kind) => createNaturalLanguageHandler(
    kind,
    options.readModel,
    options.client,
  ));
}

function createNaturalLanguageHandler(
  kind: SessionKind,
  readModel: SessionWorldReadModel,
  client: ConversationClient,
): HandlerSessionHandler {
  const messages: ConversationMessage[] = [];
  let messageCounter = 1;
  let transcriptSequence = 1;

  return {
    start: async (context, emit) => {
      const opening = openingMessage(kind);
      messages.push({ role: 'assistant', text: opening });
      emit.assistant(opening);
      await context.workspace.appendTranscript({
        sequence: transcriptSequence++,
        role: 'assistant',
        text: opening,
        messageId: null,
      });
      await writeConversationCheckpoint(context, kind, messages);
    },
    sendInput: async (input, context, emit, signal) => {
      messages.push({ role: 'user', text: input.text });
      await context.workspace.appendTranscript({
        sequence: transcriptSequence++,
        role: 'user',
        text: input.text,
        messageId: input.operationId ?? null,
      });
      const world = await readModel.read(context.world);
      const request: ConversationRequest = {
        kind,
        purpose: 'dialogue',
        systemPrompt: dialoguePrompt(kind, formatWorldContext(world)),
        messages,
        signal,
      };
      const messageId = `natural:${kind}:assistant:${messageCounter++}`;
      let assistantText = '';
      await emit.stream(messageId, capture(client.streamReply(request), (delta) => {
        assistantText += delta;
      }), signal);
      messages.push({ role: 'assistant', text: assistantText });
      await context.workspace.appendTranscript({
        sequence: transcriptSequence++,
        role: 'assistant',
        text: assistantText,
        messageId,
      });
      await writeConversationCheckpoint(context, kind, messages);
    },
    submit: async (context) => {
      const signal = new AbortController().signal;
      const world = await readModel.read(context.world);
      const output = await collect(client.streamReply({
        kind,
        purpose: 'submit',
        systemPrompt: submitPrompt(kind, context, formatWorldContext(world)),
        messages,
        signal,
      }));
      const parsed = parseJsonObject(output);
      return applyPayload(kind, parsed, context, messages, world);
    },
  };
}

function applyPayload(
  kind: SessionKind,
  parsed: Record<string, unknown>,
  context: SessionContext,
  messages: readonly ConversationMessage[],
  world: SessionWorldContext,
): SessionSubmitResult {
  switch (kind) {
    case 'init': {
      const payload = parseGeneratedInit(parsed, fallbackWorldId(context.world.worldRoot));
      return {
        kind: 'init',
        world: { id: payload.id, title: payload.title },
        canon: {
          premise: payload.premise ?? '',
          rules: payload.rules ?? '',
          style: payload.style ?? '',
          userRole: payload.userRole ?? '',
        },
      };
    }
    case 'planning': {
      const payload = parseGeneratedPlanning(parsed, context.world.day ?? 'day_0001');
      return { kind: 'planning', day: payload.day, intent: payload.intent, beats: payload.beats };
    }
    case 'play': {
      const day = context.world.day;
      if (!day) {
        throw createRuntimeError('SESSION_FAILED', 'Play Session requires a current day.');
      }
      const summary = stringValue(parsed.summary);
      if (!summary) {
        throw createRuntimeError('SESSION_FAILED', 'Play payload requires a non-empty summary.');
      }
      const events = buildPlayEvents(messages);
      const beats = resolvePlanBeats(world, events);
      return {
        kind: 'play',
        day,
        summary,
        beats,
        events: events.map((event, index) => ({
          ...event,
          beatId: world.day?.plan.beats[index]?.id ?? null,
        })),
        transcript: messages.map((message, index) => ({
          sequence: index + 1,
          role: message.role,
          text: message.text,
          messageId: null,
        })),
      };
    }
    case 'revise': {
      const payload = parseGeneratedRevise(parsed);
      return {
        kind: 'revise',
        summary: payload.summary,
        canon: mergeCanonDocuments(world, payload.documents),
      };
    }
  }
}

function resolvePlanBeats(
  world: SessionWorldContext,
  events: ReturnType<typeof buildPlayEvents>,
): ResolvedPlanBeat[] {
  return (world.day?.plan.beats ?? []).map((beat, index) => ({
    id: beat.id,
    intent: beat.intent,
    status: events[index] ? 'completed' : 'pending',
    eventId: events[index]?.id ?? null,
  }));
}

function buildPlayEvents(messages: readonly ConversationMessage[]) {
  const events: Array<{ id: string; userInput: string; assistantOutput: string }> = [];
  for (let index = 0; index < messages.length; index += 1) {
    const user = messages[index];
    if (user?.role !== 'user') continue;
    const assistant = messages.slice(index + 1).find((message) => message.role === 'assistant');
    if (!assistant) continue;
    events.push({
      id: `event_${String(events.length + 1).padStart(4, '0')}`,
      userInput: user.text,
      assistantOutput: assistant.text,
    });
  }
  return events;
}

function openingMessage(kind: SessionKind): string {
  switch (kind) {
    case 'init':
      return '我们先一起确定这个世界的背景、规则、文风和主角。你想从什么样的世界开始？';
    case 'planning':
      return '今天想让主角做什么？可以先说目标、顾虑或想探索的方向。';
    case 'play':
      return '行动阶段已经开始。告诉我主角接下来准备怎么做。';
    case 'revise':
      return '你想调整哪些世界设定？可以描述目标，我会先和你确认修改内容。';
  }
}

function dialoguePrompt(kind: SessionKind, worldContext: string): string {
  const task = {
    init: '通过简短多轮对话收集世界背景、规则、文风、主角身份和重要人物。',
    planning: '帮助用户形成今天的方向性计划，不替用户决定，不描写行动结果。',
    play: '根据已有计划推进当前行动，回应用户选择，但不要自行结束当天。',
    revise: '讨论用户想修改的世界设定，先澄清目标，不要声称已经写入文件。',
  }[kind];
  return [
    '你是 Dayloom 的自然语言业务会话助手。',
    task,
    '使用与用户相同的语言，回复应自然、简洁，每轮最多追问三个相关问题。',
    '不要输出 JSON、代码块、CLI 前缀或斜杠指令。',
    '只有程序收到显式 /submit 后才会生成并应用结构化产物。',
    worldContext ? `\n当前只读 World 上下文：\n${worldContext}` : '',
  ].join('\n');
}

function submitPrompt(kind: SessionKind, context: SessionContext, worldContext: string): string {
  const schema = {
    init: '{"id":"world-id","title":"标题","premise":"世界前提","rules":"规则","style":"文风","userRole":"主角身份与目标"}',
    planning: `{"day":"${context.world.day ?? 'day_0001'}","intent":"今日意图","beats":[{"id":"beat_001","intent":"行动方向"}]}`,
    play: '{"summary":"本次行动及结果的简洁摘要"}',
    revise: '{"summary":"修订摘要","documents":[{"path":"canon/style.md","content":"完整替换内容"}]}',
  }[kind];
  return [
    '你是 Dayloom 的提交产物生成器。',
    '根据完整对话生成一个 JSON 对象，不要输出解释、Markdown 或代码围栏。',
    `必须符合这个形状：${schema}`,
    '不得编造对话中没有依据的关键设定。',
    kind === 'revise'
      ? 'documents.path 必须是 world 根目录内的相对路径，只输出确实需要修改的完整文档。'
      : '',
    worldContext ? `\n当前只读 World 上下文：\n${worldContext}` : '',
  ].filter(Boolean).join('\n');
}

async function* capture(
  source: AsyncIterable<string>,
  onDelta: (delta: string) => void,
): AsyncIterable<string> {
  for await (const delta of source) {
    onDelta(delta);
    yield delta;
  }
}

async function collect(source: AsyncIterable<string>): Promise<string> {
  let output = '';
  for await (const delta of source) {
    output += delta;
  }
  return output;
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1);
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (!isRecord(parsed)) {
      throw new Error('Generated payload is not an object.');
    }
    return parsed;
  } catch (error) {
    throw createRuntimeError('SESSION_FAILED', 'AI generated an invalid submit payload.', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function formatWorldContext(world: SessionWorldContext): string {
  const sections: string[] = [];
  let remaining = 48_000;
  const values: Array<[string, unknown]> = [];
  if (world.canon) values.push(['canon', world.canon]);
  if (world.day) values.push(['day', world.day]);
  for (const [label, value] of values) {
    if (remaining <= 0) break;
    const content = JSON.stringify(value, null, 2).slice(0, remaining);
    remaining -= content.length;
    sections.push(`## ${label}\n${content}`);
  }
  return sections.join('\n\n');
}

function mergeCanonDocuments(
  world: SessionWorldContext,
  documents: Array<{ path: string; content: string }>,
) {
  const canon = { premise: '', rules: '', style: '', userRole: '', ...world.canon };
  for (const document of documents) {
    const normalized = document.path.replace(/\\/g, '/');
    if (normalized === 'canon/premise.md') canon.premise = document.content;
    if (normalized === 'canon/rules.md') canon.rules = document.content;
    if (normalized === 'canon/style.md') canon.style = document.content;
    if (normalized === 'canon/user-role.md') canon.userRole = document.content;
  }
  return canon;
}

function fallbackWorldId(worldRoot: string): string {
  const normalized = worldRoot.replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || 'world';
}

async function writeConversationCheckpoint(
  context: SessionContext,
  kind: SessionKind,
  messages: readonly ConversationMessage[],
): Promise<void> {
  await context.workspace.writeCheckpoint({
    kind,
    messages: messages.map((message) => ({ role: message.role, text: message.text })),
  });
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
