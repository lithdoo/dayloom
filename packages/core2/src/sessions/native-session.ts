import path from 'path';
import { createRuntimeError } from '../errors';
import type { RuntimeInput, SessionKind } from '../types';
import {
  type Core2InitPayload,
  type Core2PlanningPayload,
  type Core2RevisePayload,
  WorldStore,
} from '../world-store';
import { createHandlerSessionFactory, type HandlerSessionHandler } from './handler-session';

/** Core2 原生业务 Session 工厂配置。 */
export interface Core2NativeSessionFactoryOptions {
  /** 当前 world 根目录。 */
  worldRoot: string;
}

/** 创建 core2-native 业务 Session 工厂。 */
export function createCore2NativeSessionFactory(options: Core2NativeSessionFactoryOptions) {
  const store = new WorldStore(options.worldRoot);
  return createHandlerSessionFactory((kind) => createNativeHandler(kind, store));
}

function createNativeHandler(kind: SessionKind, store: WorldStore): HandlerSessionHandler {
  switch (kind) {
    case 'init':
      return createInitHandler(store);
    case 'planning':
      return createPlanningHandler(store);
    case 'revise':
      return createReviseHandler(store);
    case 'play':
      return createUnsupportedPlayHandler();
  }
}

function createInitHandler(store: WorldStore): HandlerSessionHandler {
  let payload: Core2InitPayload | null = null;
  return {
    start: (_context, emit) => {
      emit.system('Provide init JSON with id and title.');
    },
    sendInput: async (input, _context, emit) => {
      const parsed = parseJsonObject(input);
      payload = normalizeInitPayload(parsed, store.worldRoot);
      emit.assistant('Init payload accepted.');
    },
    submit: async () => {
      if (!payload) {
        throw createRuntimeError('SESSION_FAILED', 'Init payload was not provided.');
      }
      store.initialize(payload);
      return payload;
    },
  };
}

function createPlanningHandler(store: WorldStore): HandlerSessionHandler {
  let payload: Core2PlanningPayload | null = null;
  return {
    start: (_context, emit) => {
      emit.system('Provide planning JSON with day, intent, and beats.');
    },
    sendInput: async (input, _context, emit) => {
      payload = normalizePlanningPayload(parseJsonObject(input));
      emit.assistant('Planning payload accepted.');
    },
    submit: async () => {
      if (!payload) {
        throw createRuntimeError('SESSION_FAILED', 'Planning payload was not provided.');
      }
      store.writePlan(payload);
      return payload;
    },
  };
}

function createReviseHandler(store: WorldStore): HandlerSessionHandler {
  let payload: Core2RevisePayload | null = null;
  return {
    start: (_context, emit) => {
      emit.system('Provide revise JSON with summary and documents.');
    },
    sendInput: async (input, _context, emit) => {
      payload = normalizeRevisePayload(parseJsonObject(input));
      emit.assistant('Revise payload accepted.');
    },
    submit: async () => {
      if (!payload) {
        throw createRuntimeError('SESSION_FAILED', 'Revise payload was not provided.');
      }
      store.applyRevision(payload);
      return payload;
    },
  };
}

function createUnsupportedPlayHandler(): HandlerSessionHandler {
  return {
    start: (_context, emit) => {
      emit.system('Play Session is not connected yet; core2-native play still needs a dedicated design.');
    },
    sendInput: async () => {
      throw createRuntimeError(
        'SESSION_FAILED',
        'Play Session is not connected yet; core2-native play still needs a dedicated design.',
      );
    },
    submit: async () => {
      throw createRuntimeError('COMMAND_NOT_AVAILABLE', 'Play Session is not ready to submit.');
    },
  };
}

function normalizeInitPayload(input: Record<string, unknown>, worldRoot: string): Core2InitPayload {
  const fallbackId = path.basename(worldRoot) || 'world';
  const id = stringField(input, 'id') ?? fallbackId;
  const title = stringField(input, 'title') ?? id;
  return {
    id,
    title,
    premise: stringField(input, 'premise') ?? '',
    rules: stringField(input, 'rules') ?? '',
    style: stringField(input, 'style') ?? '',
    userRole: stringField(input, 'userRole') ?? stringField(input, 'user_role') ?? '',
  };
}

function normalizePlanningPayload(input: Record<string, unknown>): Core2PlanningPayload {
  const day = requiredString(input, 'day');
  const intent = requiredString(input, 'intent');
  const beatsValue = input.beats;
  if (!Array.isArray(beatsValue) || beatsValue.length === 0) {
    throw createRuntimeError('SESSION_FAILED', 'Planning payload requires non-empty beats.');
  }
  return {
    day,
    intent,
    beats: beatsValue.map((beat, index) => {
      if (!isRecord(beat)) {
        throw createRuntimeError('SESSION_FAILED', `Beat ${index} must be an object.`);
      }
      return {
        id: requiredString(beat, 'id'),
        intent: requiredString(beat, 'intent'),
      };
    }),
  };
}

function normalizeRevisePayload(input: Record<string, unknown>): Core2RevisePayload {
  const summary = requiredString(input, 'summary');
  const documentsValue = input.documents;
  if (!Array.isArray(documentsValue) || documentsValue.length === 0) {
    throw createRuntimeError('SESSION_FAILED', 'Revise payload requires non-empty documents.');
  }
  return {
    summary,
    documents: documentsValue.map((document, index) => {
      if (!isRecord(document)) {
        throw createRuntimeError('SESSION_FAILED', `Document ${index} must be an object.`);
      }
      return {
        path: requiredString(document, 'path'),
        content: requiredString(document, 'content'),
      };
    }),
  };
}

function parseJsonObject(input: RuntimeInput): Record<string, unknown> {
  try {
    const parsed = JSON.parse(input.text);
    if (!isRecord(parsed)) {
      throw createRuntimeError('SESSION_FAILED', 'Input JSON must be an object.');
    }
    return parsed;
  } catch (error) {
    if (isRuntimeLikeError(error)) {
      throw error;
    }
    throw createRuntimeError('SESSION_FAILED', 'Input must be valid JSON.', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = stringField(input, key);
  if (!value) {
    throw createRuntimeError('SESSION_FAILED', `Field ${key} must be a non-empty string.`);
  }
  return value;
}

function stringField(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRuntimeLikeError(error: unknown): boolean {
  return isRecord(error) && typeof error.code === 'string' && typeof error.message === 'string';
}
