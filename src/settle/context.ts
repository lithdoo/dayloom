import fs from 'fs';
import path from 'path';
import { buildPlayerContext } from '../daily/player-context';

const TRANSCRIPT_TAIL = 6000;

export function buildSettlementPlayerContext(worldRoot: string, day: string, outputRoot: string): void {
  buildPlayerContext(worldRoot, outputRoot);
  const today = path.join(outputRoot, 'today');
  fs.mkdirSync(today, { recursive: true });
  for (const name of ['plan.user.md', 'plan.initial.json', 'plan.current.json', 'play.state.json', 'runtime.state.json']) {
    copyIfExists(path.join(worldRoot, 'days', day, name), path.join(today, name));
  }
  const eventsSource = path.join(worldRoot, 'days', day, 'events');
  const eventsTarget = path.join(today, 'events');
  if (!fs.existsSync(eventsSource)) return;
  for (const eventId of fs.readdirSync(eventsSource).sort()) {
    for (const name of ['event.json', 'status.json', 'result.json']) {
      copyIfExists(path.join(eventsSource, eventId, name), path.join(eventsTarget, eventId, name));
    }
  }
}

export function buildSettlementPromptInput(worldRoot: string, day: string): string {
  const dayRoot = path.join(worldRoot, 'days', day);
  const sections: string[] = [
    section('Current day', day),
    fileSection('User plan', path.join(dayRoot, 'plan.user.md')),
    fileSection('Final plan state', path.join(dayRoot, 'plan.current.json')),
    fileSection('Runtime state', path.join(dayRoot, 'runtime.state.json')),
    fileSection('Existing short-term memory', path.join(worldRoot, 'memory', 'short_term.md')),
    fileSection('Existing unresolved threads', path.join(worldRoot, 'memory', 'unresolved_threads.yaml')),
  ];

  const eventsRoot = path.join(dayRoot, 'events');
  if (fs.existsSync(eventsRoot)) {
    for (const eventId of fs.readdirSync(eventsRoot).sort()) {
      const eventRoot = path.join(eventsRoot, eventId);
      const eventParts = [
        fileSection('Event definition', path.join(eventRoot, 'event.json')),
        fileSection('Final status', path.join(eventRoot, 'status.json')),
        fileSection('Event result', path.join(eventRoot, 'result.json')),
      ];
      const transcriptPath = path.join(eventRoot, 'transcript.md');
      if (fs.existsSync(transcriptPath)) {
        const transcript = fs.readFileSync(transcriptPath, 'utf8');
        eventParts.push(section('Transcript tail', transcript.slice(-TRANSCRIPT_TAIL)));
      }
      sections.push(section(`Event ${eventId}`, eventParts.filter(Boolean).join('\n\n')));
    }
  }

  return sections.filter(Boolean).join('\n\n');
}

function copyIfExists(source: string, target: string): void {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function fileSection(title: string, filePath: string): string {
  return fs.existsSync(filePath) ? section(title, fs.readFileSync(filePath, 'utf8')) : '';
}

function section(title: string, content: string): string {
  return `# ${title}\n\n${content.trim()}`;
}
