import { Command } from 'commander';
import { closeSql } from '@minimarket/db';
import { ingestSample } from './ingest-sample.js';
import { ingestMadrid } from './ingest-madrid.js';
import { diagnoseMadrid, summarizeDiagnose } from './diagnose-madrid.js';

const program = new Command();

program
  .name('minimarket-worker')
  .description('Ingestion jobs for MiniMarket Madrid');

program
  .command('ingest:sample')
  .description('Load the bundled fixture CSV into the stores table')
  .option('-f, --file <path>', 'CSV path (EPSG:25830)', 'fixtures/madrid-sample.csv')
  .action(async (opts: { file: string }) => {
    try {
      const summary = await ingestSample({ filePath: opts.file });
      console.log(JSON.stringify(summary, null, 2));
    } catch (err) {
      console.error('ingest:sample failed:', err);
      process.exitCode = 1;
    } finally {
      await closeSql();
    }
  });

program
  .command('ingest:madrid')
  .description('Download Madrid Censo, stage it, score candidates, upsert into stores.')
  .option('-l, --limit <n>', 'cap candidates after aggregation (for first runs)', (v) => Number.parseInt(v, 10))
  .option('--fresh', 'force re-download even if a cached copy exists', false)
  .action(async (opts: { limit?: number; fresh?: boolean }) => {
    try {
      const summary = await ingestMadrid({
        limit: opts.limit,
        fresh: opts.fresh,
        log: (m) => console.error(m),
      });
      console.log(JSON.stringify(summary, null, 2));
    } catch (err) {
      console.error('ingest:madrid failed:', err);
      process.exitCode = 1;
    } finally {
      await closeSql();
    }
  });

program
  .command('diagnose:madrid')
  .description('Download the Madrid Censo CSV and report shape vs the schema PDF. No DB writes.')
  .option('-w, --which <file>', 'which file to inspect: actividades|locales', 'actividades')
  .action(async (opts: { which: string }) => {
    const which = opts.which === 'locales' ? 'locales' : 'actividades';
    try {
      const result = await diagnoseMadrid({ which, log: (m) => console.error(m) });
      console.log(summarizeDiagnose(result));
    } catch (err) {
      console.error('diagnose:madrid failed:', err);
      process.exitCode = 1;
    }
  });

await program.parseAsync(process.argv);
