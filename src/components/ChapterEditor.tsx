import type { Chapter } from '../model/types';

interface ChapterEditorProps {
  chapter: Chapter | null;
  onChange(text: string): void;
}

export function ChapterEditor({ chapter, onChange }: ChapterEditorProps) {
  if (!chapter) {
    return (
      <section className="panel editor">
        <p className="empty">No chapter selected. Add one to get started.</p>
      </section>
    );
  }

  return (
    <section className="panel editor">
      <h2 className="panel-title">{chapter.title}</h2>
      <textarea
        className="chapter-text"
        aria-label={`Story text of ${chapter.title}`}
        placeholder="Write this chapter…"
        value={chapter.text}
        onChange={(event) => onChange(event.target.value)}
      />
    </section>
  );
}
