interface StatusBarProps {
  saveState: 'saved' | 'unsaved';
  notice: string | null;
  onDismissNotice(): void;
}

export function StatusBar({ saveState, notice, onDismissNotice }: StatusBarProps) {
  return (
    <footer className="status">
      <span className="status-save">
        {saveState === 'saved' ? 'All changes saved' : 'Unsaved changes…'}
      </span>

      {notice !== null && (
        <span className="status-notice" role="status">
          {notice}
          <button type="button" aria-label="Dismiss message" onClick={onDismissNotice}>
            ✕
          </button>
        </span>
      )}
    </footer>
  );
}
