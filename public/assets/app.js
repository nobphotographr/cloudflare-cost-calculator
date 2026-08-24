import { estimateAll, isPricingStale, PRICING } from "./pricing.js";

const form = document.querySelector("#costForm");
const plan = document.querySelector("#plan");
let snapshotMode = "manual";
let activeBudget = Number(localStorage.getItem("cloud-cost-budget-usd")) || 0;

const presets = {
  photo: { monthlyUploadGb: 100, retentionDays: 3, averageFileGb: 2, downloadsPerFile: 3, workerRequests: 100_000, averageCpuMs: 5, rowsRead: 1_000_000, rowsWritten: 100_000, d1StorageGb: 0.5 },
  video: { monthlyUploadGb: 2_000, retentionDays: 7, averageFileGb: 20, downloadsPerFile: 3, workerRequests: 500_000, averageCpuMs: 7, rowsRead: 10_000_000, rowsWritten: 1_000_000, d1StorageGb: 2 },
  archive: { monthlyUploadGb: 500, retentionDays: 30, averageFileGb: 5, downloadsPerFile: 1, workerRequests: 250_000, averageCpuMs: 5, rowsRead: 5_000_000, rowsWritten: 500_000, d1StorageGb: 1 }
};

const demoSnapshot = {
  source: "demo",
  period: { start: "2026-08-01T00:00:00.000Z", end: "2026-08-24T00:00:00.000Z", label: "デモ / 今月24日分", daysObserved: 24, daysInMonth: 31 },
  r2: { storageGbMonth: 362.6, classA: 63800, classB: 253000, buckets: [] },
  workers: { requests: 1440000, cpuTimeP50Ms: 5.8, cpuTimeP99Ms: 19.4, scripts: [] },
  d1: { rowsRead: 21987000, rowsWritten: 975000, storageGb: 1.8, databases: [] },
  limitations: ["これは画面確認用の架空データです。", "Workers CPU料金はP50を中心値、P99を上限参考値として推定します。"]
};

const demoHistory = [
  { ...demoSnapshot, capturedOn: "2026-08-24" },
  {
    capturedOn: "2026-07-31",
    period: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-31T23:59:59.000Z", daysObserved: 31, daysInMonth: 31 },
    r2: { storageGbMonth: 410, classA: 71_000, classB: 290_000 },
    workers: { requests: 1_600_000, cpuTimeP50Ms: 5.5, cpuTimeP99Ms: 18 },
    d1: { rowsRead: 24_000_000, rowsWritten: 1_100_000, storageGb: 1.6 },
  },
];

const money = (value) => `$${(Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2)}`;
const compact = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1, notation: "compact" });
const value = (id) => Number(document.querySelector(`#${id}`).value) || 0;

function readInput() {
  return {
    exchangeRate: value("exchangeRate"),
    r2: {
      storageClass: document.querySelector("#storageClass").value,
      monthlyUploadGb: value("monthlyUploadGb"),
      retentionDays: value("retentionDays"),
      averageFileGb: value("averageFileGb"),
      downloadsPerFile: value("downloadsPerFile"),
      multipartPartMb: value("multipartPartMb"),
      existingStorageGbMonth: value("existingStorageGbMonth"),
      existingClassA: value("existingClassA"),
      existingClassB: value("existingClassB")
    },
    workers: { plan: plan.value, requests: value("workerRequests"), averageCpuMs: value("averageCpuMs") },
    d1: { plan: plan.value, rowsRead: value("rowsRead"), rowsWritten: value("rowsWritten"), storageGb: value("d1StorageGb") }
  };
}

function setBar(id, amount, total) {
  const el = document.querySelector(`#${id}`);
  el.style.width = total > 0 ? `${Math.max(amount > 0 ? 2 : 0, amount / total * 100)}%` : "0%";
}

