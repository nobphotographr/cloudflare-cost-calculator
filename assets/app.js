import { estimateAll, isPricingStale } from "./pricing.js";

const form = document.querySelector("#costForm");
const plan = document.querySelector("#plan");

const presets = {
  photo: { monthlyUploadGb: 100, retentionDays: 3, averageFileGb: 2, downloadsPerFile: 3, workerRequests: 100_000, averageCpuMs: 5, rowsRead: 1_000_000, rowsWritten: 100_000, d1StorageGb: 0.5 },
  video: { monthlyUploadGb: 2_000, retentionDays: 7, averageFileGb: 20, downloadsPerFile: 3, workerRequests: 500_000, averageCpuMs: 7, rowsRead: 10_000_000, rowsWritten: 1_000_000, d1StorageGb: 2 },
  archive: { monthlyUploadGb: 500, retentionDays: 30, averageFileGb: 5, downloadsPerFile: 1, workerRequests: 250_000, averageCpuMs: 5, rowsRead: 5_000_000, rowsWritten: 500_000, d1StorageGb: 1 }
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
document.querySelector("#dialogAction").addEventListener("click", () => dialog.close());
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
