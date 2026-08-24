import { allRequests, getSession, sessionStats } from "../../shared/db.js";
import { escapeHtml, formatBytes, formatDuration } from "../../shared/utils.js";
import { methodBadge, statusBadge } from "./helpers.js";

const PALETTE = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#64748b"];

export async function render(container, { sessionId }) {
  const session = await getSession(sessionId);
  if (!session) {
    container.innerHTML = '<div class="empty-state">会话不存在</div>';
    return;
  }
  const records = await allRequests(sessionId);
  const stats = sessionStats(records);
  apiList.length = 0;
  apiList.push(...stats.apis.values());

  container.innerHTML = `
    <div class="page-head">
      <h1>API 统计 · ${escapeHtml(session.name)}</h1>
      <div class="page-actions">
        <a class="btn ghost" href="#/session/${sessionId}">← 返回会话</a>
      </div>
    </div>
    <div class="stat-cards">
      ${statCard("请求", stats.requestCount)}
      ${statCard("去重 API", stats.apiCount)}
      ${statCard("错误", stats.errorCount)}
      ${statCard("平均耗时", formatDuration(stats.avgMs))}
      ${statCard("最大耗时", formatDuration(stats.maxMs))}
      ${statCard("数据量", formatBytes(stats.sizeBytes))}
    </div>
    <div class="chart-grid">
      <div class="chart-card"><h3>方法分布</h3><div id="chart-method" class="chart"></div></div>
      <div class="chart-card"><h3>状态码分布</h3><div id="chart-status" class="chart"></div></div>
      <div class="chart-card wide"><h3>响应时间趋势（按请求顺序）</h3><div id="chart-trend" class="chart"></div></div>
      <div class="chart-card"><h3>调用次数 TOP 10</h3><div id="chart-top-count" class="chart"></div></div>
      <div class="chart-card"><h3>平均耗时 TOP 10</h3><div id="chart-top-duration" class="chart"></div></div>
    </div>
    <div class="api-table-wrap">
      <h3>API 明细（${stats.apiCount}）</h3>
      <table class="kv-table api-table">
        <thead>
          <tr>
            <th>${apiHeader("method", "方法")}</th>
            <th>${apiHeader("path", "路径")}</th>
            <th>${apiHeader("count", "次数")}</th>
            <th>${apiHeader("errors", "错误")}</th>
            <th>${apiHeader("avg", "平均")}</th>
            <th>${apiHeader("max", "最大")}</th>
            <th>${apiHeader("lastStatus", "最近状态")}</th>
          </tr>
        </thead>
        <tbody id="api-tbody">${renderApiRows()}</tbody>
      </table>
    </div>
  `;

  drawCharts(stats);
  bindApiSort(container);
}

const apiList = [];

function apiHeader(key, label) {
  const arrow = apiSort.key === key ? (apiSort.dir === "asc" ? "▲" : "▼") : "";
  return `<button class="sortable" data-sort="${key}">${label}${arrow ? `<span class="sort-arrow">${arrow}</span>` : ""}</button>`;
}

function renderApiRows() {
  return sortedApis().map(apiRow).join("");
}

function sortedApis() {
  const { key, dir } = apiSort;
  const factor = dir === "asc" ? 1 : -1;
  return [...apiList].sort((a, b) => {
    let va;
    let vb;
    if (key === "avg") {
      va = a.count ? a.totalMs / a.count : 0;
      vb = b.count ? b.totalMs / b.count : 0;
    } else if (key === "path") {
      va = `${a.host}${a.path}`;
      vb = `${b.host}${b.path}`;
    } else {
      va = a[key];
      vb = b[key];
    }
    if (va === vb) return 0;
    return (va < vb ? -1 : 1) * factor;
  });
}

function bindApiSort(container) {
  const table = container.querySelector(".api-table");
  table?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-sort]");
    if (!button) return;
    const key = button.dataset.sort;
    if (apiSort.key === key) {
      apiSort.dir = apiSort.dir === "asc" ? "desc" : "asc";
    } else {
      apiSort = { key, dir: "asc" };
    }
    table.querySelector("thead").innerHTML = `
      <tr>
        <th>${apiHeader("method", "方法")}</th>
        <th>${apiHeader("path", "路径")}</th>
        <th>${apiHeader("count", "次数")}</th>
        <th>${apiHeader("errors", "错误")}</th>
        <th>${apiHeader("avg", "平均")}</th>
        <th>${apiHeader("max", "最大")}</th>
        <th>${apiHeader("lastStatus", "最近状态")}</th>
      </tr>`;
    container.querySelector("#api-tbody").innerHTML = renderApiRows();
  });
}

