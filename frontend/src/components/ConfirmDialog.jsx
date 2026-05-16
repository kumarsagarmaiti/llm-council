import { useEffect } from 'react';
import './ConfirmDialog.css';

export default function ConfirmDialog({ message, detail, confirmLabel = 'Delete', onConfirm, onCancel }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-message">{message}</p>
        {detail && <p className="confirm-detail">{detail}</p>}
        <div className="confirm-actions">
          <button className="confirm-cancel-btn" onClick={onCancel}>Cancel</button>
          <button className="confirm-ok-btn" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
