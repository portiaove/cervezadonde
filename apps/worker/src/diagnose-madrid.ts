import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';
import { downloadIfNeeded } from './download.js';
import {
  MADRID_ACTIVIDADES_COLUMNS,
  MADRID_CSV_DELIMITER,
  getCacheDir,
  getMadridUrls,
} from './sources/madrid.js';

type CodeCount = { desc: string; count: number };

export type DiagnoseResult = {
  filePath: string;
  fileHashHead: string;
  sizeMB: number;
  fromCache: boolean;
  totalRows: number;
  columnCount: number;
  declaredColumns: readonly string[];
  observedColumns: string[];
  missingColumns: string[];
  unexpectedColumns: string[];
  encodingLooksUtf8: boolean;
  delimiterLooksRight: boolean;
  countsByTipoAcceso: Record<string, CodeCount>;
  countsBySituacion: Record<string, CodeCount>;
  rowsWithCoords: number;
  rowsWithValidCoords: number;
  sampleRows: Record<string, string>[];
};

const MADRID_X_MIN = 420000;
const MADRID_X_MAX = 470000;
const MADRID_Y_MIN = 4460000;
const MADRID_Y_MAX = 4495000;

const readFirstChunk = (path: string, bytes = 4096): Promise<Buffer> =>
  new Promise((res, rej) => {
    const stream = createReadStream(path, { end: bytes - 1 });
    const chunks: Buffer[] = [];
    stream.on('data', (c) => chunks.push(typeof c === 'string' ? Buffer.from(c) : c));
    stream.on('end', () => res(Buffer.concat(chunks)));
    stream.on('error', rej);
  });

const looksUtf8 = (buf: Buffer): boolean => {
  try {
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buf);
    return true;
  } catch {
    return false;
  }
};

const bumpCount = (bucket: Record<string, CodeCount>, code: string, desc: string): void => {
  const existing = bucket[code];
  if (existing) existing.count += 1;
  else bucket[code] = { desc, count: 1 };
};

export async function diagnoseMadrid(opts: {
  which: 'actividades' | 'locales';
  log?: (msg: string) => void;
}): Promise<DiagnoseResult> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const { actividades, locales } = getMadridUrls();
  const url = opts.which === 'actividades' ? actividades : locales;
  const fileName = `madrid-${opts.which}.csv`;

  const dl = await downloadIfNeeded({
    url,
    destDir: getCacheDir(),
    fileName,
    log,
  });

  const head = await readFirstChunk(dl.path);
  const encodingLooksUtf8 = looksUtf8(head);
  const firstLine = head.toString('utf-8').split('\n')[0] ?? '';
  const delimiterLooksRight = firstLine.includes(MADRID_CSV_DELIMITER);

  let totalRows = 0;
  let observedColumns: string[] = [];
  let rowsWithCoords = 0;
  let rowsWithValidCoords = 0;
  const countsByTipoAcceso: Record<string, CodeCount> = {};
  const countsBySituacion: Record<string, CodeCount> = {};
  const sampleRows: Record<string, string>[] = [];

  await new Promise<void>((resolve, reject) => {
    const parser = parse({
      delimiter: MADRID_CSV_DELIMITER,
      columns: (header: string[]) => {
        observedColumns = header.map((h) => h.trim());
        return observedColumns;
      },
      bom: true,
      trim: false,
      relax_quotes: true,
      relax_column_count: true,
      skip_empty_lines: true,
    });

    parser.on('readable', () => {
      let record: Record<string, string> | null;
      // biome-ignore lint/suspicious/noAssignInExpressions: standard csv-parse pattern
      while ((record = parser.read() as Record<string, string> | null) !== null) {
        totalRows += 1;
        if (sampleRows.length < 5) sampleRows.push(record);

        const tipo = (record.id_tipo_acceso_local ?? '').trim();
        const tipoDesc = (record.desc_tipo_acceso_local ?? '').trim();
        const sit = (record.id_situacion_local ?? '').trim();
        const sitDesc = (record.desc_situacion_local ?? '').trim();
        bumpCount(countsByTipoAcceso, tipo, tipoDesc);
        bumpCount(countsBySituacion, sit, sitDesc);

        const xRaw = record.coordenada_x_local;
        const yRaw = record.coordenada_y_local;
        if (xRaw && yRaw) {
          rowsWithCoords += 1;
          const x = Number(xRaw);
          const y = Number(yRaw);
          if (
            Number.isFinite(x) &&
            Number.isFinite(y) &&
            x >= MADRID_X_MIN &&
            x <= MADRID_X_MAX &&
            y >= MADRID_Y_MIN &&
            y <= MADRID_Y_MAX
          ) {
            rowsWithValidCoords += 1;
          }
        }
      }
    });
    parser.on('error', reject);
    parser.on('end', () => resolve());

    createReadStream(dl.path).pipe(parser);
  });

  const declared = new Set(MADRID_ACTIVIDADES_COLUMNS as readonly string[]);
  const observed = new Set(observedColumns);
  const missingColumns = [...declared].filter((c) => !observed.has(c));
  const unexpectedColumns = [...observed].filter((c) => !declared.has(c));

  return {
    filePath: dl.path,
    fileHashHead: dl.hash.slice(0, 16),
    sizeMB: Number((dl.size / 1024 / 1024).toFixed(1)),
    fromCache: dl.fromCache,
    totalRows,
    columnCount: observedColumns.length,
    declaredColumns: MADRID_ACTIVIDADES_COLUMNS,
    observedColumns,
    missingColumns,
    unexpectedColumns,
    encodingLooksUtf8,
    delimiterLooksRight,
    countsByTipoAcceso,
    countsBySituacion,
    rowsWithCoords,
    rowsWithValidCoords,
    sampleRows,
  };
}

