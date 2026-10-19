import { type ReactTestRenderer, act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchBox } from '../src/SearchBox.js';

let tree: ReactTestRenderer;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn());
  act(() => {
    tree = create(<SearchBox getBias={() => null} onPick={() => {}} />);
  });
  act(() => tree.root.findByType('button').props.onClick());
});
afterEach(() => {
  act(() => tree.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const typeQuery = (value: string) =>
  act(() => tree.root.findByType('input').props.onChange({ target: { value } }));

describe('search cancellation', () => {
  it('does not send a pending search after the panel has closed', async () => {
    typeQuery('Madrid');
    act(() => tree.root.findByProps({ 'aria-label': 'Cerrar búsqueda' }).props.onClick());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('invalidates old results as soon as the query changes', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(fetch).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    typeQuery('Madrid');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    typeQuery('Barcelona');
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      finish({
        ok: true,
        json: async () => ({
          features: [
            { geometry: { coordinates: [-3.7, 40.4] }, properties: { name: 'Old Madrid result' } },
          ],
        }),
      });
    });
    expect(JSON.stringify(tree.toJSON())).not.toContain('Old Madrid result');
  });
});
