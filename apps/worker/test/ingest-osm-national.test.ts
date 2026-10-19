import { beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadIfNeeded } from '../src/download.js';
import { persistOsmCanonical } from '../src/ingest-osm-canonical.js';
import { ingestOsmPbf } from '../src/ingest-osm-pbf.js';

vi.mock('node:child_process', () => ({
  execFile: (
    _file: string,
    _args: string[],
    done: (error: null, stdout: string, stderr: string) => void,
  ) => done(null, '', ''),
}));
vi.mock('@cervezadonde/db', () => ({ getSql: () => ({}) }));
vi.mock('../src/sources/madrid.js', () => ({ getCacheDir: () => 'fixtures/national-extract' }));
vi.mock('../src/download.js', () => ({ downloadIfNeeded: vi.fn() }));
vi.mock('../src/ingest-osm-canonical.js', () => ({ persistOsmCanonical: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(downloadIfNeeded).mockResolvedValue({
    path: '',
    hash: 'fixture',
    size: 1,
    fromCache: true,
  });
  vi.mocked(persistOsmCanonical).mockResolvedValue({
    importRunId: 1,
    byType: {},
    officialFlagged: 0,
    censoMatched: 0,
    pruned: 0,
  });
});

describe('whole-Spain persistence safety', () => {
  it('persists both geographic parts together before allowing stale-row pruning', async () => {
    await ingestOsmPbf({ region: 'spain', log: () => {} });
    expect(persistOsmCanonical).toHaveBeenCalledTimes(1);
    const [, places, options] = vi.mocked(persistOsmCanonical).mock.calls[0];
    expect(places.map((place) => place.lat)).toEqual([40.4, 28.467]);
    expect(options.pruneStale).toBe(true);
    expect(options.sourceUrl).toContain('africa/canary-islands');
  });
  it('does not persist or prune mainland-only data if the Canary download fails', async () => {
    vi.mocked(downloadIfNeeded)
      .mockResolvedValueOnce({ path: '', hash: 'mainland', size: 1, fromCache: true })
      .mockRejectedValueOnce(new Error('Canary download failed'));
    await expect(ingestOsmPbf({ region: 'spain', log: () => {} })).rejects.toThrow(
      'Canary download failed',
    );
    expect(persistOsmCanonical).not.toHaveBeenCalled();
  });
});
