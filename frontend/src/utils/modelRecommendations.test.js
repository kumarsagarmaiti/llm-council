import test from 'node:test';
import assert from 'node:assert/strict';

import { getSortedRecommendations } from './modelRecommendations.js';

test('hides installed models from recommendations by default', () => {
  const recommendations = [
    { name: 'llama3.2', status: 'optimal', size_gb: 2 },
    { name: 'mistral', status: 'compatible', size_gb: 7 },
  ];
  const localModels = [{ name: 'llama3.2:latest' }];

  const result = getSortedRecommendations(recommendations, { localModels });

  assert.deepEqual(result.map((model) => model.name), ['mistral']);
});

test('can include installed models when toggle is enabled', () => {
  const recommendations = [
    { name: 'llama3.2', status: 'optimal', size_gb: 2 },
    { name: 'mistral', status: 'compatible', size_gb: 7 },
  ];
  const localModels = [{ name: 'llama3.2:latest' }];

  const result = getSortedRecommendations(recommendations, {
    localModels,
    showInstalled: true,
  });

  assert.deepEqual(result.map((model) => model.name), ['llama3.2', 'mistral']);
});

test('hides non-compatible models from recommendations by default', () => {
  const recommendations = [
    { name: 'llama3.2', status: 'optimal', size_gb: 2 },
    { name: 'deepseek-r1', status: 'heavy', size_gb: 6.4 },
  ];

  const result = getSortedRecommendations(recommendations, {
    showInstalled: true,
  });

  assert.deepEqual(result.map((model) => model.name), ['llama3.2']);
});

test('can include non-compatible models when toggle is enabled', () => {
  const recommendations = [
    { name: 'llama3.2', status: 'optimal', size_gb: 2, type: 'general', min_ram_gb: 4, can_install: true },
    { name: 'deepseek-r1', status: 'heavy', size_gb: 6.4, type: 'reasoning', min_ram_gb: 8, can_install: true },
  ];

  const result = getSortedRecommendations(recommendations, {
    showInstalled: true,
    showNonCompatible: true,
    systemInfo: { total_ram_gb: 16, available_ram_gb: 6 },
  });

  assert.deepEqual(result.map((model) => model.name), ['llama3.2', 'deepseek-r1']);
});

test('best fit prefers the strongest model that still looks safe right now', () => {
  const recommendations = [
    {
      name: 'deepseek-r1',
      family: 'Deepseek R1',
      type: 'reasoning',
      status: 'heavy',
      size_gb: 6.4,
      min_ram_gb: 8,
      can_install: true,
      ram_warning: 'Close other apps to run',
    },
    {
      name: 'llama3.2',
      family: 'Llama3',
      type: 'general',
      status: 'optimal',
      size_gb: 4.8,
      min_ram_gb: 6,
      can_install: true,
      ram_warning: null,
    },
    {
      name: 'mistral',
      family: 'Mistral',
      type: 'general',
      status: 'compatible',
      size_gb: 5.6,
      min_ram_gb: 7,
      can_install: true,
      ram_warning: null,
    },
  ];

  const result = getSortedRecommendations(recommendations, {
    sortBy: 'recommended',
    systemInfo: { total_ram_gb: 16, available_ram_gb: 6.5 },
    showInstalled: true,
    showNonCompatible: true,
  });

  assert.deepEqual(result.map((model) => model.name), ['llama3.2', 'mistral', 'deepseek-r1']);
});

test('best fit promotes the more capable model when enough free ram exists', () => {
  const recommendations = [
    {
      name: 'deepseek-r1',
      family: 'Deepseek R1',
      type: 'reasoning',
      status: 'optimal',
      size_gb: 6.4,
      min_ram_gb: 8,
      can_install: true,
      ram_warning: null,
    },
    {
      name: 'llama3.2',
      family: 'Llama3',
      type: 'general',
      status: 'optimal',
      size_gb: 4.8,
      min_ram_gb: 6,
      can_install: true,
      ram_warning: null,
    },
  ];

  const result = getSortedRecommendations(recommendations, {
    sortBy: 'recommended',
    systemInfo: { total_ram_gb: 24, available_ram_gb: 16 },
    showInstalled: true,
  });

  assert.deepEqual(result.map((model) => model.name), ['deepseek-r1', 'llama3.2']);
});

test('best fit sinks models that cannot be installed', () => {
  const recommendations = [
    {
      name: 'gemma2',
      family: 'Gemma2',
      type: 'general',
      status: 'optimal',
      size_gb: 7.2,
      min_ram_gb: 9,
      can_install: false,
      ram_warning: null,
    },
    {
      name: 'phi3',
      family: 'Phi3',
      type: 'general',
      status: 'compatible',
      size_gb: 3.2,
      min_ram_gb: 4,
      can_install: true,
      ram_warning: null,
    },
  ];

  const result = getSortedRecommendations(recommendations, {
    sortBy: 'recommended',
    systemInfo: { total_ram_gb: 16, available_ram_gb: 12 },
    showInstalled: true,
  });

  assert.deepEqual(result.map((model) => model.name), ['phi3', 'gemma2']);
});
