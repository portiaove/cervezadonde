import { closeSql } from '@cervezadonde/db';
import { Command } from 'commander';
import { crawlHours } from './crawl-hours.js';
import { diagnoseMadrid, summarizeDiagnose } from './diagnose-madrid.js';
import { ingestBarcelona } from './ingest-barcelona.js';
import { ingestDiba } from './ingest-diba.js';
import { ingestMadrid } from './ingest-madrid.js';
import { ingestOsmCanonical } from './ingest-osm-canonical.js';
import { ingestOsmPbf } from './ingest-osm-pbf.js';
import { ingestSample } from './ingest-sample.js';

const program = new Command();

program.name('cervezadonde-worker').description('Ingestion jobs for cervezadonde.es');

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
  .option('-l, --limit <n>', 'cap candidates after aggregation (for first runs)', (v) =>
    Number.parseInt(v, 10),
  )
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
  .command('ingest:barcelona')
  .description('Download the Barcelona ground-floor premises census, classify, upsert into stores.')
  .option('--fresh', 'force re-download even if a cached copy exists', false)
  .action(async (opts: { fresh?: boolean }) => {
    try {
      const summary = await ingestBarcelona({
        fresh: opts.fresh,
        log: (m) => console.error(m),
      });
      console.log(JSON.stringify(summary, null, 2));
    } catch (err) {
      console.error('ingest:barcelona failed:', err);
      process.exitCode = 1;
    } finally {
      await closeSql();
    }
  });

program
  .command('ingest:diba')
  .description(
    'Download the Barcelona-province GIA census (Diputació de Barcelona), classify, upsert.',
  )
  .option('--fresh', 'force re-download even if a cached copy exists', false)
  .action(async (opts: { fresh?: boolean }) => {
    try {
      const summary = await ingestDiba({
        fresh: opts.fresh,
        log: (m) => console.error(m),
      });
      console.log(JSON.stringify(summary, null, 2));
    } catch (err) {
      console.error('ingest:diba failed:', err);
      process.exitCode = 1;
    } finally {
      await closeSql();
    }
  });

program
  .command('ingest:osm:region')
  .description('OSM-canonical store ingest for a region (ADR-007).')
  .option('-r, --region <name>', 'region key', 'comunidad-madrid')
  .option('--fresh', "re-query Overpass even if today's cache exists", false)
  .option('-l, --limit <n>', 'cap parsed places (for first runs)', (v) => Number.parseInt(v, 10))
  .action(async (opts: { region?: string; fresh?: boolean; limit?: number }) => {
    try {
      const summary = await ingestOsmCanonical({
        region: opts.region,
        fresh: opts.fresh,
        limit: opts.limit,
        log: (m) => console.error(m),
      });
      console.log(JSON.stringify(summary, null, 2));
    } catch (err) {
      console.error('ingest:osm:region failed:', err);
      process.exitCode = 1;
    } finally {
      await closeSql();
    }
  });

program
  .command('ingest:osm:pbf')
  .description('OSM-canonical ingest from a Geofabrik pbf via osmium (ADR-007, national).')
  .option('-r, --region <name>', 'region key (comunidad-madrid, spain)', 'comunidad-madrid')
  .option('--fresh', 're-download the pbf extract', false)
  .action(async (opts: { region?: string; fresh?: boolean }) => {
    try {
      const summary = await ingestOsmPbf({
        region: opts.region,
        fresh: opts.fresh,
        log: (m) => console.error(m),
      });
      console.log(JSON.stringify(summary, null, 2));
    } catch (err) {
      console.error('ingest:osm:pbf failed:', err);
      process.exitCode = 1;
    } finally {
      await closeSql();
    }
  });

program
  .command('crawl:hours')
  .description('Crawl store websites for schema.org opening hours (incremental).')
  .option('-l, --limit <n>', 'cap the number of URLs (for test runs)', (v) =>
    Number.parseInt(v, 10),
  )
  .option('-c, --concurrency <n>', 'parallel hosts', (v) => Number.parseInt(v, 10))
  .option('--max-age-days <n>', 're-check sites older than this', (v) => Number.parseInt(v, 10))
  .action(async (opts: { limit?: number; concurrency?: number; maxAgeDays?: number }) => {
    try {
      const summary = await crawlHours({
        limit: opts.limit,
        concurrency: opts.concurrency,
        maxAgeDays: opts.maxAgeDays,
        log: (m) => console.error(m),
      });
      console.log(JSON.stringify(summary, null, 2));
    } catch (err) {
      console.error('crawl:hours failed:', err);
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
