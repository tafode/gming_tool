//! Turning the URLs a Game Master pastes into something the app can play.
//!
//! Nothing here downloads or extracts media: the app only ever hands a video id
//! to YouTube's own embedded player.

/** Shown when a pasted URL cannot be understood as a YouTube link. */
export const NOT_YOUTUBE_MESSAGE = 'that does not look like a YouTube link';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const EMBED_HOSTS = new Set([
  'youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'm.youtube.com',
]);

const EMBED_PREFIXES = new Set(['embed', 'shorts', 'live', 'v']);

/**
 * Extract the video id from a YouTube URL, or from a bare id.
 *
 * Accepts `watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`, `/live/` and a missing
 * scheme, and returns `null` for anything else.
 */
export function videoIdFromUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') {
    return null;
  }

  if (VIDEO_ID.test(trimmed)) {
    return trimmed;
  }

  let url: URL;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^(www|m)\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return id && VIDEO_ID.test(id) ? id : null;
  }

  if (!EMBED_HOSTS.has(host)) {
    return null;
  }

  const fromQuery = url.searchParams.get('v');
  if (fromQuery && VIDEO_ID.test(fromQuery)) {
    return fromQuery;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length >= 2 && EMBED_PREFIXES.has(segments[0] ?? '')) {
    const id = segments[1];
    return id && VIDEO_ID.test(id) ? id : null;
  }

  return null;
}

/** What a track is called until oEmbed or the player tells us better. */
export function placeholderTitle(videoId: string): string {
  return videoId;
}

/** The canonical watch URL for a video id. */
export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** True while a track still carries its placeholder name. */
export function isPlaceholderTitle(track: { url: string; title: string }): boolean {
  return track.title === '' || track.title === videoIdFromUrl(track.url);
}

/**
 * Look a video's title up through YouTube's public oEmbed endpoint.
 *
 * This is the same endpoint websites use to render link previews; it needs no
 * API key and no account, and it never touches the media itself. Returns `null`
 * on any failure, so callers can simply keep the placeholder.
 */
export async function fetchVideoTitle(
  videoId: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    watchUrl(videoId),
  )}&format=json`;

  try {
    const response = await fetch(endpoint, { signal });
    if (!response.ok) {
      return null;
    }
    const body: unknown = await response.json();
    const title = (body as { title?: unknown } | null)?.title;
    return typeof title === 'string' && title.trim() !== '' ? title.trim() : null;
  } catch {
    return null;
  }
}