function updateBudgetStatus(total) {
  const status = document.querySelector("#budgetStatus");
  if (!(activeBudget > 0)) {
    status.hidden = true;
    return;
  }
  const ratio = total / activeBudget;
  status.hidden = false;
  status.classList.toggle("is-watch", ratio >= 0.5 && ratio < 0.8);
  status.classList.toggle("is-danger", ratio >= 0.8);
  document.querySelector("#budgetRatio").textContent = `${Math.round(ratio * 100)}%`;
  document.querySelector("#budgetBar").style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`;
  document.querySelector("#budgetMessage").textContent = ratio >= 1
    ? `予算を${money(total - activeBudget)}超える見込みです。`
    : ratio >= 0.8
      ? `予算まで残り${money(activeBudget - total)}です。`
      : ratio >= 0.5
        ? "予算の50%を超えました。推移を確認してください。"
        : `予算まで${money(activeBudget - total)}の余裕があります。`;
}

function render() {
  const result = estimateAll(readInput());
  document.querySelector("#totalUsd").textContent = money(result.subtotal);
  document.querySelector("#totalYen").textContent = `約 ${Math.round(result.yen).toLocaleString("ja-JP")}円 / 月`;
  document.querySelector("#workersCost").textContent = money(result.workers.total);
  document.querySelector("#workerBaseCost").textContent = money(result.workers.subscriptionCost);
  document.querySelector("#workerUsageCost").textContent = money(result.workers.requestCost + result.workers.cpuCost);
  document.querySelector("#r2Cost").textContent = money(result.r2.total);
  document.querySelector("#r2StorageCost").textContent = money(result.r2.storageCost);
  document.querySelector("#r2OperationsCost").textContent = money(result.r2.classACost + result.r2.classBCost + result.r2.retrievalCost);
  document.querySelector("#d1Cost").textContent = money(result.d1.total);
  document.querySelector("#r2Usage").textContent = `${result.r2.storageGbMonth.toLocaleString("ja-JP", { maximumFractionDigits: 1 })} GB-mo`;
  document.querySelector("#fileCount").textContent = `約 ${Math.ceil(result.r2.fileCount).toLocaleString("ja-JP")}件`;
  document.querySelector("#workerCpu").textContent = `${compact.format(result.workers.cpuMs)} ms`;
  setBar("barWorkers", result.workers.total, result.subtotal);
  setBar("barR2", result.r2.total, result.subtotal);
  setBar("barD1", result.d1.total, result.subtotal);
  updateBudgetStatus(result.subtotal);

  const warningBox = document.querySelector("#warnings");
  warningBox.replaceChildren();
  warningBox.hidden = result.warnings.length === 0;
  result.warnings.forEach((warning) => {
    const p = document.createElement("p");
    p.textContent = warning;
    warningBox.append(p);
  });
}

function setValue(id, nextValue) {
  const normalized = typeof nextValue === "number" && Number.isFinite(nextValue)
    ? Number(nextValue.toPrecision(12))
    : nextValue;
  document.querySelector(`#${id}`).value = normalized;
}

function setConnectionState(connected) {
  const button = document.querySelector("#connectButton");
  button.dataset.connected = connected ? "true" : "false";
  button.textContent = connected ? "接続済み" : "Cloudflareに接続";
}

function renderResourceList(id, rows, describe) {
  const list = document.querySelector(`#${id}`);
  list.replaceChildren();
  if (rows.length === 0) {
    const item = document.createElement("li");
    item.className = "is-empty";
    item.textContent = "対象データなし";
    list.append(item);
    return;
  }
  rows.slice(0, 5).forEach((row) => {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    const amount = document.createElement("span");
    name.textContent = row.name ?? row.id;
    amount.textContent = describe(row);
    item.append(name, amount);
    list.append(item);
  });
}

function projectionFactor(snapshot) {
  const observed = Number(snapshot.period.daysObserved) || 30;
  const total = Number(snapshot.period.daysInMonth) || observed;
  return Math.max(1, total / observed);
}

