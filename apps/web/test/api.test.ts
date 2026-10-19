import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMap } from '../src/api.js';

const bounds = { north: 41, south: 40, east: -3, west: -4 };
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('map HTTP requests', () => {
  const hangingFetch = () => {
    vi.mocked(fetch).mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
  };

  it('times out a stalled connection so the UI can offer a retry', async () => {
    hangingFetch();
    const result = expect(fetchMap(bounds)).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
  });

  it('forwards cancellation when a newer viewport replaces it', async () => {
    hangingFetch();
    const controller = new AbortController();
    const result = expect(fetchMap(bounds, {}, 2000, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    controller.abort();
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
});
