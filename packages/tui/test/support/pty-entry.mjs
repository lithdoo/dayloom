import path from 'node:path';
import { mountApp } from '../../dist/app.js';
import { createViewModel } from '../../dist/view-model.js';
import { createRuntimeDriverFromCoreForTest } from '../../dist/runtime-driver/create-runtime-driver-from-core-for-test.js';
import { ScriptedDayloomCore } from './scripted-core.mjs';

const scenario = process.env.DAYLOOM_TUI_TEST_SCENARIO ?? 'success';
const sendScript = scenario === 'failure'
  ? [{ deltas: ['部分回复'], failure: { code: 'AGENT_FAILED', message: 'provider failed' } }]
  : scenario === 'slow'
    ? [{ deltas: ['第一段', '不应显示的第二段'], delayMs: 350 }]
    : [{ deltas: ['这是连续输出的中文回复，', '用于验证流式片段聚合。'] }];
const core = new ScriptedDayloomCore({ sendScript });
const driver = createRuntimeDriverFromCoreForTest({ worldRoot: path.resolve(process.env.DAYLOOM_TUI_TEST_WORLD ?? 'scripted-world'), core });
let mounted;
let stopping;
const shutdown = () => {
  if (stopping) return stopping;
  mounted?.dispose(); mounted = undefined;
  stopping = vm.dispose();
  return stopping;
};
const exit = () => { void shutdown().then(() => process.exit(0), () => process.exit(1)); };
const vm = createViewModel(driver, { onExitRequest: exit });
mounted = mountApp(vm, { onExitRequest: exit });
