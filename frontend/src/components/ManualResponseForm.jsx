import { useState } from 'react';
import { SYNTHESIS_PROFILES } from '../utils/synthesisProfiles';
import './ManualResponseForm.css';

export default function ManualResponseForm({ 
  onSubmit, 
  onCancel, 
  isLoading,
  localModels,
  selectedChairman,
  setSelectedChairman,
  selectedSynthesisProfile,
  setSelectedSynthesisProfile,
}) {
  const [query, setQuery] = useState('');
  const [modelResponses, setModelResponses] = useState([
    { id: 1, model: 'ChatGPT', response: '' },
    { id: 2, model: 'Claude', response: '' },
    { id: 3, model: 'Gemini', response: '' },
  ]);

  const handleModelChange = (id, field, value) => {
    setModelResponses((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const addModel = () => {
    const newId = Math.max(0, ...modelResponses.map((r) => r.id)) + 1;
    setModelResponses([...modelResponses, { id: newId, model: '', response: '' }]);
  };

  const removeModel = (id) => {
    if (modelResponses.length > 2) {
      setModelResponses(modelResponses.filter((item) => item.id !== id));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const validResponses = modelResponses
      .filter((item) => item.model.trim() !== '' && item.response.trim() !== '')
      .map((item) => ({ model: item.model, response: item.response }));

    if (query.trim() && validResponses.length >= 2) {
      onSubmit(query, validResponses);
    } else if (validResponses.length < 2) {
      alert('Please provide at least 2 model responses with names.');
    } else {
      alert('Please provide a query.');
    }
  };

  return (
    <div className="manual-response-form">
      <div className="manual-form-header">
        <div className="header-text">
          <h3>Manual Council Input</h3>
          <p>Enter the question and paste responses from at least 2 models.</p>
        </div>
        <div className="header-controls">
          <div className="header-control-group">
            <label>Chairman:</label>
            <select 
              className="chairman-selector"
              value={selectedChairman}
              onChange={(e) => setSelectedChairman(e.target.value)}
              disabled={isLoading || localModels.length === 0}
            >
              {localModels.length === 0 && <option>No models installed</option>}
              {localModels.map(m => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
            </select>
          </div>
          <div className="header-control-group">
            <label>Synthesis:</label>
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
          </div>
        </div>
      </div>
      
      <form onSubmit={handleSubmit}>
        <div className="form-section query-section">
          <label>Original Question:</label>
          <textarea
            className="query-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What did you ask the models?"
            rows={3}
            required
          />
        </div>

        <div className="responses-scroll-area">
          <div className="responses-grid">
            {modelResponses.map((item) => (
              <div key={item.id} className="model-response-input">
                <div className="model-input-header">
                  <input
                    type="text"
                    className="model-name-input"
                    value={item.model}
                    onChange={(e) => handleModelChange(item.id, 'model', e.target.value)}
                    placeholder="Model Name (e.g. GPT-4)"
                  />
                  {modelResponses.length > 2 && (
                    <button 
                      type="button" 
                      className="remove-model-button"
                      onClick={() => removeModel(item.id)}
                    >
                      ×
                    </button>
                  )}
                </div>
                <textarea
                  value={item.response}
                  onChange={(e) => handleModelChange(item.id, 'response', e.target.value)}
                  placeholder={`Paste ${item.model || 'model'} response here...`}
                  rows={8}
                />
              </div>
            ))}
            <button type="button" className="add-model-card" onClick={addModel}>
              <span className="plus-icon">+</span>
              <span>Add Another Model</span>
            </button>
          </div>
        </div>

        <div className="form-actions">
          <button type="button" className="cancel-button" onClick={onCancel} disabled={isLoading}>
            Cancel
          </button>
          <button type="submit" className="submit-button" disabled={isLoading}>
            Submit to Chairman
          </button>
        </div>
      </form>
    </div>
  );
}
