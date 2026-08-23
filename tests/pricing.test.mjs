import test from "node:test";
import assert from "node:assert/strict";
import { estimateAll, estimateD1, estimateR2, estimateWorkers, isPricingStale } from "../public/assets/pricing.js";

test("100GBを3日保存すると10 GB-monthになり、Standard無料枠内に収まる", () => {
  const result = estimateR2({ monthlyUploadGb: 100, retentionDays: 3, averageFileGb: 2, downloadsPerFile: 3, multipartPartMb: 100 });
  assert.equal(result.storageGbMonth, 10);
  assert.equal(result.storageCost, 0);
});

test("R2 Standardは無料枠超過分を請求単位へ切り上げる", () => {
  const result = estimateR2({ monthlyUploadGb: 101, retentionDays: 3, averageFileGb: 101, downloadsPerFile: 0, multipartPartMb: 100 });
  assert.equal(result.storageGbMonth, 10.1);
  assert.equal(result.storageCost, 0.015);
});

test("Infrequent Accessは30日の最低保存期間と取り出し料金を反映する", () => {
  const result = estimateR2({ storageClass: "infrequent", monthlyUploadGb: 100, retentionDays: 3, averageFileGb: 10, downloadsPerFile: 2, multipartPartMb: 100 });
  assert.equal(result.storageGbMonth, 100);
  assert.equal(result.storageCost, 1);
  assert.equal(result.retrievalCost, 2);
});

test("Workers Paidの基本料金と超過料金を計算する", () => {
  const result = estimateWorkers({ plan: "paid", requests: 15_000_000, averageCpuMs: 7 });
  assert.equal(result.requestCost, 1.5);
  assert.equal(result.cpuCost, 1.5);
  assert.equal(result.total, 8);
});

test("Workers Freeは超過を課金せず警告する", () => {
  const result = estimateWorkers({ plan: "free", requests: 4_000_000, averageCpuMs: 11 });
  assert.equal(result.total, 0);
  assert.equal(result.warnings.length, 2);
});

test("D1 Paidは月間無料枠超過分だけを計算する", () => {
  const result = estimateD1({ plan: "paid", rowsRead: 26_000_000_000, rowsWritten: 52_000_000, storageGb: 7 });
  assert.equal(result.readCost, 1);
  assert.equal(result.writeCost, 2);
  assert.equal(result.storageCost, 1.5);
  assert.equal(result.total, 4.5);
});

test("合計を指定為替で円換算する", () => {
  const result = estimateAll({
    exchangeRate: 150,
    r2: { monthlyUploadGb: 0 },
    workers: { plan: "paid", requests: 0, averageCpuMs: 0 },
    d1: { plan: "paid", rowsRead: 0, rowsWritten: 0, storageGb: 0 }
  });
  assert.equal(result.subtotal, 5);
  assert.equal(result.yen, 750);
});

test("最終確認から90日を超えた料金表を古いと判定する", () => {
  assert.equal(isPricingStale(new Date("2026-11-22T00:00:00Z")), false);
  assert.equal(isPricingStale(new Date("2026-11-23T00:00:00Z")), true);
});
