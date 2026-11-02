const rows = (result) => result.results || [];
const first = (result) => rows(result)[0] || {};
const number = (value) => Number(value) || 0;

export function operationsPeriod(days, now = new Date()) {
  const endDay = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const fromDay = new Date(Date.parse(endDay + "T00:00:00Z") - (days - 1) * 86400000).toISOString().slice(0, 10);
  return {days, from: fromDay, to: endDay, timezone: "Asia/Shanghai", today_incomplete: true,
    start: new Date(Date.parse(fromDay + "T00:00:00Z") - 8 * 3600000).toISOString(), end: now.toISOString()};
}

export function registerAdminOperations({route, requireAdmin, json, throwHttp, todayIso, addDays, realUserFilter}) {
  route("GET", "/v1/scorpio_v1_admin/operations", async (ctx) => {
    requireAdmin(ctx);
    const days = Number(ctx.url.searchParams.get("days") || 7);
    if (![7, 30, 90].includes(days)) throwHttp(400, "operations_period_invalid");
    const period = operationsPeriod(days), day = todayIso(), soon = addDays(day, 30);
    const users = `u.archived_at IS NULL AND ${realUserFilter}`;
    const valid = "l.archived_at IS NULL AND l.is_active=1 AND l.revoked=0 AND COALESCE(l.approval_status,'auto') NOT IN ('pending','rejected') AND substr(l.expires_at,1,10)>=?";
    const range = "datetime(created_at)>=datetime(?) AND datetime(created_at)<=datetime(?)";
    const downloadPlatform = "LOWER(COALESCE(rv.platform,''))='android' OR LOWER(COALESCE(d.file_name,'')) LIKE '%.apk'";
    // One D1 batch keeps the dashboard below the Worker's concurrent-connection limit.
    const result = await ctx.env.DB.batch([
      ctx.env.DB.prepare(`SELECT COUNT(*) AS pv,COUNT(DISTINCT visitor_hash) AS uv FROM site_visit_events WHERE ${range}`).bind(period.start, period.end),
      ctx.env.DB.prepare(`SELECT date(created_at,'+8 hours') AS day,COUNT(*) AS pv,COUNT(DISTINCT visitor_hash) AS uv FROM site_visit_events WHERE ${range} GROUP BY day ORDER BY day`).bind(period.start, period.end),
      ctx.env.DB.prepare(`SELECT date(u.created_at,'+8 hours') AS day,COUNT(*) AS registrations FROM users u WHERE ${realUserFilter} AND datetime(u.created_at)>=datetime(?) AND datetime(u.created_at)<=datetime(?) GROUP BY day`).bind(period.start, period.end),
      ctx.env.DB.prepare(`SELECT date(d.created_at,'+8 hours') AS day,SUM(CASE WHEN ${downloadPlatform} THEN 1 ELSE 0 END) AS android,SUM(CASE WHEN ${downloadPlatform} THEN 0 ELSE 1 END) AS windows FROM release_download_events d LEFT JOIN release_versions rv ON rv.id=d.release_id WHERE datetime(d.created_at)>=datetime(?) AND datetime(d.created_at)<=datetime(?) GROUP BY day`).bind(period.start, period.end),
      ctx.env.DB.prepare(`SELECT COUNT(*) AS users,COUNT(DISTINCT CASE WHEN EXISTS(SELECT 1 FROM licenses l WHERE l.user_id=u.id AND ${valid}) THEN u.id END) AS licensed_users FROM users u WHERE ${users}`).bind(day),
      ctx.env.DB.prepare(`SELECT COUNT(*) AS valid_credentials,COUNT(DISTINCT CASE WHEN substr(l.expires_at,1,10)<=? THEN l.user_id END) AS expiring_users FROM licenses l JOIN users u ON u.id=l.user_id WHERE ${users} AND ${valid}`).bind(soon, day),
      ctx.env.DB.prepare(`SELECT l.edition,COUNT(DISTINCT l.user_id) AS users FROM licenses l JOIN users u ON u.id=l.user_id WHERE ${users} AND ${valid} GROUP BY l.edition ORDER BY users DESC`).bind(day),
      ctx.env.DB.prepare(`SELECT
        (SELECT COUNT(*) FROM customers) AS customers,
        (SELECT COUNT(*) FROM activation_codes WHERE archived_at IS NULL) AS codes,
        (SELECT COUNT(*) FROM licenses l JOIN users u ON u.id=l.user_id WHERE ${users} AND l.archived_at IS NULL) AS credentials,
        (SELECT COUNT(*) FROM activation_codes ac WHERE ac.archived_at IS NULL AND ac.status IN ('active','assigned')
          AND NOT EXISTS(SELECT 1 FROM users owner WHERE owner.archived_at IS NOT NULL AND (owner.id=ac.assigned_to_user_id OR owner.id=ac.used_by_user_id))
          AND NOT EXISTS(SELECT 1 FROM licenses used WHERE used.activation_code_id=ac.id AND used.revoked=0 AND substr(used.expires_at,1,10)<?)) AS available_codes,
        (SELECT COUNT(*) FROM release_versions WHERE is_active=1) AS published_releases,
        (SELECT COUNT(*) FROM release_versions) AS releases`).bind(day),
      ctx.env.DB.prepare(`SELECT COUNT(*) AS renewals FROM account_service_requests r JOIN users u ON u.id=r.user_id WHERE r.status='pending' AND ${users}`),
      ctx.env.DB.prepare(`SELECT COUNT(*) AS pending_credentials FROM licenses l JOIN users u ON u.id=l.user_id WHERE ${users} AND l.archived_at IS NULL AND l.revoked=0 AND (l.expires_at IS NULL OR l.expires_at='' OR substr(l.expires_at,1,10)>=?) AND (l.approval_status IN ('pending','rejected') OR l.is_active=0)`).bind(day),
      ctx.env.DB.prepare("SELECT COUNT(*) AS open_feedback,SUM(CASE WHEN priority IN ('high','urgent') THEN 1 ELSE 0 END) AS urgent_feedback FROM feedback_items WHERE status IN ('new','triaged','in_progress')"),
      ctx.env.DB.prepare(`SELECT page_path,COUNT(*) AS pv,COUNT(DISTINCT visitor_hash) AS uv FROM site_visit_events WHERE ${range} GROUP BY page_path ORDER BY pv DESC,page_path LIMIT 6`).bind(period.start, period.end),
      ctx.env.DB.prepare(`SELECT COUNT(*) AS requests,SUM(CASE WHEN status IN ('ok','contract_ready','compute_proxy') THEN 0 ELSE 1 END) AS exceptions,AVG(latency_ms) AS avg_latency_ms FROM analysis_requests WHERE ${range}`).bind(period.start, period.end),
      ctx.env.DB.prepare("SELECT COUNT(*) AS visits_total,COUNT(DISTINCT visitor_hash) AS visitors_total FROM site_visit_events"),
      ctx.env.DB.prepare(`SELECT SUM(CASE WHEN ${downloadPlatform} THEN 1 ELSE 0 END) AS android_downloads_total,SUM(CASE WHEN ${downloadPlatform} THEN 0 ELSE 1 END) AS windows_downloads_total FROM release_download_events d LEFT JOIN release_versions rv ON rv.id=d.release_id`),
      ctx.env.DB.prepare(`SELECT u.id AS user_id,u.username,MIN(l.expires_at) AS expires_at FROM licenses l JOIN users u ON u.id=l.user_id WHERE ${users} AND ${valid} AND substr(l.expires_at,1,10)<=? GROUP BY u.id,u.username ORDER BY expires_at,u.id LIMIT 5`).bind(day, soon),
    ]);
    const [traffic, dailyVisits, dailyUsers, dailyDownloads, accountCounts, licenseCounts, editions, inventory, renewals, pending, feedback, pages, analysis, allVisits, allDownloads, expiring] = result;
    const byDay = new Map();
    for (let index = 0; index < days; index++) {
      const key = addDays(period.from, index); byDay.set(key, {day: key, pv: 0, uv: 0, registrations: 0, windows: 0, android: 0});
    }
    for (const source of [dailyVisits, dailyUsers, dailyDownloads]) for (const row of rows(source)) if (byDay.has(row.day)) for (const [key, value] of Object.entries(row)) if (key !== "day") byDay.get(row.day)[key] = number(value);
    const series = [...byDay.values()];
    const aggregate = (key) => series.reduce((sum, row) => sum + row[key], 0);
    const snapshot = {...first(accountCounts), ...first(licenseCounts), ...first(inventory), ...first(allVisits), ...first(allDownloads)};
    for (const key of Object.keys(snapshot)) snapshot[key] = number(snapshot[key]);
    const service = first(analysis);
    return json({generated_at: period.end, period, totals: {pv: number(first(traffic).pv), uv: number(first(traffic).uv), registrations: aggregate("registrations"), windows: aggregate("windows"), android: aggregate("android")},
      snapshot, queue: {renewals: number(first(renewals).renewals), pending_credentials: number(first(pending).pending_credentials), open_feedback: number(first(feedback).open_feedback), urgent_feedback: number(first(feedback).urgent_feedback)},
      series, editions: rows(editions).map((row) => ({edition: row.edition, users: number(row.users)})), pages: rows(pages).map((row) => ({path: row.page_path, pv: number(row.pv), uv: number(row.uv)})), expiring: rows(expiring),
      analysis: {requests: number(service.requests), exceptions: number(service.exceptions), avg_latency_ms: service.avg_latency_ms === null ? null : number(service.avg_latency_ms)},
      definitions: {uv: "distinct_visitor_hash_in_period_not_sum_of_daily_uv", downloads: "recorded_download_requests_not_installs", licenses: "distinct_current_users_with_effective_license", license_day: day, editions: "users_can_hold_multiple_editions", account_snapshot_excludes: "archived_and_known_test_accounts", registrations: "historical_registrations_including_archived_accounts", source: ["site_visit_events", "customers", "activation_codes", "users", "licenses", "release_download_events", "release_versions", "account_service_requests", "feedback_items", "analysis_requests"]},
    }, 200, {"cache-control": "private, no-store"});
  });
}
