import test from 'node:test';
import assert from 'node:assert/strict';

import { assessCouncilMemory, estimateModelRuntimeGb } from './councilMemory.js';

test('uses installed model size for runtime estimate', () => {
  const estimate = estimateModelRuntimeGb('llama3.1:latest', [
    { name: 'llama3.1:latest', size: 8 * 1024 ** 3 },
  ]);

  assert.equal(estimate, 12.3);
});

test('warns when free memory is much lower than total memory', () => {
  const assessment = assessCouncilMemory(
    ['llama3.1:latest', 'mistral:7b'],
    [
      { name: 'llama3.1:latest', size: 8 * 1024 ** 3 },
      { name: 'mistral:7b', size: 7 * 1024 ** 3 },
    ],
    [],
    { total_ram_gb: 36, available_ram_gb: 8 },
  );

  assert.equal(assessment.status, 'critical');
});

test('estimates 0 GB runtime for cloud models', () => {
  const estimate = estimateModelRuntimeGb('openai:gpt-4o', [
    { name: 'openai:gpt-4o', is_cloud: true },
  ]);
  assert.equal(estimate, 0);

  const legacyEstimate = estimateModelRuntimeGb('openai/gpt-4o', []);
  assert.equal(legacyEstimate, 0);
});

test('returns safe status and 0 peak memory for cloud only council', () => {
  const assessment = assessCouncilMemory(
    ['openai:gpt-4o', 'anthropic:claude-3-5-sonnet-latest'],
    [
      { name: 'openai:gpt-4o', is_cloud: true },
      { name: 'anthropic:claude-3-5-sonnet-latest', is_cloud: true },
    ],
    [],
    { total_ram_gb: 8, available_ram_gb: 1 }
  );

  assert.equal(assessment.status, 'safe');
  assert.equal(assessment.estimatedPeakGb, 0);
});
