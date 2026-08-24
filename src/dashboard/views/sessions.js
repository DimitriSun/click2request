import { deleteSession, listSessions, saveSession } from "../../shared/db.js";
import { escapeHtml, formatBytes, formatClock, formatDuration } from "../../shared/utils.js";
import { openConfirm, openExportModal, openPrompt } from "./modals.js";

export async function render(container, { sortValue = "createdAt_desc" } = {}) {
  const sessions = sortSessions(await listSessions(), sortValue);
  container.innerHTML = `
    <div class="page-head">
      <h1>会话列表</h1>
      <div class="page-actions">
        <select id="session-sort" class="input" style="width:auto">
          <option value="createdAt_desc">按时间（新→旧）</option>
          <option value="createdAt_asc">按时间（旧→新）</option>
          <option value="requestCount_desc">按请求数</option>
          <option value="apiCount_desc">按 API 数</option>
          <option value="errorCount_desc">按错误数</option>
          <option value="sizeBytes_desc">按大小</option>
        </select>
        <button id="btn-new-session" class="btn primary">开始新录制</button>
        <button id="btn-clear-all" class="btn danger-ghost">清空全部数据</button>
      </div>
    </div>
    <div class="card-grid">
      ${
        sessions.length
          ? sessions.map(sessionCard).join("")
          : '<div class="empty-state">还没有会话。<br>点击浏览器工具栏的扩展图标打开录制开关，然后在页面上正常操作，API 请求就会被自动记录。</div>'
      }
    </div>
  `;
  container.querySelector("#session-sort").value = sortValue;
  container.querySelector("#session-sort").addEventListener("change", (event) => {
    render(container, { sortValue: event.target.value });
  });
  bindEvents(container, sessions);
}

function sortSessions(sessions, sortValue) {
  const [key, dir] = sortValue.split("_");
  const factor = dir === "asc" ? 1 : -1;
  return [...sessions].sort((a, b) => {
    const va = key === "createdAt" ? a.createdAt : a.stats?.[key] ?? 0;
    const vb = key === "createdAt" ? b.createdAt : b.stats?.[key] ?? 0;
    return (va - vb) * factor;
  });
}

function sessionCard(session) {
  const stats = session.stats || {};
  const duration = session.endWallTime ? session.endWallTime - session.startWallTime : Date.now() - session.startWallTime;
  return `
    <div class="card session-card" data-id="${session.id}">
      <div class="card-head">
        <span class="session-name" title="${escapeHtml(session.name)}">${escapeHtml(session.name)}</span>
        <span class="status-badge ${session.status}">${statusLabel(session.status)}</span>
      </div>
      <div class="card-stats">
        <div class="stat"><span class="stat-num">${stats.requestCount || 0}</span><span class="stat-label">请求</span></div>
        <div class="stat"><span class="stat-num">${stats.apiCount || 0}</span><span class="stat-label">API</span></div>
        <div class="stat"><span class="stat-num">${stats.errorCount || 0}</span><span class="stat-label">错误</span></div>
        <div class="stat"><span class="stat-num">${formatBytes(stats.sizeBytes || 0)}</span><span class="stat-label">大小</span></div>
      </div>
      <div class="card-meta">${formatClock(session.startWallTime)} · 时长 ${formatDuration(duration)}</div>
      <div class="card-actions">
        <button class="btn small" data-action="view">查看</button>
        <button class="btn small" data-action="stats">统计</button>
        <button class="btn small" data-action="export">导出</button>
        <button class="btn small" data-action="rename">重命名</button>
        <button class="btn small danger-ghost" data-action="delete">删除</button>
      </div>
    </div>`;
}

function statusLabel(status) {
  return { recording: "录制中", paused: "已暂停", closed: "已结束", interrupted: "已中断" }[status] || status;
}

function bindEvents(container, sessions) {
  container.querySelector("#btn-new-session")?.addEventListener("click", async () => {
    const result = await chrome.runtime.sendMessage({ type: "START_RECORDING" });
    if (result?.error) alert(result.error);
    else render(container);
  });

  container.querySelector("#btn-clear-all")?.addEventListener("click", async () => {
    const ok = await openConfirm("清空全部数据", "将删除所有会话与请求记录，此操作不可恢复。确定继续？");
    if (!ok) return;
    for (const session of sessions) await deleteSession(session.id);
    render(container);
  });

  container.querySelectorAll(".session-card").forEach((card) => {
    const session = sessions.find((item) => item.id === card.dataset.id);
    if (!session) return;
    card.querySelectorAll("button[data-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        switch (button.dataset.action) {
          case "view":
            location.hash = `#/session/${session.id}`;
            break;
          case "stats":
            location.hash = `#/stats/${session.id}`;
            break;
          case "export":
            openExportModal({ sessionId: session.id, sessionName: session.name });
            break;
          case "rename": {
            const name = await openPrompt("重命名会话", session.name);
            if (name) {
              session.name = name;
              session.updatedAt = Date.now();
              await saveSession(session);
              render(container);
            }
            break;
          }
          case "delete": {
            const ok = await openConfirm("删除会话", `确定删除「${session.name}」及其全部请求记录？此操作不可恢复。`);
            if (ok) {
              await deleteSession(session.id);
              render(container);
            }
            break;
          }
        }
      });
    });
  });
}
