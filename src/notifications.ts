import type { UsageSnapshot } from "./analytics";
import { decrypt, encrypt, sha256 } from "./crypto";
import { estimateUsageSnapshot } from "./forecast";
import { getBudget } from "./history";

type Fetcher = typeof fetch;
const WEBHOOK_TIMEOUT_MS = 10_000;
const DELIVERY_LEASE_MS = 60_000;

export type NotificationSettings = {
  enabled: boolean;
  webhookConfigured: boolean;
  webhookDisplay: string | null;
  verifiedAt: string | null;
  updatedAt: string | null;
};

type NotificationSettingsRow = {
  webhook_url_encrypted: string | null;
  enabled: number;
  verified_at: string | null;
  updated_at: string;
};

export type BudgetNotificationEvent = {
  monthKey: string;
  thresholdRatio: number;
  status: "sent" | "failed";
  estimateUsd: number;
  budgetUsd: number;
  attemptCount: number;
  errorMessage: string | null;
  nextRetryAt: string | null;
  updatedAt: string;
};

type EventRow = {
  month_key: string;
  threshold_ratio: number;
  status: "sending" | "sent" | "failed";
  estimate_usd: number;
  budget_usd: number;
  attempt_count: number;
  error_message: string | null;
  next_retry_at: string | null;
  claim_token: string | null;
  updated_at: string;
};

export async function notificationAccountHash(accountId: string): Promise<string> {
  return sha256(`cloud-cost-account:${accountId}`);
}

export function normalizeWebhookUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.length > 2048) throw new Error("Webhook URL is too long");
  const url = new URL(trimmed);
  if (url.protocol !== "https:") throw new Error("Webhook URL must use HTTPS");
  if (url.username || url.password) throw new Error("Webhook URL must not include credentials");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isBlockedWebhookHostname(hostname)) {
    throw new Error("Webhook URL host is not allowed");
  }
  url.hash = "";
  return url.toString();
}

function isBlockedWebhookHostname(hostname: string): boolean {
  if (!hostname || hostname.includes(":")) return true;
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")
    || hostname.endsWith(".internal") || hostname.endsWith(".home.arpa") || hostname === "metadata.google.internal") return true;
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return true;
  const [first, second, third] = octets;
  return first === 0 || first === 10 || first === 127 || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0 && third === 0)
    || (first === 192 && second === 0 && third === 2)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113);
}

export function maskWebhookUrl(value: string): string {
  const url = new URL(value);
  return `${url.origin}/...`;
}

export function monthKeyForSnapshot(snapshot: UsageSnapshot): string {
  return snapshot.period.end.slice(0, 7);
}

export function dueBudgetThresholds(input: {
  monthlyBudgetUsd: number;
  estimateUsd: number;
  thresholds: number[];
  events: Array<{ thresholdRatio: number; status: "sending" | "sent" | "failed"; nextRetryAt: string | null }>;
  now: Date;
}): number[] {
  if (!(input.monthlyBudgetUsd > 0) || !(input.estimateUsd > 0)) return [];
  const ratio = input.estimateUsd / input.monthlyBudgetUsd;
  return input.thresholds
    .filter((threshold) => threshold > 0 && threshold <= 2 && ratio >= threshold)
    .filter((threshold, index, values) => values.indexOf(threshold) === index)
    .filter((threshold) => {
      const event = input.events.find((row) => row.thresholdRatio === threshold);
      if (!event) return true;
      if (event.status === "sent") return false;
      return !event.nextRetryAt || Date.parse(event.nextRetryAt) <= input.now.getTime();
    })
    .sort((left, right) => left - right);
}

export function buildBudgetWebhookPayload(input: {
  accountName: string;
  monthKey: string;
  thresholdRatio: number;
  estimateUsd: number;
  budgetUsd: number;
  periodLabel: string;
}) {
  return {
    type: "cloud_cost.budget_threshold",
    accountName: input.accountName,
    month: input.monthKey,
    thresholdPercent: Math.round(input.thresholdRatio * 100),
    estimateUsd: Number(input.estimateUsd.toFixed(4)),
    budgetUsd: Number(input.budgetUsd.toFixed(4)),
    ratio: Number((input.estimateUsd / input.budgetUsd).toFixed(4)),
    periodLabel: input.periodLabel,
    generatedAt: new Date().toISOString(),
  };
}

