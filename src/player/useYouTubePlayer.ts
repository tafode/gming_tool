//! Owns the embedded YouTube player for the whole session.
//!
//! The player is created lazily, the first time a track is played, and then
//! reused: switching tracks calls `loadVideoById`, so nothing reloads the API
//! script or rebuilds the iframe.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  describePlayerError,
  loadYouTubeApi,
  PlayerState,
  type VideoData,
  type YTNamespace,
  type YTPlayer,
} from './youtubeApi';

export interface YouTubeControls {
  /** Load a video and start playing it. */
  load(videoId: string): void;
  play(): void;
  pause(): void;
  stop(): void;
}

export interface UseYouTubePlayerOptions {
  /** Desired volume, 0–1. Re-applied whenever it changes or the player appears. */
  volume: number;
  /** Fired when the player reports the current video's title. */
  onTitle(videoId: string, title: string): void;
  /** Fired for every player state change (see [`PlayerState`]). */
  onState(state: number): void;
  /** Fired when the player cannot play what was asked of it. */
  onError(message: string): void;
}

export interface UseYouTubePlayerResult {
  /** Attach to the element the player should fill. */
  hostRef: RefObject<HTMLDivElement | null>;
  controls: YouTubeControls;
}

function readVideoData(player: YTPlayer): VideoData | null {
  try {
    const info = player.getVideoData();
    return info && typeof info === 'object' ? info : null;
  } catch {
    // Asking too early throws; the next state change will try again.
    return null;
  }
}

export function useYouTubePlayer(options: UseYouTubePlayerOptions): UseYouTubePlayerResult {
  const { volume } = options;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const creatingRef = useRef(false);
  const pendingVideoRef = useRef<string | null>(null);
  const queueRef = useRef<Array<(player: YTPlayer) => void>>([]);
  const [ready, setReady] = useState(false);
  // Whether playback is wanted right now, and whether we have already tried to
  // rescue a blocked autoplay for the current track.
  const wantsToPlayRef = useRef(false);
  const nudgedRef = useRef(false);

  // Events are read through a ref so changing callbacks never rebuilds the player.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const flushQueue = useCallback(() => {
    const player = playerRef.current;
    if (!player) {
      return;
    }
    const queued = queueRef.current;
    queueRef.current = [];
    for (const action of queued) {
      action(player);
    }
  }, []);

  const ensurePlayer = useCallback(async () => {
    if (playerRef.current || creatingRef.current) {
      return;
    }
    const host = hostRef.current;
    if (!host) {
      return;
    }
    creatingRef.current = true;

    let namespace: YTNamespace;
    try {
      namespace = await loadYouTubeApi();
    } catch (error) {
      creatingRef.current = false;
      optionsRef.current.onError(
        error instanceof Error
          ? `could not start the YouTube player: ${error.message}`
          : 'could not start the YouTube player',
      );
      return;
    }

    // YouTube's script replaces the element it is handed with an <iframe>, so it
    // gets a throw-away child of ours and React stays well clear of that subtree.
    const mount = document.createElement('div');
    host.appendChild(mount);

    const initialVideo = pendingVideoRef.current;
    pendingVideoRef.current = null;

    new namespace.Player(mount, {
      videoId: initialVideo ?? undefined,
      playerVars: {
        autoplay: 1,
        controls: 1,
        rel: 0,
        playsinline: 1,
        enablejsapi: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: (event) => {
          playerRef.current = event.target;
          readyRef.current = true;
          creatingRef.current = false;
          event.target.setVolume(Math.round(optionsRef.current.volume * 100));

          const queuedVideo = pendingVideoRef.current;
          pendingVideoRef.current = null;
          if (queuedVideo) {
            event.target.loadVideoById(queuedVideo);
          }

          flushQueue();
          setReady(true);
        },
        onStateChange: (event) => {
          if (event.data === PlayerState.CUED && wantsToPlayRef.current && !nudgedRef.current) {
            // Autoplay was refused (usually because the API script finished
            // loading after the click's activation window lapsed). Ask once more
            // now that the video is cued; a state of CUED is still reported, so
            // the UI stays honest if it does not work.
            nudgedRef.current = true;
            event.target.playVideo();
          }

          optionsRef.current.onState(event.data);

          if (event.data === PlayerState.PLAYING) {
            const info = readVideoData(event.target);
            if (info?.title && info.video_id) {
              optionsRef.current.onTitle(info.video_id, info.title);
            }
          }
        },
        onError: (event) => {
          optionsRef.current.onError(describePlayerError(event.data));
        },
      },
    });
  }, [flushQueue]);

  /** Run an action now, or as soon as the player finishes coming up. */
  const withPlayer = useCallback((action: (player: YTPlayer) => void) => {
    const player = playerRef.current;
    if (!player) {
      // Nothing has been loaded yet, so there is nothing to control.
      return;
    }
    if (readyRef.current) {
      action(player);
    } else {
      queueRef.current.push(action);
    }
  }, []);

  const load = useCallback(
    (videoId: string) => {
      wantsToPlayRef.current = true;
      nudgedRef.current = false;

      const player = playerRef.current;
      if (player && readyRef.current) {
        player.loadVideoById(videoId);
        return;
      }
      pendingVideoRef.current = videoId;
      void ensurePlayer();
    },
    [ensurePlayer],
  );

  const play = useCallback(
    () => {
      wantsToPlayRef.current = true;
      nudgedRef.current = false;
      withPlayer((player) => player.playVideo());
    },
    [withPlayer],
  );

  const pause = useCallback(
    () => {
      wantsToPlayRef.current = false;
      withPlayer((player) => player.pauseVideo());
    },
    [withPlayer],
  );

  const stop = useCallback(
    () => {
      wantsToPlayRef.current = false;
      withPlayer((player) => player.stopVideo());
    },
    [withPlayer],
  );

  useEffect(() => {
    if (ready && playerRef.current) {
      playerRef.current.setVolume(Math.round(volume * 100));
    }
  }, [volume, ready]);

  useEffect(
    () => () => {
      try {
        playerRef.current?.destroy();
      } catch {
        // Already gone; nothing to clean up.
      }
      playerRef.current = null;
      readyRef.current = false;
    },
    [],
  );

  const controls = useMemo<YouTubeControls>(() => ({ load, play, pause, stop }), [
    load,
    play,
    pause,
    stop,
  ]);

  return { hostRef, controls };
}
