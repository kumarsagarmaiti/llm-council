const GIGABYTE = 1024 ** 3;

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

function isCloudModel(modelName, localModels = []) {
  const model = localModels.find((m) => m.name === modelName);
  if (model && model.is_cloud) return true;
  const prefixes = ['openai:', 'anthropic:', 'gemini:', 'deepseek:', 'openrouter:'];
  return prefixes.some(prefix => modelName.startsWith(prefix)) || modelName.includes('/');
}

function estimateFromName(modelName) {
  const lowerName = modelName.toLowerCase();

  if (lowerName.includes('70b')) return 48;
  if (lowerName.includes('32b')) return 26;
  if (lowerName.includes('27b')) return 22;
  if (lowerName.includes('14b')) return 14;
  if (lowerName.includes('8b') || lowerName.includes('7b')) return 9;
  if (lowerName.includes('4b') || lowerName.includes('3b')) return 6;
  return 8;
}

export function estimateModelRuntimeGb(modelName, localModels = [], recommendations = []) {
  if (isCloudModel(modelName, localModels)) {
    return 0;
  }

  const installedModel = localModels.find((model) => model.name === modelName);
  if (installedModel?.size) {
    const modelSizeGb = installedModel.size / GIGABYTE;
    return roundToTenth(Math.max(5, modelSizeGb * 1.35 + 1.5));
  }

  const recommendation = recommendations.find((model) => model.name === modelName);
  if (recommendation?.min_ram_gb) {
    return roundToTenth(Math.max(5, recommendation.min_ram_gb + 1.5));
  }

  return estimateFromName(modelName);
}

export function estimateCouncilMemory(selectedModels, localModels = [], recommendations = []) {
  const localSelectedModels = selectedModels.filter(name => !isCloudModel(name, localModels));

  if (localSelectedModels.length === 0) {
    return {
      estimatedPeakGb: 0,
      baselineGb: 0,
      modelRuntimeGb: 0,
      concurrencyOverheadGb: 0,
    };
  }

  const baselineGb = 6;
  const modelRuntimeGb = localSelectedModels.reduce(
    (sum, modelName) => sum + estimateModelRuntimeGb(modelName, localModels, recommendations),
    0,
  );
  const concurrencyOverheadGb = Math.max(2, localSelectedModels.length * 1.25);
  const estimatedPeakGb = roundToTenth((baselineGb + modelRuntimeGb + concurrencyOverheadGb) * 1.15);

  return {
    estimatedPeakGb,
    baselineGb,
    modelRuntimeGb: roundToTenth(modelRuntimeGb),
    concurrencyOverheadGb: roundToTenth(concurrencyOverheadGb),
  };
}

export function assessCouncilMemory(selectedModels, localModels = [], recommendations = [], systemInfo = {}) {
  const { estimatedPeakGb } = estimateCouncilMemory(selectedModels, localModels, recommendations);
  const totalRamGb = systemInfo.total_ram_gb ?? 16;
  const availableRamGb = systemInfo.available_ram_gb ?? totalRamGb;

  if (estimatedPeakGb === 0) {
    return {
      estimatedPeakGb: 0,
      totalRamGb,
      availableRamGb,
      status: 'safe',
      message: 'Cloud models run remotely and require no local RAM.',
    };
  }

  const peakVsAvailable = availableRamGb > 0 ? estimatedPeakGb / availableRamGb : 1;
  const peakVsTotal = totalRamGb > 0 ? estimatedPeakGb / totalRamGb : 1;

  let status = 'safe';
  let message = 'Current free RAM looks sufficient.';

  if (peakVsAvailable >= 1 || peakVsTotal >= 0.9) {
    status = 'critical';
    message = 'High risk of swap or system slowdown on current memory pressure.';
  } else if (peakVsAvailable >= 0.8 || peakVsTotal >= 0.7) {
    status = 'warning';
    message = 'This run is likely to feel heavy unless more memory frees up.';
  }

  return {
    estimatedPeakGb,
    totalRamGb,
    availableRamGb,
    status,
    message,
  };
}
