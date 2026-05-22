import { useState, useRef } from 'react';
import { SYNTHESIS_PROFILES } from '../utils/synthesisProfiles';
import { getFullModelName } from '../utils/modelFormatting';
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
  const [files, setFiles] = useState([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const configuredModels = (localModels || []).filter(m => !m.is_cloud || m.is_configured);

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

  // Drag and drop handlers
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFiles = Array.from(e.dataTransfer.files);
      const validFiles = droppedFiles.filter(file => {
        const ext = file.name.split('.').pop().toLowerCase();
        return ['pdf', 'txt', 'md', 'json', 'csv'].includes(ext);
      });
      if (validFiles.length < droppedFiles.length) {
        alert("Only text/markdown or PDF files are supported.");
      }
      setFiles((prev) => [...prev, ...validFiles]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      setFiles((prev) => [...prev, ...selectedFiles]);
    }
  };

  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const triggerFileInput = () => {
    fileInputRef.current.click();
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const validResponses = modelResponses
      .filter((item) => item.model.trim() !== '' && item.response.trim() !== '')
      .map((item) => ({ model: item.model, response: item.response }));

    if (!query.trim()) {
      alert('Please provide the original question/query.');
      return;
    }

    const hasFiles = files.length > 0;
    const hasPasted = validResponses.length >= 2;

    if (!hasFiles && !hasPasted) {
      if (validResponses.length > 0) {
        alert('Please provide at least 2 pasted model responses, or upload text/PDF files.');
      } else {
        alert('Please upload text/PDF files or paste at least 2 model responses.');
      }
      return;
    }

    onSubmit(query, validResponses, files);
  };

  return (
    <div className="manual-response-form">
      <div className="manual-form-header">
        <div className="header-text">
          <h3>Manual Council Input</h3>
          <p>Provide research documents (PDFs/TXTs) or copy-paste responses from frontier models for synthesis.</p>
        </div>
        <div className="header-controls">
          <div className="header-control-group">
            <label htmlFor="chairman-select-manual">Chairman:</label>
            <select 
              id="chairman-select-manual"
              className="chairman-selector"
              value={selectedChairman}
              onChange={(e) => setSelectedChairman(e.target.value)}
              disabled={isLoading || configuredModels.length === 0}
            >
              {configuredModels.length === 0 && <option>No models installed</option>}
              {configuredModels.map(m => (
                <option key={m.name} value={m.name}>{getFullModelName(m.name)}</option>
              ))}
            </select>
          </div>
          <div className="header-control-group">
            <label htmlFor="synthesis-select-manual">Synthesis:</label>
            <select
              id="synthesis-select-manual"
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
          <label htmlFor="query-textarea">Original Question / Deliberation Prompt:</label>
          <textarea
            id="query-textarea"
            className="query-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What question did you ask the models or what is the topic of synthesis?"
            rows={3}
            required
          />
        </div>

        {/* File Upload Section */}
        <div className="form-section file-upload-section">
          <label>Upload Research Files (PDF, TXT, MD, JSON):</label>
          <div 
            className={`file-dropzone ${isDragActive ? 'drag-active' : ''}`}
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            onClick={triggerFileInput}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              multiple 
              onChange={handleFileChange} 
              accept=".pdf,.txt,.md,.json,.csv"
              style={{ display: 'none' }}
              aria-label="Upload files"
            />
            <div className="dropzone-content">
              <span className="upload-icon">📂</span>
              <p className="dropzone-text">Drag & drop files here, or <span className="browse-link">browse</span></p>
              <p className="dropzone-hint">Supports PDF, TXT, Markdown (Max 20MB per file)</p>
            </div>
          </div>

          {files.length > 0 && (
            <div className="uploaded-files-list">
              {files.map((file, idx) => (
                <div key={idx} className="file-item-chip">
                  <span className="file-chip-icon">📄</span>
                  <div className="file-chip-info">
                    <span className="file-chip-name">{file.name}</span>
                    <span className="file-chip-size">{formatFileSize(file.size)}</span>
                  </div>
                  <button 
                    type="button" 
                    className="file-chip-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(idx);
                    }}
                    aria-label={`Remove ${file.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="form-divider">
          <span className="divider-text">OR PASTE TEXT MANUALLY</span>
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
                    aria-label={`Model Name for response ${item.id}`}
                  />
                  {modelResponses.length > 2 && (
                    <button 
                      type="button" 
                      className="remove-model-button"
                      onClick={() => removeModel(item.id)}
                      aria-label={`Remove response ${item.id}`}
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
                  aria-label={`Paste response for ${item.model || 'model'}`}
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
