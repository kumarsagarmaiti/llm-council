import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizePullProgress } from './pullProgress.js';

test('shows determinate download progress while blobs are downloading', () => {
  const state = normalizePullProgress({
    status: 'pulling 123abc',
    completed: 25,
    total: 100,
  });

  assert.equal(state.phase, 'downloading');
  assert.equal(state.label, 'pulling 123abc');
  assert.equal(state.showSpinner, false);
  assert.equal(state.showProgressBar, true);
  assert.equal(state.percent, 25);
});

test('switches to verifying spinner for sha verification phases', () => {
  const state = normalizePullProgress({
    status: 'verifying sha256 digest',
    completed: 80,
    total: 100,
  });

  assert.equal(state.phase, 'verifying');
  assert.equal(state.label, 'Verifying...');
  assert.equal(state.showSpinner, true);
  assert.equal(state.showProgressBar, false);
  assert.equal(state.percent, null);
});

test('keeps download bar for pulling sha256 blob statuses', () => {
  const state = normalizePullProgress({
    status: 'pulling sha256:abcdef123456',
    completed: 40,
    total: 100,
  });

  assert.equal(state.phase, 'downloading');
  assert.equal(state.showSpinner, false);
  assert.equal(state.showProgressBar, true);
  assert.equal(state.percent, 40);
});

test('treats manifest write and digest steps as verifying work', () => {
  assert.equal(normalizePullProgress({ status: 'writing manifest' }).phase, 'verifying');
  assert.equal(normalizePullProgress({ status: 'success' }).phase, 'complete');
});
