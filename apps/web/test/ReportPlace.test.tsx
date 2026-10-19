import { type ReactTestRenderer, act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportPlace } from '../src/ReportPlace.js';
import { reportPlace } from '../src/api.js';
vi.mock('../src/api.js', () => ({ reportPlace: vi.fn() }));
let tree: ReactTestRenderer;
beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => {
  if (tree) act(() => tree.unmount());
});
async function open() {
  await act(async () => {
    tree = create(<ReportPlace id="70654" />);
  });
  act(() => tree.root.findByType('button').props.onClick());
}
describe('report interaction', () => {
  it('submits only the selected kind and shows pending review, not a false correction', async () => {
    vi.mocked(reportPlace).mockResolvedValue();
    await open();
    act(() => tree.root.findByType('select').props.onChange({ target: { value: 'no_beer' } }));
    await act(async () => {
      await tree.root.findByType('button').props.onClick();
    });
    expect(reportPlace).toHaveBeenCalledWith('70654', 'no_beer');
    expect(JSON.stringify(tree.toJSON())).toContain('pendiente de revisión');
  });
  it('shows a retryable failure without claiming success', async () => {
    vi.mocked(reportPlace).mockRejectedValue(new Error('offline'));
    await open();
    await act(async () => {
      await tree.root.findByType('button').props.onClick();
    });
    expect(tree.root.findByProps({ role: 'alert' })).toBeTruthy();
    expect(JSON.stringify(tree.toJSON())).not.toContain('Aviso recibido');
  });
});