const formatBucket = (label: string, bucket: Record<string, CodeCount>): string[] => {
  const lines: string[] = [`${label}:`];
  const entries = Object.entries(bucket).sort(([a], [b]) => a.localeCompare(b));
  for (const [code, { desc, count }] of entries) {
    const codeLabel = code === '' ? '(empty)' : code;
    lines.push(
      `  ${codeLabel.padEnd(4)} ${(desc || '?').padEnd(28)} ${count.toLocaleString('es-ES')}`,
    );
  }
  return lines;
};

export function summarizeDiagnose(d: DiagnoseResult): string {
  const lines: string[] = [];
  lines.push('--- Madrid Censo de Locales / diagnose ---');
  lines.push(`file:                ${d.filePath} (${d.fromCache ? 'cache' : 'downloaded'})`);
  lines.push(`size:                ${d.sizeMB} MB`);
  lines.push(`hash (head):         ${d.fileHashHead}`);
  lines.push(`encoding utf-8:      ${d.encodingLooksUtf8 ? 'yes' : 'NO (check encoding)'}`);
  lines.push(
    `delimiter ${MADRID_CSV_DELIMITER}:         ${d.delimiterLooksRight ? 'yes' : 'NO (check separator)'}`,
  );
  lines.push(`columns:             ${d.columnCount}`);
  lines.push(`total rows:          ${d.totalRows.toLocaleString('es-ES')}`);
  lines.push(`rows w/ coords:      ${d.rowsWithCoords.toLocaleString('es-ES')}`);
  lines.push(
    `rows w/ valid coords ${d.rowsWithValidCoords.toLocaleString('es-ES')}` +
      ' (numeric, inside Madrid UTM bbox)',
  );

  if (d.missingColumns.length > 0) {
    lines.push(`MISSING vs schema PDF (${d.missingColumns.length}):`);
    for (const c of d.missingColumns) lines.push(`  - ${c}`);
  } else {
    lines.push('schema match:        all declared columns present');
  }
  if (d.unexpectedColumns.length > 0) {
    lines.push(`UNEXPECTED columns (${d.unexpectedColumns.length}):`);
    for (const c of d.unexpectedColumns) lines.push(`  + ${c}`);
  }

  lines.push('');
  lines.push(...formatBucket('counts by id_tipo_acceso_local', d.countsByTipoAcceso));
  lines.push('');
  lines.push(...formatBucket('counts by id_situacion_local', d.countsBySituacion));

  lines.push('');
  lines.push('first 5 rows (id_local, situacion, rotulo, epigrafe):');
  for (const r of d.sampleRows) {
    lines.push(
      `  ${(r.id_local ?? '').padEnd(10)} ` +
        `sit=${(r.id_situacion_local ?? '').padEnd(2)} ` +
        `acc=${(r.id_tipo_acceso_local ?? '').padEnd(2)} ` +
        `epi=${(r.id_epigrafe ?? '').padEnd(7)} ` +
        `rot="${(r.rotulo ?? '').slice(0, 40)}"`,
    );
  }
  return lines.join('\n');
}