function projectedSnapshot(snapshot) {
  const factor = projectionFactor(snapshot);
  return {
    ...snapshot,
    r2: {
      ...snapshot.r2,
      storageGbMonth: snapshot.r2.storageGbMonth * factor,
      classA: snapshot.r2.classA * factor,
      classB: snapshot.r2.classB * factor,
    },
    workers: { ...snapshot.workers, requests: snapshot.workers.requests * factor },
    d1: {
      ...snapshot.d1,
      rowsRead: snapshot.d1.rowsRead * factor,
      rowsWritten: snapshot.d1.rowsWritten * factor,
    },
  };
}

function estimateSnapshot(snapshot, cpuField = "cpuTimeP50Ms") {
  const projected = projectedSnapshot(snapshot);
  return estimateAll({
    exchangeRate: value("exchangeRate") || 150,
    r2: {
      storageClass: "standard",
      monthlyUploadGb: 0,
      retentionDays: 1,
      averageFileGb: 1,
      downloadsPerFile: 0,
      multipartPartMb: 100,
      existingStorageGbMonth: projected.r2.storageGbMonth,
      existingClassA: projected.r2.classA,
      existingClassB: projected.r2.classB,
    },
    workers: { plan: "paid", requests: projected.workers.requests, averageCpuMs: projected.workers[cpuField] },
    d1: { plan: "paid", rowsRead: projected.d1.rowsRead, rowsWritten: projected.d1.rowsWritten, storageGb: projected.d1.storageGb },
  });
}

function renderHistory(points) {
  const delta = document.querySelector("#historyDelta");
  const note = document.querySelector("#historyNote");
  if (!Array.isArray(points) || points.length === 0) {
    delta.textContent = "履歴を蓄積中";
    note.textContent = "翌月以降に比較できます";
    return;
  }
  const current = points[0];
  const previous = points.find((point) => point.period.start.slice(0, 7) !== current.period.start.slice(0, 7));
  if (!previous) {
    delta.textContent = "履歴を蓄積中";
    note.textContent = `${points.length}日分を保存済み`;
    return;
  }
  const currentTotal = estimateSnapshot(current).subtotal;
  const previousTotal = estimateSnapshot(previous).subtotal;
  const difference = currentTotal - previousTotal;
  const percent = previousTotal > 0 ? difference / previousTotal * 100 : 0;
  delta.textContent = `${difference >= 0 ? "+" : "−"}${money(Math.abs(difference))} (${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%)`;
  note.textContent = `${previous.period.start.slice(0, 7).replace("-", "年")}月比`;
}

function resourceCostRows(snapshot) {
  const factor = projectionFactor(snapshot);
  const r2Rate = PRICING.r2.standard;
  const workersRate = PRICING.workers.paid;
  const d1Rate = PRICING.d1.paid;
  return {
    buckets: (snapshot.r2.buckets ?? []).map((row) => ({
      ...row,
      cost: row.storageGbMonth * factor * r2Rate.storagePerGbMonth
        + row.classA * factor / 1_000_000 * r2Rate.classAPerMillion
        + row.classB * factor / 1_000_000 * r2Rate.classBPerMillion,
    })).sort((left, right) => right.cost - left.cost),
    scripts: (snapshot.workers.scripts ?? []).map((row) => ({
      ...row,
      cost: row.requests * factor / 1_000_000 * workersRate.requestsPerMillion
        + row.requests * factor * row.cpuTimeP50Ms / 1_000_000 * workersRate.cpuPerMillionMs,
    })).sort((left, right) => right.cost - left.cost),
    databases: (snapshot.d1.databases ?? []).map((row) => ({
      ...row,
      cost: row.rowsRead * factor / 1_000_000 * d1Rate.rowsReadPerMillion
        + row.rowsWritten * factor / 1_000_000 * d1Rate.rowsWrittenPerMillion
        + row.storageGb * d1Rate.storagePerGbMonth,
    })).sort((left, right) => right.cost - left.cost),
  };
}

