//! Owns the embedded YouTube players for the whole session.
//!
//! Two players are kept — one per "slot" — so a track change can *crossfade*:
//! the new video starts in the idle slot at volume 0, and once it is actually
//! playing the two are ramped against each other, volume and picture together.
//! The outgoing player is stopped but not destroyed, so the slot is warm for the
//! next change.
//!
//! The players are created lazily, the first time a track is played. When
//! nothing is playing yet, or the current track is paused, a change is a plain
//! reload of the active slot — there is nothing to blend against.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  describePlayerError,
  loadYouTubeApi,
  PlayerState,
  type VideoData,
  type YTPlayer,
} from './youtubeApi';
import { CROSSFADE_MS, CROSSFADE_TIMEOUT_MS, opacityAt, volumeAt } from './fade';

export interface YouTubeControls {
  /** Load a video and start playing it, crossfading if something is already on. */
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
  /** Attach to the element the players should fill. */
  hostRef: RefObject<HTMLDivElement | null>;
  controls: YouTubeControls;
}

interface PlayerSlot {
  index: number;
  /** Our own layer inside the host; YouTube fills it with its iframe. */
  wrapper: HTMLDivElement | null;
  player: YTPlayer | null;
  ready: boolean;
  creating: boolean;
  pendingVideo: string | null;
  queue: Array<(player: YTPlayer) => void>;
  wantsToPlay: boolean;
  nudged: boolean;
  muted: boolean;
  state: number;
}

interface Crossfade {
  fromIndex: number;
  toIndex: number;
  phase: 'loading' | 'animating';
  generation: number;
}