let apiSort = { key: "count", dir: "desc" };

function statCard(label, value) {
  return `<div class="stat-card"><div class="stat-card-num">${escapeHtml(String(value))}</div><div class="stat-card-label">${label}</div></div>`;
}

function apiRow(api) {
  const avg = api.count ? formatDuration(Math.round(api.totalMs / api.count)) : "-";
  return `
    <tr>
      <td>${methodBadge(api.method)}</td>
      <td class="api-path" title="${escapeHtml(api.host)}${escapeHtml(api.path)}">${escapeHtml(api.host)}${escapeHtml(api.path)}</td>
      <td>${api.count}</td>
      <td>${api.errors || "-"}</td>
      <td>${avg}</td>
      <td>${formatDuration(api.maxMs)}</td>
      <td>${statusBadge(api.lastStatus)}</td>
    </tr>`;
}

function drawCharts(stats) {
  const echarts = window.echarts;
  if (!echarts) return;
  const charts = [];

  const pieOption = (data) => ({
    tooltip: { trigger: "item" },
    series: [{ type: "pie", radius: ["42%", "68%"], data, label: { color: "#e2e8f0" }, itemStyle: { borderColor: "#0f172a", borderWidth: 2 } }],
    color: PALETTE,
  });

  charts.push(echarts.init(document.getElementById("chart-method")));
  charts[0].setOption(pieOption(Object.entries(stats.methods).map(([name, value]) => ({ name, value }))));

  charts.push(echarts.init(document.getElementById("chart-status")));
  charts[1].setOption(pieOption(Object.entries(stats.statuses).map(([name, value]) => ({ name, value }))));

  charts.push(echarts.init(document.getElementById("chart-trend")));
  charts[2].setOption({
    tooltip: { trigger: "axis" },
    grid: { left: 50, right: 16, top: 20, bottom: 30 },
    xAxis: { type: "category", data: stats.timeline.map((point) => point.index), name: "请求序号", axisLabel: { color: "#94a3b8" }, axisLine: { lineStyle: { color: "#334155" } } },
    yAxis: { type: "value", name: "ms", axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "#1e293b" } } },
    series: [{ type: "line", data: stats.timeline.map((point) => point.totalMs), showSymbol: false, lineStyle: { color: "#3b82f6" }, areaStyle: { color: "rgba(59,130,246,0.15)" }, markLine: { data: [{ type: "average" }], lineStyle: { color: "#f59e0b" } } }],
  });

  const apis = [...stats.apis.values()];
  const topCount = [...apis].sort((a, b) => b.count - a.count).slice(0, 10);
  charts.push(echarts.init(document.getElementById("chart-top-count")));
  charts[3].setOption(barOption(topCount, "count", "次数"));

  const topDuration = [...apis]
    .filter((api) => api.count > 0)
    .sort((a, b) => b.totalMs / b.count - a.totalMs / a.count)
    .slice(0, 10);
  charts.push(echarts.init(document.getElementById("chart-top-duration")));
  charts[4].setOption(barOption(topDuration, "avg", "平均耗时 (ms)"));

  window.addEventListener("resize", () => charts.forEach((chart) => chart.resize()));
}

function barOption(items, valueKey, yName) {
  const value = (item) => (valueKey === "avg" ? Math.round(item.totalMs / item.count) : item[valueKey]);
  return {
    tooltip: { trigger: "axis" },
    grid: { left: 60, right: 16, top: 20, bottom: 60 },
    xAxis: { type: "category", data: items.map((item) => `${item.method} ${item.path}`.slice(0, 24)), axisLabel: { color: "#94a3b8", rotate: 30 }, axisLine: { lineStyle: { color: "#334155" } } },
    yAxis: { type: "value", name: yName, axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "#1e293b" } } },
    series: [{ type: "bar", data: items.map(value), itemStyle: { color: "#3b82f6", borderRadius: [3, 3, 0, 0] } }],
  };
}