function showConnectedSnapshot(snapshot, accountName = "デモアカウント") {
  snapshotMode = snapshot.source;
  const projected = projectedSnapshot(snapshot);
  plan.value = "paid";
  setValue("monthlyUploadGb", 0);
  setValue("retentionDays", 1);
  setValue("averageFileGb", 1);
  setValue("downloadsPerFile", 0);
  setValue("existingStorageGbMonth", projected.r2.storageGbMonth);
  setValue("existingClassA", projected.r2.classA);
  setValue("existingClassB", projected.r2.classB);
  setValue("workerRequests", projected.workers.requests);
  setValue("averageCpuMs", projected.workers.cpuTimeP50Ms);
  setValue("rowsRead", projected.d1.rowsRead);
  setValue("rowsWritten", projected.d1.rowsWritten);
  setValue("d1StorageGb", projected.d1.storageGb);
  document.querySelectorAll("[data-preset]").forEach((item) => item.classList.remove("is-active"));

  document.querySelector("#connectionTitle").textContent = snapshot.source === "demo" ? "デモデータを読み込みました" : accountName;
  document.querySelector("#connectionPeriod").textContent = snapshot.period.label;
  document.querySelector("#liveR2").textContent = `${snapshot.r2.storageGbMonth.toLocaleString("ja-JP", { maximumFractionDigits: 1 })} GB-mo`;
  document.querySelector("#liveWorkers").textContent = `${compact.format(snapshot.workers.requests)} req`;
  document.querySelector("#liveD1").textContent = `${compact.format(snapshot.d1.rowsRead)} 行`;
  const resources = resourceCostRows(snapshot);
  renderResourceList("bucketUsage", resources.buckets, (row) => `${money(row.cost)} / ${row.storageGbMonth.toLocaleString("ja-JP", { maximumFractionDigits: 1 })} GB-mo`);
  renderResourceList("scriptUsage", resources.scripts, (row) => `${money(row.cost)} / ${compact.format(row.requests)} req`);
  renderResourceList("databaseUsage", resources.databases, (row) => `${money(row.cost)} / ${compact.format(row.rowsRead)} reads`);
  const limitations = document.querySelector("#connectionLimitations");
  limitations.replaceChildren();
  (snapshot.limitations ?? []).forEach((message) => {
    const span = document.createElement("span");
    span.textContent = message;
    limitations.append(span);
  });
  document.querySelector("#connectionPanel").hidden = false;
  document.querySelector("#disconnectButton").hidden = snapshot.source === "demo";
  document.querySelector("#notificationControl").hidden = snapshot.source !== "cloudflare";
  setConnectionState(snapshot.source === "cloudflare");
  render();
  const center = estimateAll(readInput());
  const highInput = readInput();
  highInput.workers.averageCpuMs = projected.workers.cpuTimeP99Ms;
  const high = estimateAll(highInput);
  document.querySelector("#liveForecast").textContent = high.subtotal - center.subtotal >= 0.01
    ? `${money(center.subtotal)}–${money(high.subtotal)}`
    : money(center.subtotal);
}

