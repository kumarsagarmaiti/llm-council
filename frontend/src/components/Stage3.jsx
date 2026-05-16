import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { SYNTHESIS_PROFILES, getSynthesisProfileLabel } from '../utils/synthesisProfiles';
import './Stage3.css';

export default function Stage3({ finalResponse, onRetry, localModels = [] }) {
  const [showReasoning, setShowReasoning] = useState(false);
  const availableModels = localModels.map((model) => model.name);
  const defaultRetryChairman = (
    finalResponse?.model && availableModels.includes(finalResponse.model)
      ? finalResponse.model
      : localModels[0]?.name
  ) || '';
  const [retryChairman, setRetryChairman] = useState(defaultRetryChairman);
  const [retryProfile, setRetryProfile] = useState(finalResponse?.synthesis_profile || 'auto');

  if (!finalResponse) {
    return null;
  }

  const effectiveRetryChairman = availableModels.includes(retryChairman)
    ? retryChairman
    : defaultRetryChairman;

  const isError = finalResponse.response.includes('Error:') || finalResponse.model === 'error';

  const modelDisplay = finalResponse.model.includes('/') 
    ? finalResponse.model.split('/')[1] 
    : finalResponse.model;

  const requestedModelDisplay = finalResponse.requested_model?.includes('/')
    ? finalResponse.requested_model.split('/')[1]
    : finalResponse.requested_model;

  return (
    <div className="stage stage3">
      <div className="stage3-header">
        <h3 className="stage-title">Stage 3: Final Council Answer</h3>
        <div className="retry-controls">
          <select 
            className="retry-chairman-selector"
            value={effectiveRetryChairman}
            onChange={(e) => setRetryChairman(e.target.value)}
          >
            {localModels.map(m => (
              <option key={m.name} value={m.name}>Chairman: {m.name}</option>
            ))}
          </select>
          <select
            className="retry-chairman-selector"
            value={retryProfile}
            onChange={(e) => setRetryProfile(e.target.value)}
          >
            {SYNTHESIS_PROFILES.map((profile) => (
              <option key={profile.value} value={profile.value}>
                Profile: {profile.label}
              </option>
            ))}
          </select>
          <button 
            className="retry-button"
            onClick={() => onRetry(effectiveRetryChairman, retryProfile)}
            title="Retry Chairman Synthesis"
          >
            ↺ Retry
          </button>
        </div>
      </div>
      
      <div className={`final-response ${isError ? 'error-border' : ''}`}>
        <div className="chairman-info">
          <div className="chairman-label">
            Chairman: {modelDisplay}
          </div>
          {requestedModelDisplay && requestedModelDisplay !== modelDisplay && (
            <div className="chairman-label">
              Requested: {requestedModelDisplay}
            </div>
          )}
          <div className="chairman-label">
            Profile: {getSynthesisProfileLabel(finalResponse.synthesis_profile)}
          </div>
          {finalResponse.reasoning && (
            <button 
              className="toggle-reasoning"
              onClick={() => setShowReasoning(!showReasoning)}
            >
              {showReasoning ? 'Hide Thinking' : 'Show Thinking'}
            </button>
          )}
        </div>

        {showReasoning && finalResponse.reasoning && (
          <div className="chairman-reasoning">
            <ReactMarkdown>{finalResponse.reasoning}</ReactMarkdown>
          </div>
        )}

        <div className={`final-text markdown-content ${isError ? 'error-text' : ''}`}>
          <ReactMarkdown>{finalResponse.response}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
