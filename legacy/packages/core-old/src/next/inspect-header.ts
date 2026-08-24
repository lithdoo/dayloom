import fs from 'fs';
import path from 'path';
import { eventRoot, loadState } from '../play/state';
import type { GeneratedEvent } from '../play/types';
import { inspectNextState } from './inspect';

export interface TuiHeaderSnapshot {
  worldRoot: string;
  day?: string;
  phase?: string;
  eventTitle?: string;
  suggestedActions: string[];
}

export function inspectTuiHeader(dir: string): TuiHeaderSnapshot {
  const state = inspectNextState(dir);
  const snapshot: TuiHeaderSnapshot = {
    worldRoot: state.worldRoot,
    suggestedActions: [],
  };

  if (state.kind === 'uninitialized') {
    return snapshot;
  }

  snapshot.day = state.day;
  snapshot.phase = state.phase;

  if (state.phase !== 'playing') {
    return snapshot;
  }

  try {
    const playState = loadState(state.worldRoot, state.day);
    if (!playState.active_event) {
      return snapshot;
    }

    const eventFile = path.join(eventRoot(state.worldRoot, state.day, playState.active_event), 'event.json');
    if (!fs.existsSync(eventFile)) {
      return snapshot;
    }

    const event = JSON.parse(fs.readFileSync(eventFile, 'utf8')) as GeneratedEvent;
    if (typeof event.title === 'string' && event.title.trim() !== '') {
      snapshot.eventTitle = event.title.trim();
    }
    if (Array.isArray(event.suggested_actions)) {
      snapshot.suggestedActions = event.suggested_actions
        .filter((action): action is string => typeof action === 'string' && action.trim() !== '')
        .slice(0, 5);
    }
  } catch {
    return snapshot;
  }

  return snapshot;
}
