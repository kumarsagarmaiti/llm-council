import test from 'node:test';
import assert from 'node:assert/strict';

import { getFollowUpComposerState, getFollowUpCouncilModels } from './conversationFlow.js';

test('follow-up composer reuses the last assistant council models when available locally', () => {
  const conversation = {
    messages: [
      { role: 'user', content: 'first' },
      {
        role: 'assistant',
        stage1: [
          { model: 'deepseek-r1:latest', response: 'one' },
          { model: 'deepseek-coder:latest', response: 'two' },
        ],
      },
    ],
  };

  const result = getFollowUpCouncilModels(conversation, [
    { name: 'deepseek-r1:latest' },
    { name: 'deepseek-coder:latest' },
    { name: 'llama3.1:latest' },
  ]);

  assert.deepEqual(result, ['deepseek-r1:latest', 'deepseek-coder:latest']);
});

test('follow-up composer falls back to installed local models when prior council is unavailable', () => {
  const conversation = {
    messages: [
      { role: 'user', content: 'first' },
      {
        role: 'assistant',
        stage1: [
          { model: 'ChatGPT', response: 'one' },
          { model: 'Claude', response: 'two' },
        ],
      },
    ],
  };

  const result = getFollowUpCouncilModels(conversation, [
    { name: 'deepseek-r1:latest' },
    { name: 'deepseek-coder:latest' },
  ]);

  assert.deepEqual(result, ['deepseek-r1:latest', 'deepseek-coder:latest']);
});

test('follow-up composer reports when too few local models are installed', () => {
  const conversation = {
    messages: [
      { role: 'user', content: 'first' },
      {
        role: 'assistant',
        stage1: [{ model: 'deepseek-r1:latest', response: 'one' }],
      },
    ],
  };

  const state = getFollowUpComposerState(conversation, [
    { name: 'deepseek-r1:latest' },
  ]);

  assert.equal(state.canSend, false);
  assert.match(state.message, /at least 2 installed local models/i);
  assert.match(state.message, /deepseek-r1:latest/);
});
