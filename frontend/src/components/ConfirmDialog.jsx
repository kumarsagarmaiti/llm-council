import './ConfirmDialog.css';

export default function ConfirmDialog({ message, detail, confirmLabel = 'Delete', onConfirm, onCancel }) {
  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
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
