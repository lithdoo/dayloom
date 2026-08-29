import http from 'node:http';

const OBSERVE_TEXT = `[EVIDENCE]
Wrote the granted Draft file.
[REMAINING]
<none>
[SHOULD_CONTINUE]
false
`;

const FINAL_TEXT = 'Created the draft.';

export function startOpenAiStub(options = {}) {
  const write = options.write ?? { path: 'new-draft.md', content: '# New World\n' };
  const observe = options.observe ?? OBSERVE_TEXT;
  const final = options.final ?? FINAL_TEXT;
  const phases = [];

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || !String(req.url ?? '').includes('/chat/completions')) {
        res.writeHead(404);
        res.end();
        return;
      }
      const chunks = [];
      req.on('data', (chunk) => {
        if (chunks.reduce((sum, part) => sum + part.length, 0) < 2 * 1024 * 1024) chunks.push(chunk);
      });
      req.on('end', () => {
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          res.writeHead(400);
          res.end();
          return;
        }
        const phase = classifyPhase(body);
        phases.push(phase);
        if (phase === 'thought') {
          writeSse(res, {
            tool_calls: [{
              index: 0,
              id: 'call_write_draft',
              type: 'function',
              function: {
                name: 'mcp__draft__write_file',
                arguments: JSON.stringify({ path: write.path, content: write.content }),
              },
            }],
          }, 'tool_calls');
          return;
        }
        if (phase === 'check') {
          writeSse(res, {
            tool_calls: [{
              index: 0,
              id: 'call_check',
              type: 'function',
              function: {
                name: 'react_check_decision',
                arguments: JSON.stringify({ decision: false }),
              },
            }],
          }, 'tool_calls');
          return;
        }
        writeSse(res, { content: phase === 'observe' ? observe : final }, 'stop');
      });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('OpenAI stub could not bind a loopback port.'));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        phases,
        final,
        close() {
          return new Promise((done, fail) => {
            server.close((error) => error ? fail(error) : done());
          });
        },
      });
    });
  });
}

function classifyPhase(body) {
  const names = toolNames(body);
  if (names.includes('react_check_decision')) return 'check';
  if (names.some((name) => name.startsWith('mcp__'))) return 'thought';
  const text = JSON.stringify(body.messages ?? []);
  if (text.includes('Final text is not a structured result') || text.includes('does not submit the Draft')) {
    return 'final';
  }
  return 'observe';
}

function toolNames(body) {
  if (!Array.isArray(body.tools)) return [];
  return body.tools.flatMap((tool) => {
    if (tool && typeof tool === 'object' && tool.function && typeof tool.function.name === 'string') {
      return [tool.function.name];
    }
    if (tool && typeof tool === 'object' && typeof tool.name === 'string') return [tool.name];
    return [];
  });
}

function writeSse(res, delta, finishReason) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}
