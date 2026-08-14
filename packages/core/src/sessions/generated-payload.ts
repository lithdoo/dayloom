import { createRuntimeError } from '../errors';

export interface GeneratedInitPayload {
  id: string;
  title: string;
  premise: string;
  rules: string;
  style: string;
  userRole: string;
}

export interface GeneratedPlanningPayload {
  day: string;
  intent: string;
  beats: Array<{ id: string; intent: string }>;
}

export interface GeneratedRevisePayload {
  summary: string;
  documents: Array<{ path: string; content: string }>;
}

/** 校验模型生成的初始化对象，并补齐安全默认值。 */
export function parseGeneratedInit(
  input: Record<string, unknown>,
  fallbackId: string,
): GeneratedInitPayload {
  const id = stringField(input, 'id') || fallbackId || 'world';
  return {
    id,
    title: stringField(input, 'title') || id,
    premise: stringField(input, 'premise') ?? '',
    rules: stringField(input, 'rules') ?? '',
    style: stringField(input, 'style') ?? '',
    userRole: stringField(input, 'userRole') ?? stringField(input, 'user_role') ?? '',
  };
}

/** 校验模型生成的计划对象。 */
export function parseGeneratedPlanning(
  input: Record<string, unknown>,
  fallbackDay: string,
): GeneratedPlanningPayload {
  const beats = input.beats;
  if (!Array.isArray(beats) || beats.length === 0) {
    throw createRuntimeError('SESSION_FAILED', 'Planning payload requires non-empty beats.');
  }
  return {
    day: stringField(input, 'day') || fallbackDay,
    intent: requiredString(input, 'intent'),
    beats: beats.map((beat, index) => {
      if (!isRecord(beat)) {
        throw createRuntimeError('SESSION_FAILED', `Beat ${index} must be an object.`);
      }
      return { id: requiredString(beat, 'id'), intent: requiredString(beat, 'intent') };
    }),
  };
}

/** 校验模型生成的 canon 修订对象。 */
export function parseGeneratedRevise(input: Record<string, unknown>): GeneratedRevisePayload {
  const documents = input.documents;
  if (!Array.isArray(documents) || documents.length === 0) {
    throw createRuntimeError('SESSION_FAILED', 'Revise payload requires non-empty documents.');
  }
  return {
    summary: requiredString(input, 'summary'),
    documents: documents.map((document, index) => {
      if (!isRecord(document)) {
        throw createRuntimeError('SESSION_FAILED', `Document ${index} must be an object.`);
      }
      return { path: requiredString(document, 'path'), content: requiredString(document, 'content') };
    }),
  };
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = stringField(input, key);
  if (!value) throw createRuntimeError('SESSION_FAILED', `Field ${key} must be a non-empty string.`);
  return value;
}

function stringField(input: Record<string, unknown>, key: string): string | null {
  return typeof input[key] === 'string' ? input[key] as string : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
