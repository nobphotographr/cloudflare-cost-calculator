const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const GB = 1_000_000_000;

const CLASS_A = new Set([
  "ListBuckets", "PutBucket", "ListObjects", "PutObject", "CopyObject", "CompleteMultipartUpload",
  "CreateMultipartUpload", "LifecycleStorageTierTransition", "ListMultipartUploads", "UploadPart",
  "UploadPartCopy", "ListParts", "PutBucketEncryption", "PutBucketCors", "PutBucketLifecycleConfiguration",
]);
const CLASS_B = new Set([
  "HeadBucket", "HeadObject", "GetObject", "UsageSummary", "GetBucketEncryption", "GetBucketLocation",
  "GetBucketCors", "GetBucketLifecycleConfiguration",
]);

export type UsageSnapshot = {
  source: "cloudflare" | "demo";
  period: { start: string; end: string; label: string };
  r2: {
    storageGbMonth: number;
    classA: number;
    classB: number;
    buckets: Array<{ name: string; storageGbMonth: number; classA: number; classB: number }>;
  };
  workers: {
    requests: number;
    cpuTimeP50Ms: number;
    cpuTimeP99Ms: number;
    scripts: Array<{ name: string; requests: number; cpuTimeP50Ms: number; cpuTimeP99Ms: number }>;
  };
  d1: {
    rowsRead: number;
    rowsWritten: number;
    storageGb: number;
    databases: Array<{ id: string; rowsRead: number; rowsWritten: number; storageGb: number }>;
  };
  limitations: string[];
};

type GraphQLResponse = { data?: { viewer?: { accounts?: Array<Record<string, unknown>> } }; errors?: unknown[] };

async function queryGraphQL(input: {
  accessToken: string;
  query: string;
  variables: Record<string, unknown>;
  fetcher: typeof fetch;
}): Promise<Record<string, unknown>> {
  const response = await input.fetcher(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: input.query, variables: input.variables }),
  });
  const payload = await response.json() as GraphQLResponse;
  if (!response.ok || payload.errors?.length) throw new Error(`Cloudflare Analytics request failed: HTTP ${response.status}`);
  const account = payload.data?.viewer?.accounts?.[0];
  if (!account) throw new Error("Cloudflare Analytics returned no authorized account");
  return account;
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function aggregateR2(account: Record<string, unknown>): UsageSnapshot["r2"] {
  const operationsByBucket = new Map<string, { classA: number; classB: number }>();
  for (const rowValue of array(account.r2OperationsAdaptiveGroups)) {
    const row = object(rowValue);
    const dimensions = object(row.dimensions);
    const bucket = typeof dimensions.bucketName === "string" ? dimensions.bucketName : "(account)";
    const action = typeof dimensions.actionType === "string" ? dimensions.actionType : "";
    const requests = numeric(object(row.sum).requests);
    const current = operationsByBucket.get(bucket) ?? { classA: 0, classB: 0 };
    if (CLASS_A.has(action)) current.classA += requests;
    if (CLASS_B.has(action)) current.classB += requests;
    operationsByBucket.set(bucket, current);
  }

  const peakByBucketDay = new Map<string, number>();
  for (const rowValue of array(account.r2StorageAdaptiveGroups)) {
    const row = object(rowValue);
    const dimensions = object(row.dimensions);
    const bucket = typeof dimensions.bucketName === "string" ? dimensions.bucketName : "(account)";
    const datetime = typeof dimensions.datetime === "string" ? dimensions.datetime : "";
    const day = datetime.slice(0, 10);
    const bytes = numeric(object(row.max).payloadSize) + numeric(object(row.max).metadataSize);
    const key = `${bucket}\u0000${day}`;
    peakByBucketDay.set(key, Math.max(peakByBucketDay.get(key) ?? 0, bytes));
  }

  const storageByBucket = new Map<string, number>();
  for (const [key, bytes] of peakByBucketDay) {
    const bucket = key.split("\u0000")[0];
    storageByBucket.set(bucket, (storageByBucket.get(bucket) ?? 0) + bytes / GB / 30);
  }
  const names = new Set([...operationsByBucket.keys(), ...storageByBucket.keys()]);
  const buckets = [...names].map((name) => ({
    name,
    storageGbMonth: storageByBucket.get(name) ?? 0,
    classA: operationsByBucket.get(name)?.classA ?? 0,
    classB: operationsByBucket.get(name)?.classB ?? 0,
  })).sort((left, right) => right.storageGbMonth - left.storageGbMonth);
  return {
    storageGbMonth: sum(buckets.map((bucket) => bucket.storageGbMonth)),
    classA: sum(buckets.map((bucket) => bucket.classA)),
    classB: sum(buckets.map((bucket) => bucket.classB)),
    buckets,
  };
}

