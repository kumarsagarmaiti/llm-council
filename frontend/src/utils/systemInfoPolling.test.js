import test from 'node:test';
import assert from 'node:assert/strict';

import { SYSTEM_INFO_POLL_MS, shouldPollSystemInfo } from './systemInfoPolling.js';

test('system info polling interval stays short enough for live RAM updates', () => {
  assert.equal(SYSTEM_INFO_POLL_MS, 15000);
});

test('polling only runs while the document is visible', () => {
  assert.equal(shouldPollSystemInfo('visible'), true);
  assert.equal(shouldPollSystemInfo('hidden'), false);
});
