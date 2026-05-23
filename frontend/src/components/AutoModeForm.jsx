import { useState, useEffect } from 'react';
import { api } from '../api';
import { assessCouncilMemory } from '../utils/councilMemory';
import { getAutoModeSubmitState } from '../utils/autoModeSubmit';
import { normalizePullProgress } from '../utils/pullProgress';
import { SYNTHESIS_PROFILES } from '../utils/synthesisProfiles';
import './AutoModeForm.css';

export default function AutoModeForm({ 
  onSubmit, 
  onCancel, 
  isLoading, 
  localModels = [], 
  systemInfo, 
  pullingModel, 
  pullProgress, 
  onPullModel, 
  onCancelPull,
  onOpenSettings,
  selectedSynthesisProfile,
  setSelectedSynthesisProfile,
}) {
  const [query, setQuery] = useState('');
  const [selectedModels, setSelectedModels] = useState([]);
  const availableModels = localModels.filter(m => !m.is_cloud || m.is_configured);
  const [memoryAssessment, setMemoryAssessment] = useState({
    estimatedPeakGb: 0,
    totalRamGb: 16,
    availableRamGb: 16,
    status: 'safe',
    message: 'Current free RAM looks sufficient.',
  });
  const [recommendations, setRecommendations] = useState([]);

  // Auto-select first 2 configured models if none selected
  useEffect(() => {
    if (selectedModels.length === 0) {
      if (availableModels.length >= 2) {
        setSelectedModels([availableModels[0].name, availableModels[1].name]);
      }
    }
  }, [availableModels, selectedModels]);

  // Fetch recommendations for empty state
  useEffect(() => {
    const fetchRecs = async () => {
      try {
        const status = await api.getSystemStatus();
        if (status && status.recommendations) {
          setRecommendations(status.recommendations.models.slice(0, 3));
        }
      } catch (error) {
        console.error('Failed to load model recommendations:', error);
      }
    };
    if (availableModels.length === 0) fetchRecs();
  }, [availableModels]);

  // Calculate RAM pressure whenever selection changes
  useEffect(() => {
    setMemoryAssessment(
      assessCouncilMemory(selectedModels, availableModels, recommendations, systemInfo),
    );
  }, [selectedModels, availableModels, recommendations, systemInfo]);

  const toggleModel = (modelName) => {
    setSelectedModels(prev => 
      prev.includes(modelName) 
        ? prev.filter(m => m !== modelName) 
        : [...prev, modelName]
    );
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (query.trim() && selectedModels.length >= 2) {
      onSubmit(query, selectedModels);
    } else if (selectedModels.length < 2) {
      alert('Please select at least 2 models for the council.');
    } else {
      alert('Please enter your question.');
    }
  };

  const isOverloaded = memoryAssessment.status === 'critical';
  const isRisky = memoryAssessment.status === 'warning';
  const submitState = getAutoModeSubmitState({
    isLoading,
    localModelCount: availableModels.length,
    memoryStatus: memoryAssessment.status,
  });

  return (
    <div className="auto-mode-form">
      <h3>Auto Council Mode</h3>
      <p>Select local models to provide responses and rank each other automatically.</p>
      
      <form onSubmit={handleSubmit}>
        <div className="form-section">
          <label>Your Question:</label>
          <textarea
            className="query-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask the council anything..."
            rows={3}
            required
          />
        </div>

        <div className="form-section synthesis-profile-section">
          <label>Synthesis Profile:</label>
          <div className="synthesis-profile-row">
            <select
              className="chairman-selector"
              value={selectedSynthesisProfile}
              onChange={(e) => setSelectedSynthesisProfile(e.target.value)}
              disabled={isLoading}
            >
              {SYNTHESIS_PROFILES.map((profile) => (
                <option key={profile.value} value={profile.value}>
                  {profile.label}
                </option>
              ))}
            </select>
            <span className="synthesis-profile-note">
              Auto chooses strategic for planning-style prompts and concise for normal Q&A.
            </span>
          </div>
        </div>

        <div className="council-selection-section">
          <label>Select Council Members (Min 2):</label>
          
          <div className="ram-warning-bar">
            <div className="ram-stats">
              Estimated peak RAM: <strong>{memoryAssessment.estimatedPeakGb}GB</strong> | Free now: {memoryAssessment.availableRamGb}GB | Total: {memoryAssessment.totalRamGb}GB
            </div>
            {isOverloaded ? (
              <div className="warning-msg error">
                🔴 <strong>CRITICAL:</strong> {memoryAssessment.message}
              </div>
            ) : isRisky ? (
              <div className="warning-msg risk">
                🟡 <strong>WARNING:</strong> {memoryAssessment.message}
              </div>
            ) : (
              <div className="warning-msg safe">
                🟢 <strong>SAFE:</strong> {memoryAssessment.message}
              </div>
            )}
          </div>

          <div className="models-selection-grid">
            {availableModels.length === 0 ? (
              <div className="no-models-wizard">
                <p className="wizard-hint">No models installed yet. Pull these recommended models to get started:</p>
                <div className="recommendation-row">
                  {recommendations.map(m => {
                    const isDownloading = pullingModel === m.name;
                    const pullState = isDownloading ? normalizePullProgress(pullProgress) : null;
                    return (
                      <div key={m.name} className="mini-recommend-card">
                        <div className="family-badge">{m.family}</div>
                        <div className="name">{m.name}</div>
                        <div className="meta">{m.size_gb}GB • {m.type}</div>
                        
                        {isDownloading ? (
                          <div className="wizard-pull-progress">
                            {pullState.showProgressBar ? (
                              <div className="mini-bar">
                                <div className="fill" style={{width: `${pullState.percent}%`}}></div>
                              </div>
                            ) : (
                              <div className="wizard-verify-state">
                                <div className="verify-spinner"></div>
                                <span>{pullState.label}</span>
                              </div>
                            )}
                            <button type="button" className="mini-cancel" onClick={() => onCancelPull(m.name)}>×</button>
                          </div>
                        ) : (
                          <button 
                            type="button" 
                            className="mini-pull-btn"
                            onClick={() => onPullModel(m.name)}
                            disabled={pullingModel !== null}
                          >
                            Install
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button 
                  type="button" 
                  className="go-to-settings-btn"
                  onClick={onOpenSettings}
                >
                  ⚙ Advanced Model Management
                </button>
              </div>
            ) : (
              availableModels.map((model) => {
                const isCloud = model.is_cloud;
                const isSelected = selectedModels.includes(model.name);

                return (
                  <div 
                    key={model.name} 
                    className={`model-select-card ${isCloud ? 'cloud-card' : ''} ${isSelected ? 'selected' : ''}`}
                    onClick={() => toggleModel(model.name)}
                    title={model.description || ''}
                  >
                    <div className="checkbox">
                      {isSelected ? '✓' : ''}
                    </div>
                    <div className="model-details">
                      <div className="model-name-wrapper">
                        {isCloud && <span className="cloud-icon">☁</span>}
                        <div className="model-name">{isCloud ? model.displayName : model.name}</div>
                      </div>
                      {isCloud ? (
                        <div className="model-provider-badge">
                          {model.provider}
                        </div>
                      ) : (
                        <div className="model-size">
                          {model.size ? (model.size / (1024**3)).toFixed(1) : '?'}GB
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="form-actions">
          <button type="button" className="cancel-button" onClick={onCancel} disabled={isLoading}>
            Cancel
          </button>
          <button 
            type="submit" 
            className={`submit-button ${submitState.danger ? 'danger' : ''}`}
            disabled={submitState.disabled}
          >
            {submitState.label}
          </button>
        </div>
      </form>
    </div>
  );
}
