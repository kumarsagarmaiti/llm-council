function isInstalledRecommendation(model, localModels = []) {
  return Array.isArray(localModels) && localModels.some((entry) => entry?.name?.startsWith(model.name));
}

const FAMILY_CAPABILITY_SCORES = {
  'deepseek r1': 34,
  deepseek: 30,
  llama3: 25,
  llama: 23,
  gemma2: 22,
  gemma: 20,
  mistral: 19,
  phi3: 16,
};

function getFamilyCapabilityScore(model) {
  const family = (model.family || model.name || '').toLowerCase();

  for (const [needle, score] of Object.entries(FAMILY_CAPABILITY_SCORES)) {
    if (family.includes(needle)) {
      return score;
    }
  }

  return 18;
}

function getCapabilityScore(model) {
  let score = getFamilyCapabilityScore(model);

  if (model.type === 'reasoning') {
    score += 12;
  }

  score += Math.min(model.min_ram_gb || 0, 12) * 1.5;
  return score;
}

function getSafetyAdjustment(model, systemInfo = {}) {
  const runtimeInfo = systemInfo || {};

  if (model.can_install === false) {
    return -1000;
  }

  const availableRam = runtimeInfo.available_ram_gb ?? runtimeInfo.total_ram_gb ?? null;
  const totalRam = runtimeInfo.total_ram_gb ?? availableRam ?? null;
  const minRam = model.min_ram_gb || 0;
  let score = 0;

  if (model.status === 'optimal') {
    score += 8;
  } else if (model.status === 'compatible') {
    score += 2;
  } else if (model.status === 'heavy') {
    score -= 18;
  }

  if (availableRam !== null && minRam > 0) {
    const freeHeadroom = availableRam - minRam;
    if (freeHeadroom >= minRam * 0.35) {
      score += 10;
    } else if (freeHeadroom >= 0) {
      score += 2;
    } else {
      score -= 24 + Math.abs(freeHeadroom) * 6;
    }
  }

  if (totalRam !== null && minRam > 0) {
    if (totalRam < minRam) {
      score -= 28;
    } else if (totalRam < minRam * 1.25) {
      score -= 8;
    }
  }

  if (model.ram_warning) {
    score -= 12;
  }

  score -= (model.size_gb || 0) * 0.6;
  return score;
}

function compareByBalancedBestFit(a, b, systemInfo) {
  const scoreA = getCapabilityScore(a) + getSafetyAdjustment(a, systemInfo);
  const scoreB = getCapabilityScore(b) + getSafetyAdjustment(b, systemInfo);

  if (scoreA !== scoreB) {
    return scoreB - scoreA;
  }

  if ((a.can_install ?? true) !== (b.can_install ?? true)) {
    return a.can_install ? -1 : 1;
  }

  if ((a.size_gb || 0) !== (b.size_gb || 0)) {
    return (a.size_gb || 0) - (b.size_gb || 0);
  }

  return a.name.localeCompare(b.name);
}

export function getSortedRecommendations(
  recommendations = [],
  {
    searchQuery = '',
    sortBy = 'recommended',
    localModels = [],
    showInstalled = false,
    showNonCompatible = false,
    systemInfo = null,
  } = {},
) {
  const normalizedQuery = searchQuery.toLowerCase();

  let filtered = recommendations.filter((model) => {
    const matchesQuery =
      model.name.toLowerCase().includes(normalizedQuery) ||
      (model.type && model.type.toLowerCase().includes(normalizedQuery)) ||
      (model.family && model.family.toLowerCase().includes(normalizedQuery));

    if (!matchesQuery) {
      return false;
    }

    if (!showInstalled && isInstalledRecommendation(model, localModels)) {
      return false;
    }

    if (!showNonCompatible && model.status === 'heavy') {
      return false;
    }

    return true;
  });

  if (sortBy === 'smallest') {
    return filtered.sort((a, b) => (a.size_gb || 0) - (b.size_gb || 0));
  }

  if (sortBy === 'smartest') {
    return filtered.sort((a, b) => {
      if (a.type === 'reasoning' && b.type !== 'reasoning') return -1;
      if (a.type !== 'reasoning' && b.type === 'reasoning') return 1;
      return (b.size_gb || 0) - (a.size_gb || 0);
    });
  }

  return filtered.sort((a, b) => compareByBalancedBestFit(a, b, systemInfo));
}
