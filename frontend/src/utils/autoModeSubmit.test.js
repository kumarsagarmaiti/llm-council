import test from 'node:test';
import assert from 'node:assert/strict';

import { getAutoModeSubmitState } from './autoModeSubmit.js';

test('critical memory risk does not disable auto mode submission', () => {
  const state = getAutoModeSubmitState({
    isLoading: false,
    localModelCount: 3,
    memoryStatus: 'critical',
  });

  assert.equal(state.disabled, false);
  assert.equal(state.label, 'Run Anyway');
  assert.equal(state.danger, true);
});

test('still disables auto mode when not enough models are installed', () => {
  const state = getAutoModeSubmitState({
    isLoading: false,
    localModelCount: 1,
    memoryStatus: 'critical',
  });

  assert.equal(state.disabled, true);
});
