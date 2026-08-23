import { estimateAll, isPricingStale } from "./pricing.js";

const form = document.querySelector("#costForm");
const plan = document.querySelector("#plan");

const presets = {
  photo: { monthlyUploadGb: 100, retentionDays: 3, averageFileGb: 2, downloadsPerFile: 3, workerRequests: 100_000, averageCpuMs: 5, rowsRead: 1_000_000, rowsWritten: 100_000, d1StorageGb: 0.5 },
  video: { monthlyUploadGb: 2_000, retentionDays: 7, averageFileGb: 20, downloadsPerFile: 3, workerRequests: 500_000, averageCpuMs: 7, rowsRead: 10_000_000, rowsWritten: 1_000_000, d1StorageGb: 2 },
  archive: { monthlyUploadGb: 500, retentionDays: 30, averageFileGb: 5, downloadsPerFile: 1, workerRequests: 250_000, averageCpuMs: 5, rowsRead: 5_000_000, rowsWritten: 500_000, d1StorageGb: 1 }
};

const demoSnapshot = {
  source: "demo",
  period: { label: "デモ / 直近30日" },
  r2: { storageGbMonth: 468.4, classA: 82400, classB: 326800 },
  workers: { requests: 1860000, cpuTimeP50Ms: 5.8, cpuTimeP99Ms: 19.4 },
  d1: { rowsRead: 28400000, rowsWritten: 1260000, storageGb: 1.8 },
  limitations: ["これは画面確認用の架空データです。", "Workers CPU料金はP50を中心値、P99を上限参考値として推定します。"]
};

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
  document.querySelector(`#${id}`).value = nextValue;
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

function showConnectedSnapshot(snapshot, accountName = "デモアカウント") {
  plan.value = "paid";
  setValue("monthlyUploadGb", 0);
  setValue("retentionDays", 1);
  setValue("averageFileGb", 1);
  setValue("downloadsPerFile", 0);
  setValue("existingStorageGbMonth", snapshot.r2.storageGbMonth);
  setValue("existingClassA", snapshot.r2.classA);
  setValue("existingClassB", snapshot.r2.classB);
  setValue("workerRequests", snapshot.workers.requests);
  setValue("averageCpuMs", snapshot.workers.cpuTimeP50Ms);
  setValue("rowsRead", snapshot.d1.rowsRead);
  setValue("rowsWritten", snapshot.d1.rowsWritten);
  setValue("d1StorageGb", snapshot.d1.storageGb);
  document.querySelectorAll("[data-preset]").forEach((item) => item.classList.remove("is-active"));

  document.querySelector("#connectionTitle").textContent = snapshot.source === "demo" ? "デモデータを読み込みました" : accountName;
  document.querySelector("#connectionPeriod").textContent = snapshot.period.label;
  document.querySelector("#liveR2").textContent = `${snapshot.r2.storageGbMonth.toLocaleString("ja-JP", { maximumFractionDigits: 1 })} GB-mo`;
  document.querySelector("#liveWorkers").textContent = `${compact.format(snapshot.workers.requests)} req`;
  document.querySelector("#liveD1").textContent = `${compact.format(snapshot.d1.rowsRead)} 行`;
  renderResourceList("bucketUsage", snapshot.r2.buckets ?? [], (row) => `${row.storageGbMonth.toLocaleString("ja-JP", { maximumFractionDigits: 1 })} GB-mo`);
  renderResourceList("scriptUsage", snapshot.workers.scripts ?? [], (row) => `${compact.format(row.requests)} req / CPU P50 ${row.cpuTimeP50Ms.toLocaleString("ja-JP", { maximumFractionDigits: 1 })} ms`);
  renderResourceList("databaseUsage", snapshot.d1.databases ?? [], (row) => `${compact.format(row.rowsRead)} reads / ${row.storageGb.toLocaleString("ja-JP", { maximumFractionDigits: 1 })} GB`);
  const limitations = document.querySelector("#connectionLimitations");
  limitations.replaceChildren();
  (snapshot.limitations ?? []).forEach((message) => {
    const span = document.createElement("span");
    span.textContent = message;
    limitations.append(span);
  });
  document.querySelector("#connectionPanel").hidden = false;
  document.querySelector("#disconnectButton").hidden = snapshot.source === "demo";
  render();
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
      document.querySelector("#connectionPanel").hidden = false;
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
document.querySelector("#connectButton").addEventListener("click", () => dialog.showModal());
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
document.querySelector("#disconnectButton").addEventListener("click", async () => {
  try { await fetchJson("/api/disconnect", { method: "POST" }); } catch { /* Hide local state even if revoke is unavailable. */ }
  document.querySelector("#connectionPanel").hidden = true;
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
