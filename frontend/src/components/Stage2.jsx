import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { getShortModelName, getFullModelName } from '../utils/modelFormatting';
import './Stage2.css';

function deAnonymizeText(text, labelToModel) {
  if (!text) return '';
  if (!labelToModel) return text;

  // Replace case-insensitively "Response [A-Za-z]" using regex
  return text.replace(/([Rr]esponse\s*([A-Za-z]))\b/g, (match, fullLabel, letter) => {
    const uppercaseLetter = letter.toUpperCase();
    const standardLabel = `Response ${uppercaseLetter}`;
    
    if (labelToModel[standardLabel]) {
      const modelShortName = getShortModelName(labelToModel[standardLabel]);
      return `**${modelShortName}**`;
    } else {
      return `${standardLabel} (Unused)`;
    }
  });
}

export default function Stage2({ rankings, labelToModel, aggregateRankings }) {
  const [activeTab, setActiveTab] = useState(0);

  if (!rankings || rankings.length === 0) {
    return null;
  }

  return (
    <div className="stage stage2">
      <div className="stage2-header">
        <h3 className="stage-title">Stage 2: Peer Evaluation & Rankings</h3>
      </div>

      <div className="stage2-intro">
        <h4>Raw Evaluations</h4>
        <p className="stage-description">
          Each model evaluated all responses (anonymized as Response A, B, C, etc.) and provided rankings.
          Below, model names are shown in <strong>bold</strong> for readability, but the original evaluation used anonymous labels.
        </p>
      </div>

      <div className="tabs">
        {rankings.map((rank, index) => (
          <button
            key={index}
            className={`tab ${activeTab === index ? 'active' : ''}`}
            onClick={() => setActiveTab(index)}
          >
            {getShortModelName(rank.model)}
          </button>
        ))}
      </div>

      <div className="tab-content">
        <div className="ranking-model">
          {getFullModelName(rankings[activeTab].model)}
        </div>
        <div className="ranking-content markdown-content">
          <ReactMarkdown>
            {deAnonymizeText(rankings[activeTab].ranking, labelToModel)}
          </ReactMarkdown>
        </div>

        {rankings[activeTab].parsed_ranking &&
         rankings[activeTab].parsed_ranking.length > 0 && (
          <div className="parsed-ranking">
            <strong>Extracted Ranking:</strong>
            {rankings[activeTab].ranking_recovered && (
              <p className="stage-description">
                The original evaluation did not include a usable final ranking, so the app requested a strict ranking-only follow-up from this model.
              </p>
            )}
            <ol>
              {rankings[activeTab].parsed_ranking.map((label, i) => {
                const hasModel = labelToModel && labelToModel[label];
                return (
                  <li key={i}>
                    {hasModel ? getShortModelName(labelToModel[label]) : `${label} (Unused)`}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>

      {aggregateRankings && aggregateRankings.length > 0 && (
        <div className="stage2-aggregate-container">
          <div className="aggregate-rankings">
            <h4>Aggregate Rankings (Street Cred)</h4>
            <p className="stage-description">
              Combined results across all peer evaluations (lower score is better):
            </p>
            <div className="aggregate-list">
              {aggregateRankings.map((agg, index) => (
                <div key={index} className="aggregate-item">
                  <span className="rank-position">#{index + 1}</span>
                  <span className="rank-model">
                    {getShortModelName(agg.model)}
                  </span>
                  <span className="rank-score">
                    Avg: {agg.average_rank.toFixed(2)}
                  </span>
                  <span className="rank-count">
                    ({agg.rankings_count} votes)
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
