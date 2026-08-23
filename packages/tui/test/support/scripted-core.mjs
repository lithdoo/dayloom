export class ScriptedDayloomCore {
  constructor(options = {}) {
    this.world = options.world ?? { status: 'uninitialized' };
    this.session = options.session ?? null;
    this.listeners = new Set();
    this.calls = [];
    this.disposed = false;
    this.nextSessionId = 1;
    this.nextOperationId = 1;
    this.activeStreams = new Map();
    this.dayNumber = this.world.status === 'published' && this.world.day ? Number(this.world.day.replace(/\D/g, '')) || 1 : 1;
    this.sendScript = [...(options.sendScript ?? [])];
    this.handlers = { ...(options.handlers ?? {}) };
  }

  getState() {
    return structuredClone({ world: this.world, session: this.session, capabilities: capabilities(this.world, this.session, this.disposed) });
  }
  subscribe(listener) { if (this.disposed) return () => {}; this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(event) { for (const listener of [...this.listeners]) listener(structuredClone(event)); }
  changed() { this.emit({ type: 'state.changed', state: this.getState() }); }
  setState({ world = this.world, session = this.session } = {}) { this.world = world; this.session = session; this.changed(); }
  delta(sessionId, text) {
    const stream = this.ensureOutput(sessionId);
    this.emit({ type: 'output.delta', sessionId, operationId: stream.operationId, messageId: stream.messageId, text });
  }
  work(sessionId, phase, text, stepIndex = 0) {
    const stream = this.ensureWork(sessionId);
    this.emit({ type: 'work.delta', sessionId, operationId: stream.operationId, phase, stepIndex, text });
  }

  async startSession(kind) {
    this.calls.push(['startSession', kind]);
    if (this.handlers.startSession) return this.handlers.startSession(this, kind);
    if (!this.getState().capabilities.startSessions.includes(kind)) return failure('NOT_AVAILABLE', 'Session unavailable.');
    this.session = { id: `session-${this.nextSessionId++}`, kind, status: 'ready' }; this.changed(); return success();
  }
  async send(text) {
    this.calls.push(['send', text]);
    if (this.handlers.send) {
      const result = await this.handlers.send(this, text); this.finishOutput(this.session?.id ?? this.lastStreamSessionId, result); return result;
    }
    if (!this.session || this.session.status !== 'ready') return failure('NOT_AVAILABLE', 'send unavailable.');
    const id = this.session.id, kind = this.session.kind;
    this.session = { id, kind, status: 'running' }; this.changed();
    const script = this.sendScript.shift() ?? { deltas: ['ok'] };
    for (const delta of script.deltas ?? []) { if (script.delayMs) await delay(script.delayMs); this.delta(id, delta); }
    if (script.wait) await script.wait;
    if (script.failure) {
      if (script.terminal !== false) { this.session = null; this.changed(); }
      else { this.session = { id, kind, status: 'ready' }; this.changed(); }
      const result = failure(script.failure.code, script.failure.message); this.finishOutput(id, result); return result;
    }
    if (this.session?.id !== id) return failure('CANCELLED', 'cancelled');
    this.session = { id, kind, status: 'ready' }; this.changed(); const result = success(); this.finishOutput(id, result); return result;
  }
  async submit() {
    this.calls.push(['submit']);
    if (this.handlers.submit) return this.handlers.submit(this);
    if (!this.session || this.session.status !== 'ready') return failure('NOT_AVAILABLE', 'submit unavailable.');
    const kind = this.session.kind;
    this.session = { ...this.session, status: 'submitting' }; this.changed();
    this.session = null;
    if (kind === 'init') this.world = published({ revision: 1, phase: 'idle' });
    else if (kind === 'planning') this.world = published({ ...publishedFields(this.world), revision: revision(this.world) + 1, phase: 'planned', day: `day${this.dayNumber}` });
    else if (kind === 'play') this.world = published({ ...publishedFields(this.world), revision: revision(this.world) + 1, phase: 'awaiting-settle' });
    else this.world = published({ ...publishedFields(this.world), revision: revision(this.world) + 1 });
    this.changed(); return success();
  }
  async cancel() {
    this.calls.push(['cancel']);
    if (this.handlers.cancel) return this.handlers.cancel(this);
    if (!this.session || this.session.status === 'submitting') return failure('NOT_AVAILABLE', 'cancel unavailable.');
    this.session = null; this.changed(); return success();
  }
  async settle() {
    this.calls.push(['settle']);
    if (this.handlers.settle) return this.handlers.settle(this);
    if (this.world.status !== 'published' || this.world.phase !== 'awaiting-settle') return failure('NOT_AVAILABLE', 'settle unavailable.');
    const settledDay = this.world.day;
    this.world = published({ ...publishedFields(this.world), revision: this.world.revision + 1, phase: 'idle', day: null, lastSettledDay: settledDay });
    this.dayNumber += 1; this.changed(); return success();
  }
  async abandonDay() {
    this.calls.push(['abandonDay']);
    if (this.handlers.abandonDay) return this.handlers.abandonDay(this);
    if (this.world.status !== 'published' || !['planned', 'awaiting-settle'].includes(this.world.phase)) return failure('NOT_AVAILABLE', 'abandon unavailable.');
    this.world = published({ ...publishedFields(this.world), revision: this.world.revision + 1, phase: 'idle', day: null });
    this.changed(); return success();
  }
  async dispose() { this.calls.push(['dispose']); this.disposed = true; this.listeners.clear(); }

  ensureWork(sessionId) {
    let stream = this.activeStreams.get(sessionId);
    if (!stream) {
      const operationId = `operation-${this.nextOperationId++}`;
      stream = { operationId, messageId: `message-${operationId}`, workPath: `C:\\temp\\${operationId}`, outputStarted: false };
      this.activeStreams.set(sessionId, stream); this.lastStreamSessionId = sessionId;
      this.emit({ type: 'work.started', sessionId, operationId, workPath: stream.workPath });
    }
    return stream;
  }
  ensureOutput(sessionId) {
    const stream = this.ensureWork(sessionId);
    if (!stream.outputStarted) {
      this.emit({ type: 'work.completed', sessionId, operationId: stream.operationId, workPath: stream.workPath });
      this.emit({ type: 'output.started', sessionId, operationId: stream.operationId, messageId: stream.messageId });
      stream.outputStarted = true;
    }
    return stream;
  }
  finishOutput(sessionId, result) {
    if (!sessionId) return;
    const stream = this.activeStreams.get(sessionId); if (!stream) return;
    if (stream.outputStarted) this.emit({
      type: result.ok ? 'output.completed' : 'output.failed', sessionId, operationId: stream.operationId, messageId: stream.messageId,
      ...(result.ok ? {} : { message: result.error.message }),
    });
    this.activeStreams.delete(sessionId);
  }
}

export const success = () => ({ ok: true });
export const failure = (code, message) => ({ ok: false, error: { code, message } });
export const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
export const published = (overrides = {}) => ({
  status: 'published', worldId: 'world-1', title: 'World', revision: 1, commitId: 'commit-1',
  phase: 'idle', day: null, lastSettledDay: null, ...overrides,
});
export const invalid = (message = 'invalid world') => ({ status: 'invalid', error: { code: 'WORLD_INVALID', message } });

function capabilities(world, session, disposed) {
  if (disposed) return { startSessions: [], settle: false, abandonDay: false, send: false, submit: false, cancel: false };
  if (session) return {
    startSessions: [], settle: false, abandonDay: false,
    send: session.status === 'ready', submit: session.status === 'ready', cancel: session.status === 'ready' || session.status === 'running',
  };
  if (world.status === 'uninitialized') return { startSessions: ['init'], settle: false, abandonDay: false, send: false, submit: false, cancel: false };
  if (world.status !== 'published') return { startSessions: [], settle: false, abandonDay: false, send: false, submit: false, cancel: false };
  if (world.phase === 'idle') return { startSessions: ['planning', 'revise'], settle: false, abandonDay: false, send: false, submit: false, cancel: false };
  if (world.phase === 'planned') return { startSessions: ['play'], settle: false, abandonDay: true, send: false, submit: false, cancel: false };
  return { startSessions: [], settle: true, abandonDay: true, send: false, submit: false, cancel: false };
}
function publishedFields(world) { return world.status === 'published' ? world : {}; }
function revision(world) { return world.status === 'published' ? world.revision : 0; }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
