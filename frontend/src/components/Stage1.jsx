import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import './Stage1.css';

export default function Stage1({ responses }) {
  const [activeTab, setActiveTab] = useState(0);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [isCollapsed, setIsCollapsed] = useState(true);

  if (!responses || responses.length === 0) {
    return null;
  }

  const handleCopy = (text, index) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className={`stage stage1 ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="stage1-header">
        <h3 className="stage-title">Stage 1: Individual Responses</h3>
      </div>

      <div className="tabs">
        {responses.map((resp, index) => (
          <button
            key={index}
            className={`tab ${activeTab === index ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setActiveTab(index);
            }}
          >
            {resp.model.includes('/') ? resp.model.split('/')[1] : resp.model}
          </button>
        ))}
      </div>

      <div className="tab-content-wrapper">
        <div className="tab-content">
          <div className="tab-header">
            <div className="model-name">{responses[activeTab].model}</div>
            <button 
              className={`copy-button ${copiedIndex === activeTab ? 'copied' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                handleCopy(responses[activeTab].response, activeTab);
              }}
            >
              {copiedIndex === activeTab ? '✓ Copied' : '📋 Copy Response'}
            </button>
          </div>
          <div className="response-text markdown-content">
            <ReactMarkdown>{responses[activeTab].response}</ReactMarkdown>
          </div>
        </div>
        
        <div className="collapse-overlay-trigger" onClick={() => setIsCollapsed(!isCollapsed)}>
          <button className="bottom-collapse-btn">
            {isCollapsed ? '▼ Show More (Expanded View)' : '▲ Show Less (Collapsed View)'}
          </button>
        </div>
      </div>
    </div>
  );
}
