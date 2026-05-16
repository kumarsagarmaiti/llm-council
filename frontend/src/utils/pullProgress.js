function normalizeStatusText(status) {
  return (status || '').trim();
}

function isVerifyingStatus(status) {
  const lowered = status.toLowerCase();
  return (
    lowered.startsWith('verifying') ||
    lowered.startsWith('writing manifest') ||
    lowered.startsWith('removing any unused layers')
  );
}

export function normalizePullProgress(progress = {}) {
  const status = normalizeStatusText(progress.status);

  if (status.toLowerCase() === 'success') {
    return {
      phase: 'complete',
      label: 'Installed',
      percent: 100,
      showSpinner: false,
      showProgressBar: false,
    };
  }

  if (isVerifyingStatus(status)) {
    return {
      phase: 'verifying',
      label: 'Verifying...',
      percent: null,
      showSpinner: true,
      showProgressBar: false,
    };
  }

  const hasDeterminateProgress =
    Number.isFinite(progress.completed) &&
    Number.isFinite(progress.total) &&
    progress.total > 0;

  return {
    phase: 'downloading',
    label: status || 'Downloading...',
    percent: hasDeterminateProgress
      ? Math.round((progress.completed / progress.total) * 100)
      : null,
    showSpinner: false,
    showProgressBar: true,
    indeterminate: !hasDeterminateProgress,
  };
}
