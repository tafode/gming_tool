//! The YouTube IFrame Player API, loaded lazily and wrapped in the small slice
//! of it this app needs.
//!
//! The API script is the only thing the app ever fetches from the network. It is
//! loaded the first time a track is played, so a Game Master who never touches
//! the music panel never talks to YouTube at all.

const API_SCRIPT_SRC = 'https://www.youtube.com/iframe_api';

/** The player states we care about, as reported by the API. */
export const PlayerState = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

export interface VideoData {
  video_id?: string;
  title?: string;
  author?: string;
}

export interface YTPlayer {
  loadVideoById(videoId: string): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  setVolume(volume: number): void;
  getVideoData(): VideoData;
  destroy(): void;
}

export interface YTPlayerEvent {
  target: YTPlayer;
  data: number;
}

export interface YTPlayerOptions {
  videoId?: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (event: { target: YTPlayer }) => void;
    onStateChange?: (event: YTPlayerEvent) => void;
    onError?: (event: YTPlayerEvent) => void;
  };
}

export interface YTNamespace {
  Player: new (element: HTMLElement, options: YTPlayerOptions) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

/**
 * Load the IFrame Player API once per page.
 *
 * Rejects if the script cannot be fetched at all, so the caller can say so
 * rather than showing an empty box forever.
 */
export function loadYouTubeApi(doc: Document = document): Promise<YTNamespace> {
  const loaded = window.YT;
  if (loaded?.Player) {
    return Promise.resolve(loaded);
  }
  if (apiPromise) {
    return apiPromise;
  }

  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) {
        resolve(window.YT);
      }
    };

    const script = doc.createElement('script');
    script.src = API_SCRIPT_SRC;
    script.async = true;
    script.addEventListener('error', () => {
      reject(new Error('the YouTube player could not be fetched — are you online?'));
    });
    doc.head.appendChild(script);
  });

  // Allow a later retry after a failure, without leaving an unhandled rejection.
  apiPromise.catch(() => {
    apiPromise = null;
  });

  return apiPromise;
}

const PLAYER_ERRORS: Record<number, string> = {
  2: 'the video id or player parameters are invalid',
  5: 'the video could not be played in this browser',
  100: 'the video was not found — it may be private or deleted',
  101: 'the video’s owner does not allow it to be played outside YouTube',
  150: 'the video’s owner does not allow it to be played outside YouTube',
};

/** Turn an API error code into something worth reading. */
export function describePlayerError(code: number): string {
  return PLAYER_ERRORS[code] ?? `the player reported an error (code ${code})`;
}
