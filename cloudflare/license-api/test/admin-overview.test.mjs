import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/worker.js";

test("website admin overview batches D1 reads within the connection limit", async () => {
  const db = fakeOverviewDb();
  const response = await worker.fetch(
    new Request("https://api.example.invalid/v1/scorpio_v1_admin/overview", {
      headers: { "x-admin-token": "admin-contract-token" },
    }),
    {
      DB: db,
      ADMIN_API_TOKEN: "admin-contract-token",
      ADMIN_API_TOKEN_ID: "test-admin",
      CORS_ALLOWED_ORIGINS: "*",
    },
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(db.batchCalls, 1);
  assert.equal(db.batchedStatementCount, 12);
  assert.equal(db.directReadCalls, 0);
  assert.equal(db.authorizedAuditLogged, true);
  assert.equal(payload.users.total, 2);
  assert.equal(payload.licensed_users.valid, 1);
  assert.equal(payload.releases.downloads_24h, 7);
  assert.equal(payload.site.visits_today, 4);
  assert.equal(payload.recent_audit_events.length, 1);
});

function fakeOverviewDb() {
  const db = {
    batchCalls: 0,
    batchedStatementCount: 0,
    directReadCalls: 0,
    authorizedAuditLogged: false,
    prepare(sql) {
      const statement = {
        sql,
        bindings: [],
        bind(...values) {
          this.bindings = values;
          return this;
        },
        async first() {
          db.directReadCalls += 1;
          throw new Error("overview reads must use DB.batch");
        },
        async all() {
          db.directReadCalls += 1;
          throw new Error("overview reads must use DB.batch");
        },
        async run() {
          if (sql.includes("INSERT INTO admin_audit_events") && this.bindings[0] === "admin_request_authorized") {
            db.authorizedAuditLogged = true;
          }
          return { success: true, meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch(statements) {
      db.batchCalls += 1;
      db.batchedStatementCount = statements.length;
      assert.equal(statements.length, 12);
      return [
        result({ total: 2, verified: 2, registered_24h: 1 }),
        result({ total: 1, active: 1, valid: 1, bound_24h: 1 }),
        result({ total: 1, active: 1, draft: 0, suspended: 0 }),
        result({ total: 9, active: 3, assigned: 1, used: 5, revoked: 0 }),
        result({ total: 5, active: 4, pending: 0, revoked: 1, expiring_soon: 0 }),
        result({ total: 5, latest_released_at: "2026-08-19T00:00:00.000Z", download_count: 11 }),
        result({ total_24h: 7 }),
        result({ visits_total: 55, unique_visitors_total: 30, visits_today: 4, unique_visitors_today: 3 }),
        result({ total_24h: 21, exceptions_24h: 0, avg_latency_ms_24h: 18.4 }),
        { success: true, results: [{ id: 1, action: "admin_request_authorized" }] },
        { success: true, results: [] },
        { success: true, results: [] },
      ];
    },
  };
  return db;
}

function result(row) {
  return { success: true, results: [row] };
}
