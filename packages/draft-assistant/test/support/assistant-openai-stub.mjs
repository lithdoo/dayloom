import http from 'node:http';

export function startAssistantOpenAiStub(options = {}) {
  const phases = [];
  let dialogueObserveCount = 0;
  let syncThoughtCount = 0;
  let lastDecision = false;
  let sawRepairCarryover = false;
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      if (request.method !== 'POST' || !String(request.url).includes('/chat/completions')) {
        response.writeHead(404).end();
        return;
      }
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const phase = classify(body);
        phases.push(phase);
        const reply = options.reply ?? 'What should the central mystery conceal?';
        if (phase === 'dialogue-thought') {
          if (JSON.stringify(body.messages ?? []).includes('The candidate took away player agency.')) sawRepairCarryover = true;
          return content(response, reply);
        }
        if (phase === 'dialogue-observe') {
          dialogueObserveCount += 1;
          const reject = options.alwaysReject === true || (options.repairOnce === true && dialogueObserveCount === 1);
          lastDecision = reject;
          return content(response, reject
            ? '[REVIEW]\nThe candidate took away player agency. Repair it.\n\n[USER_REPLY]\n<none>\n\n[SHOULD_CONTINUE]\ntrue'
            : `[REVIEW]\n<none>\n\n[USER_REPLY]\n${reply}\n\n[SHOULD_CONTINUE]\nfalse`);
        }
        if (phase === 'dialogue-final') return content(response, reply);
        if (phase === 'sync-thought') {
          syncThoughtCount += 1;
          const transcript = JSON.stringify(body.messages ?? []);
          const draftContent = typeof options.draftContent === 'function'
            ? options.draftContent({ syncThoughtCount, transcript })
            : options.draftContent ?? '# Initialization intent\nA quiet town with a central mystery.\n';
          return tool(response, `write-draft-${syncThoughtCount}`, 'mcp__draft__write_file', { path: options.draftPath ?? 'intent.md', content: draftContent });
        }
        if (phase === 'sync-observe') { lastDecision = false; return content(response, '[REVIEW]\n<none>\n\n[SHOULD_CONTINUE]\nfalse'); }
        if (phase === 'check') return tool(response, `check-${phases.length}`, 'react_check_decision', { decision: lastDecision });
        response.writeHead(500).end(`unknown phase: ${phase}`);
      });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}/v1`, phases,
        sawRepairCarryover: () => sawRepairCarryover,
        close: () => new Promise((done, fail) => server.close((error) => error ? fail(error) : done())),
      });
    });
  });
}

function classify(body) {
  const names = (body.tools ?? []).flatMap((entry) => {
    const name = entry?.function?.name ?? entry?.name;
    return typeof name === 'string' ? [name] : [];
  });
  if (names.includes('react_check_decision')) return 'check';
  if (names.some((name) => name.startsWith('mcp__draft__'))) return 'sync-thought';
  const messages = [...(body.messages ?? [])].reverse();
  for (const message of messages) {
    const value = typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content ?? '');
    if (value.includes('Copy the latest approved [USER_REPLY]')) return 'dialogue-final';
    if (value.includes('Audit the candidate reply for Dayloom')) return 'dialogue-observe';
    if (value.includes('You are the Dialogue Thought phase')) return 'dialogue-thought';
    if (value.includes('Audit Draft against the currently valid')) return 'sync-observe';
  }
  return 'unknown';
}

function content(response, value) {
  sse(response, { content: value }, 'stop');
}

function tool(response, id, name, args) {
  sse(response, { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, 'tool_calls');
}

function sse(response, delta, finishReason) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\n`);
  response.write('data: [DONE]\n\n');
  response.end();
}
