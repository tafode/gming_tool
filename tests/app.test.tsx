import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { SAVE_KEY } from '../src/model/store';
import { RESUME_KEY } from '../src/player/resume';
import type { PdfDocumentInfo } from '../src/pdf/library';

// The real player is never built in tests: YouTube's API script is never
// fetched, so `loadYouTubeApi` simply never settles.
vi.mock('../src/player/youtubeApi', () => ({
  PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
  describePlayerError: (code: number) => `player error ${code}`,
  loadYouTubeApi: () => new Promise(() => {}),
}));

// The player hook is bridged rather than built: tests get at the transport
// calls the app makes, and can feed it events the way YouTube would.
const bridge = vi.hoisted(() => ({
  options: null as null | {
    onTitle(videoId: string, title: string): void;
    onState(state: number): void;
    onPosition(videoId: string, seconds: number | null): void;
    onError(message: string): void;
  },
  load: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  stop: vi.fn(),
}));

vi.mock('../src/player/useYouTubePlayer', () => ({
  useYouTubePlayer: (options: unknown) => {
    bridge.options = options as typeof bridge.options;
    return { hostRef: { current: null }, controls: bridge };
  },
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
  // The button's label carries the title, plus ", resumes at m:ss" when a
  // position is saved.
  return screen.getByRole('button', {
    name: new RegExp(`^${VIDEO_ID}(, resumes at \\d+:\\d{2})?$`),
  });
}

describe('the GMing tool', () => {
  beforeEach(() => {
    localStorage.clear();
    stubFetch();
    bridge.options = null;
    bridge.load.mockClear();
    bridge.play.mockClear();
    bridge.pause.mockClear();
    bridge.stop.mockClear();
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

  it('resumes a track from where it was left off', () => {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ [VIDEO_ID]: 84 }));
    render(<App />);
    addLink(VIDEO_URL);

    expect(screen.getByText('resumes 1:24')).toBeTruthy();

    fireEvent.click(trackButton());

    expect(bridge.load).toHaveBeenCalledWith(VIDEO_ID, 84);
  });

  it('starts a track with nothing saved from its beginning', () => {
    render(<App />);
    addLink(VIDEO_URL);

    fireEvent.click(trackButton());

    expect(bridge.load).toHaveBeenCalledWith(VIDEO_ID, undefined);
  });

  it('remembers where a track is, and shows it', () => {
    render(<App />);
    addLink(VIDEO_URL);

    act(() => bridge.options?.onPosition(VIDEO_ID, 84.2));

    expect(screen.getByText('resumes 1:24')).toBeTruthy();
    expect(localStorage.getItem(RESUME_KEY)).toContain('84.2');
  });

  it('forgets a track that has played to its end', () => {
    render(<App />);
    addLink(VIDEO_URL);
    act(() => bridge.options?.onPosition(VIDEO_ID, 84.2));

    act(() => bridge.options?.onPosition(VIDEO_ID, null));

    expect(screen.queryByText(/resumes/)).toBeNull();
    expect(JSON.parse(localStorage.getItem(RESUME_KEY) ?? '{}')).toEqual({});
  });

  it('plays a stopped track again from where it stopped', () => {
    render(<App />);
    addLink(VIDEO_URL);
    fireEvent.click(trackButton());
    act(() => bridge.options?.onState(1));
    act(() => bridge.options?.onPosition(VIDEO_ID, 42));

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));

    expect(bridge.load).toHaveBeenLastCalledWith(VIDEO_ID, 42);
  });

  it('drops a saved position when its track is removed', () => {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ [VIDEO_ID]: 84 }));
    render(<App />);
    addLink(VIDEO_URL);
    expect(screen.getByText('resumes 1:24')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: `Remove ${VIDEO_ID}` }));

    expect(JSON.parse(localStorage.getItem(RESUME_KEY) ?? '{}')).toEqual({});
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
