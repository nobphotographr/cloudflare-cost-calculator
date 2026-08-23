import { describe, expect, it } from "vitest";
import { demoUsage } from "../src/analytics";
import { historyPoint } from "../src/history";

describe("利用履歴", () => {
  it("ファイル名を含めずアカウント合計だけを日次保存形式へ変換する", () => {
    const point = historyPoint(demoUsage());
    expect(point.capturedOn).toBe("2026-08-24");
    expect(point.daysObserved).toBe(24);
    expect(point.daysInMonth).toBe(31);
    expect(point.r2.storageGbMonth).toBe(362.6);
    expect(point.workers.requests).toBe(1_440_000);
    expect(JSON.stringify(point)).not.toContain("client-deliveries");
    expect(JSON.stringify(point)).not.toContain("handoff-db");
  });
});
