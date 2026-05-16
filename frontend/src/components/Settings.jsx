import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import ConfirmDialog from './ConfirmDialog';
import { getSortedRecommendations } from '../utils/modelRecommendations';
import { normalizePullProgress } from '../utils/pullProgress';
import './Settings.css';

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
  </svg>
);

export default function Settings({
  onClose,
  onModelsChanged,
  localModels = [],
  pullingModel,
  pullProgress,
  onPullModel,
  onCancelPull
}) {
  const [systemInfo, setSystemInfo] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showInstalled, setShowInstalled] = useState(false);
  const [showNonCompatible, setShowNonCompatible] = useState(false);
  const [activeInfo, setActiveInfo] = useState(null);
  const [sortBy, setSortBy] = useState('recommended');
  const [sortOpen, setSortOpen] = useState(false);

  const SORT_OPTIONS = [
    { value: 'recommended', label: 'Best Fit' },
    { value: 'smallest',    label: 'Fastest'  },
    { value: 'smartest',    label: 'Most Capable' },
  ];

  const [isInstalling, setIsInstalling] = useState(false);
  const [installLogs, setInstallLogs] = useState([]);
  const [confirmModel, setConfirmModel] = useState(null);
  const logEndRef = useRef(null);
  const activePullState = pullingModel ? normalizePullProgress(pullProgress) : null;

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [installLogs]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const status = await api.getSystemStatus();
      if (status?.system) setSystemInfo(status.system);
      if (status?.recommendations) {
        setRecommendations(status.recommendations.models || []);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const sortedRecommendations = getSortedRecommendations(recommendations, {
    searchQuery,
    sortBy,
    localModels,
    showInstalled,
    showNonCompatible,
    systemInfo,
  });

  const handleRefreshRegistry = async () => {
    setIsRefreshing(true);
    try { await loadData(); } catch (e) { console.error(e); } finally { setIsRefreshing(false); }
  };

  const handleInstallOllama = async () => {
    setIsInstalling(true);
    setInstallLogs(['Starting installation script...']);
    try {
      await api.installOllama((log) => {
        setInstallLogs(prev => [...prev.slice(-20), log.message]);
        if (log.status === 'success') { setIsInstalling(false); loadData(); }
        if (log.status === 'error') { setIsInstalling(false); alert(log.message); }
      });
    } catch (error) {
      setIsInstalling(false);
      setInstallLogs(prev => [...prev, 'Error: ' + error.message]);
    }
  };

  const executeDeleteModel = async (modelName) => {
    setConfirmModel(null);
    try {
      await api.deleteModel(modelName);
      loadData();
      if (onModelsChanged) onModelsChanged();
    } catch (error) {
      alert('Delete failed');
      console.error('Failed to delete model:', error);
    }
  };

  if (isLoading) return (
    <div className="settings-overlay">
      <div className="spinner-large"></div>
    </div>
  );

  return (
    <div className="settings-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings-modal">

        <div className="settings-header">
          <div>
            <h2>Local AI Control Center</h2>
            <p className="header-subtitle">Hardware · Models · Configuration</p>
          </div>
          <button className="close-button" onClick={onClose}>✕ Close</button>
        </div>

        {!systemInfo?.ollama_installed && (
          <div className="setup-wizard-card">
            <div className="wizard-content">
              <div className="wizard-icon">🚀</div>
              <div className="wizard-text">
                <h3>One-Click Local Setup</h3>
                <p>Ollama is not detected. Install it now on your {systemInfo?.chip_name || 'machine'}.</p>
                {isInstalling ? (
                  <div className="install-console">
                    <div className="console-header">Installing Ollama...</div>
                    <div className="console-body">
                      {installLogs.map((log, i) => <div key={i} className="log-line">{log}</div>)}
                      <div ref={logEndRef} />
                    </div>
                  </div>
                ) : (
                  <div className="wizard-actions">
                    <button className="primary-install-btn" onClick={handleInstallOllama}>Install Ollama Now</button>
                    <a href="https://ollama.com" target="_blank" rel="noreferrer" className="secondary-link">Manual Download ↗</a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="settings-body">

          {/* Main area: system + marketplace */}
          <div className="settings-main">

            <section className="settings-section">
              <div className="section-header-row">
                <h3>System Resources</h3>
                {systemInfo?.is_apple_silicon && <span className="apple-badge">Apple Silicon</span>}
              </div>
              <div className="hardware-cards">
                <div className="hw-card">
                  <label>Processor</label>
                  <span className="hw-value">{systemInfo?.chip_name || systemInfo?.processor || 'Unknown'}</span>
                  <span className="hw-sub">{systemInfo?.cpu_count} CPU cores</span>
                </div>
                <div className="hw-card">
                  <label>Memory (RAM)</label>
                  <span className="hw-value">{systemInfo?.total_ram_gb || '?'} GB total</span>
                  <div className="resource-bar">
                    <div className="fill ram-fill" style={{
                      width: `${systemInfo?.total_ram_gb
                        ? Math.min(100, Math.max(0, ((systemInfo.total_ram_gb - systemInfo.available_ram_gb) / systemInfo.total_ram_gb) * 100))
                        : 0}%`
                    }}></div>
                  </div>
                  <span className="hw-sub">{systemInfo?.available_ram_gb} GB free</span>
                </div>
                <div className="hw-card">
                  <label>Local Storage</label>
                  <span className="hw-value">{systemInfo?.available_disk_gb || '?'} GB free</span>
                  <span className="hw-sub">Primary system disk</span>
                </div>
              </div>
            </section>

            <section className="settings-section">
              <div className="section-header-row">
                <h3>Model Marketplace</h3>
                <div className="marketplace-actions">
                  <a
                    href="https://ollama.com/library"
                    target="_blank"
                    rel="noreferrer"
                    className="ollama-link"
                  >
                    Ollama Library ↗
                  </a>
                  <button
                    className="refresh-btn"
                    onClick={handleRefreshRegistry}
                    disabled={isRefreshing}
                  >
                    {isRefreshing ? 'Refreshing…' : '↺ Refresh'}
                  </button>
                </div>
              </div>

              <div className="search-row">
                <input
                  type="text"
                  className="search-input"
                  placeholder="Search models…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <div className="custom-sort" onClick={() => setSortOpen(o => !o)}>
                  <span className="custom-sort-value">
                    {SORT_OPTIONS.find(o => o.value === sortBy)?.label}
                  </span>
                  <span className="custom-sort-arrow">{sortOpen ? '▴' : '▾'}</span>
                  {sortOpen && (
                    <div className="custom-sort-menu">
                      {SORT_OPTIONS.map(opt => (
                        <div
                          key={opt.value}
                          className={`custom-sort-option ${sortBy === opt.value ? 'active' : ''}`}
                          onClick={(e) => { e.stopPropagation(); setSortBy(opt.value); setSortOpen(false); }}
                        >
                          {opt.label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className={`toggle-chip ${showInstalled ? 'active' : ''}`}
                  onClick={() => setShowInstalled((value) => !value)}
                >
                  {showInstalled ? 'Hide Installed' : 'Show Installed'}
                </button>
                <button
                  type="button"
                  className={`toggle-chip ${showNonCompatible ? 'active' : ''}`}
                  onClick={() => setShowNonCompatible((value) => !value)}
                >
                  {showNonCompatible ? 'Hide Non-Compatible' : 'Show Non-Compatible'}
                </button>
              </div>

              <div className="model-grid">
                {searchQuery && !sortedRecommendations.some(m => m.name.toLowerCase() === searchQuery.toLowerCase()) && (
                  <div className="model-card pull-request-card">
                    <div className="model-card-name">{searchQuery}</div>
                    <div className="model-card-sub">Remote pull</div>
                    <button className="install-btn" onClick={() => onPullModel(searchQuery)}>Pull</button>
                  </div>
                )}

                {sortedRecommendations.map((model) => {
                  const isInstalled = Array.isArray(localModels) && localModels.some(m => m?.name?.startsWith(model.name));
                  const isDownloading = pullingModel === model.name;
                  const pullState = isDownloading ? normalizePullProgress(pullProgress) : null;

                  const baseName = model.name.includes(':') ? model.name.split(':')[0] : model.name;
                  const paramTag = model.name.includes(':') ? model.name.split(':')[1] : (model.params || null);
                  return (
                    <div key={model.name} className={`model-card status-${model.status}`}>
                      {model.family && (
                        <div className="model-family">{model.family}</div>
                      )}
                      <div className="model-card-top">
                        <span className="fit-tag">{model.recommendation}</span>
                        <a
                          href={`https://ollama.com/library/${baseName}`}
                          target="_blank"
                          rel="noreferrer"
                          className="lib-link"
                          title="View on Ollama Library"
                        >↗</a>
                      </div>

                      {activeInfo === model.name ? (
                        <div className="expanded-info">
                          <p><strong>Hardware:</strong> {model.status === 'optimal' ? 'Full speed, no lag.' : 'May slow the system.'}</p>
                          <p><strong>Strengths:</strong> {model.strengths || 'Reliable local reasoning.'}</p>
                          <button className="back-btn" onClick={() => setActiveInfo(null)}>← Back</button>
                        </div>
                      ) : (
                        <>
                          <div className="model-card-name">
                            <span className="name-base">{baseName}</span>
                            {paramTag && <span className="name-params">{paramTag}</span>}
                          </div>

                          <div className="model-card-meta">
                            <span className="type-tag">{model.type || 'General'}</span>
                            <span className="size-tag">{model.size_gb || '?'} GB</span>
                            <button
                              className="info-btn"
                              onClick={() => setActiveInfo(model.name)}
                              title="More info"
                            >i</button>
                          </div>

                          {(model.ram_warning || !model.can_install) && (
                            <div className="warn-row">
                              {!model.can_install && <span className="warn-pill">🚫 Low Storage</span>}
                              {model.ram_warning && <span className="warn-pill warn-ram">⚠ Low RAM</span>}
                            </div>
                          )}

                          {isDownloading ? (
                            <div className="pull-progress">
                              <div className="progress-info">
                                <span>{pullState.label}</span>
                                <span>{pullState.percent !== null ? `${pullState.percent}%` : ''}</span>
                              </div>
                              {pullState.showProgressBar ? (
                                <div className="progress-bar">
                                  <div
                                    className={`progress-fill${pullState.indeterminate ? ' indeterminate' : ''}`}
                                    style={pullState.indeterminate ? {} : { width: `${pullState.percent}%` }}
                                  ></div>
                                </div>
                              ) : null}
                              {pullState.showSpinner ? (
                                <div className="verify-status">
                                  <div className="verify-spinner"></div>
                                  <span>Checking downloaded files before install completes.</span>
                                </div>
                              ) : null}
                              <button className="cancel-btn" onClick={() => onCancelPull(model.name)}>Cancel</button>
                            </div>
                          ) : (
                            <button
                              className={`install-btn ${isInstalled ? 'installed' : ''} ${!model.can_install ? 'locked' : ''}`}
                              onClick={() => onPullModel(model.name)}
                              disabled={isInstalled || pullingModel !== null || !model.can_install}
                            >
                              {isInstalled ? 'Installed ✓' : !model.can_install ? 'No Storage' : 'Install'}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Sidebar: installed models */}
          <aside className="settings-sidebar">
            <div className="sidebar-section">
              <div className="sidebar-header-row">
                <h3>Downloading</h3>
                <span className="model-count">{pullingModel ? 1 : 0}</span>
              </div>
              <div className="library-list">
                {!pullingModel ? (
                  <div className="empty-library">No active downloads.</div>
                ) : (
                  <div className="library-item library-item-download">
                    <div className="item-info">
                      <span className="item-name">{pullingModel}</span>
                      <span className="item-size">{activePullState?.label}</span>
                    </div>
                    <button
                      className="delete-btn"
                      onClick={() => onCancelPull(pullingModel)}
                      title={`Cancel ${pullingModel}`}
                    >
                      ×
                    </button>
                    {activePullState?.showProgressBar ? (
                      <div className="sidebar-progress">
                        <div className="progress-bar">
                          <div
                            className={`progress-fill${activePullState.indeterminate ? ' indeterminate' : ''}`}
                            style={activePullState.indeterminate ? {} : { width: `${activePullState.percent}%` }}
                          ></div>
                        </div>
                        {!activePullState.indeterminate && (
                          <div className="sidebar-progress-meta">{activePullState.percent}%</div>
                        )}
                      </div>
                    ) : null}
                    {activePullState?.showSpinner ? (
                      <div className="verify-status sidebar-verify-status">
                        <div className="verify-spinner"></div>
                        <span>Verifying downloaded files.</span>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>

            <div className="sidebar-section">
            <div className="sidebar-header-row">
              <h3>Installed</h3>
              <span className="model-count">{localModels.length}</span>
            </div>
            <div className="library-list">
              {localModels.length === 0 ? (
                <div className="empty-library">No models installed yet.</div>
              ) : (
                localModels.map((model) => (
                  <div key={model.name} className="library-item">
                    <div className="item-info">
                      <span className="item-name">{model.name}</span>
                      <span className="item-size">
                        {model.size ? (model.size / (1024 ** 3)).toFixed(1) : '?'} GB
                      </span>
                    </div>
                    <button
                      className="delete-btn"
                      onClick={() => setConfirmModel(model.name)}
                      title={`Delete ${model.name}`}
                    ><TrashIcon /></button>
                  </div>
                ))
              )}
            </div>
            </div>
          </aside>

        </div>
      </div>

      {confirmModel && (
        <ConfirmDialog
          message="Delete model?"
          detail={confirmModel}
          confirmLabel="Delete"
          onConfirm={() => executeDeleteModel(confirmModel)}
          onCancel={() => setConfirmModel(null)}
        />
      )}
    </div>
  );
}
