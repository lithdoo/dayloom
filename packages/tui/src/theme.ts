import type { TuiMessageRole } from './view-model.js';

export function roleLabel(role: TuiMessageRole): string {
  switch (role) {
    case 'warn':
      return 'warn';
    case 'error':
      return 'error';
    case 'system':
      return 'sys';
    case 'output':
      return 'out';
  }
}

export function roleColor(role: TuiMessageRole): string {
  switch (role) {
    case 'warn':
      return 'yellow';
    case 'error':
      return 'red';
    case 'system':
      return 'cyan';
    case 'output':
      return 'white';
  }
}
