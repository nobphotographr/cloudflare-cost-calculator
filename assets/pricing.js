export const PRICING = Object.freeze({
  version: "2026-08-24",
  billingDays: 30,
  r2: {
    standard: {
      storagePerGbMonth: 0.015,
      classAPerMillion: 4.5,
      classBPerMillion: 0.36,
      retrievalPerGb: 0,
      minimumStorageDays: 0,
      free: { storageGbMonth: 10, classA: 1_000_000, classB: 10_000_000 }
    },
    infrequent: {
      storagePerGbMonth: 0.01,
      classAPerMillion: 9,
      classBPerMillion: 0.9,
      retrievalPerGb: 0.01,
      minimumStorageDays: 30,
      free: { storageGbMonth: 0, classA: 0, classB: 0 }
    }
  },
  workers: {
    paid: {
      subscription: 5,
      includedRequests: 10_000_000,
      requestsPerMillion: 0.3,
      includedCpuMs: 30_000_000,
      cpuPerMillionMs: 0.02
    },
    free: { dailyRequests: 100_000, maxCpuMsPerInvocation: 10 }
  },
  d1: {
    paid: {
      includedRowsRead: 25_000_000_000,
      rowsReadPerMillion: 0.001,
      includedRowsWritten: 50_000_000,
      rowsWrittenPerMillion: 1,
      includedStorageGb: 5,
      storagePerGbMonth: 0.75
    },
    free: { dailyRowsRead: 5_000_000, dailyRowsWritten: 100_000, storageGb: 5 }
  }
});

export function isPricingStale(referenceDate = new Date(), maximumAgeDays = 90) {
  const verifiedAt = new Date(`${PRICING.version}T00:00:00Z`);
  const elapsedDays = (referenceDate.getTime() - verifiedAt.getTime()) / 86_400_000;
  return elapsedDays > maximumAgeDays;
}

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const ceilBillingUnit = (value, unit) => value > 0 ? Math.ceil(value / unit) : 0;

export function estimateR2(input) {
  const storageClass = input.storageClass === "infrequent" ? "infrequent" : "standard";
  const rate = PRICING.r2[storageClass];
  const monthlyUploadGb = number(input.monthlyUploadGb);
  const retentionDays = number(input.retentionDays);
  const averageFileGb = number(input.averageFileGb);
  const downloadsPerFile = number(input.downloadsPerFile);
  const partsPerFile = Math.max(1, Math.ceil(averageFileGb * 1024 / Math.max(5, number(input.multipartPartMb) || 100)));
  const fileCount = averageFileGb > 0 ? monthlyUploadGb / averageFileGb : 0;
  const billedRetentionDays = Math.max(retentionDays, rate.minimumStorageDays);
  const scenarioStorageGbMonth = monthlyUploadGb * billedRetentionDays / PRICING.billingDays;
  const scenarioClassA = fileCount * (partsPerFile > 1 ? partsPerFile + 2 : 1);
  const scenarioClassB = fileCount * downloadsPerFile;
  const scenarioRetrievalGb = storageClass === "infrequent" ? monthlyUploadGb * downloadsPerFile : 0;

  const storageGbMonth = scenarioStorageGbMonth + number(input.existingStorageGbMonth);
  const classA = scenarioClassA + number(input.existingClassA);
  const classB = scenarioClassB + number(input.existingClassB);
  const retrievalGb = scenarioRetrievalGb + number(input.existingRetrievalGb);

  const storageUnits = ceilBillingUnit(Math.max(0, storageGbMonth - rate.free.storageGbMonth), 1);
  const classAUnits = ceilBillingUnit(Math.max(0, classA - rate.free.classA), 1_000_000);
  const classBUnits = ceilBillingUnit(Math.max(0, classB - rate.free.classB), 1_000_000);
  const retrievalUnits = ceilBillingUnit(retrievalGb, 1);

  const storageCost = storageUnits * rate.storagePerGbMonth;
  const classACost = classAUnits * rate.classAPerMillion;
  const classBCost = classBUnits * rate.classBPerMillion;
  const retrievalCost = retrievalUnits * rate.retrievalPerGb;

  return {
    storageClass,
    storageGbMonth,
    classA,
    classB,
    retrievalGb,
    fileCount,
    partsPerFile,
    storageCost,
    classACost,
    classBCost,
    retrievalCost,
    total: storageCost + classACost + classBCost + retrievalCost,
    freeRemaining: {
      storageGbMonth: Math.max(0, rate.free.storageGbMonth - storageGbMonth),
      classA: Math.max(0, rate.free.classA - classA),
      classB: Math.max(0, rate.free.classB - classB)
    }
  };
}