async function fetchJson(url, options) {
  const response = await fetch(url, { ...options, headers: { "content-type": "application/json", ...(options?.headers ?? {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `HTTP ${response.status}`);
    error.code = payload.error;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function loadUsage() {
  const snapshot = await fetchJson("/api/usage");
  const accountName = document.querySelector("#accountSelect").selectedOptions[0]?.textContent || "Cloudflareアカウント";
  showConnectedSnapshot(snapshot, accountName);
  await loadBudget();
  await loadHistory();
  await loadNotifications();
}

async function loadBudget() {
  if (snapshotMode !== "cloudflare") {
    document.querySelector("#budgetUsd").value = activeBudget || "";
    render();
    return;
  }
  try {
    const result = await fetchJson("/api/budget");
    activeBudget = result.budget?.monthlyBudgetUsd ?? 0;
    document.querySelector("#budgetUsd").value = activeBudget || "";
    render();
  } catch { /* A failed budget request must not hide usage data. */ }
}

async function loadHistory() {
  if (snapshotMode !== "cloudflare") return;
  try {
    const result = await fetchJson("/api/history?limit=400");
    renderHistory((result.points ?? []).map((point) => ({ ...point, period: { start: point.periodStart, end: point.periodEnd, daysObserved: point.daysObserved, daysInMonth: point.daysInMonth } })));
  } catch { /* History is optional during the first connection. */ }
}

function renderNotificationHistory(events) {
  const history = document.querySelector("#notificationHistory");
  const latest = Array.isArray(events) ? events[0] : null;
  if (!latest) {
    history.textContent = "通知履歴なし";
    return;
  }
  const label = latest.status === "sent" ? "送信済み" : "再送待ち";
  history.textContent = `${label}: ${latest.monthKey} / ${Math.round(latest.thresholdRatio * 100)}% / ${money(latest.estimateUsd)}`;
}

async function loadNotifications() {
  if (snapshotMode !== "cloudflare") return;
  try {
    const [settingsResult, historyResult] = await Promise.all([
      fetchJson("/api/notifications/webhook"),
      fetchJson("/api/notifications/history?limit=5"),
    ]);
    const settings = settingsResult.settings ?? {};
    document.querySelector("#notificationEnabled").checked = Boolean(settings.enabled);
    document.querySelector("#notificationWebhook").placeholder = settings.webhookDisplay || "https://hooks.example.com/...";
    document.querySelector("#notificationStatus").textContent = settings.webhookConfigured
      ? `設定済み: ${settings.webhookDisplay}`
      : "";
    renderNotificationHistory(historyResult.events ?? []);
  } catch {
    document.querySelector("#notificationStatus").textContent = "通知設定を読み込めませんでした";
  }
}

async function loadSession() {
  try {
    const session = await fetchJson("/api/session");
    if (!session.connected) return;
    const select = document.querySelector("#accountSelect");
    select.replaceChildren();
    session.accounts.forEach((account) => {
      const option = document.createElement("option");
      option.value = account.id;
      option.textContent = account.name;
      option.selected = session.selectedAccount?.id === account.id;
      select.append(option);
    });
    document.querySelector("#accountPicker").hidden = session.accounts.length <= 1;
    if (!session.selectedAccount && session.accounts.length > 1) {
      setConnectionState(true);
      document.querySelector("#connectionPanel").hidden = false;
      document.querySelector("#notificationControl").hidden = true;
      document.querySelector("#connectionTitle").textContent = "対象アカウントを選択してください";
      document.querySelector("#connectionPeriod").textContent = "接続済み";
      return;
    }
    await loadUsage();
  } catch {
    // A static preview has no API. Manual estimation remains fully available.
  }
}

form.addEventListener("input", render);

document.querySelectorAll("[data-preset]").forEach((button) => {
  button.addEventListener("click", () => {
    const preset = presets[button.dataset.preset];
    Object.entries(preset).forEach(([id, presetValue]) => {
      document.querySelector(`#${id}`).value = presetValue;
    });
    document.querySelectorAll("[data-preset]").forEach((item) => item.classList.toggle("is-active", item === button));
    render();
  });
});

document.querySelector("#resetButton").addEventListener("click", () => {
  form.reset();
  document.querySelectorAll("[data-preset]").forEach((item) => item.classList.remove("is-active"));
  render();
});

const dialog = document.querySelector("#connectDialog");
document.querySelector("#connectButton").addEventListener("click", (event) => {
  if (event.currentTarget.dataset.connected === "true") {
    document.querySelector("#connectionPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  dialog.showModal();
});
document.querySelector("#closeDialog").addEventListener("click", () => dialog.close());
document.querySelector("#oauthConnectButton").addEventListener("click", async () => {
  const message = document.querySelector("#dialogMessage");
  message.hidden = true;
  try {
    const result = await fetchJson("/api/connect/start");
    window.location.assign(result.authorizationUrl);
  } catch (error) {
    message.textContent = error.code === "oauth_not_configured"
      ? "OAuth clientの設定後に利用できます。現在はデモデータで画面を確認できます。"
      : "Cloudflareへの接続を開始できませんでした。時間をおいて再度お試しください。";
    message.hidden = false;
  }
});
document.querySelector("#demoButton").addEventListener("click", async () => {
  let snapshot = demoSnapshot;
  try { snapshot = await fetchJson("/api/demo/usage"); } catch { /* Static preview fallback. */ }
  showConnectedSnapshot(snapshot);
  await loadBudget();
  renderHistory(demoHistory);
  dialog.close();
  document.querySelector("#connectionPanel").scrollIntoView({ behavior: "smooth", block: "start" });
});
document.querySelector("#refreshUsage").addEventListener("click", async () => {
  try { await loadUsage(); } catch { /* Keep the last successful snapshot visible. */ }
});
document.querySelector("#accountSelect").addEventListener("change", async (event) => {
  try {
    await fetchJson("/api/session/account", { method: "POST", body: JSON.stringify({ accountId: event.target.value }) });
    await loadUsage();
  } catch { /* Keep account selector available for retry. */ }
});
document.querySelector("#saveBudget").addEventListener("click", async () => {
  const amount = value("budgetUsd");
  const status = document.querySelector("#budgetSaveStatus");
  status.textContent = "保存中…";
  try {
    if (snapshotMode === "cloudflare") {
      const result = await fetchJson("/api/budget", { method: "POST", body: JSON.stringify({ monthlyBudgetUsd: amount }) });
      activeBudget = result.budget.monthlyBudgetUsd;
    } else {
      activeBudget = amount;
      if (amount > 0) localStorage.setItem("cloud-cost-budget-usd", String(amount));
      else localStorage.removeItem("cloud-cost-budget-usd");
    }
    status.textContent = amount > 0 ? "保存しました" : "予算を解除しました";
    render();
  } catch {
    status.textContent = "保存できませんでした";
  }
});
document.querySelector("#saveNotification").addEventListener("click", async () => {
  const enabled = document.querySelector("#notificationEnabled").checked;
  const webhookUrl = document.querySelector("#notificationWebhook").value;
  const status = document.querySelector("#notificationStatus");
  status.textContent = enabled ? "検証中…" : "保存中…";
  try {
    const result = await fetchJson("/api/notifications/webhook", { method: "POST", body: JSON.stringify({ enabled, webhookUrl }) });
    const settings = result.settings ?? {};
    document.querySelector("#notificationWebhook").value = "";
    document.querySelector("#notificationWebhook").placeholder = settings.webhookDisplay || "https://hooks.example.com/...";
    status.textContent = settings.enabled ? `保存しました: ${settings.webhookDisplay}` : "通知を無効化しました";
  } catch (error) {
    status.textContent = error.message || "通知設定を保存できませんでした";
  }
});
document.querySelector("#disconnectButton").addEventListener("click", async () => {
  try { await fetchJson("/api/disconnect", { method: "POST" }); } catch { /* Hide local state even if revoke is unavailable. */ }
  document.querySelector("#connectionPanel").hidden = true;
  setConnectionState(false);
  snapshotMode = "manual";
  activeBudget = 0;
  form.reset();
  render();
});
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

if (isPricingStale()) {
  const pricingDate = document.querySelector(".pricing-date");
  pricingDate.classList.add("is-stale");
  pricingDate.title = "料金表の最終確認から90日以上経過しています。公式料金を確認してください。";
  pricingDate.insertAdjacentText("beforeend", " / 要確認");
}

render();
loadSession();
