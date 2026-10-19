\set ON_ERROR_STOP on
SELECT json_build_object(
  'physical_rows', (SELECT count(*) FROM stores),
  'published', (SELECT count(*) FROM stores WHERE is_published AND confidence_level <> 'excluded'),
  'published_non_osm', (SELECT count(*) FROM stores WHERE is_published AND confidence_level <> 'excluded' AND source_name <> 'osm'),
  'canary_published', (SELECT count(*) FROM stores WHERE is_published AND confidence_level <> 'excluded' AND ST_Y(geom) BETWEEN 27.5 AND 29.6 AND ST_X(geom) BETWEEN -18.3 AND -13.2),
  'real_hours', (SELECT count(*) FROM stores WHERE is_published AND confidence_level <> 'excluded' AND (opening_hours_osm IS NOT NULL OR opening_hours_web IS NOT NULL)),
  'official_matches', (SELECT count(*) FROM stores WHERE is_published AND matched_censo_source IS NOT NULL),
  'badge_without_match', (SELECT count(*) FROM stores WHERE is_published AND 'oficial' = ANY(badges) AND matched_censo_source IS NULL),
  'match_without_badge', (SELECT count(*) FROM stores WHERE is_published AND matched_censo_source IS NOT NULL AND NOT ('oficial' = ANY(badges))),
  'duplicate_matches', (SELECT count(*) FROM (SELECT matched_censo_source,matched_censo_local_id FROM stores WHERE matched_censo_source IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1) duplicates),
  'orphan_imports', (SELECT count(*) FROM stores s LEFT JOIN import_runs r ON r.id=s.last_import_run_id WHERE s.last_import_run_id IS NOT NULL AND r.id IS NULL),
  'orphan_activities', (SELECT count(*) FROM store_activities a LEFT JOIN stores s ON s.id=a.store_id WHERE s.id IS NULL),
  'osm_updated_at', (SELECT max(last_seen_osm_at) FROM stores WHERE is_published)
);
