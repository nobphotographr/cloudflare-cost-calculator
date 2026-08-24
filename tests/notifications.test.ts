import { describe, expect, it } from "vitest";
import { demoUsage } from "../src/analytics";
import { estimateUsageSnapshot, projectionFactor } from "../src/forecast";
import { buildBudgetWebhookPayload, dueBudgetThresholds, maskWebhookUrl, normalizeWebhookUrl, postWebhook } from "../src/notifications";

describe("外部予算通知", () => {
  it("接続版usage snapshotから月末予測額をサーバー側で算出する", () => {
    const snapshot = demoUsage();
    const estimate = estimateUsageSnapshot(snapshot);
    expect(projectionFactor(snapshot)).toBeCloseTo(31 / 24, 6);
    expect(estimate.subtotal).toBeGreaterThan(10);
    expect(estimate.r2).toBeGreaterThan(0);
    expect(estimate.workers).toBe(5);
  });

  it("HTTPSのWebhookだけを保存対象にし、表示用にはsecret pathを伏せる", () => {
    const url = normalizeWebhookUrl("https://hooks.example.com/services/T000/B000/secret#fragment");
    expect(url).toBe("https://hooks.example.com/services/T000/B000/secret");
    expect(maskWebhookUrl(url ?? "")).toBe("https://hooks.example.com/...");
    expect(() => normalizeWebhookUrl("http://hooks.example.com/test")).toThrow(/HTTPS/);
    expect(() => normalizeWebhookUrl("https://user:pass@example.com/test")).toThrow(/credentials/);
    expect(() => normalizeWebhookUrl("https://localhost/test")).toThrow(/not allowed/);
    expect(() => normalizeWebhookUrl("https://localhost./test")).toThrow(/not allowed/);
    expect(() => normalizeWebhookUrl("https://169.254.169.254/latest/meta-data")).toThrow(/not allowed/);
    expect(() => normalizeWebhookUrl("https://10.0.0.8/test")).toThrow(/not allowed/);
    expect(() => normalizeWebhookUrl("https://[::1]/test")).toThrow(/not allowed/);
  });

  it("Webhook送信はredirectを拒否し、冪等性keyを付ける", async () => {
    let captured: RequestInit | undefined;
    await postWebhook("https://hooks.example.com/test", { ok: true }, async (_url, init) => {
      captured = init;
      return new Response(null, { status: 204 });
    }, "event-key");
    expect(captured?.redirect).toBe("error");
    expect(new Headers(captured?.headers).get("idempotency-key")).toBe("event-key");
  });

  it("当月に未送信で到達済みの閾値だけを送信対象にする", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    const due = dueBudgetThresholds({
      monthlyBudgetUsd: 10,
      estimateUsd: 12,
      thresholds: [0.5, 0.8, 1],
      events: [
        { thresholdRatio: 0.5, status: "sent", nextRetryAt: null },
        { thresholdRatio: 0.8, status: "failed", nextRetryAt: "2026-08-24T11:59:00.000Z" },
        { thresholdRatio: 1, status: "failed", nextRetryAt: "2026-08-24T13:00:00.000Z" },
      ],
      now,
    });
    expect(due).toEqual([0.8]);
  });

  it("送信中leaseが切れるまで同じ閾値を再取得しない", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    expect(dueBudgetThresholds({
      monthlyBudgetUsd: 10,
      estimateUsd: 12,
      thresholds: [1],
      events: [{ thresholdRatio: 1, status: "sending", nextRetryAt: "2026-08-24T12:01:00.000Z" }],
      now,
    })).toEqual([]);
    expect(dueBudgetThresholds({
      monthlyBudgetUsd: 10,
      estimateUsd: 12,
      thresholds: [1],
      events: [{ thresholdRatio: 1, status: "sending", nextRetryAt: "2026-08-24T11:59:00.000Z" }],
      now,
    })).toEqual([1]);
  });

  it("Webhook payloadに予算額、予測額、閾値を含める", () => {
    const payload = buildBudgetWebhookPayload({
      accountName: "Example Account",
      monthKey: "2026-08",
      thresholdRatio: 0.8,
      estimateUsd: 12.34567,
      budgetUsd: 10,
      periodLabel: "今月 24日分",
    });
    expect(payload).toMatchObject({
      type: "cloud_cost.budget_threshold",
      accountName: "Example Account",
      month: "2026-08",
      thresholdPercent: 80,
      estimateUsd: 12.3457,
      budgetUsd: 10,
      ratio: 1.2346,
      periodLabel: "今月 24日分",
    });
  });
});