export async function postWebhook(url: string, payload: unknown, fetcher?: Fetcher, idempotencyKey?: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  const init: RequestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: JSON.stringify(payload),
    redirect: "error",
    signal: controller.signal,
  };
  try {
    const response = fetcher ? await fetcher(url, init) : await fetch(url, init);
    if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

function fromSettingsRow(row: NotificationSettingsRow | null, webhookUrl: string | null): NotificationSettings {
  return {
    enabled: Boolean(row?.enabled),
    webhookConfigured: Boolean(row?.webhook_url_encrypted),
    webhookDisplay: webhookUrl ? maskWebhookUrl(webhookUrl) : null,
    verifiedAt: row?.verified_at ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

export async function getNotificationSettings(db: D1Database, accountId: string, encryptionSecret: string): Promise<NotificationSettings> {
  const row = await db.prepare("SELECT webhook_url_encrypted, enabled, verified_at, updated_at FROM notification_settings WHERE account_hash = ?1")
    .bind(await notificationAccountHash(accountId)).first<NotificationSettingsRow>();
  const webhookUrl = row?.webhook_url_encrypted ? await decrypt(row.webhook_url_encrypted, encryptionSecret) : null;
  return fromSettingsRow(row ?? null, webhookUrl);
}

export async function saveNotificationSettings(input: {
  db: D1Database;
  accountId: string;
  webhookUrl: unknown;
  enabled: boolean;
  encryptionSecret: string;
  fetcher?: Fetcher;
  now?: Date;
}): Promise<NotificationSettings> {
  const now = input.now ?? new Date();
  const accountHash = await notificationAccountHash(input.accountId);
  if (!input.enabled) {
    await input.db.prepare(`INSERT INTO notification_settings (account_hash, webhook_url_encrypted, enabled, verified_at, updated_at)
      VALUES (?1, NULL, 0, NULL, ?2)
      ON CONFLICT(account_hash) DO UPDATE SET webhook_url_encrypted = NULL, enabled = 0, verified_at = NULL, updated_at = excluded.updated_at`)
      .bind(accountHash, now.toISOString()).run();
    return fromSettingsRow({ webhook_url_encrypted: null, enabled: 0, verified_at: null, updated_at: now.toISOString() }, null);
  }
  const normalized = normalizeWebhookUrl(input.webhookUrl);
  if (!normalized) throw new Error("Webhook URL is required");
  await postWebhook(normalized, {
    type: "cloud_cost.webhook_verification",
    message: "Cloud Cost budget notification test",
    generatedAt: now.toISOString(),
  }, input.fetcher);
  const encrypted = await encrypt(normalized, input.encryptionSecret);
  await input.db.prepare(`INSERT INTO notification_settings (account_hash, webhook_url_encrypted, enabled, verified_at, updated_at)
    VALUES (?1, ?2, 1, ?3, ?3)
    ON CONFLICT(account_hash) DO UPDATE SET webhook_url_encrypted = excluded.webhook_url_encrypted,
      enabled = 1, verified_at = excluded.verified_at, updated_at = excluded.updated_at`)
    .bind(accountHash, encrypted, now.toISOString()).run();
  return fromSettingsRow({ webhook_url_encrypted: encrypted, enabled: 1, verified_at: now.toISOString(), updated_at: now.toISOString() }, normalized);
}

export async function loadNotificationEvents(db: D1Database, accountId: string, limit = 20): Promise<BudgetNotificationEvent[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
  const result = await db.prepare(`SELECT month_key, threshold_ratio, status, estimate_usd, budget_usd,
      attempt_count, error_message, next_retry_at, updated_at
    FROM budget_notification_events WHERE account_hash = ?1 AND status IN ('sent', 'failed') ORDER BY updated_at DESC LIMIT ?2`)
    .bind(await notificationAccountHash(accountId), safeLimit).all<EventRow>();
  return (result.results ?? []).map((row) => ({
    monthKey: row.month_key,
    thresholdRatio: row.threshold_ratio,
    status: row.status === "sent" ? "sent" : "failed",
    estimateUsd: row.estimate_usd,
    budgetUsd: row.budget_usd,
    attemptCount: row.attempt_count,
    errorMessage: row.error_message,
    nextRetryAt: row.next_retry_at,
    updatedAt: row.updated_at,
  }));
}

async function monthEvents(db: D1Database, accountHash: string, monthKey: string): Promise<EventRow[]> {
  const result = await db.prepare(`SELECT month_key, threshold_ratio, status, estimate_usd, budget_usd,
      attempt_count, error_message, next_retry_at, claim_token, updated_at
    FROM budget_notification_events WHERE account_hash = ?1 AND month_key = ?2`)
    .bind(accountHash, monthKey).all<EventRow>();
  return result.results ?? [];
}

async function claimNotification(input: {
  db: D1Database;
  accountHash: string;
  monthKey: string;
  threshold: number;
  estimateUsd: number;
  budgetUsd: number;
  now: Date;
}): Promise<{ claimToken: string; attemptCount: number } | null> {
  const claimToken = crypto.randomUUID();
  const nowIso = input.now.toISOString();
  const leaseUntil = new Date(input.now.getTime() + DELIVERY_LEASE_MS).toISOString();
  const result = await input.db.prepare(`INSERT INTO budget_notification_events
      (account_hash, month_key, threshold_ratio, status, estimate_usd, budget_usd, attempt_count,
       error_message, next_retry_at, claim_token, created_at, updated_at)
    VALUES (?1, ?2, ?3, 'sending', ?4, ?5, 1, NULL, ?6, ?7, ?8, ?8)
    ON CONFLICT(account_hash, month_key, threshold_ratio) DO UPDATE SET
      status = 'sending', estimate_usd = excluded.estimate_usd, budget_usd = excluded.budget_usd,
      attempt_count = budget_notification_events.attempt_count + 1,
      error_message = NULL, next_retry_at = excluded.next_retry_at,
      claim_token = excluded.claim_token, updated_at = excluded.updated_at
    WHERE budget_notification_events.status != 'sent'
      AND (budget_notification_events.next_retry_at IS NULL OR budget_notification_events.next_retry_at <= ?9)`)
    .bind(input.accountHash, input.monthKey, input.threshold, input.estimateUsd, input.budgetUsd,
      leaseUntil, claimToken, nowIso, nowIso).run();
  if ((result.meta.changes ?? 0) !== 1) return null;
  const row = await input.db.prepare(`SELECT attempt_count FROM budget_notification_events
    WHERE account_hash = ?1 AND month_key = ?2 AND threshold_ratio = ?3 AND claim_token = ?4`)
    .bind(input.accountHash, input.monthKey, input.threshold, claimToken).first<{ attempt_count: number }>();
  return row ? { claimToken, attemptCount: row.attempt_count } : null;
}

export async function dispatchBudgetNotifications(input: {
  db: D1Database;
  accountId: string;
  accountName: string;
  snapshot: UsageSnapshot;
  encryptionSecret: string;
  fetcher?: Fetcher;
  now?: Date;
}): Promise<BudgetNotificationEvent[]> {
  const now = input.now ?? new Date();
  const accountHash = await notificationAccountHash(input.accountId);
  const row = await input.db.prepare("SELECT webhook_url_encrypted, enabled, verified_at, updated_at FROM notification_settings WHERE account_hash = ?1")
    .bind(accountHash).first<NotificationSettingsRow>();
  if (!row?.enabled || !row.webhook_url_encrypted) return [];
  const budget = await getBudget(input.db, input.accountId);
  if (!budget || budget.monthlyBudgetUsd <= 0) return [];
  const webhookUrl = await decrypt(row.webhook_url_encrypted, input.encryptionSecret);
  const estimateUsd = estimateUsageSnapshot(input.snapshot).subtotal;
  const monthKey = monthKeyForSnapshot(input.snapshot);
  const existing = await monthEvents(input.db, accountHash, monthKey);
  const thresholds = dueBudgetThresholds({
    monthlyBudgetUsd: budget.monthlyBudgetUsd,
    estimateUsd,
    thresholds: budget.thresholds,
    events: existing.map((event) => ({ thresholdRatio: event.threshold_ratio, status: event.status, nextRetryAt: event.next_retry_at })),
    now,
  });
  const dispatched: BudgetNotificationEvent[] = [];
  for (const threshold of thresholds) {
    const claim = await claimNotification({
      db: input.db,
      accountHash,
      monthKey,
      threshold,
      estimateUsd,
      budgetUsd: budget.monthlyBudgetUsd,
      now,
    });
    if (!claim) continue;
    const idempotencyKey = await sha256(`cloud-cost-budget:${accountHash}:${monthKey}:${threshold}`);
    try {
      await postWebhook(webhookUrl, buildBudgetWebhookPayload({
        accountName: input.accountName,
        monthKey,
        thresholdRatio: threshold,
        estimateUsd,
        budgetUsd: budget.monthlyBudgetUsd,
        periodLabel: input.snapshot.period.label,
      }), input.fetcher, idempotencyKey);
      await input.db.prepare(`UPDATE budget_notification_events SET status = 'sent', error_message = NULL,
        next_retry_at = NULL, claim_token = NULL, updated_at = ?1
        WHERE account_hash = ?2 AND month_key = ?3 AND threshold_ratio = ?4 AND claim_token = ?5`)
        .bind(now.toISOString(), accountHash, monthKey, threshold, claim.claimToken).run();
      dispatched.push({ monthKey, thresholdRatio: threshold, status: "sent", estimateUsd, budgetUsd: budget.monthlyBudgetUsd, attemptCount: claim.attemptCount, errorMessage: null, nextRetryAt: null, updatedAt: now.toISOString() });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 180) : "Webhook failed";
      const retryAt = new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString();
      await input.db.prepare(`UPDATE budget_notification_events SET status = 'failed', error_message = ?1,
        next_retry_at = ?2, claim_token = NULL, updated_at = ?3
        WHERE account_hash = ?4 AND month_key = ?5 AND threshold_ratio = ?6 AND claim_token = ?7`)
        .bind(message, retryAt, now.toISOString(), accountHash, monthKey, threshold, claim.claimToken).run();
      dispatched.push({ monthKey, thresholdRatio: threshold, status: "failed", estimateUsd, budgetUsd: budget.monthlyBudgetUsd, attemptCount: claim.attemptCount, errorMessage: message, nextRetryAt: retryAt, updatedAt: now.toISOString() });
    }
  }
  return dispatched;
}
