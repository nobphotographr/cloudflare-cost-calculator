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
  period: { start: string; end: string; label: string; daysObserved: number; daysInMonth: number };
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

type GraphQLResponse = {
  data?: { viewer?: { accounts?: Array<Record<string, unknown>> } };
  errors?: Array<{ message?: unknown }>;
};

function graphQLErrorMessage(payload: GraphQLResponse): string {
  const messages = (payload.errors ?? [])
    .map((error) => typeof error?.message === "string" ? error.message.trim() : "")
    .filter(Boolean)
    .slice(0, 3);
  return messages.length ? messages.join(" | ") : "unknown GraphQL error";
}

async function queryGraphQL(input: {
  accessToken: string;
  query: string;
  variables: Record<string, unknown>;
  fetcher?: typeof fetch;
}): Promise<Record<string, unknown>> {
  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: input.query, variables: input.variables }),
  };
  // Cloudflare Workers の組み込み fetch は参照だけを渡して呼ぶと
  // `Illegal invocation` になるため、実運用時はグローバル関数を直接呼ぶ。
  const { fetcher } = input;
  const response = fetcher
    ? await fetcher(GRAPHQL_ENDPOINT, requestInit)
    : await fetch(GRAPHQL_ENDPOINT, requestInit);
  const payload = await response.json() as GraphQLResponse;
  if (!response.ok || payload.errors?.length) {
    throw new Error(`Cloudflare Analytics request failed: HTTP ${response.status}: ${graphQLErrorMessage(payload)}`);
  }
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
    // workersInvocationsAdaptive の cpuTime quantile はマイクロ秒。
    // 料金計算と画面入力はミリ秒なので、ここで単位を揃える。
    const p50 = numeric(object(row.quantiles).cpuTimeP50) / 1_000;
    const p99 = numeric(object(row.quantiles).cpuTimeP99) / 1_000;
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
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const daysObserved = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
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
  const fetcher = input.fetcher;
  const [r2Result, workersResult, d1Result] = await Promise.allSettled([
    queryGraphQL({ accessToken: input.accessToken, query: R2_QUERY, variables, fetcher }),
    queryGraphQL({ accessToken: input.accessToken, query: WORKERS_QUERY, variables, fetcher }),
    queryGraphQL({ accessToken: input.accessToken, query: D1_QUERY, variables: dateVariables, fetcher }),
  ]);
  for (const [product, result] of [["r2", r2Result], ["workers", workersResult], ["d1", d1Result]] as const) {
    if (result.status === "rejected") {
      console.error("analytics_query_failed", {
        product,
        message: result.reason instanceof Error ? result.reason.message : "unknown_error",
      });
    }
  }
  const limitations: string[] = ["Workers CPU料金はP50を中心値、P99を上限参考値として推定します。"];
  if (r2Result.status === "rejected") limitations.push("R2の集計を取得できませんでした。権限または利用状況を確認してください。");
  if (workersResult.status === "rejected") limitations.push("Workersの集計を取得できませんでした。権限または利用状況を確認してください。");
  if (d1Result.status === "rejected") limitations.push("D1の集計を取得できませんでした。権限または利用状況を確認してください。");
  return {
    source: "cloudflare",
    period: { start: start.toISOString(), end: now.toISOString(), label: `今月 ${daysObserved}日分`, daysObserved, daysInMonth },
    r2: r2Result.status === "fulfilled" ? aggregateR2(r2Result.value) : { storageGbMonth: 0, classA: 0, classB: 0, buckets: [] },
    workers: workersResult.status === "fulfilled" ? aggregateWorkers(workersResult.value) : { requests: 0, cpuTimeP50Ms: 0, cpuTimeP99Ms: 0, scripts: [] },
    d1: d1Result.status === "fulfilled" ? aggregateD1(d1Result.value) : { rowsRead: 0, rowsWritten: 0, storageGb: 0, databases: [] },
    limitations,
  };
}

export function demoUsage(): UsageSnapshot {
  return {
    source: "demo",
    period: { start: "2026-08-01T00:00:00.000Z", end: "2026-08-24T00:00:00.000Z", label: "デモ / 今月24日分", daysObserved: 24, daysInMonth: 31 },
    r2: {
      storageGbMonth: 362.6,
      classA: 63_800,
      classB: 253_000,
      buckets: [
        { name: "client-deliveries", storageGbMonth: 326.5, classA: 52_800, classB: 216_900 },
        { name: "project-archive", storageGbMonth: 36.1, classA: 11_000, classB: 36_100 },
      ],
    },
    workers: {
      requests: 1_440_000,
      cpuTimeP50Ms: 5.8,
      cpuTimeP99Ms: 19.4,
      scripts: [
        { name: "handoff", requests: 1_254_194, cpuTimeP50Ms: 5.4, cpuTimeP99Ms: 18.1 },
        { name: "cost-notifier", requests: 185_806, cpuTimeP50Ms: 8.5, cpuTimeP99Ms: 28.2 },
      ],
    },
    d1: {
      rowsRead: 21_987_097,
      rowsWritten: 975_484,
      storageGb: 1.8,
      databases: [{ id: "handoff-db", rowsRead: 21_987_097, rowsWritten: 975_484, storageGb: 1.8 }],
    },
    limitations: ["これは画面確認用の架空データです。", "Workers CPU料金はP50を中心値、P99を上限参考値として推定します。"],
  };
}
