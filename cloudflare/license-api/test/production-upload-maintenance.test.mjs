import assert from "node:assert/strict";
import test from "node:test";

import { __productionUploadMaintenanceTest as maintenance } from "../src/worker.js";

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async all() {
    this.db.selects.push(this);
    return { results: this.db.staleBatches };
  }
}

class FakeDb {
  constructor(staleBatches = []) {
    this.staleBatches = staleBatches;
    this.selects = [];
    this.batches = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    this.batches.push(statements);
    return statements.map(() => ({ success: true }));
  }
}

test("stale production upload cleanup removes staging and chunks before aborting batches", async () => {
  const db = new FakeDb([{ batch_id: "pu_old_receiving" }]);
  const result = await maintenance.cleanupStaleProductionUploads({
    DB: db,
    PRODUCTION_UPLOAD_STALE_TTL_HOURS: "24",
    PRODUCTION_UPLOAD_CLEANUP_LIMIT: "25",
  });

  assert.equal(result.cleaned_batches, 1);
  assert.equal(db.batches.length, 1);
  assert.equal(db.batches[0].length, 3);
  assert.match(db.batches[0][0].sql, /DELETE FROM production_upload_staging_rows/);
  assert.match(db.batches[0][1].sql, /DELETE FROM production_upload_chunks/);
  assert.match(db.batches[0][2].sql, /SET status = 'aborted'/);
  assert.match(db.batches[0][2].values[0], /stale_upload_ttl_expired_after_24h/);
  assert.match(db.selects[0].sql, /status IN \('created', 'receiving'\)/);
});

test("production upload cleanup is a no-op when no stale batches exist", async () => {
  const db = new FakeDb([]);
  const result = await maintenance.cleanupStaleProductionUploads({ DB: db });

  assert.equal(result.cleaned_batches, 0);
  assert.equal(db.batches.length, 0);
});
