import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchVideoTitle,
  formatClock,
  isPlaceholderTitle,
  placeholderTitle,
  videoIdFromUrl,
  watchUrl,
} from '../src/music/youtube';
import { describePlayerError, PlayerState } from '../src/player/youtubeApi';

const ID = 'dQw4w9WgXcQ';

describe('reading a YouTube link', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`, ID],
    [`https://youtube.com/watch?v=${ID}&t=30s`, ID],
    [`https://m.youtube.com/watch?v=${ID}`, ID],
    [`https://music.youtube.com/watch?v=${ID}`, ID],
    [`https://youtu.be/${ID}`, ID],
    [`https://youtu.be/${ID}?si=abc`, ID],
    [`https://www.youtube.com/embed/${ID}`, ID],
    [`https://www.youtube-nocookie.com/embed/${ID}`, ID],
    [`https://www.youtube.com/shorts/${ID}`, ID],
    [`https://www.youtube.com/live/${ID}`, ID],
    [`www.youtube.com/watch?v=${ID}`, ID],
    [`  https://youtu.be/${ID}  `, ID],
    [ID, ID],
  ])('accepts %s', (input, expected) => {
    expect(videoIdFromUrl(input)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    `https://example.com/watch?v=${ID}`,
    'https://soundcloud.com/artist/track',
    'just some words',
    'https://youtu.be/too-short',
    'https://www.youtube.com/playlist?list=PL123',
    'https://www.youtube.com/watch?v=tooshort',
  ])('rejects %s', (input) => {
    expect(videoIdFromUrl(input)).toBeNull();
  });
});

describe('track titles', () => {
  it('uses the video id until something better arrives', () => {
    expect(placeholderTitle(ID)).toBe(ID);
    expect(watchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });

  it('knows when a title is still a placeholder', () => {
    const url = `https://youtu.be/${ID}`;
    expect(isPlaceholderTitle({ url, title: ID })).toBe(true);
    expect(isPlaceholderTitle({ url, title: '' })).toBe(true);
    expect(isPlaceholderTitle({ url, title: 'Tavern Ambience' })).toBe(false);
  });
});

describe('formatting a playback position', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [59.9, '0:59'],
    [60, '1:00'],
    [245, '4:05'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3725, '1:02:05'],
  ])('renders %s seconds as %s', (seconds, expected) => {
    expect(formatClock(seconds)).toBe(expected);
  });

  it('falls back to the start for nonsense values', () => {
    expect(formatClock(Number.NaN)).toBe('0:00');
    expect(formatClock(-12)).toBe('0:00');
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});

describe('looking a title up through oEmbed', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the title when YouTube answers', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ title: '  Tavern Ambience  ' }) }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVideoTitle(ID)).resolves.toBe('Tavern Ambience');
    expect(fetchMock).toHaveBeenCalledWith(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl(ID))}&format=json`,
      expect.anything(),
    );
  });

  it('gives up quietly when the lookup fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })));
    await expect(fetchVideoTitle(ID)).resolves.toBeNull();

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    await expect(fetchVideoTitle(ID)).resolves.toBeNull();

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })));
    await expect(fetchVideoTitle(ID)).resolves.toBeNull();
  });
});

describe('player errors', () => {
  it('explains the codes the API can report', () => {
    expect(describePlayerError(100)).toMatch(/not found/);
    expect(describePlayerError(101)).toMatch(/does not allow/);
    expect(describePlayerError(150)).toMatch(/does not allow/);
    expect(describePlayerError(42)).toMatch(/code 42/);
  });

  it('exposes the state numbers the API uses', () => {
    expect(PlayerState.ENDED).toBe(0);
    expect(PlayerState.PLAYING).toBe(1);
    expect(PlayerState.PAUSED).toBe(2);
  });
});
