import { getRequest } from "../../shared/db.js";
import { escapeHtml, formatBytes, formatClock, formatDuration } from "../../shared/utils.js";
import { generate } from "../../shared/exporters/curl.js";
import { bodyHtml, headerTable, kvList, methodBadge, statusBadge } from "./helpers.js";
import { openExportModal, openReplayModal } from "./modals.js";

export async function render(container, { sessionId, requestId }) {
  const record = await getRequest(requestId);
  if (!record) {
    container.innerHTML = '<div class="empty-state">请求不存在</div>';
    return;
  }
  const url = parseUrlSafe(record.url);
  const totalMs = record.totalMs || 0;
  const ttfbPct = totalMs ? ((record.ttfbMs || 0) / totalMs) * 100 : 0;
  const downloadPct = totalMs ? ((record.downloadMs || 0) / totalMs) * 100 : 0;

  container.innerHTML = `
    <div class="page-head">
      <h1>${methodBadge(record.method)} <span class="req-title-path">${escapeHtml(record.path)}</span></h1>
      <div class="page-actions">
        <button id="btn-copy-curl" class="btn">复制 curl</button>
        <button id="btn-replay" class="btn primary">回放此请求</button>
        <button id="btn-export" class="btn">导出</button>
        <a class="btn ghost" href="#/session/${sessionId}">← 返回会话</a>
      </div>
    </div>

    <div class="detail-grid">
      <div class="detail-section">
        <h3>请求信息</h3>
        ${kvList([
          ["URL", record.url],
          ["方法", record.method],
          ["状态", record.statusCode ?? "-"],
          ["资源类型", record.resourceType],
          ["发起方式", record.initiatorType],
          ["来源页面", record.pageUrl],
          ["发起时间", formatClock(record.wallTime)],
          ["响应大小", formatBytes(record.sizeBytes)],
        ])}
      </div>
      <div class="detail-section">
        <h3>耗时分解</h3>
        <div class="timing-bar">
          <span class="timing-seg timing-ttfb" style="width:${ttfbPct}%"></span>
          <span class="timing-seg timing-download" style="width:${downloadPct}%"></span>
        </div>
        <div class="timing-legend">
          <span><i class="legend-dot timing-ttfb"></i>TTFB ${formatDuration(record.ttfbMs)}</span>
          <span><i class="legend-dot timing-download"></i>下载 ${formatDuration(record.downloadMs)}</span>
          <span>总计 ${formatDuration(totalMs)}</span>
        </div>
      </div>
    </div>

    <div class="tabs" id="detail-tabs">
      <button class="tab active" data-tab="query">参数 (${record.query?.length || 0})</button>
      <button class="tab" data-tab="req-headers">请求头 (${record.requestHeaders?.length || 0})</button>
      <button class="tab" data-tab="req-body">请求体</button>
      <button class="tab" data-tab="res-headers">响应头 (${record.responseHeaders?.length || 0})</button>
      <button class="tab" data-tab="res-body">响应体</button>
      <button class="tab" data-tab="meta">元数据</button>
    </div>
    <div id="tab-content" class="tab-content"></div>
  `;

  const tabs = {
    query: kvList((record.query || []).map((item) => [item.name, item.value])),
    "req-headers": headerTable(record.requestHeaders),
    "req-body": bodyHtml(record.requestBody),
    "res-headers": headerTable(record.responseHeaders),
    "res-body": bodyHtml(record.responseBody),
    meta: kvList([
      ["协议", record.protocol],
      ["域名", record.host],
      ["端口", record.port],
      ["路径", record.path],
      ["完整 URL", record.url],
      ["frameId", record.frameId],
      ["requestId", record.requestId],
      ["会话", record.sessionId],
      ["序号", record.seq],
      ["错误信息", record.errorText],
    ]),
  };
  const content = container.querySelector("#tab-content");
  const showTab = (name) => {
    container.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
    content.innerHTML = tabs[name];
  };
  container.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => showTab(tab.dataset.tab));
  });
  showTab("query");

  container.querySelector("#btn-copy-curl").addEventListener("click", async () => {
    await navigator.clipboard.writeText(generate([record]));
    const button = container.querySelector("#btn-copy-curl");
    button.textContent = "已复制";
    setTimeout(() => (button.textContent = "复制 curl"), 1500);
  });

  container.querySelector("#btn-replay").addEventListener("click", () => {
    openReplayModal({ requestIds: [record.id], records: [record] });
  });

  container.querySelector("#btn-export").addEventListener("click", () => {
    openExportModal({ requestIds: [record.id], sessionName: `${record.method} ${record.path}` });
  });
}

function parseUrlSafe(raw) {
  try {
    return new URL(raw);
  } catch {
    return { pathname: raw };
  }
}
