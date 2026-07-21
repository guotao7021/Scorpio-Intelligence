-- Rebuild the derived analytics tables from the immutable event source.
-- This corrects historical daily counts that were incremented by retried beacons.
DELETE FROM site_unique_visitors;

INSERT INTO site_unique_visitors (event_date, page_path, visitor_hash, first_seen_at)
SELECT
  event_date,
  page_path,
  visitor_hash,
  MIN(created_at) AS first_seen_at
FROM site_visit_events
GROUP BY event_date, page_path, visitor_hash;

DELETE FROM site_page_daily;

INSERT INTO site_page_daily (
  event_date,
  page_path,
  language,
  page_title,
  referrer_host,
  visit_count,
  unique_visitor_count,
  updated_at
)
SELECT
  event_date,
  page_path,
  MAX(language) AS language,
  MAX(page_title) AS page_title,
  MAX(referrer_host) AS referrer_host,
  COUNT(*) AS visit_count,
  COUNT(DISTINCT visitor_hash) AS unique_visitor_count,
  MAX(created_at) AS updated_at
FROM site_visit_events
GROUP BY event_date, page_path;
