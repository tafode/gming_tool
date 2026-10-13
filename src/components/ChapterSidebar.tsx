import type { Chapter } from '../model/types';

interface ChapterSidebarProps {
  chapters: Chapter[];
  selectedId: number | null;
  onSelect(id: number): void;
  onAdd(): void;
}

export function ChapterSidebar({ chapters, selectedId, onSelect, onAdd }: ChapterSidebarProps) {
  return (
    <aside className="panel chapters">
      <h2 className="panel-title">Story</h2>

      <ul className="chapter-list">
        {chapters.map((chapter) => (
          <li key={chapter.id}>
            <button
              type="button"
              className="chapter-button"
              aria-current={chapter.id === selectedId}
              onClick={() => onSelect(chapter.id)}
            >
              {chapter.title}
            </button>
          </li>
        ))}
      </ul>

      <button type="button" className="add-button" onClick={onAdd}>
        New chapter
      </button>
    </aside>
  );
}
