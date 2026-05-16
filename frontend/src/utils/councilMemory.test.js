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
