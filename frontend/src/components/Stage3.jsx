import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { SYNTHESIS_PROFILES, getSynthesisProfileLabel } from '../utils/synthesisProfiles';
import { api } from '../api';
import { getFullModelName } from '../utils/modelFormatting';
import './Stage3.css';

export default function Stage3({ finalResponse, onRetry, localModels = [], userQuery = 'Synthesis Report' }) {
  const [showReasoning, setShowReasoning] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const configuredModels = localModels.filter(m => !m.is_cloud || m.is_configured);
  const availableModels = configuredModels.map((model) => model.name);
  const defaultRetryChairman = (
    finalResponse?.model && availableModels.includes(finalResponse.model)
      ? finalResponse.model
      : configuredModels[0]?.name
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

  const modelDisplay = getFullModelName(finalResponse.model);

  const requestedModelDisplay = finalResponse.requested_model
    ? getFullModelName(finalResponse.requested_model)
    : null;

  const handleDownloadPdf = async () => {
    setIsDownloading(true);
    try {
      await api.generateAndDownloadPdf(userQuery, finalResponse.response);
    } catch (error) {
      console.error('Failed to download PDF:', error);
      alert('Failed to generate PDF. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };

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
            {configuredModels.map(m => (
              <option key={m.name} value={m.name}>Chairman: {getFullModelName(m.name)}</option>
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
            className="download-pdf-button"
            onClick={handleDownloadPdf}
            disabled={isDownloading}
            title="Download PDF report"
          >
            {isDownloading ? '⏳...' : '📥 PDF'}
          </button>
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
