\set ON_ERROR_STOP on
-- "published" is the retained OSM backbone; api_visible is the effective
-- serving boundary after beer eligibility and moderated corrections.
SELECT json_build_object(
  'physical_rows', (SELECT count(*) FROM stores),
  'api_visible', (SELECT count(*) FROM serving_stores),
  'api_schedule_sources', (SELECT count(*) FROM serving_stores WHERE reviewed_hours IS NOT NULL OR (NOT hours_disputed AND place_type<>'gasolinera' AND (opening_hours_osm IS NOT NULL OR (opening_hours_web IS NOT NULL AND hours_web_observed_at>now()-interval '180 days')))),
  'pending_reports', (SELECT count(*) FROM place_reports WHERE status='pending'),
  'retained_corrections', (SELECT count(*) FROM place_corrections),
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
