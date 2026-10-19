import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { downloadIfNeeded } from '../src/download.js';

describe('cached download integrity', () => {
  it('hashes every cached byte and reports its size without making a network request', async () => {
    const network = vi.spyOn(globalThis, 'fetch');
    try {
      const result = await downloadIfNeeded({
        url: 'https://example.invalid/not-requested',
        destDir: 'fixtures/national-extract',
        fileName: 'spain.geojsonl',
      });
      const bytes = await readFile(result.path);
      expect(result.fromCache).toBe(true);
      expect(result.size).toBe(bytes.length);
      expect(result.hash).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });
});
