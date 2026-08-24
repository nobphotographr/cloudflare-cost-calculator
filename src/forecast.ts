import type { UsageSnapshot } from "./analytics";

export const SERVER_PRICING = Object.freeze({
  r2: {
    standard: {
      storagePerGbMonth: 0.015,
      classAPerMillion: 4.5,
      classBPerMillion: 0.36,
      free: { storageGbMonth: 10, classA: 1_000_000, classB: 10_000_000 },
    },
  },
  workers: {
    paid: {
      subscription: 5,
      includedRequests: 10_000_000,
      requestsPerMillion: 0.3,
      includedCpuMs: 30_000_000,
      cpuPerMillionMs: 0.02,
    },
  },
  d1: {
    paid: {
      includedRowsRead: 25_000_000_000,
      rowsReadPerMillion: 0.001,
      includedRowsWritten: 50_000_000,
      rowsWrittenPerMillion: 1,
      includedStorageGb: 5,
      storagePerGbMonth: 0.75,
    },
  },
});

function ceilBillingUnit(value: number, unit: number): number {
  return value > 0 ? Math.ceil(value / unit) : 0;
}

export function projectionFactor(snapshot: UsageSnapshot): number {
  const observed = Number(snapshot.period.daysObserved) || 30;
  const total = Number(snapshot.period.daysInMonth) || observed;
  return Math.max(1, total / observed);
}

export function estimateUsageSnapshot(snapshot: UsageSnapshot, cpuField: "cpuTimeP50Ms" | "cpuTimeP99Ms" = "cpuTimeP50Ms"): {
  subtotal: number;
  r2: number;
  workers: number;
  d1: number;
} {
  const factor = projectionFactor(snapshot);
  const r2Rate = SERVER_PRICING.r2.standard;
  const workersRate = SERVER_PRICING.workers.paid;
  const d1Rate = SERVER_PRICING.d1.paid;
  const r2Storage = snapshot.r2.storageGbMonth * factor;
  const r2ClassA = snapshot.r2.classA * factor;
  const r2ClassB = snapshot.r2.classB * factor;
  const workerRequests = snapshot.workers.requests * factor;
  const workerCpuMs = workerRequests * snapshot.workers[cpuField];
  const d1RowsRead = snapshot.d1.rowsRead * factor;
  const d1RowsWritten = snapshot.d1.rowsWritten * factor;

  const r2 = ceilBillingUnit(Math.max(0, r2Storage - r2Rate.free.storageGbMonth), 1) * r2Rate.storagePerGbMonth
    + ceilBillingUnit(Math.max(0, r2ClassA - r2Rate.free.classA), 1_000_000) * r2Rate.classAPerMillion
    + ceilBillingUnit(Math.max(0, r2ClassB - r2Rate.free.classB), 1_000_000) * r2Rate.classBPerMillion;
  const workers = workersRate.subscription
    + Math.max(0, workerRequests - workersRate.includedRequests) / 1_000_000 * workersRate.requestsPerMillion
    + Math.max(0, workerCpuMs - workersRate.includedCpuMs) / 1_000_000 * workersRate.cpuPerMillionMs;
  const d1 = Math.max(0, d1RowsRead - d1Rate.includedRowsRead) / 1_000_000 * d1Rate.rowsReadPerMillion
    + Math.max(0, d1RowsWritten - d1Rate.includedRowsWritten) / 1_000_000 * d1Rate.rowsWrittenPerMillion
    + Math.max(0, snapshot.d1.storageGb - d1Rate.includedStorageGb) * d1Rate.storagePerGbMonth;

  return { subtotal: r2 + workers + d1, r2, workers, d1 };
}