export function aggregateWorkers(account: Record<string, unknown>): UsageSnapshot["workers"] {
  const scripts = new Map<string, { requests: number; weightedP50: number; weightedP99: number }>();
  for (const rowValue of array(account.workersInvocationsAdaptive)) {
    const row = object(rowValue);
    const dimensions = object(row.dimensions);
    const name = typeof dimensions.scriptName === "string" ? dimensions.scriptName : "(unknown)";
    const requests = numeric(object(row.sum).requests);
    const p50 = numeric(object(row.quantiles).cpuTimeP50);
    const p99 = numeric(object(row.quantiles).cpuTimeP99);
    const current = scripts.get(name) ?? { requests: 0, weightedP50: 0, weightedP99: 0 };
    current.requests += requests;
    current.weightedP50 += requests * p50;
    current.weightedP99 += requests * p99;
    scripts.set(name, current);
  }
  const rows = [...scripts].map(([name, value]) => ({
    name,
    requests: value.requests,
    cpuTimeP50Ms: value.requests ? value.weightedP50 / value.requests : 0,
    cpuTimeP99Ms: value.requests ? value.weightedP99 / value.requests : 0,
  })).sort((left, right) => right.requests - left.requests);
  const requests = sum(rows.map((row) => row.requests));
  return {
    requests,
    cpuTimeP50Ms: requests ? sum(rows.map((row) => row.requests * row.cpuTimeP50Ms)) / requests : 0,
    cpuTimeP99Ms: requests ? sum(rows.map((row) => row.requests * row.cpuTimeP99Ms)) / requests : 0,
    scripts: rows,
  };
}

export function aggregateD1(account: Record<string, unknown>): UsageSnapshot["d1"] {
  const databases = new Map<string, { rowsRead: number; rowsWritten: number; storageGb: number }>();
  for (const rowValue of array(account.d1AnalyticsAdaptiveGroups)) {
    const row = object(rowValue);
    const dimensions = object(row.dimensions);
    const id = typeof dimensions.databaseId === "string" ? dimensions.databaseId : "(unknown)";
    const current = databases.get(id) ?? { rowsRead: 0, rowsWritten: 0, storageGb: 0 };
    current.rowsRead += numeric(object(row.sum).rowsRead);
    current.rowsWritten += numeric(object(row.sum).rowsWritten);
    databases.set(id, current);
  }
  const storagePeakByDatabase = new Map<string, number>();
  for (const rowValue of array(account.d1StorageAdaptiveGroups)) {
    const row = object(rowValue);
    const dimensions = object(row.dimensions);
    const id = typeof dimensions.databaseId === "string" ? dimensions.databaseId : "(unknown)";
    storagePeakByDatabase.set(id, Math.max(storagePeakByDatabase.get(id) ?? 0, numeric(object(row.max).databaseSizeBytes)));
  }
  for (const [id, bytes] of storagePeakByDatabase) {
    const current = databases.get(id) ?? { rowsRead: 0, rowsWritten: 0, storageGb: 0 };
    current.storageGb = bytes / GB;
    databases.set(id, current);
  }
  const rows = [...databases].map(([id, value]) => ({ id, ...value })).sort((left, right) => right.storageGb - left.storageGb);
  return {
    rowsRead: sum(rows.map((row) => row.rowsRead)),
    rowsWritten: sum(rows.map((row) => row.rowsWritten)),
    storageGb: sum(rows.map((row) => row.storageGb)),
    databases: rows,
  };
}

const R2_QUERY = `query CostR2($accountTag: string!, $start: Time, $end: Time) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    r2OperationsAdaptiveGroups(limit: 10000, filter: { datetime_geq: $start, datetime_leq: $end }) {
      sum { requests } dimensions { bucketName actionType }
    }
    r2StorageAdaptiveGroups(limit: 10000, filter: { datetime_geq: $start, datetime_leq: $end }, orderBy: [datetime_ASC]) {
      max { payloadSize metadataSize } dimensions { bucketName datetime }
    }
  } }
}`;

