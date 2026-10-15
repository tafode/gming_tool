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

const DOCUMENTS: PdfDocumentInfo[] = [
  { path: 'rulebook.pdf', name: 'rulebook', size: 2048, modified: 1700000000, kind: 'pdf' },
  { path: 'notes.docx', name: 'notes', size: 1024, modified: 1700000001, kind: 'office' },
];

/**
 * Stub the one thing the app reaches out for on load: the reference listing.
 *
 * It only resolves when a test asks for it: a shelf that never arrives keeps the
 * sidebar quiet in tests that are not about it, so no state settles after a test
 * has finished.
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
          json: () =>
            Promise.resolve({
              folder: '/home/marco/gming_tool/pdfs',
              converter: 'soffice',
              documents,
            }),
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

  it('lists the documents and reads one in the viewer', async () => {
    stubFetch(DOCUMENTS);
    render(<App />);

    expect(await screen.findByRole('button', { name: /rulebook/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /rulebook/ }));

    const viewer = screen.getByTitle('rulebook — page 1') as HTMLIFrameElement;
    expect(viewer.getAttribute('src')).toBe('/pdfs/rulebook.pdf#page=1');
  });

  it('points at the folder when there are no documents', async () => {
    stubFetch([]);
    render(<App />);

    expect(await screen.findByText(/No documents in/)).toBeTruthy();
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

  it('remembers music across a reload', async () => {
    const first = render(<App />);
    addLink(VIDEO_URL);

    await waitFor(
      () => {
        expect(localStorage.getItem(SAVE_KEY)).toContain(VIDEO_ID);
      },
      { timeout: 4000 },
    );

    first.unmount();
    render(<App />);

    expect(screen.getByRole('button', { name: VIDEO_ID })).toBeTruthy();
  });
});
