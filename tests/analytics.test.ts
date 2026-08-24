import { describe, expect, it } from "vitest";
import { aggregateD1, aggregateR2, aggregateWorkers, analyticsPeriodLabel, demoUsage, loadAccountUsage } from "../src/analytics";

describe("Cloudflare Analytics集計", () => {
  it("UTC月初から現在までの比較可能な期間を表示する", () => {
    expect(analyticsPeriodLabel(
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-24T05:30:45.000Z"),
    )).toBe("今月（UTC） 2026-08-01 00:00〜2026-08-24 05:30");
  });

  it("各GraphQL datasetへ同じUTC月初と終了時刻を渡す", async () => {
    const requests = new Map<string, Record<string, string>>();
    const fetcher: typeof fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, string> };
      const operation = payload.query.match(/query (\w+)/)?.[1] ?? "unknown";
      requests.set(operation, payload.variables);
      const account = operation === "CostR2"
        ? { r2OperationsAdaptiveGroups: [], r2StorageAdaptiveGroups: [] }
        : operation === "CostWorkers"
          ? { workersInvocationsAdaptive: [] }
          : { d1AnalyticsAdaptiveGroups: [], d1StorageAdaptiveGroups: [] };
      return new Response(JSON.stringify({ data: { viewer: { accounts: [account] } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await loadAccountUsage({
      accessToken: "token",
      accountId: "0".repeat(32),
      fetcher,
      now: new Date("2026-08-24T05:30:45.000Z"),
    });

    const exactWindow = {
      accountTag: "0".repeat(32),
      start: "2026-08-01T00:00:00.000Z",
      end: "2026-08-24T05:30:45.000Z",
    };
    expect(requests.get("CostR2")).toEqual(exactWindow);
    expect(requests.get("CostWorkers")).toEqual(exactWindow);
    expect(requests.get("CostD1")).toEqual({
      accountTag: "0".repeat(32),
      start: "2026-08-01",
      end: "2026-08-24",
    });
  });

  it("R2の日次ピークと操作種別を料金入力へ変換する", () => {
    const result = aggregateR2({
      r2OperationsAdaptiveGroups: [
        { dimensions: { bucketName: "photos", actionType: "PutObject" }, sum: { requests: 12 } },
        { dimensions: { bucketName: "photos", actionType: "GetObject" }, sum: { requests: 24 } },
        { dimensions: { bucketName: "photos", actionType: "DeleteObject" }, sum: { requests: 4 } },
      ],
      r2StorageAdaptiveGroups: [
        { dimensions: { bucketName: "photos", datetime: "2026-08-23T01:00:00Z" }, max: { payloadSize: 100_000_000_000, metadataSize: 0 } },
        { dimensions: { bucketName: "photos", datetime: "2026-08-23T22:00:00Z" }, max: { payloadSize: 120_000_000_000, metadataSize: 0 } },
        { dimensions: { bucketName: "photos", datetime: "2026-08-24T22:00:00Z" }, max: { payloadSize: 180_000_000_000, metadataSize: 0 } },
      ],
    });
    expect(result.storageGbMonth).toBe(10);
    expect(result.classA).toBe(12);
    expect(result.classB).toBe(24);
  });

  it("WorkersのCPU quantileをマイクロ秒からミリ秒へ変換してrequest加重平均する", () => {
    const result = aggregateWorkers({ workersInvocationsAdaptive: [
      { dimensions: { scriptName: "a" }, sum: { requests: 100 }, quantiles: { cpuTimeP50: 5_000, cpuTimeP99: 20_000 } },
      { dimensions: { scriptName: "b" }, sum: { requests: 300 }, quantiles: { cpuTimeP50: 7_000, cpuTimeP99: 30_000 } },
    ] });
    expect(result.requests).toBe(400);
    expect(result.cpuTimeP50Ms).toBe(6.5);
    expect(result.cpuTimeP99Ms).toBe(27.5);
  });

  it("D1の行数とDBごとの最大容量を合算する", () => {
    const result = aggregateD1({
      d1AnalyticsAdaptiveGroups: [
        { dimensions: { databaseId: "one" }, sum: { rowsRead: 100, rowsWritten: 5 } },
        { dimensions: { databaseId: "one" }, sum: { rowsRead: 200, rowsWritten: 6 } },
      ],
      d1StorageAdaptiveGroups: [
        { dimensions: { databaseId: "one" }, max: { databaseSizeBytes: 1_000_000_000 } },
        { dimensions: { databaseId: "one" }, max: { databaseSizeBytes: 1_500_000_000 } },
      ],
    });
    expect(result.rowsRead).toBe(300);
    expect(result.rowsWritten).toBe(11);
    expect(result.storageGb).toBe(1.5);
  });

  it("デモデータに個別内訳と精度注記がある", () => {
    const demo = demoUsage();
    expect(demo.r2.buckets.length).toBeGreaterThan(0);
    expect(demo.workers.scripts.length).toBeGreaterThan(0);
    expect(demo.limitations.length).toBeGreaterThan(0);
  });

  it("一部製品のAPIが失敗しても取得済みの利用量を返す", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      if (calls === 2) return new Response(JSON.stringify({ errors: [{ message: "not authorized" }] }), { status: 403 });
      const account = calls === 1
        ? { r2OperationsAdaptiveGroups: [], r2StorageAdaptiveGroups: [] }
        : { d1AnalyticsAdaptiveGroups: [], d1StorageAdaptiveGroups: [] };
      return new Response(JSON.stringify({ data: { viewer: { accounts: [account] } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const result = await loadAccountUsage({
      accessToken: "token",
      accountId: "0".repeat(32),
      fetcher,
      now: new Date("2026-08-24T00:00:00Z"),
    });
    expect(result.source).toBe("cloudflare");
    expect(result.period.label).toBe("今月（UTC） 2026-08-01 00:00〜2026-08-24 00:00");
    expect(result.workers.requests).toBe(0);
    expect(result.limitations).toContain("Workersの集計を取得できませんでした。権限または利用状況を確認してください。");
    expect(result.limitations).not.toContain("R2の集計を取得できませんでした。権限または利用状況を確認してください。");
  });
});
