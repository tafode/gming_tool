import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { SAVE_KEY } from '../src/model/store';

// The real player is never built in tests: YouTube's API script is never
// fetched, so `loadYouTubeApi` simply never settles.
vi.mock('../src/player/youtubeApi', () => ({
  PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
  describePlayerError: (code: number) => `player error ${code}`,
  loadYouTubeApi: () => new Promise(() => {}),
}));

const VIDEO_URL = 'https://youtu.be/dQw4w9WgXcQ';
const VIDEO_ID = 'dQw4w9WgXcQ';

function addLink(url: string): void {
  fireEvent.change(screen.getByLabelText('YouTube link'), { target: { value: url } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
}

function trackButton(): HTMLElement {
  return screen.getByRole('button', { name: VIDEO_ID });
}

describe('the GMing tool', () => {
  beforeEach(() => {
    localStorage.clear();
    // oEmbed lookups are not part of these tests.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('starts with one chapter and adds more', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Chapter 1' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'New chapter' }));

    expect(screen.getByRole('button', { name: 'Chapter 2' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Chapter 2' })).toBeTruthy();
  });

  it('keeps each chapter’s text to itself', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'New chapter' }));

    fireEvent.change(screen.getByLabelText('Story text of Chapter 2'), {
      target: { value: 'the second chapter' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Chapter 1' }));

    const first = screen.getByLabelText('Story text of Chapter 1') as HTMLTextAreaElement;
    expect(first.value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Chapter 2' }));
    const second = screen.getByLabelText('Story text of Chapter 2') as HTMLTextAreaElement;
    expect(second.value).toBe('the second chapter');
  });

  it('adds a link and plays it', () => {
    render(<App />);
    expect(screen.queryByRole('button', { name: VIDEO_ID })).toBeNull();

    addLink(VIDEO_URL);
    expect(trackButton().getAttribute('aria-current')).toBe('false');

    fireEvent.click(trackButton());

    expect(trackButton().getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('pauses, plays again and stops', () => {
    render(<App />);
    addLink(VIDEO_URL);

    fireEvent.click(trackButton());
    fireEvent.click(trackButton());
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('removes a track', () => {
    render(<App />);
    addLink(VIDEO_URL);
    addLink('https://youtu.be/aaaaaaaaaaa');
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByRole('button', { name: `Remove ${VIDEO_ID}` }));

    expect(screen.queryByRole('button', { name: VIDEO_ID })).toBeNull();
    expect(screen.getByRole('button', { name: 'aaaaaaaaaaa' })).toBeTruthy();
  });

  it('refuses a link that is not YouTube', () => {
    render(<App />);

    addLink('https://example.com/not-youtube');

    expect(screen.getByRole('status').textContent).toContain('that does not look like a YouTube link');
    expect((screen.getByLabelText('YouTube link') as HTMLInputElement).value).toBe(
      'https://example.com/not-youtube',
    );
  });

  it('remembers edits and music across a reload', async () => {
    const first = render(<App />);
    fireEvent.change(screen.getByLabelText('Story text of Chapter 1'), {
      target: { value: 'The inn at dusk' },
    });
    addLink(VIDEO_URL);

    await waitFor(
      () => {
        expect(localStorage.getItem(SAVE_KEY)).toContain('The inn at dusk');
      },
      { timeout: 4000 },
    );

    first.unmount();
    render(<App />);

    expect((screen.getByLabelText('Story text of Chapter 1') as HTMLTextAreaElement).value).toBe(
      'The inn at dusk',
    );
    expect(screen.getByRole('button', { name: VIDEO_ID })).toBeTruthy();
  });
});