export function estimateWorkers(input) {
  const plan = input.plan === "free" ? "free" : "paid";
  const requests = number(input.requests);
  const averageCpuMs = number(input.averageCpuMs);
  const cpuMs = requests * averageCpuMs;

  if (plan === "free") {
    const averageDailyRequests = requests / PRICING.billingDays;
    return {
      plan,
      requests,
      cpuMs,
      subscriptionCost: 0,
      requestCost: 0,
      cpuCost: 0,
      total: 0,
      warnings: [
        averageDailyRequests > PRICING.workers.free.dailyRequests
          ? "Workers Freeの日次リクエスト上限を超える見込みです。超過分への課金ではなく、処理が失敗する可能性があります。"
          : "",
        averageCpuMs > PRICING.workers.free.maxCpuMsPerInvocation
          ? "1リクエストあたりのCPU時間がWorkers Freeの上限を超えています。"
          : ""
      ].filter(Boolean)
    };
  }

  const rate = PRICING.workers.paid;
  const requestCost = Math.max(0, requests - rate.includedRequests) / 1_000_000 * rate.requestsPerMillion;
  const cpuCost = Math.max(0, cpuMs - rate.includedCpuMs) / 1_000_000 * rate.cpuPerMillionMs;
  return {
    plan,
    requests,
    cpuMs,
    subscriptionCost: rate.subscription,
    requestCost,
    cpuCost,
    total: rate.subscription + requestCost + cpuCost,
    warnings: []
  };
}

export function estimateD1(input) {
  const plan = input.plan === "free" ? "free" : "paid";
  const rowsRead = number(input.rowsRead);
  const rowsWritten = number(input.rowsWritten);
  const storageGb = number(input.storageGb);

  if (plan === "free") {
    const dailyRowsRead = rowsRead / PRICING.billingDays;
    const dailyRowsWritten = rowsWritten / PRICING.billingDays;
    return {
      plan,
      rowsRead,
      rowsWritten,
      storageGb,
      readCost: 0,
      writeCost: 0,
      storageCost: 0,
      total: 0,
      warnings: [
        dailyRowsRead > PRICING.d1.free.dailyRowsRead ? "D1 Freeの日次読み取り上限を超える見込みです。" : "",
        dailyRowsWritten > PRICING.d1.free.dailyRowsWritten ? "D1 Freeの日次書き込み上限を超える見込みです。" : "",
        storageGb > PRICING.d1.free.storageGb ? "D1 Freeの保存容量上限を超える見込みです。" : ""
      ].filter(Boolean)
    };
  }

  const rate = PRICING.d1.paid;
  const readCost = Math.max(0, rowsRead - rate.includedRowsRead) / 1_000_000 * rate.rowsReadPerMillion;
  const writeCost = Math.max(0, rowsWritten - rate.includedRowsWritten) / 1_000_000 * rate.rowsWrittenPerMillion;
  const storageCost = Math.max(0, storageGb - rate.includedStorageGb) * rate.storagePerGbMonth;
  return {
    plan,
    rowsRead,
    rowsWritten,
    storageGb,
    readCost,
    writeCost,
    storageCost,
    total: readCost + writeCost + storageCost,
    warnings: []
  };
}

export function estimateAll(input) {
  const r2 = estimateR2(input.r2 || {});
  const workers = estimateWorkers(input.workers || {});
  const d1 = estimateD1(input.d1 || {});
  const subtotal = r2.total + workers.total + d1.total;
  const exchangeRate = number(input.exchangeRate) || 150;
  return {
    r2,
    workers,
    d1,
    subtotal,
    yen: subtotal * exchangeRate,
    warnings: [...workers.warnings, ...d1.warnings]
  };
}
