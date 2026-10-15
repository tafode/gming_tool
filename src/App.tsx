import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { DocumentSidebar } from './components/DocumentSidebar';
import { DocumentViewer } from './components/DocumentViewer';
import { MusicPanel, type Playback } from './components/MusicPanel';
import { StatusBar } from './components/StatusBar';
import { createAutosaver, downloadDocument, loadDocument, saveDocument } from './model/store';
import {
  addTrack,
  parseSaveData,
  removeTrack,
  setTrackTitle,
  type SaveData,
} from './model/types';
import {
  NOT_YOUTUBE_MESSAGE,
  fetchVideoTitle,
  isPlaceholderTitle,
  placeholderTitle,
  videoIdFromUrl,
} from './music/youtube';
import { useDocuments } from './pdf/useDocuments';
import { useYouTubePlayer } from './player/useYouTubePlayer';
import { loadYouTubeApi, PlayerState } from './player/youtubeApi';

export default function App() {
  const [initial] = useState(loadDocument);
  const [data, setData] = useState<SaveData>(initial.data);
  const [notice, setNotice] = useState<string | null>(initial.notice ?? null);
  const [volume, setVolume] = useState(0.7);
  const [activeTrackId, setActiveTrackId] = useState<number | null>(null);
  const [playback, setPlayback] = useState<Playback>('idle');
  const [saveState, setSaveState] = useState<'saved' | 'unsaved'>('saved');

  // The newest document, for callbacks that must not be rebuilt on every edit.
  const dataRef = useRef(data);
  dataRef.current = data;

  const [autosaver] = useState(() =>
    createAutosaver(() => {
      saveDocument(dataRef.current);
      setSaveState('saved');
    }),
  );

  // --- persistence ---------------------------------------------------------

  const skippedFirstSave = useRef(false);
  useEffect(() => {
    // Nothing has changed on the first pass, so nothing is written yet.
    if (!skippedFirstSave.current) {
      skippedFirstSave.current = true;
      return;
    }
    setSaveState('unsaved');
    autosaver.schedule();
  }, [data, autosaver]);

  useEffect(() => {
    // Closing a tab mid-edit must not lose the last keystrokes.
    const flush = () => autosaver.flush();
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      autosaver.flush();
    };
  }, [autosaver]);

  // --- documents -----------------------------------------------------------

  const documents = useDocuments();

  // --- music ---------------------------------------------------------------

  const setTitleIfPlaceholder = useCallback((videoId: string, title: string) => {
    setData((current) => {
      const target = current.music.tracks.find(
        (track) => videoIdFromUrl(track.url) === videoId && isPlaceholderTitle(track),
      );
      return target
        ? { ...current, music: setTrackTitle(current.music, target.id, title) }
        : current;
    });
  }, []);

  const player = useYouTubePlayer({
    volume,
    onTitle: setTitleIfPlaceholder,
    onState: (state) => {
      if (state === PlayerState.PLAYING) {
        setPlayback('playing');
      } else if (state === PlayerState.PAUSED) {
        setPlayback('paused');
      } else if (state === PlayerState.CUED) {
        // Loaded but not running: autoplay was refused, so say so rather than
        // pretending to play.
        setPlayback('paused');
      } else if (state === PlayerState.ENDED) {
        setPlayback('idle');
      }
    },
    onError: (message) => {
      setNotice(message);
      setPlayback('idle');
    },
  });
  const { controls } = player;

  // Fetch YouTube's player script as soon as there is music, so the first click
  // spends the browser's user-activation window starting playback rather than
  // downloading a script.
  const trackCount = data.music.tracks.length;
  useEffect(() => {
    if (trackCount > 0) {
      loadYouTubeApi().catch(() => {
        // Reported when the user actually tries to play something.
      });
    }
  }, [trackCount]);

  const handlePlayTrack = useCallback(
    (trackId: number) => {
      const track = dataRef.current.music.tracks.find((candidate) => candidate.id === trackId);
      if (!track) {
        return;
      }
      const videoId = videoIdFromUrl(track.url);
      if (!videoId) {
        setNotice(NOT_YOUTUBE_MESSAGE);
        return;
      }
      setNotice(null);
      setActiveTrackId(trackId);
      setPlayback('playing');
      controls.load(videoId);
    },
    [controls],
  );

  const handleToggleTrack = useCallback(
    (trackId: number) => {
      const isActive = trackId === activeTrackId;
      if (isActive && playback === 'playing') {
        controls.pause();
        setPlayback('paused');
        return;
      }
      if (isActive && playback === 'paused') {
        controls.play();
        setPlayback('playing');
        return;
      }
      handlePlayTrack(trackId);
    },
    [activeTrackId, playback, handlePlayTrack, controls],
  );

  const handleTransportToggle = useCallback(() => {
    if (playback === 'playing') {
      controls.pause();
      setPlayback('paused');
      return;
    }
    if (activeTrackId !== null) {
      handlePlayTrack(activeTrackId);
    }
  }, [playback, activeTrackId, handlePlayTrack, controls]);

  const handleStop = useCallback(() => {
    controls.stop();
    setPlayback('idle');
  }, [controls]);

  const handleAddTrack = useCallback(
    (url: string): boolean => {
      const videoId = videoIdFromUrl(url);
      if (!videoId) {
        setNotice(NOT_YOUTUBE_MESSAGE);
        return false;
      }
      setNotice(null);
      setData((current) => ({
        ...current,
        music: addTrack(current.music, url.trim(), placeholderTitle(videoId)).library,
      }));
      // Titles come from YouTube's public oEmbed endpoint; on failure the
      // placeholder simply stays until the player reports one.
      void fetchVideoTitle(videoId).then((title) => {
        if (title) {
          setTitleIfPlaceholder(videoId, title);
        }
      });
      return true;
    },
    [setTitleIfPlaceholder],
  );

  const handleDeleteTrack = useCallback(
    (trackId: number) => {
      setData((current) => ({ ...current, music: removeTrack(current.music, trackId) }));
      if (trackId === activeTrackId) {
        controls.stop();
        setActiveTrackId(null);
        setPlayback('idle');
      }
    },
    [activeTrackId, controls],
  );

  // --- import / export -----------------------------------------------------

  const handleExport = useCallback(() => {
    downloadDocument(dataRef.current);
  }, []);

  const handleImport = useCallback(
    (file: File) => {
      void file.text().then((text) => {
        try {
          const imported = parseSaveData(text);
          controls.stop();
          setActiveTrackId(null);
          setPlayback('idle');
          setData(imported);
          setNotice(`Imported ${file.name}.`);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          setNotice(`Could not import ${file.name}: ${reason}`);
        }
      });
    },
    [controls],
  );

  const handleImportFile = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset first, so picking the same file twice still fires a change event.
      event.target.value = '';
      if (file) {
        handleImport(file);
      }
    },
    [handleImport],
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>GMing Tool</h1>
        <span className="spacer" />
        <button type="button" onClick={handleExport}>
          Export
        </button>
        <label className="file-button">
          Import
          <input type="file" accept="application/json,.json" onChange={handleImportFile} />
        </label>
      </header>

      <div className="app-body">
        <DocumentSidebar
          documents={documents.documents}
          library={documents.library}
          loading={documents.loading}
          error={documents.error}
          activePath={documents.activePath}
          search={documents.search}
          onSelect={documents.open}
          onOpenResult={documents.open}
          onRefresh={documents.refresh}
        />
        <DocumentViewer
          document={documents.active}
          page={documents.page}
          revision={documents.revision}
          converter={documents.converter}
          preparing={documents.preparing}
          error={documents.viewerError}
        />
        <MusicPanel
          tracks={data.music.tracks}
          activeTrackId={activeTrackId}
          playback={playback}
          volume={volume}
          hostRef={player.hostRef}
          onVolumeChange={setVolume}
          onToggle={handleToggleTrack}
          onTransportToggle={handleTransportToggle}
          onStop={handleStop}
          onAdd={handleAddTrack}
          onDelete={handleDeleteTrack}
        />
      </div>

      <StatusBar
        saveState={saveState}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
      />
    </div>
  );
}
