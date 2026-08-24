import { allRequests, distinctHosts, getSession, sessionStats } from "../../shared/db.js";
import { escapeHtml, formatBytes, formatDuration } from "../../shared/utils.js";
import { methodBadge, statusBadge } from "./helpers.js";
import { openExportModal, openReplayModal } from "./modals.js";

const PAGE_SIZE = 200;

export async function render(container, { sessionId }) {
  const session = await getSession(sessionId);
  if (!session) {
    container.innerHTML = '<div class="empty-state">会话不存在</div>';
    return;
  }
  const records = await allRequests(sessionId);
  const hosts = await distinctHosts(sessionId);
  const stats = sessionStats(records);

  container.innerHTML = `
    <div class="page-head">
      <h1>${escapeHtml(session.name)}</h1>
      <div class="page-actions">
        <button id="btn-replay-all" class="btn primary">回放全部</button>
        <button id="btn-export-session" class="btn">导出会话</button>
        <a class="btn ghost" href="#/stats/${sessionId}">统计</a>
        <a class="btn ghost" href="#/sessions">← 返回</a>
      </div>
    </div>
    <div class="stat-cards">
      ${statCard("请求", stats.requestCount)}
      ${statCard("API", stats.apiCount)}
      ${statCard("错误", stats.errorCount)}
      ${statCard("平均耗时", formatDuration(stats.avgMs))}
      ${statCard("最大耗时", formatDuration(stats.maxMs))}
      ${statCard("大小", formatBytes(stats.sizeBytes))}
    </div>
    <div class="filter-bar">
      <select id="filter-method">
        <option value="">全部方法</option>
        ${["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((m) => `<option value="${m}">${m}</option>`).join("")}
      </select>
      <select id="filter-status">
        <option value="">全部状态</option>
        ${["2xx", "3xx", "4xx", "5xx", "other"].map((s) => `<option value="${s}">${s}</option>`).join("")}
      </select>
      <select id="filter-host">
        <option value="">全部域名</option>
        ${hosts.map((host) => `<option value="${escapeHtml(host)}">${escapeHtml(host)}</option>`).join("")}
      </select>
      <input id="filter-search" type="search" placeholder="搜索 URL / 路径…">
      <div class="segmented">
        <button id="view-list" class="segment active">列表</button>
        <button id="view-waterfall" class="segment">瀑布</button>
      </div>
    </div>
    <div id="request-area" class="request-area"></div>
  `;

  const context = {
    container,
    records,
    sessionId,
    filters: { method: "", status: "", host: "", search: "" },
    mode: "list",
    shown: PAGE_SIZE,
    sort: { key: "wallTime", dir: "asc" },
  };
  bindFilters(container, context);
  renderRequestArea(container, context);
  bindActions(container, context);
}

function statCard(label, value) {
  return `<div class="stat-card"><div class="stat-card-num">${escapeHtml(String(value))}</div><div class="stat-card-label">${label}</div></div>`;
}

function bindFilters(container, context) {
  const apply = () => {
    context.shown = PAGE_SIZE;
    renderRequestArea(container, context);
  };
  container.querySelector("#filter-method").addEventListener("change", (event) => {
    context.filters.method = event.target.value;
    apply();
  });
  container.querySelector("#filter-status").addEventListener("change", (event) => {
    context.filters.status = event.target.value;
    apply();
  });
  container.querySelector("#filter-host").addEventListener("change", (event) => {
    context.filters.host = event.target.value;
    apply();
  });
  container.querySelector("#filter-search").addEventListener("input", (event) => {
    context.filters.search = event.target.value;
    apply();
  });
  container.querySelector("#view-list").addEventListener("click", () => {
    context.mode = "list";
    container.querySelector("#view-list").classList.add("active");
    container.querySelector("#view-waterfall").classList.remove("active");
    renderRequestArea(container, context);
  });
  container.querySelector("#view-waterfall").addEventListener("click", () => {
    context.mode = "waterfall";
    container.querySelector("#view-waterfall").classList.add("active");
    container.querySelector("#view-list").classList.remove("active");
    renderRequestArea(container, context);
  });
}

function filteredRecords(context) {
  const { method, status, host, search } = context.filters;
  const needle = search.toLowerCase();
  const records = context.records.filter((record) => {
    if (method && record.method !== method) return false;
    if (status) {
      const bucket = record.statusCode >= 500 ? "5xx" : record.statusCode >= 400 ? "4xx" : record.statusCode >= 300 ? "3xx" : record.statusCode >= 200 ? "2xx" : "other";
      if (bucket !== status) return false;
    }
    if (host && record.host !== host) return false;
    if (search && !`${record.method} ${record.url}`.toLowerCase().includes(needle)) return false;
    return true;
  });
  const { key, dir } = context.sort;
  const factor = dir === "asc" ? 1 : -1;
  return [...records].sort((a, b) => {
    let va;
    let vb;
    if (key === "path") {
      va = `${a.host}${a.path}`;
      vb = `${b.host}${b.path}`;
    } else {
      va = a[key];
      vb = b[key];
    }
    if (va === vb) return 0;
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    if (typeof va === "string") return va.localeCompare(vb) * factor;
    return (va - vb) * factor;
  });
}

