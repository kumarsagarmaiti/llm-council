import { useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import './Sidebar.css';

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    <line x1="10" y1="11" x2="10" y2="17"></line>
    <line x1="14" y1="11" x2="14" y2="17"></line>
  </svg>
);

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onOpenSettings,
  onDeleteConversation,
  theme,
  onToggleTheme,
}) {
  const [confirmId, setConfirmId] = useState(null);

  const confirmTitle = conversations.find(c => c.id === confirmId)?.title || 'this conversation';

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>LLM Council</h1>
        <button className="new-conversation-btn" onClick={onNewConversation}>
          + New Conversation
        </button>
      </div>

      <div className="conversation-list">
        {conversations.length === 0 ? (
          <div className="no-conversations">No conversations yet</div>
        ) : (
          conversations.map((conv) => (
            <div
              key={conv.id}
              className={`conversation-item ${conv.id === currentConversationId ? 'active' : ''}`}
              onClick={() => onSelectConversation(conv.id)}
            >
              <div className="conversation-content">
                <div className="conversation-title">
                  {conv.title || 'New Conversation'}
                </div>
                <div className="conversation-meta">
                  {conv.message_count} messages
                </div>
              </div>
              <button
                className="delete-conversation-btn"
                onClick={(e) => { e.stopPropagation(); setConfirmId(conv.id); }}
                title="Delete Conversation"
              >
                <TrashIcon />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="sidebar-footer">
        <button className="theme-toggle" onClick={onToggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
          <span className="theme-toggle-icon">{theme === 'dark' ? '◑' : '◐'}</span>
          {theme === 'dark' ? 'LIGHT MODE' : 'DARK MODE'}
        </button>
        <button className="settings-btn" onClick={onOpenSettings}>
          ⚙ Settings &amp; Models
        </button>
      </div>

      {confirmId && (
        <ConfirmDialog
          message="Delete conversation?"
          detail={confirmTitle}
          confirmLabel="Delete"
          onConfirm={() => { onDeleteConversation(confirmId); setConfirmId(null); }}
          onCancel={() => setConfirmId(null)}
        />
      )}
    </div>
  );
}
