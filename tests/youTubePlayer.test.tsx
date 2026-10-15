import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { PlayerState } from '../src/player/youtubeApi';
import { useYouTubePlayer } from '../src/player/useYouTubePlayer';

// A stand-in for YouTube's player, wired up the way the real one behaves: the
// hook drives methods, the player answers with events. Everything it is asked
// to do is recorded, so tests can assert on the API calls the hook makes.
const fake = vi.hoisted(() => ({
  players: [] as Array<Record<string, any>>,
}));

vi.mock('../src/player/youtubeApi', () => {
  const PlayerState = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

  class FakePlayer {
    currentTime = 0;
    duration = 300;
    videoId: string | undefined;
    muted = false;
    volume = 100;
    state: number = PlayerState.UNSTARTED;
    destroyed = false;
    lastLoad: unknown = null;
    private readonly events: Record<string, ((event: any) => void) | undefined>;

    constructor(_element: HTMLElement, options: { events?: Record<string, (event: any) => void> }) {
      this.events = options.events ?? {};
      fake.players.push(this as unknown as Record<string, any>);
      this.events.onReady?.({ target: this });
    }

    loadVideoById(video: string | { videoId: string; startSeconds?: number }): void {
      if (typeof video === 'string') {
        this.videoId = video;
        this.currentTime = 0;
      } else {
        this.videoId = video.videoId;
        this.currentTime = video.startSeconds ?? 0;
      }
      this.lastLoad = video;
      this.emitState(PlayerState.PLAYING);
    }

    playVideo(): void {
      this.emitState(PlayerState.PLAYING);
    }

    pauseVideo(): void {
      this.emitState(PlayerState.PAUSED);
    }

    stopVideo(): void {
      this.currentTime = 0;
      this.emitState(PlayerState.UNSTARTED);
    }

    setVolume(volume: number): void {
      this.volume = volume;
    }

    mute(): void {
      this.muted = true;
    }

    unMute(): void {
      this.muted = false;
    }

    getCurrentTime(): number {
      return this.currentTime;
    }

    getDuration(): number {
      return this.duration;
    }

    seekTo(seconds: number): void {
      this.currentTime = seconds;
    }

    getVideoData(): { video_id: string; title: string } | null {
      return this.videoId ? { video_id: this.videoId, title: `Title ${this.videoId}` } : null;
    }

    destroy(): void {
      this.destroyed = true;
    }

    emitState(state: number): void {
      this.state = state;
      this.events.onStateChange?.({ target: this, data: state });
    }
  }

  return {
    PlayerState,
    describePlayerError: (code: number) => `player error ${code}`,
    loadYouTubeApi: () => Promise.resolve({ Player: FakePlayer }),
  };
});

const ID = 'dQw4w9WgXcQ';
const OTHER = 'aaaaaaaaaaa';

interface MockedOptions {
  volume: number;
  onTitle: Mock<(videoId: string, title: string) => void>;
  onState: Mock<(state: number) => void>;
  onPosition: Mock<(videoId: string, seconds: number | null) => void>;
  onError: Mock<(message: string) => void>;
}

function makeOptions(): MockedOptions {
  return {
    volume: 0.7,
    onTitle: vi.fn(),
    onState: vi.fn(),
    onPosition: vi.fn(),
    onError: vi.fn(),
  };
}

type Options = MockedOptions;

function renderPlayer(options: Options) {
  const harness = renderHook(() => useYouTubePlayer(options));
  const host = document.createElement('div');
  harness.result.current.hostRef.current = host;
  return harness;
}

/** Render the hook and play a video, letting the lazy player creation settle. */
async function startPlayer(options: Options, videoId: string, startSeconds?: number) {
  const harness = renderPlayer(options);
  await act(async () => {
    harness.result.current.controls.load(videoId, startSeconds);
  });
  return harness;
}

function player(index = 0): Record<string, any> {
  return fake.players[index]!;
}

async function switchTo(harness: ReturnType<typeof renderPlayer>, videoId: string): Promise<void> {
  await act(async () => {
    harness.result.current.controls.load(videoId);
  });
}

describe('the YouTube player hook', () => {
  beforeEach(() => {
    fake.players.length = 0;
  });

  afterEach(() => {
    cleanup();
  });

  it('starts a video at the saved position', async () => {
    const options = makeOptions();

    await startPlayer(options, ID, 84);

    expect(fake.players).toHaveLength(1);
    expect(player().lastLoad).toEqual({ videoId: ID, startSeconds: 84 });
    expect(player().currentTime).toBe(84);
  });

  it('loads a video with nothing saved from its beginning', async () => {
    const options = makeOptions();

    await startPlayer(options, ID);

    expect(player().lastLoad).toBe(ID);
    expect(player().currentTime).toBe(0);
  });

  it('remembers where a paused track got to', async () => {
    const options = makeOptions();
    await startPlayer(options, ID, 84);

    act(() => {
      player().currentTime = 95.5;
      player().pauseVideo();
    });

    expect(options.onPosition).toHaveBeenCalledWith(ID, 95.5);
  });

  it('forgets a video that ran to its end', async () => {
    const options = makeOptions();
    await startPlayer(options, ID);

    act(() => {
      player().currentTime = player().duration;
      player().emitState(PlayerState.ENDED);
    });

    expect(options.onPosition).toHaveBeenCalledWith(ID, null);
  });

  it('treats a position a moment from the end as finished', async () => {
    const options = makeOptions();
    await startPlayer(options, ID);

    act(() => {
      player().currentTime = player().duration - 1;
      player().pauseVideo();
    });

    expect(options.onPosition).toHaveBeenCalledWith(ID, null);
  });

  it('remembers a track when Stop is pressed, before the clock is reset', async () => {
    const options = makeOptions();
    const harness = await startPlayer(options, ID, 30);

    act(() => {
      player().currentTime = 42;
      harness.result.current.controls.stop();
    });

    expect(options.onPosition).toHaveBeenCalledWith(ID, 42);
    expect(player().currentTime).toBe(0);
  });

  it('remembers the outgoing track when another one is picked', async () => {
    const options = makeOptions();
    const harness = await startPlayer(options, ID, 30);

    act(() => {
      player(0).currentTime = 55;
    });
    await switchTo(harness, OTHER);

    expect(options.onPosition).toHaveBeenCalledWith(ID, 55);
    expect(fake.players).toHaveLength(2);
    expect(player(1).lastLoad).toBe(OTHER);
  });

  it('reports the position now and then while a track plays', async () => {
    vi.useFakeTimers();
    try {
      const options = makeOptions();
      await startPlayer(options, ID, 30);

      act(() => {
        player().currentTime = 35;
        vi.advanceTimersByTime(5000);
      });

      expect(options.onPosition).toHaveBeenCalledWith(ID, 35);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says nothing about a track that is not playing', async () => {
    vi.useFakeTimers();
    try {
      const options = makeOptions();
      const harness = await startPlayer(options, ID, 30);

      act(() => {
        harness.result.current.controls.stop();
        vi.advanceTimersByTime(20000);
      });

      // Stop takes the position once; the idle tick must not add anything.
      expect(options.onPosition).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