const WORKERS_QUERY = `query CostWorkers($accountTag: string!, $start: string, $end: string) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    workersInvocationsAdaptive(limit: 10000, filter: { datetime_geq: $start, datetime_leq: $end }) {
      sum { requests } quantiles { cpuTimeP50 cpuTimeP99 } dimensions { scriptName datetime }
    }
  } }
}`;

const D1_QUERY = `query CostD1($accountTag: string!, $start: Date, $end: Date) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    d1AnalyticsAdaptiveGroups(limit: 10000, filter: { date_geq: $start, date_leq: $end }) {
      sum { rowsRead rowsWritten } dimensions { databaseId date }
    }
    d1StorageAdaptiveGroups(limit: 10000, filter: { date_geq: $start, date_leq: $end }) {
      max { databaseSizeBytes } dimensions { databaseId date }
    }
  } }
}`;

export async function loadAccountUsage(input: {
  accessToken: string;
  accountId: string;
  now?: Date;
  fetcher?: typeof fetch;
}): Promise<UsageSnapshot> {
  const now = input.now ?? new Date();
  const start = new Date(now.getTime() - 29 * 86_400_000);
  const variables = {
    accountTag: input.accountId,
    start: start.toISOString(),
    end: now.toISOString(),
  };
  const dateVariables = {
    accountTag: input.accountId,
    start: start.toISOString().slice(0, 10),
    end: now.toISOString().slice(0, 10),
  };
  const fetcher = input.fetcher ?? fetch;
  const [r2Result, workersResult, d1Result] = await Promise.allSettled([
    queryGraphQL({ accessToken: input.accessToken, query: R2_QUERY, variables, fetcher }),
    queryGraphQL({ accessToken: input.accessToken, query: WORKERS_QUERY, variables, fetcher }),
    queryGraphQL({ accessToken: input.accessToken, query: D1_QUERY, variables: dateVariables, fetcher }),
  ]);
  const limitations: string[] = ["Workers CPU料金はP50を中心値、P99を上限参考値として推定します。"];
  if (r2Result.status === "rejected") limitations.push("R2の集計を取得できませんでした。権限または利用状況を確認してください。");
  if (workersResult.status === "rejected") limitations.push("Workersの集計を取得できませんでした。権限または利用状況を確認してください。");
  if (d1Result.status === "rejected") limitations.push("D1の集計を取得できませんでした。権限または利用状況を確認してください。");
  return {
    source: "cloudflare",
    period: { start: start.toISOString(), end: now.toISOString(), label: "直近30日" },
    r2: r2Result.status === "fulfilled" ? aggregateR2(r2Result.value) : { storageGbMonth: 0, classA: 0, classB: 0, buckets: [] },
    workers: workersResult.status === "fulfilled" ? aggregateWorkers(workersResult.value) : { requests: 0, cpuTimeP50Ms: 0, cpuTimeP99Ms: 0, scripts: [] },
    d1: d1Result.status === "fulfilled" ? aggregateD1(d1Result.value) : { rowsRead: 0, rowsWritten: 0, storageGb: 0, databases: [] },
    limitations,
  };
}

export function demoUsage(): UsageSnapshot {
  return {
    source: "demo",
    period: { start: "2026-07-26T00:00:00.000Z", end: "2026-08-24T00:00:00.000Z", label: "デモ / 直近30日" },
    r2: {
      storageGbMonth: 468.4,
      classA: 82_400,
      classB: 326_800,
      buckets: [
        { name: "client-deliveries", storageGbMonth: 421.8, classA: 68_200, classB: 280_100 },
        { name: "project-archive", storageGbMonth: 46.6, classA: 14_200, classB: 46_700 },
      ],
    },
    workers: {
      requests: 1_860_000,
      cpuTimeP50Ms: 5.8,
      cpuTimeP99Ms: 19.4,
      scripts: [
        { name: "handoff", requests: 1_620_000, cpuTimeP50Ms: 5.4, cpuTimeP99Ms: 18.1 },
        { name: "cost-notifier", requests: 240_000, cpuTimeP50Ms: 8.5, cpuTimeP99Ms: 28.2 },
      ],
    },
    d1: {
      rowsRead: 28_400_000,
      rowsWritten: 1_260_000,
      storageGb: 1.8,
      databases: [{ id: "handoff-db", rowsRead: 28_400_000, rowsWritten: 1_260_000, storageGb: 1.8 }],
    },
    limitations: ["これは画面確認用の架空データです。", "Workers CPU料金はP50を中心値、P99を上限参考値として推定します。"],
  };
}
