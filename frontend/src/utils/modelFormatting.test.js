import test from 'node:test';
import assert from 'node:assert';
import { getShortModelName, getFullModelName } from './modelFormatting.js';

test('getShortModelName formatting', () => {
  assert.strictEqual(getShortModelName('openai:gpt-4o'), 'gpt-4o');
  assert.strictEqual(getShortModelName('openrouter:openai/gpt-4o'), 'gpt-4o');
  assert.strictEqual(getShortModelName('openai/gpt-4o'), 'gpt-4o');
  assert.strictEqual(getShortModelName('llama3.2:latest'), 'llama3.2:latest');
  assert.strictEqual(getShortModelName('deepseek:deepseek-chat'), 'deepseek-chat');
  assert.strictEqual(getShortModelName(''), '');
  assert.strictEqual(getShortModelName(null), '');
});

test('getFullModelName formatting', () => {
  assert.strictEqual(getFullModelName('openai:gpt-4o'), 'gpt-4o (OpenAI)');
  assert.strictEqual(getFullModelName('openrouter:openai/gpt-4o'), 'gpt-4o (OpenRouter)');
  assert.strictEqual(getFullModelName('openai/gpt-4o'), 'gpt-4o (OpenAI)');
  assert.strictEqual(getFullModelName('llama3.2:latest'), 'llama3.2:latest');
  assert.strictEqual(getFullModelName('deepseek:deepseek-chat'), 'deepseek-chat (DeepSeek)');
  assert.strictEqual(getFullModelName(''), '');
  assert.strictEqual(getFullModelName(null), '');
});
