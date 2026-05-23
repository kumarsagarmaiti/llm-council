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

const EyeIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>
);

const EyeOffIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
    <line x1="1" y1="1" x2="23" y2="23"></line>
  </svg>
);



const SORT_OPTIONS = [
  { value: 'recommended', label: 'Best Fit' },
  { value: 'smallest',    label: 'Fastest'  },
  { value: 'smartest',    label: 'Most Capable' },
];

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

  const [isInstalling, setIsInstalling] = useState(false);
  const [installLogs, setInstallLogs] = useState([]);
  const [confirmModel, setConfirmModel] = useState(null);
  const logEndRef = useRef(null);
  const sortButtonRef = useRef(null);
  const sortOptionRefs = useRef([]);
  const activePullState = pullingModel ? normalizePullProgress(pullProgress) : null;
  const sortMenuId = 'model-sort-menu';

  // Cloud tabs & keys state
  const [activeTab, setActiveTab] = useState('local');
  const [cloudSettings, setCloudSettings] = useState({
    api_keys: {
      openai: '',
      anthropic: '',
      gemini: '',
      deepseek: '',
      openrouter: ''
    },
    enabled_cloud_models: [],
    custom_cloud_models: [],
    discovered_cloud_models: []
  });
  const [keyVisibility, setKeyVisibility] = useState({
    openai: false,
    anthropic: false,
    gemini: false,
    deepseek: false,
    openrouter: false
  });
  const [customModelInput, setCustomModelInput] = useState('');
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [saveStatus, setSaveStatus] = useState('');

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [installLogs]);

  useEffect(() => {
    if (!sortOpen) {
      return;
    }

    const selectedIndex = Math.max(
      0,
      SORT_OPTIONS.findIndex((option) => option.value === sortBy),
    );

    requestAnimationFrame(() => {
      sortOptionRefs.current[selectedIndex]?.focus();
    });
  }, [sortOpen, sortBy]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [status, settings] = await Promise.all([
        api.getSystemStatus(),
        api.getSettings()
      ]);
      if (status?.system) setSystemInfo(status.system);
      if (status?.recommendations) {
        setRecommendations(status.recommendations.models || []);
      }
      if (settings) {
        setCloudSettings({
          api_keys: {
            openai: settings.api_keys?.openai || '',
            anthropic: settings.api_keys?.anthropic || '',
            gemini: settings.api_keys?.gemini || '',
            deepseek: settings.api_keys?.deepseek || '',
            openrouter: settings.api_keys?.openrouter || ''
          },
          enabled_cloud_models: settings.enabled_cloud_models || [],
          custom_cloud_models: settings.custom_cloud_models || [],
          discovered_cloud_models: settings.discovered_cloud_models || []
        });
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

  const openSortMenu = () => {
    setSortOpen(true);
  };

  const closeSortMenu = () => {
    setSortOpen(false);
    sortButtonRef.current?.focus();
  };

  const selectSortOption = (value) => {
    setSortBy(value);
    closeSortMenu();
  };

  const handleSortTriggerKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSortMenu();
      return;
    }

    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openSortMenu();
    }
  };

  const handleSortOptionKeyDown = (event, index, value) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSortMenu();
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectSortOption(value);
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();

      let nextIndex = index;
      if (event.key === 'ArrowDown') {
        nextIndex = (index + 1) % SORT_OPTIONS.length;
      } else if (event.key === 'ArrowUp') {
        nextIndex = (index - 1 + SORT_OPTIONS.length) % SORT_OPTIONS.length;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = SORT_OPTIONS.length - 1;
      }

      sortOptionRefs.current[nextIndex]?.focus();
    }
  };

  // Frontier models matching backend check
  const FRONTIER_KEYWORDS = [
    "gpt-4o", "gpt-4o-mini", "o1", "o3-mini", "gpt-4-turbo",
    "claude-3-5-sonnet", "claude-3-5-haiku", "claude-3-opus",
    "gemini-2.5-pro", "gemini-2.5-flash", "gemini-1.5-pro", "gemini-1.5-flash",
    "deepseek-chat", "deepseek-reasoner", "deepseek-v4-pro", "deepseek-v4-flash"
  ];
  const isFrontierModel = (name) => {
    const nameLower = name.toLowerCase();
    const id = nameLower.includes(':') ? nameLower.split(':', 2)[1] : nameLower;
    return FRONTIER_KEYWORDS.some(kw => id.includes(kw));
  };

  // Cloud tab handlers
  const handleApiKeyChange = (provider, value) => {
    setCloudSettings(prev => ({
      ...prev,
      api_keys: {
        ...prev.api_keys,
        [provider]: value
      }
    }));
  };

  const handleModelToggle = (modelName) => {
    setCloudSettings(prev => {
      const enabled = [...prev.enabled_cloud_models];
      const index = enabled.indexOf(modelName);
      if (index > -1) {
        enabled.splice(index, 1);
      } else {
        enabled.push(modelName);
      }
      return {
        ...prev,
        enabled_cloud_models: enabled
      };
    });
  };

  const toggleKeyVisibility = (provider) => {
    setKeyVisibility(prev => ({
      ...prev,
      [provider]: !prev[provider]
    }));
  };

  const handleAddCustomModel = () => {
    const trimmed = customModelInput.trim();
    if (!trimmed) return;

    if (cloudSettings.custom_cloud_models.includes(trimmed)) {
      setCustomModelInput('');
      return;
    }

    setCloudSettings(prev => ({
      ...prev,
      custom_cloud_models: [...prev.custom_cloud_models, trimmed]
    }));
    setCustomModelInput('');
  };

  const handleRemoveCustomModel = (modelName) => {
    setCloudSettings(prev => ({
      ...prev,
      custom_cloud_models: prev.custom_cloud_models.filter(m => m !== modelName)
    }));
  };

  const handleSaveCloudSettings = async () => {
    try {
      setSaveStatus('Saving...');
      await api.saveSettings(cloudSettings);
      
      // Reload settings to get updated models list
      const settings = await api.getSettings();
      if (settings) {
        setCloudSettings({
          api_keys: {
            openai: settings.api_keys?.openai || '',
            anthropic: settings.api_keys?.anthropic || '',
            gemini: settings.api_keys?.gemini || '',
            deepseek: settings.api_keys?.deepseek || '',
            openrouter: settings.api_keys?.openrouter || ''
          },
          enabled_cloud_models: settings.enabled_cloud_models || [],
          custom_cloud_models: settings.custom_cloud_models || [],
          discovered_cloud_models: settings.discovered_cloud_models || []
        });
      }

      setSaveStatus('Saved successfully ✓');
      if (onModelsChanged) {
        onModelsChanged();
      }
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (error) {
      console.error('Failed to save settings:', error);
      setSaveStatus(error.message || 'Error saving settings');
      setTimeout(() => setSaveStatus(''), 5000);
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
            <h2>AI Control Center</h2>
            <p className="header-subtitle">Hardware · Models · Cloud Configuration</p>
          </div>
          <button className="close-button" onClick={onClose}>✕ Close</button>
        </div>

        <div className="settings-tabs">
          <button
            className={`tab-btn ${activeTab === 'local' ? 'active' : ''}`}
            onClick={() => setActiveTab('local')}
          >
            Local Control Center
          </button>
          <button
            className={`tab-btn ${activeTab === 'cloud' ? 'active' : ''}`}
            onClick={() => setActiveTab('cloud')}
          >
            Cloud API Keys & Models
          </button>
        </div>

        {activeTab === 'local' && !systemInfo?.ollama_installed && (
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

        {activeTab === 'local' ? (
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
                  <div style={{ position: 'relative' }}>
                    <button
                      type="button"
                      ref={sortButtonRef}
                      className="custom-sort"
                      onClick={() => setSortOpen((o) => !o)}
                      onKeyDown={handleSortTriggerKeyDown}
                      aria-expanded={sortOpen}
                      aria-controls={sortMenuId}
                      aria-haspopup="listbox"
                    >
                      <span className="custom-sort-value">
                        {SORT_OPTIONS.find(o => o.value === sortBy)?.label}
                      </span>
                      <span className="custom-sort-arrow">{sortOpen ? '▴' : '▾'}</span>
                    </button>
                    {sortOpen && (
                      <div className="custom-sort-menu" id={sortMenuId} role="listbox">
                        {SORT_OPTIONS.map((opt) => {
                          const index = SORT_OPTIONS.findIndex((option) => option.value === opt.value);
                          return (
                            <button
                              key={opt.value}
                              ref={(el) => {
                                sortOptionRefs.current[index] = el;
                              }}
                              type="button"
                              className={`custom-sort-option ${sortBy === opt.value ? 'active' : ''}`}
                              role="option"
                              aria-selected={sortBy === opt.value}
                              onClick={(e) => {
                                e.stopPropagation();
                                selectSortOption(opt.value);
                              }}
                              onKeyDown={(event) => handleSortOptionKeyDown(event, index, opt.value)}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
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
                    const isInstalled = Array.isArray(localModels) && localModels.some(m => m?.name === model.name);
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
        ) : (
          <div className="cloud-settings-container">
            {/* API Keys */}
            <div className="cloud-section">
              <h3>API Keys</h3>
              <p className="cloud-section-desc">Add cloud provider keys. Keys are saved securely to settings.json.</p>
              <div className="api-keys-grid">
                {['openai', 'anthropic', 'gemini', 'deepseek', 'openrouter'].map(provider => (
                  <div key={provider} className="api-key-field">
                    <label htmlFor={`api-key-${provider}`}>{provider}</label>
                    <div className="api-key-input-wrapper">
                      <input
                        id={`api-key-${provider}`}
                        type={keyVisibility[provider] ? 'text' : 'password'}
                        className="api-key-input"
                        placeholder={`Enter ${provider.toUpperCase()} API Key`}
                        value={cloudSettings.api_keys[provider] || ''}
                        onChange={(e) => handleApiKeyChange(provider, e.target.value)}
                      />
                      <button
                        type="button"
                        className="eye-toggle-btn"
                        onClick={() => toggleKeyVisibility(provider)}
                        title={keyVisibility[provider] ? 'Hide API Key' : 'Show API Key'}
                      >
                        {keyVisibility[provider] ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Configure Active Models */}
            {(() => {
              const groupedDiscoveredModels = {
                openai: [],
                anthropic: [],
                gemini: [],
                deepseek: [],
                openrouter: []
              };
              
              (cloudSettings.discovered_cloud_models || []).forEach(modelName => {
                if (modelName.includes(':')) {
                  const [provider, id] = modelName.split(':', 2);
                  const provLower = provider.toLowerCase();
                  if (groupedDiscoveredModels[provLower]) {
                    groupedDiscoveredModels[provLower].push({
                      name: modelName,
                      displayName: id,
                      provider: provider.charAt(0).toUpperCase() + provider.slice(1)
                    });
                  }
                }
              });

              const hasDiscovered = Object.values(groupedDiscoveredModels).some(list => list.length > 0);
              if (!hasDiscovered) return null;

              return (
                <div className="cloud-section">
                  <h3>Configure Active Models</h3>
                  <p className="cloud-section-desc">Select which models to display in the Auto Council selection grid.</p>
                  
                  <div className="model-search-row">
                    <input
                      type="text"
                      className="search-input"
                      placeholder="Filter cloud models (e.g. gpt-4, sonnet)..."
                      value={modelSearchQuery}
                      onChange={(e) => setModelSearchQuery(e.target.value)}
                    />
                  </div>

                  <div className="providers-models-container">
                    {Object.entries(groupedDiscoveredModels).map(([provider, models]) => {
                      if (models.length === 0) return null;
                      
                      const filteredModels = models.filter(m => 
                        m.displayName.toLowerCase().includes(modelSearchQuery.toLowerCase())
                      );
                      
                      const sortedModels = [...filteredModels].sort((a, b) => {
                        const aRec = isFrontierModel(a.name);
                        const bRec = isFrontierModel(b.name);
                        if (aRec && !bRec) return -1;
                        if (!aRec && bRec) return 1;
                        return a.displayName.localeCompare(b.displayName);
                      });

                      if (sortedModels.length === 0) return null;

                      return (
                        <div key={provider} className="provider-models-group">
                          <h4>{provider.toUpperCase()} Models</h4>
                          <div className="provider-models-list">
                            {sortedModels.map(model => {
                              const isEnabled = cloudSettings.enabled_cloud_models.includes(model.name);
                              const isRec = isFrontierModel(model.name);
                              return (
                                <div 
                                  key={model.name} 
                                  className={`model-checkbox-item ${isEnabled ? 'checked' : ''} ${isRec ? 'recommended' : ''}`}
                                  onClick={() => handleModelToggle(model.name)}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isEnabled}
                                    onChange={() => {}} /* Controlled item click */
                                  />
                                  <div className="model-item-details">
                                    <span className="model-item-name">{model.displayName}</span>
                                    {isRec && <span className="recommended-badge">Frontier</span>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Custom Cloud Models */}
            <div className="cloud-section">
              <h3>Custom Cloud Models</h3>
              <p className="cloud-section-desc">Add other models. Use format <code>provider:model_name</code> or <code>provider:organization/model_name</code> (e.g. <code>openrouter:meta-llama/llama-3-70b-instruct</code>).</p>
              <div className="custom-model-input-row">
                <input
                  type="text"
                  className="search-input"
                  placeholder="e.g. openrouter:meta-llama/llama-3-70b-instruct"
                  value={customModelInput}
                  onChange={(e) => setCustomModelInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddCustomModel(); }}
                />
                <button type="button" className="add-custom-btn" onClick={handleAddCustomModel}>Add</button>
              </div>

              <div className="custom-models-list">
                {cloudSettings.custom_cloud_models.map(modelName => (
                  <div key={modelName} className="custom-model-item">
                    <span>{modelName}</span>
                    <button
                      type="button"
                      className="delete-btn"
                      onClick={() => handleRemoveCustomModel(modelName)}
                      title={`Remove ${modelName}`}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                ))}
                {cloudSettings.custom_cloud_models.length === 0 && (
                  <div className="empty-library" style={{ padding: '12px 0' }}>No custom cloud models added yet.</div>
                )}
              </div>
            </div>

            {/* Save Bar */}
            <div className="cloud-save-bar">
              <button type="button" className="save-cloud-settings-btn" onClick={handleSaveCloudSettings}>
                Save Settings
              </button>
              {saveStatus && <span className="save-status-msg">{saveStatus}</span>}
            </div>
          </div>
        )}
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
