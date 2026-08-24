import type { UsageSnapshot } from "./analytics";
import { sha256 } from "./crypto";

export type UsageHistoryPoint = {
  capturedOn: string;
  periodStart: string;
  periodEnd: string;
  daysObserved: number;
  daysInMonth: number;
  r2: { storageGbMonth: number; classA: number; classB: number };
  workers: { requests: number; cpuTimeP50Ms: number; cpuTimeP99Ms: number };
  d1: { rowsRead: number; rowsWritten: number; storageGb: number };
};

type HistoryRow = {
  captured_on: string;
  period_start: string;
  period_end: string;
  days_observed: number;
  days_in_month: number;
  r2_storage_gb_month: number;
  r2_class_a: number;
  r2_class_b: number;
  workers_requests: number;
  workers_cpu_p50_ms: number;
  workers_cpu_p99_ms: number;
  d1_rows_read: number;
  d1_rows_written: number;
  d1_storage_gb: number;
};

export function historyPoint(snapshot: UsageSnapshot, capturedOn = snapshot.period.end.slice(0, 10)): UsageHistoryPoint {
  return {
    capturedOn,
    periodStart: snapshot.period.start,
    periodEnd: snapshot.period.end,
    daysObserved: snapshot.period.daysObserved,
    daysInMonth: snapshot.period.daysInMonth,
    r2: { storageGbMonth: snapshot.r2.storageGbMonth, classA: snapshot.r2.classA, classB: snapshot.r2.classB },
    workers: { requests: snapshot.workers.requests, cpuTimeP50Ms: snapshot.workers.cpuTimeP50Ms, cpuTimeP99Ms: snapshot.workers.cpuTimeP99Ms },
    d1: { rowsRead: snapshot.d1.rowsRead, rowsWritten: snapshot.d1.rowsWritten, storageGb: snapshot.d1.storageGb },
  };
}

function fromRow(row: HistoryRow): UsageHistoryPoint {
  return {
    capturedOn: row.captured_on,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    daysObserved: row.days_observed,
    daysInMonth: row.days_in_month,
    r2: { storageGbMonth: row.r2_storage_gb_month, classA: row.r2_class_a, classB: row.r2_class_b },
    workers: { requests: row.workers_requests, cpuTimeP50Ms: row.workers_cpu_p50_ms, cpuTimeP99Ms: row.workers_cpu_p99_ms },
    d1: { rowsRead: row.d1_rows_read, rowsWritten: row.d1_rows_written, storageGb: row.d1_storage_gb },
  };
}

async function accountHash(accountId: string): Promise<string> {
  return sha256(`cloud-cost-account:${accountId}`);
}

export async function saveUsageSnapshot(db: D1Database, accountId: string, snapshot: UsageSnapshot): Promise<void> {
  const point = historyPoint(snapshot);
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO usage_snapshots (
    account_hash, captured_on, period_start, period_end, days_observed, days_in_month,
    r2_storage_gb_month, r2_class_a, r2_class_b,
    workers_requests, workers_cpu_p50_ms, workers_cpu_p99_ms,
    d1_rows_read, d1_rows_written, d1_storage_gb, created_at, updated_at
  ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16)
  ON CONFLICT(account_hash, captured_on) DO UPDATE SET
    period_start = excluded.period_start, period_end = excluded.period_end,
    days_observed = excluded.days_observed, days_in_month = excluded.days_in_month,
    r2_storage_gb_month = excluded.r2_storage_gb_month, r2_class_a = excluded.r2_class_a, r2_class_b = excluded.r2_class_b,
    workers_requests = excluded.workers_requests, workers_cpu_p50_ms = excluded.workers_cpu_p50_ms, workers_cpu_p99_ms = excluded.workers_cpu_p99_ms,
    d1_rows_read = excluded.d1_rows_read, d1_rows_written = excluded.d1_rows_written, d1_storage_gb = excluded.d1_storage_gb,
    updated_at = excluded.updated_at`).bind(
    await accountHash(accountId), point.capturedOn, point.periodStart, point.periodEnd, point.daysObserved, point.daysInMonth,
    point.r2.storageGbMonth, point.r2.classA, point.r2.classB,
    point.workers.requests, point.workers.cpuTimeP50Ms, point.workers.cpuTimeP99Ms,
    point.d1.rowsRead, point.d1.rowsWritten, point.d1.storageGb, now,
  ).run();
}

export async function loadUsageHistory(db: D1Database, accountId: string, limit = 90): Promise<UsageHistoryPoint[]> {
  const safeLimit = Math.max(1, Math.min(400, Math.trunc(limit)));
  const result = await db.prepare("SELECT * FROM usage_snapshots WHERE account_hash = ?1 ORDER BY captured_on DESC LIMIT ?2")
    .bind(await accountHash(accountId), safeLimit).all<HistoryRow>();
  return (result.results ?? []).map(fromRow);
}

export async function getBudget(db: D1Database, accountId: string): Promise<{ monthlyBudgetUsd: number; thresholds: number[] } | null> {
  const row = await db.prepare("SELECT monthly_budget_usd, thresholds_json FROM budget_settings WHERE account_hash = ?1")
    .bind(await accountHash(accountId)).first<{ monthly_budget_usd: number; thresholds_json: string }>();
  if (!row) return null;
  let thresholds = [0.5, 0.8, 1];
  try {
    const parsed = JSON.parse(row.thresholds_json) as unknown;
    if (Array.isArray(parsed)) thresholds = parsed.filter((item): item is number => typeof item === "number" && item > 0 && item <= 2);
  } catch {
    // Retain safe defaults for malformed historical rows.
  }
  return { monthlyBudgetUsd: row.monthly_budget_usd, thresholds };
}

export async function setBudget(db: D1Database, accountId: string, monthlyBudgetUsd: number): Promise<{ monthlyBudgetUsd: number; thresholds: number[] }> {
  if (!Number.isFinite(monthlyBudgetUsd) || monthlyBudgetUsd < 0 || monthlyBudgetUsd > 1_000_000) throw new Error("Invalid monthly budget");
  const thresholds = [0.5, 0.8, 1];
  await db.prepare(`INSERT INTO budget_settings (account_hash, monthly_budget_usd, thresholds_json, updated_at)
    VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT(account_hash) DO UPDATE SET monthly_budget_usd = excluded.monthly_budget_usd,
    thresholds_json = excluded.thresholds_json, updated_at = excluded.updated_at`)
    .bind(await accountHash(accountId), monthlyBudgetUsd, JSON.stringify(thresholds), new Date().toISOString()).run();
  return { monthlyBudgetUsd, thresholds };
}

export async function deleteAccountData(db: D1Database, accountIds: string[]): Promise<void> {
  for (const accountId of new Set(accountIds)) {
    const hash = await accountHash(accountId);
    await db.batch([
      db.prepare("DELETE FROM usage_snapshots WHERE account_hash = ?1").bind(hash),
      db.prepare("DELETE FROM budget_settings WHERE account_hash = ?1").bind(hash),
      db.prepare("DELETE FROM notification_settings WHERE account_hash = ?1").bind(hash),
      db.prepare("DELETE FROM budget_notification_events WHERE account_hash = ?1").bind(hash),
    ]);
  }
}

export async function cleanupUsageHistory(db: D1Database, now = new Date(), retentionDays = 400): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString().slice(0, 10);
  const result = await db.prepare("DELETE FROM usage_snapshots WHERE captured_on < ?1").bind(cutoff).run();
  return result.meta.changes ?? 0;
}
