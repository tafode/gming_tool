import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { SAVE_KEY } from '../src/model/store';
import type { PdfDocumentInfo } from '../src/pdf/library';

// The real player is never built in tests: YouTube's API script is never
// fetched, so `loadYouTubeApi` simply never settles.
vi.mock('../src/player/youtubeApi', () => ({
  PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
  describePlayerError: (code: number) => `player error ${code}`,
  loadYouTubeApi: () => new Promise(() => {}),
}));

const VIDEO_URL = 'https://youtu.be/dQw4w9WgXcQ';
const VIDEO_ID = 'dQw4w9WgXcQ';

/**
 * Stub the two things the app reaches out for.
 *
 * The reference listing only resolves when a test asks for it: a shelf that
 * never arrives keeps the drawer quiet in tests that are not about the drawer,
 * so no state settles after a test has finished.
 */
function stubFetch(documents?: PdfDocumentInfo[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      if (String(input) === '/pdfs/index.json') {
        if (documents === undefined) {
          return new Promise(() => {});
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ folder: '/home/marco/gming_tool/pdfs', documents }),
        });
      }
      // oEmbed title lookups are not part of these tests.
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    }),
  );
}

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
    stubFetch();
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

  it('keeps a reference drawer under the story, folded away by default', async () => {
    stubFetch([]);
    render(<App />);

    expect(screen.getByRole('button', { name: '▸ Reference' })).toBeTruthy();
    expect(screen.queryByLabelText('Search reference documents')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '▸ Reference' }));

    expect(screen.getByLabelText('Search reference documents')).toBeTruthy();
    expect(await screen.findByText(/No PDFs in/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '▾ Reference' }));

    expect(screen.queryByLabelText('Search reference documents')).toBeNull();
  });
});
