# Core Test Baseline

Stage 0 baseline recorded on 2026-07-22.

## Before Test Restructure

- Build: passed.
- Tests: 37 passed, 0 failed.
- Test layout: one `test/index.test.js` file.

## After Test Restructure

- Build: passed.
- Public type smoke check: passed.
- Existing behavior tests preserved: 37.
- Test-helper self-tests added: 4.
- Total tests: 41 passed, 0 failed.

Run the baseline with:

```bash
npm run test -w @dayloom/core
```
