import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
import ManualResponseForm from './ManualResponseForm';
import AutoModeForm from './AutoModeForm';
import { getFollowUpComposerState } from '../utils/conversationFlow';
import './ChatInterface.css';

export default function ChatInterface({
  conversation,
  onSendMessage,
  onRetrySynthesis,
  localModels = [],
  systemInfo,
  pullingModel,
  pullProgress,
  onPullModel,
  onCancelPull,
  isLoading,
  onOpenSettings,
}) {
  const [mode, setMode] = useState('manual'); // 'manual' or 'auto'
  const [input, setInput] = useState('');
  const [selectedChairman, setSelectedChairman] = useState('');
  const [selectedSynthesisProfile, setSelectedSynthesisProfile] = useState('auto');
  const messagesEndRef = useRef(null);
  const previousConversationIdRef = useRef(null);
  const effectiveChairman = selectedChairman || localModels[0]?.name || '';
  const followUpComposer = getFollowUpComposerState(conversation, localModels);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (conversation?.id !== previousConversationIdRef.current) {
      setMode('manual');
      setInput('');
      setSelectedChairman('');
      setSelectedSynthesisProfile('auto');
      previousConversationIdRef.current = conversation?.id ?? null;
    }

    // Only scroll if there are actually messages
    if (conversation?.messages?.length > 0) {
      scrollToBottom();
    }
  }, [conversation]);

  const handleManualSubmit = (query, manualResponses) => {
    onSendMessage(query, manualResponses, effectiveChairman, null, selectedSynthesisProfile);
  };

  const handleAutoSubmit = (query, councilModels) => {
    onSendMessage(query, null, effectiveChairman, councilModels, selectedSynthesisProfile);
  };

  const handleFollowUpSubmit = (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !followUpComposer.canSend) {
      return;
    }

    onSendMessage(
      input,
      null,
      effectiveChairman,
      followUpComposer.councilModels,
      selectedSynthesisProfile,
    );
    setInput('');
  };

  if (!conversation) {
    return (
      <div className="chat-interface">
        <div className="empty-state">
          <h2>Welcome to LLM Council</h2>
          <p>Create a new conversation to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-interface">
      <div className="messages-container">
        {conversation.messages.length === 0 ? (
          <div className="empty-state">
            <div className="mode-toggle-header">
              <button 
                className={`mode-btn ${mode === 'manual' ? 'active' : ''}`}
                onClick={() => setMode('manual')}
              >
                Manual (Copy-Paste)
              </button>
              <button 
                className={`mode-btn ${mode === 'auto' ? 'active' : ''}`}
                onClick={() => setMode('auto')}
              >
                Auto (Local Parallel)
              </button>
            </div>

            {mode === 'manual' ? (
              <ManualResponseForm 
                onSubmit={handleManualSubmit} 
                onCancel={() => {}} 
                isLoading={isLoading} 
                localModels={localModels}
                selectedChairman={effectiveChairman}
                setSelectedChairman={setSelectedChairman}
                selectedSynthesisProfile={selectedSynthesisProfile}
                setSelectedSynthesisProfile={setSelectedSynthesisProfile}
              />
            ) : (
              <AutoModeForm
                onSubmit={handleAutoSubmit}
                onCancel={() => {}}
                isLoading={isLoading}
                localModels={localModels}
                systemInfo={systemInfo}
                pullingModel={pullingModel}
                pullProgress={pullProgress}
                onPullModel={onPullModel}
                onCancelPull={onCancelPull}
                onOpenSettings={onOpenSettings}
                selectedSynthesisProfile={selectedSynthesisProfile}
                setSelectedSynthesisProfile={setSelectedSynthesisProfile}
              />
            )}
          </div>
        ) : (
          conversation.messages.map((msg, index) => (
            <div key={index} className="message-group">
              {msg.role === 'user' ? (
                <div className="user-message">
                  <div className="message-label">You</div>
                  <div className="message-content">
                    <div className="markdown-content">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="assistant-message">
                  <div className="message-label">LLM Council</div>

                  {/* Stage 1 */}
                  {msg.loading?.stage1 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Collecting individual responses...</span>
                    </div>
                  )}
                  {msg.stage1 && <Stage1 responses={msg.stage1} />}

                  {/* Stage 2 (Peer Evaluation) */}
                  {msg.loading?.stage2 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Peer evaluation in progress...</span>
                    </div>
                  )}
                  {msg.stage2 && msg.stage2.length > 0 && (
                    <Stage2
                      rankings={msg.stage2}
                      labelToModel={msg.metadata?.label_to_model}
                      aggregateRankings={msg.metadata?.aggregate_rankings}
                    />
                  )}

                  {/* Stage 3 (Renamed to Stage 2 for the user) */}
                  {msg.loading?.stage3 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Running Stage 2: Final synthesis...</span>
                    </div>
                  )}
                  {msg.stage3 && (
                    <Stage3 
                      key={`${index}-${msg.stage3?.model || 'none'}-${msg.stage3?.synthesis_profile || 'auto'}`}
                      finalResponse={msg.stage3} 
                      onRetry={onRetrySynthesis}
                      localModels={localModels}
                    />
                  )}
                </div>
              )}
            </div>
          ))
        )}

        {conversation.messages.some(m => m.loading?.stage1 || m.loading?.stage2 || m.loading?.stage3) && (
          <div className="loading-indicator">
            <div className="spinner"></div>
            <span>Consulting the council...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {conversation.messages.length === 0 ? (
        <div className="bottom-input-note">
          Use the forms above to start the council process.
        </div>
      ) : (
        <form className="input-form" onSubmit={handleFollowUpSubmit}>
          <div className="input-controls">
            <div className="follow-up-meta">
              <span>{followUpComposer.message}</span>
            </div>
            <select
              id="synthesis-select"
              className="chairman-selector"
              value={selectedSynthesisProfile}
              onChange={(e) => setSelectedSynthesisProfile(e.target.value)}
              disabled={isLoading}
              aria-label="Synthesis profile"
            >
              <option value="auto">Profile: Auto</option>
              <option value="concise">Profile: Concise</option>
              <option value="strategic">Profile: Strategic</option>
            </select>
            <select
              id="chairman-select"
              className="chairman-selector"
              value={effectiveChairman}
              onChange={(e) => setSelectedChairman(e.target.value)}
              disabled={isLoading || localModels.length === 0}
              aria-label="Chairman model"
            >
              {localModels.map((model) => (
                <option key={model.name} value={model.name}>
                  Chairman: {model.name}
                </option>
              ))}
            </select>
          </div>
          <div className="message-input-wrapper">
            <textarea
              id="followup-textarea"
              className="message-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Continue the conversation..."
              rows={2}
              disabled={isLoading}
              aria-label="Follow-up message"
            />
            <button
              type="submit"
              className="send-button"
              disabled={isLoading || !input.trim() || !followUpComposer.canSend}
            >
              Send
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