function sortableHeader(key, label, context) {
  const { sort } = context;
  const arrow = sort.key === key ? (sort.dir === "asc" ? "▲" : "▼") : "";
  return `<button class="sortable" data-sort="${key}">${label}${arrow ? `<span class="sort-arrow">${arrow}</span>` : ""}</button>`;
}

function renderRequestArea(container, context) {
  const area = container.querySelector("#request-area");
  const records = filteredRecords(context);
  if (!records.length) {
    area.innerHTML = '<div class="empty-state">没有符合条件的请求</div>';
    return;
  }
  if (context.mode === "waterfall") {
    area.innerHTML = renderWaterfall(records);
    area.querySelectorAll(".waterfall-row[data-id]").forEach((row) => {
      row.addEventListener("click", () => {
        location.hash = `#/request/${context.sessionId}/${row.dataset.id}`;
      });
    });
    return;
  }
  const slice = records.slice(0, context.shown);
  const totalMs = records.reduce((sum, record) => sum + (record.totalMs || 0), 0);
  area.innerHTML = `
    <div class="request-table">
      <div class="request-row header">
        <span class="req-time">${sortableHeader("wallTime", "时间", context)}</span>
        <span class="req-method">${sortableHeader("method", "方法", context)}</span>
        <span class="req-status">${sortableHeader("statusCode", "状态", context)}</span>
        <span class="req-path">${sortableHeader("path", "路径", context)}</span>
        <span class="req-duration">${sortableHeader("totalMs", "耗时", context)}</span>
        <span class="req-size">${sortableHeader("sizeBytes", "大小", context)}</span>
      </div>
      ${slice.map(requestRow).join("")}
    </div>
    ${context.shown < records.length ? `<div class="load-more-wrap"><button id="btn-load-more" class="btn">加载更多（${records.length - context.shown} 条）</button></div>` : `<div class="list-footer">共 ${records.length} 条 · 总耗时 ${formatDuration(totalMs)}</div>`}
  `;
  area.querySelectorAll(".request-row.header button[data-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sort;
      if (context.sort.key === key) {
        context.sort.dir = context.sort.dir === "asc" ? "desc" : "asc";
      } else {
        context.sort = { key, dir: "asc" };
      }
      renderRequestArea(container, context);
    });
  });
  const loadMore = area.querySelector("#btn-load-more");
  loadMore?.addEventListener("click", () => {
    context.shown += PAGE_SIZE;
    renderRequestArea(container, context);
  });
  area.querySelectorAll(".request-row[data-id]").forEach((row) => {
    row.addEventListener("click", () => {
      location.hash = `#/request/${context.sessionId}/${row.dataset.id}`;
    });
  });
}

function requestRow(record) {
  return `
    <div class="request-row" data-id="${record.id}">
      <span class="req-time">${new Date(record.wallTime || 0).toLocaleTimeString()}</span>
      <span class="req-method">${methodBadge(record.method)}</span>
      <span class="req-status">${statusBadge(record.statusCode)}</span>
      <span class="req-path" title="${escapeHtml(record.url)}">${escapeHtml(record.host)}${escapeHtml(record.path)}</span>
      <span class="req-duration">${formatDuration(record.totalMs)}</span>
      <span class="req-size">${formatBytes(record.sizeBytes)}</span>
    </div>`;
}

function renderWaterfall(records) {
  const cap = records.slice(0, 500);
  const base = cap[0]?.timestamp ?? 0;
  const last = cap[cap.length - 1];
  const spanMs = Math.max(1, (last.timestamp - base) * 1000 + (last.totalMs || 0));
  const rows = cap.map((record) => {
    const offsetMs = Math.max(0, (record.timestamp - base) * 1000);
    const totalMs = record.totalMs || 0;
    const ttfbMs = record.ttfbMs || 0;
    const leftPct = Math.min(100, (offsetMs / spanMs) * 100);
    const widthPct = Math.max(0.4, Math.min(100 - leftPct, (totalMs / spanMs) * 100));
    const ttfbPct = totalMs ? (ttfbMs / totalMs) * 100 : 0;
    return `
      <div class="waterfall-row" data-id="${record.id}" title="${escapeHtml(record.url)}">
        <div class="wf-label">${methodBadge(record.method)}<span class="wf-path">${escapeHtml(record.path)}</span></div>
        <div class="wf-track">
          <div class="wf-bar" style="left:${leftPct}%;width:${widthPct}%">
            <span class="wf-seg wf-ttfb" style="width:${ttfbPct}%"></span>
            <span class="wf-seg wf-download"></span>
          </div>
          <span class="wf-time">${formatDuration(totalMs)}</span>
        </div>
      </div>`;
  });
  return `
    <div class="waterfall">
      ${rows.join("")}
      ${records.length > 500 ? '<div class="list-footer">仅显示前 500 条，请使用筛选缩小范围</div>' : ""}
    </div>`;
}

function bindActions(container, context) {
  container.querySelector("#btn-replay-all").addEventListener("click", () => {
    openReplayModal({ sessionId: context.sessionId, records: context.records });
  });
  container.querySelector("#btn-export-session").addEventListener("click", () => {
    openExportModal({ sessionId: context.sessionId, sessionName: container.querySelector("h1").textContent });
  });
}