function makeSlot(index: number): PlayerSlot {
  return {
    index,
    wrapper: null,
    player: null,
    ready: false,
    creating: false,
    pendingVideo: null,
    queue: [],
    wantsToPlay: false,
    nudged: false,
    muted: false,
    state: PlayerState.UNSTARTED,
  };
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
  const slotsRef = useRef<PlayerSlot[]>([makeSlot(0), makeSlot(1)]);
  // Which slot the UI is showing. During a crossfade this is the incoming one.
  const activeRef = useRef(0);
  const crossfadeRef = useRef<Crossfade | null>(null);
  const fadeFrameRef = useRef<number | null>(null);
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const [ready, setReady] = useState(false);

  // Events are read through a ref so changing callbacks never rebuild a player.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const targetVolume = useCallback(() => Math.round(optionsRef.current.volume * 100), []);

  /** Create the two styled layers the iframes will live in, once. */
  function ensureWrappers(): void {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    for (const slot of slotsRef.current) {
      if (!slot.wrapper) {
        const wrapper = document.createElement('div');
        wrapper.className = 'player-slot';
        wrapper.style.opacity = '0';
        wrapper.style.pointerEvents = 'none';
        host.appendChild(wrapper);
        slot.wrapper = wrapper;
      }
    }
  }

  function setSlotLayer(slot: PlayerSlot, opacity: number, interactive: boolean): void {
    if (!slot.wrapper) {
      return;
    }
    slot.wrapper.style.opacity = String(opacity);
    slot.wrapper.style.pointerEvents = interactive ? 'auto' : 'none';
    slot.wrapper.style.zIndex = interactive ? '2' : '1';
  }

  /**
   * Mute or unmute a slot's player.
   *
   * An incoming track is started muted: it cannot leak a moment of full-volume
   * sound before `onReady` has had a chance to set its volume, and a muted
   * player is the one browsers are happiest to autoplay.
   */
  function setSlotMuted(slot: PlayerSlot, muted: boolean): void {
    if (slot.muted === muted) {
      return;
    }
    slot.muted = muted;
    if (!slot.player) {
      return;
    }
    try {
      if (muted) {
        slot.player.mute();
      } else {
        slot.player.unMute();
      }
    } catch {
      // The player is not ready to be muted yet; onReady will sort it out.
    }
  }

  function cancelFadeTimers(): void {
    if (fadeFrameRef.current !== null) {
      cancelAnimationFrame(fadeFrameRef.current);
      fadeFrameRef.current = null;
    }
    if (fadeTimeoutRef.current !== null) {
      clearTimeout(fadeTimeoutRef.current);
      fadeTimeoutRef.current = null;
    }
  }

  function ensurePlayer(slot: PlayerSlot): void {
    if (slot.player || slot.creating) {
      return;
    }
    ensureWrappers();
    const wrapper = slot.wrapper;
    if (!wrapper) {
      return;
    }
    slot.creating = true;

    void loadYouTubeApi()
      .then((namespace) => {
        if (!slot.wrapper || !hostRef.current) {
          // Host went away before the API arrived.
          slot.creating = false;
          return;
        }
        const initialVideo = slot.pendingVideo;
        slot.pendingVideo = null;

        // YouTube replaces the element it is handed with an <iframe>, so it gets
        // a throw-away child of our wrapper and React stays clear of the subtree.
        const mount = document.createElement('div');
        wrapper.appendChild(mount);

        slot.player = new namespace.Player(mount, {
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
            onReady: (event) => onSlotReady(slot, event.target),
            onStateChange: (event) => onSlotState(slot, event),
            onError: (event) => onSlotError(slot, event.data),
          },
        });

        // Created as the incoming half of a crossfade: stay silent until the
        // fade brings it in.
        const crossfade = crossfadeRef.current;
        if (crossfade !== null && crossfade.toIndex === slot.index) {
          slot.muted = true;
          try {
            slot.player.mute();
          } catch {
            // Not ready yet; onReady keeps it at volume 0 either way.
          }
        }
      })
      .catch((error: unknown) => {
        slot.creating = false;
        optionsRef.current.onError(
          error instanceof Error
            ? `could not start the YouTube player: ${error.message}`
            : 'could not start the YouTube player',
        );
      });
  }

  function loadInto(slot: PlayerSlot, videoId: string): void {
    if (slot.player && slot.ready) {
      slot.player.loadVideoById(videoId);
      return;
    }
    slot.pendingVideo = videoId;
    ensurePlayer(slot);
  }

  function onSlotReady(slot: PlayerSlot, player: YTPlayer): void {
    slot.player = player;
    slot.ready = true;
    slot.creating = false;

    const crossfade = crossfadeRef.current;
    const incoming = crossfade !== null && crossfade.toIndex === slot.index;
    player.setVolume(incoming ? 0 : targetVolume());
    if (!incoming) {
      setSlotMuted(slot, false);
    }

    if (!slot.wantsToPlay) {
      // A crossfade this slot was part of was abandoned before it appeared.
      try {
        player.stopVideo();
      } catch {
        // Nothing to stop yet.
      }
    }

    const queuedVideo = slot.pendingVideo;
    slot.pendingVideo = null;
    if (queuedVideo) {
      player.loadVideoById(queuedVideo);
    }

    const queued = slot.queue;
    slot.queue = [];
    for (const action of queued) {
      action(player);
    }

    setReady(true);
  }

  function onSlotState(
    slot: PlayerSlot,
    event: { target: YTPlayer; data: number },
  ): void {
    slot.state = event.data;
    const crossfade = crossfadeRef.current;
    const incoming = crossfade !== null && crossfade.toIndex === slot.index;

    if (event.data === PlayerState.CUED && slot.wantsToPlay && !slot.nudged) {
      // Autoplay was refused (usually because the API script finished loading
      // after the click's activation window lapsed). Ask once more now that the
      // video is cued.
      slot.nudged = true;
      event.target.playVideo();
    } else if (
      event.data === PlayerState.CUED &&
      slot.wantsToPlay &&
      slot.nudged &&
      incoming &&
      crossfade?.phase === 'loading'
    ) {
      // Still cued after the nudge: the browser will not start it. Stop trying
      // and stay on the track that is already playing.
      abortCrossfade('YouTube would not start the next track — staying on this one');
      return;
    }

    if (incoming && crossfade?.phase === 'loading' && event.data === PlayerState.PLAYING) {
      beginFade(crossfade);
    }

    // Only the slot the UI reflects may drive it, and never while the incoming
    // track is still coming up.
    const authoritative =
      slot.index === activeRef.current && (crossfade === null || crossfade.phase === 'animating');
    if (!authoritative) {
      return;
    }

    optionsRef.current.onState(event.data);

    if (event.data === PlayerState.PLAYING) {
      const info = readVideoData(event.target);
      if (info?.title && info.video_id) {
        optionsRef.current.onTitle(info.video_id, info.title);
      }
    }
  }

  function onSlotError(slot: PlayerSlot, code: number): void {
    const crossfade = crossfadeRef.current;
    if (crossfade && crossfade.toIndex === slot.index && crossfade.phase === 'loading') {
      // The new track failed before it could blend in; keep the old one going.
      abortCrossfade(describePlayerError(code));
      return;
    }
    optionsRef.current.onError(describePlayerError(code));
  }

  function beginFade(crossfade: Crossfade): void {
    const from = slotsRef.current[crossfade.fromIndex];
    const to = slotsRef.current[crossfade.toIndex];
    if (!from.player || !to.player) {
      abortCrossfade();
      return;
    }
    crossfade.phase = 'animating';

    // The incoming player has been waiting silently; bring its sound back before
    // ramping, still starting from nothing.
    setSlotMuted(to, false);
    to.player.setVolume(0);

    const target = targetVolume();
    const startedAt = performance.now();

    const step = () => {
      if (crossfadeRef.current !== crossfade || crossfade.generation !== generationRef.current) {
        return;
      }
      const progress = Math.min(1, (performance.now() - startedAt) / CROSSFADE_MS);
      from.player?.setVolume(volumeAt(target, 0, progress));
      to.player?.setVolume(volumeAt(0, target, progress));
      if (from.wrapper) {
        from.wrapper.style.opacity = String(opacityAt(1, 0, progress));
      }
      if (to.wrapper) {
        to.wrapper.style.opacity = String(opacityAt(0, 1, progress));
      }
      if (progress < 1) {
        fadeFrameRef.current = requestAnimationFrame(step);
      } else {
        settleCrossfade(crossfade);
      }
    };

    fadeFrameRef.current = requestAnimationFrame(step);
  }

  function settleCrossfade(crossfade: Crossfade): void {
    cancelFadeTimers();
    if (crossfadeRef.current !== crossfade) {
      return;
    }
    const from = slotsRef.current[crossfade.fromIndex];
    const to = slotsRef.current[crossfade.toIndex];

    from.wantsToPlay = false;
    from.state = PlayerState.UNSTARTED;
    try {
      from.player?.setVolume(0);
      from.player?.stopVideo();
    } catch {
      // The outgoing player is already gone.
    }
    setSlotLayer(from, 0, false);

    setSlotMuted(to, false);
    try {
      to.player?.setVolume(targetVolume());
    } catch {
      // Leaving the incoming slot as it is.
    }
    setSlotLayer(to, 1, true);

    activeRef.current = crossfade.toIndex;
    crossfadeRef.current = null;
  }

  function abortCrossfade(message?: string): void {
    cancelFadeTimers();
    const crossfade = crossfadeRef.current;
    crossfadeRef.current = null;
    if (!crossfade) {
      return;
    }
    const from = slotsRef.current[crossfade.fromIndex];
    const to = slotsRef.current[crossfade.toIndex];

    to.wantsToPlay = false;
    to.state = PlayerState.UNSTARTED;
    to.pendingVideo = null;
    to.queue = [];
    setSlotMuted(to, false);
    try {
      to.player?.setVolume(0);
      to.player?.stopVideo();
    } catch {
      // Nothing to stop yet.
    }
    setSlotLayer(to, 0, false);
    setSlotLayer(from, 1, true);

    activeRef.current = crossfade.fromIndex;
    if (message) {
      optionsRef.current.onError(message);
    }
  }

  function startIncoming(fromIndex: number, toIndex: number, videoId: string): void {
    ensureWrappers();
    const from = slotsRef.current[fromIndex];
    const to = slotsRef.current[toIndex];

    activeRef.current = toIndex;
    to.wantsToPlay = true;
    to.nudged = false;
    to.state = PlayerState.UNSTARTED;
    setSlotMuted(to, true);
    if (to.wrapper) {
      to.wrapper.style.opacity = '0';
      to.wrapper.style.pointerEvents = 'none';
      to.wrapper.style.zIndex = '2';
    }
    if (from.wrapper) {
      from.wrapper.style.zIndex = '1';
      from.wrapper.style.pointerEvents = 'none';
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const crossfade: Crossfade = { fromIndex, toIndex, phase: 'loading', generation };
    crossfadeRef.current = crossfade;

    cancelFadeTimers();
    fadeTimeoutRef.current = setTimeout(() => {
      if (
        crossfadeRef.current === crossfade &&
        crossfade.generation === generationRef.current &&
        crossfade.phase === 'loading'
      ) {
        abortCrossfade('the next track would not start — staying on this one');
      }
    }, CROSSFADE_TIMEOUT_MS);

    loadInto(to, videoId);
  }

  function load(videoId: string): void {
    const crossfade = crossfadeRef.current;
    if (crossfade) {
      if (crossfade.phase === 'animating') {
        settleCrossfade(crossfade);
      } else {
        // The incoming track has not started yet; just change what it is loading
        // and keep fading away from the track already playing.
        startIncoming(crossfade.fromIndex, crossfade.toIndex, videoId);
        return;
      }
    }

    const fromIndex = activeRef.current;
    const from = slotsRef.current[fromIndex];
    const playing = from.wantsToPlay && from.state === PlayerState.PLAYING;
    if (playing) {
      startIncoming(fromIndex, 1 - fromIndex, videoId);
      return;
    }

    // Nothing to blend against: reuse the active slot and play the new video.
    ensureWrappers();
    const slot = slotsRef.current[fromIndex];
    const other = slotsRef.current[1 - fromIndex];
    activeRef.current = fromIndex;
    slot.wantsToPlay = true;
    slot.nudged = false;
    setSlotMuted(slot, false);

    other.wantsToPlay = false;
    other.state = PlayerState.UNSTARTED;
    try {
      other.player?.stopVideo();
    } catch {
      // Nothing to stop.
    }
    setSlotLayer(other, 0, false);
    setSlotLayer(slot, 1, true);

    loadInto(slot, videoId);
  }

  /** Run an action on a slot now, or as soon as its player finishes coming up. */
  function withSlot(slot: PlayerSlot, action: (player: YTPlayer) => void): void {
    if (!slot.player) {
      return;
    }
    if (slot.ready) {
      action(slot.player);
    } else {
      slot.queue.push(action);
    }
  }

  /** Bring any in-flight crossfade to a definite state before a transport action. */
  function resolveCrossfade(): void {
    const crossfade = crossfadeRef.current;
    if (!crossfade) {
      return;
    }
    if (crossfade.phase === 'animating') {
      settleCrossfade(crossfade);
    } else {
      abortCrossfade();
    }
  }

  const play = useCallback(() => {
    const crossfade = crossfadeRef.current;
    if (crossfade?.phase === 'animating') {
      settleCrossfade(crossfade);
    }
    const slot = slotsRef.current[activeRef.current];
    slot.wantsToPlay = true;
    slot.nudged = false;
    setSlotMuted(slot, false);
    withSlot(slot, (player) => player.playVideo());
  }, []);

  const pause = useCallback(() => {
    resolveCrossfade();
    const slot = slotsRef.current[activeRef.current];
    slot.wantsToPlay = false;
    withSlot(slot, (player) => player.pauseVideo());
  }, []);

  const stop = useCallback(() => {
    resolveCrossfade();
    for (const slot of slotsRef.current) {
      slot.wantsToPlay = false;
      withSlot(slot, (player) => player.stopVideo());
    }
    setSlotLayer(slotsRef.current[activeRef.current], 1, true);
    setSlotLayer(slotsRef.current[1 - activeRef.current], 0, false);
  }, []);

  useEffect(() => {
    // A crossfade is driving the volume right now; it applies the latest target
    // itself when it settles.
    if (!ready || crossfadeRef.current) {
      return;
    }
    slotsRef.current[activeRef.current].player?.setVolume(targetVolume());
  }, [volume, ready, targetVolume]);

  useEffect(
    () => () => {
      cancelFadeTimers();
      for (const slot of slotsRef.current) {
        try {
          slot.player?.destroy();
        } catch {
          // Already gone; nothing to clean up.
        }
        slot.player = null;
        slot.ready = false;
      }
    },
    [],
  );

  // Keep the control surface stable while the functions behind it stay fresh.
  const implRef = useRef<YouTubeControls | null>(null);
  implRef.current = { load, play, pause, stop };
  const controls = useMemo<YouTubeControls>(
    () => ({
      load: (videoId) => implRef.current?.load(videoId),
      play: () => implRef.current?.play(),
      pause: () => implRef.current?.pause(),
      stop: () => implRef.current?.stop(),
    }),
    [],
  );

  return { hostRef, controls };
}
