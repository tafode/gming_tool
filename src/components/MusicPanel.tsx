import { useState, type FormEvent, type RefObject } from 'react';
import type { Track } from '../model/types';

export type Playback = 'idle' | 'playing' | 'paused';

interface MusicPanelProps {
  tracks: Track[];
  activeTrackId: number | null;
  playback: Playback;
  volume: number;
  hostRef: RefObject<HTMLDivElement | null>;
  onVolumeChange(volume: number): void;
  onToggle(trackId: number): void;
  onTransportToggle(): void;
  onStop(): void;
  /** Returns `false` when the URL was refused, so the input keeps its text. */
  onAdd(url: string): boolean;
  onDelete(trackId: number): void;
}

export function MusicPanel({
  tracks,
  activeTrackId,
  playback,
  volume,
  hostRef,
  onVolumeChange,
  onToggle,
  onTransportToggle,
  onStop,
  onAdd,
  onDelete,
}: MusicPanelProps) {
  const [url, setUrl] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (onAdd(url)) {
      setUrl('');
    }
  };

  const idle = activeTrackId === null && playback === 'idle';

  return (
    <aside className="panel music">
      <h2 className="panel-title">Music</h2>

      <div className="player">
        <div className="player-host" ref={hostRef} />
        {activeTrackId === null && <p className="player-idle">Pick a track to play it here.</p>}
      </div>

      <div className="transport">
        <button type="button" onClick={onTransportToggle} disabled={idle}>
          {playback === 'playing' ? 'Pause' : 'Play'}
        </button>
        <button type="button" onClick={onStop} disabled={idle}>
          Stop
        </button>
        <label className="volume">
          <span>Volume</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            aria-label="Volume"
            onChange={(event) => onVolumeChange(Number(event.target.value) / 100)}
          />
        </label>
      </div>

      <form className="add-track" onSubmit={submit}>
        <input
          type="text"
          value={url}
          placeholder="Add a YouTube link…"
          aria-label="YouTube link"
          onChange={(event) => setUrl(event.target.value)}
        />
        <button type="submit">Add</button>
      </form>

      {tracks.length === 0 ? (
        <p className="empty">No music yet. Paste a YouTube link above.</p>
      ) : (
        <ul className="track-list">
          {tracks.map((track) => {
            const active = track.id === activeTrackId;
            return (
              <li key={track.id} className={active ? 'track active' : 'track'}>
                <button
                  type="button"
                  className="track-button"
                  aria-current={active}
                  title={track.url}
                  onClick={() => onToggle(track.id)}
                >
                  <span className="track-glyph" aria-hidden="true">
                    {active && playback === 'playing' ? '❚❚' : '▶'}
                  </span>
                  <span className="track-title">{track.title}</span>
                </button>
                <button
                  type="button"
                  className="track-delete"
                  aria-label={`Remove ${track.title}`}
                  onClick={() => onDelete(track.id)}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="hint">
        Playback happens in YouTube’s own player. Signed in to YouTube Premium in this
        browser, it stays ad-free.
      </p>
    </aside>
  );
}
