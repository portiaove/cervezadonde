import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export type DownloadResult = {
  /** Absolute path to the cached file. */
  path: string;
  /** SHA-256 of the file contents. */
  hash: string;
  /** Size in bytes. */
  size: number;
  /** Whether the file was actually downloaded or served from cache. */
  fromCache: boolean;
};

const fileExists = async (p: string): Promise<boolean> => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

const hashFile = async (path: string): Promise<{ hash: string; size: number }> => {
  const { createReadStream } = await import('node:fs');
  const hash = createHash('sha256');
  let size = 0;
  await pipeline(
    createReadStream(path),
    async function* (source) {
      for await (const chunk of source) {
        hash.update(chunk);
        size += chunk.length;
        yield chunk;
      }
    },
    async function* (source) {
      // drain
      // biome-ignore lint/correctness/noUnusedVariables: drain only
      for await (const _ of source) {
        // no-op
      }
    },
  );
  return { hash: hash.digest('hex'), size };
};

/**
 * Download a URL to a local file. If a cached file already exists at the
 * destination, returns it without re-downloading. Caller is responsible for
 * invalidating the cache when freshness matters (rm the file).
 */
export async function downloadIfNeeded(opts: {
  url: string;
  destDir: string;
  fileName: string;
  log?: (msg: string) => void;
}): Promise<DownloadResult> {
  const log = opts.log ?? (() => undefined);
  const destDir = resolve(process.cwd(), opts.destDir);
  const dest = join(destDir, opts.fileName);
  await mkdir(dirname(dest), { recursive: true });

  if (await fileExists(dest)) {
    const { hash, size } = await hashFile(dest);
    log(`cache hit: ${dest} (${(size / 1024 / 1024).toFixed(1)} MB)`);
    return { path: dest, hash, size, fromCache: true };
  }

  log(`downloading ${opts.url} → ${dest}`);
  const res = await fetch(opts.url);
  if (!res.ok || !res.body) {
    throw new Error(`download failed: ${res.status} ${res.statusText}`);
  }
  const contentLength = Number(res.headers.get('content-length') ?? '0');
  if (contentLength > 0) {
    log(`content-length: ${(contentLength / 1024 / 1024).toFixed(1)} MB`);
  }

  const hash = createHash('sha256');
  let size = 0;
  const tap = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      hash.update(chunk);
      size += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });

  await pipeline(
    Readable.fromWeb(res.body.pipeThrough(tap) as never),
    createWriteStream(dest),
  );

  log(`downloaded ${(size / 1024 / 1024).toFixed(1)} MB`);
  return { path: dest, hash: hash.digest('hex'), size, fromCache: false };
}
