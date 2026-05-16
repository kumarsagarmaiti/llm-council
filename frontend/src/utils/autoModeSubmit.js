export function getAutoModeSubmitState({
  isLoading = false,
  localModelCount = 0,
  memoryStatus = 'safe',
} = {}) {
  const disabled = isLoading || localModelCount < 2;

  if (memoryStatus === 'critical') {
    return {
      disabled,
      label: 'Run Anyway',
      danger: true,
    };
  }

  return {
    disabled,
    label: 'Start Auto Council',
    danger: false,
  };
}
