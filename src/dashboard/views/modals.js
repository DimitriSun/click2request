import { getRequestsByIds, requestIds } from "../../shared/db.js";
import { escapeHtml, formatDuration, uid } from "../../shared/utils.js";
import { getSettings, updateSettings } from "../../shared/settings.js";
import { getVariables, saveVariables } from "../../shared/variables.js";
import { exporterOptions } from "../../shared/exporters/index.js";
import { ensureOriginsPermission, originOf } from "../../shared/permissions.js";
import { methodBadge } from "./helpers.js";

export function openModal(title, bodyHtml, { width = "560px" } = {}) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `
    <div class="modal-overlay">
      <div class="modal" style="width:${width}">
        <div class="modal-head">
          <h2>${escapeHtml(title)}</h2>
          <button class="modal-close" data-close>×</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-foot" data-foot></div>
      </div>
    </div>
  `;
  const overlay = root.querySelector(".modal-overlay");
  const close = () => {
    root.innerHTML = "";
  };
  overlay.addEventListener("click", (event) => {
    if (event.target.closest("[data-close]")) close();
    else if (event.target === overlay) close();
  });
  return { root: overlay, close, foot: overlay.querySelector("[data-foot]") };
}

export function openConfirm(title, message) {
  return new Promise((resolve) => {
    const modal = openModal(title, `<p class="modal-text">${escapeHtml(message)}</p>`);
    modal.foot.innerHTML = `
      <button class="btn" data-action="cancel">取消</button>
      <button class="btn danger" data-action="ok">确定</button>`;
    modal.foot.querySelector('[data-action="cancel"]').addEventListener("click", () => {
      modal.close();
      resolve(false);
    });
    modal.foot.querySelector('[data-action="ok"]').addEventListener("click", () => {
      modal.close();
      resolve(true);
    });
  });
}

export function openPrompt(title, initial = "") {
  return new Promise((resolve) => {
    const modal = openModal(title, `<input id="prompt-input" class="input" value="${escapeHtml(initial)}">`);
    modal.foot.innerHTML = `
      <button class="btn" data-action="cancel">取消</button>
      <button class="btn primary" data-action="ok">确定</button>`;
    const input = modal.root.querySelector("#prompt-input");
    input.focus();
    input.select();
    const commit = () => {
      modal.close();
      resolve(input.value.trim() || null);
    };
    modal.foot.querySelector('[data-action="cancel"]').addEventListener("click", () => {
      modal.close();
      resolve(null);
    });
    modal.foot.querySelector('[data-action="ok"]').addEventListener("click", commit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") commit();
    });
  });
}

export async function openVariablesModal() {
  const data = await getVariables();
  const state = {
    vars: { ...data.vars },
    environments: data.environments.map((env) => ({ ...env, vars: { ...(env.vars || {}) } })),
    activeEnvId: data.activeEnvId,
  };
  const modal = openModal("变量与环境", renderVarsEditor(state), { width: "720px" });
  modal.foot.innerHTML = `
    <button class="btn" data-close>关闭</button>
    <button class="btn primary" data-action="save">保存</button>`;
  bindVarsEditor(modal.root, state);
  modal.foot.querySelector('[data-action="save"]').addEventListener("click", async () => {
    await saveVariables({ vars: state.vars, environments: state.environments, activeEnvId: state.activeEnvId });
    modal.close();
  });
}

function renderVarsEditor(state) {
  const envRows = state.environments
    .map(
      (env, index) => `
    <div class="env-block" data-index="${index}">
      <div class="env-head">
        <input class="input env-name" value="${escapeHtml(env.name)}" placeholder="环境名（如 dev / test / prod）">
        <input class="input env-base" value="${escapeHtml(env.baseUrl || "")}" placeholder="baseUrl（替换 {{baseUrl}}）">
        <label class="check env-active"><input type="radio" name="active-env" ${state.activeEnvId === env.id ? "checked" : ""}> 启用</label>
        <button class="btn small danger-ghost" data-action="remove-env">删除</button>
      </div>
      <textarea class="input env-vars" rows="3" placeholder="每行一个：name=value">${escapeHtml(envVarsText(env.vars))}</textarea>
    </div>`
    )
    .join("");
  const globalRows = Object.entries(state.vars)
    .map(
      ([name, value]) => `
    <div class="var-row">
      <input class="input var-name" value="${escapeHtml(name)}" placeholder="变量名">
      <input class="input var-value" value="${escapeHtml(value)}" placeholder="值">
      <button class="btn small danger-ghost" data-action="remove-var">删除</button>
    </div>`
    )
    .join("");
  return `
    <p class="modal-text">在 URL / 请求头 / 请求体中用 <code>{{变量名}}</code> 标记，导出与回放时自动替换。环境变量优先于全局变量，<code>{{baseUrl}}</code> 取当前环境的 baseUrl。</p>
    <h3 class="modal-sub">全局变量</h3>
    <div id="vars-list">${globalRows || '<div class="empty-state small">暂无变量</div>'}</div>
    <button class="btn small" id="btn-add-var">+ 添加变量</button>
    <h3 class="modal-sub">环境</h3>
    <div id="envs-list">${envRows || '<div class="empty-state small">暂无环境</div>'}</div>
    <button class="btn small" id="btn-add-env">+ 添加环境</button>`;
}

function envVarsText(vars) {
  return Object.entries(vars || {})
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");
}

function parseEnvText(text) {
  const vars = {};
  for (const line of String(text || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) vars[trimmed] = "";
    else vars[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1);
  }
  return vars;
}

function bindVarsEditor(root, state) {
  root.querySelector("#btn-add-var").addEventListener("click", () => {
    state.vars[`var${Object.keys(state.vars).length + 1}`] = "";
    renderVarsLists(root, state);
  });
  root.querySelector("#btn-add-env").addEventListener("click", () => {
    state.environments.push({ id: uid(), name: "新环境", baseUrl: "", vars: {} });
    renderVarsLists(root, state);
  });
  root.querySelector("#vars-list").addEventListener("input", () => {
    const vars = {};
    root.querySelectorAll("#vars-list .var-row").forEach((row) => {
      const name = row.querySelector(".var-name").value.trim();
      if (name) vars[name] = row.querySelector(".var-value").value;
    });
    state.vars = vars;
  });
  root.querySelector("#vars-list").addEventListener("click", (event) => {
    if (!event.target.closest("[data-action=remove-var]")) return;
    const row = event.target.closest(".var-row");
    const name = row.querySelector(".var-name").value.trim();
    if (name) delete state.vars[name];
    renderVarsLists(root, state);
  });
  root.querySelector("#envs-list").addEventListener("input", (event) => {
    const block = event.target.closest(".env-block");
    const env = state.environments[Number(block?.dataset.index)];
    if (!env) return;
    if (event.target.classList.contains("env-name")) env.name = event.target.value;
    else if (event.target.classList.contains("env-base")) env.baseUrl = event.target.value;
    else if (event.target.classList.contains("env-vars")) env.vars = parseEnvText(event.target.value);
  });
  root.querySelector("#envs-list").addEventListener("click", (event) => {
    const radio = event.target.closest('input[type="radio"]');
    if (radio) {
      const block = event.target.closest(".env-block");
      state.activeEnvId = state.environments[Number(block.dataset.index)].id;
      return;
    }
    if (!event.target.closest("[data-action=remove-env]")) return;
    const block = event.target.closest(".env-block");
    const removed = state.environments.splice(Number(block.dataset.index), 1)[0];
    if (state.activeEnvId === removed.id) state.activeEnvId = null;
    renderVarsLists(root, state);
  });
}

function renderVarsLists(root, state) {
  root.querySelector("#vars-list").innerHTML =
    Object.entries(state.vars)
      .map(
        ([name, value]) => `
    <div class="var-row">
      <input class="input var-name" value="${escapeHtml(name)}" placeholder="变量名">
      <input class="input var-value" value="${escapeHtml(value)}" placeholder="值">
      <button class="btn small danger-ghost" data-action="remove-var">删除</button>
    </div>`
      )
      .join("") || '<div class="empty-state small">暂无变量</div>';
  root.querySelector("#envs-list").innerHTML =
    state.environments
      .map(
        (env, index) => `
    <div class="env-block" data-index="${index}">
      <div class="env-head">
        <input class="input env-name" value="${escapeHtml(env.name)}" placeholder="环境名（如 dev / test / prod）">
        <input class="input env-base" value="${escapeHtml(env.baseUrl || "")}" placeholder="baseUrl（替换 {{baseUrl}}）">
        <label class="check env-active"><input type="radio" name="active-env" ${state.activeEnvId === env.id ? "checked" : ""}> 启用</label>
        <button class="btn small danger-ghost" data-action="remove-env">删除</button>
      </div>
      <textarea class="input env-vars" rows="3" placeholder="每行一个：name=value">${escapeHtml(envVarsText(env.vars))}</textarea>
    </div>`
      )
      .join("") || '<div class="empty-state small">暂无环境</div>';
}

export async function openSettingsModal() {
  const settings = await getSettings();
  const typeOptions = ["image", "media", "font", "stylesheet", "script", "manifest", "document"]
    .map((type) => `<label class="check"><input type="checkbox" value="${type}" ${settings.excludeTypes.includes(type) ? "checked" : ""}> ${type}</label>`)
    .join("");
  const modal = openModal(
    "设置",
    `
    <h3 class="modal-sub">响应体上限（KB，超过则截断）</h3>
    <input id="set-max-body" class="input" type="number" min="64" step="64" value="${Math.round(settings.maxBodyBytes / 1024)}">
    <h3 class="modal-sub">不记录的请求类型（静态资源）</h3>
    <div id="set-exclude-types" class="check-group">${typeOptions}</div>
    <h3 class="modal-sub">URL 关键词排除（每行一个）</h3>
    <textarea id="set-keywords" class="input" rows="4">${escapeHtml(settings.excludeKeywords.join("\n"))}</textarea>
    <h3 class="modal-sub">回放 Cookie 策略</h3>
    <select id="set-cookie" class="input">
      <option value="browser" ${settings.cookieStrategy === "browser" ? "selected" : ""}>当前浏览器 Cookie（推荐）</option>
      <option value="recorded" ${settings.cookieStrategy === "recorded" ? "selected" : ""}>录制时的 Cookie</option>
      <option value="none" ${settings.cookieStrategy === "none" ? "selected" : ""}>不带 Cookie</option>
    </select>
  `,
    { width: "640px" }
  );
  modal.foot.innerHTML = `
    <button class="btn" data-close>取消</button>
    <button class="btn primary" data-action="save">保存</button>`;
  modal.foot.querySelector('[data-action="save"]').addEventListener("click", async () => {
    const maxBodyKb = Number(modal.root.querySelector("#set-max-body").value) || 2048;
    const excludeTypes = [...modal.root.querySelectorAll("#set-exclude-types input:checked")].map((input) => input.value);
    const excludeKeywords = modal.root
      .querySelector("#set-keywords")
      .value.split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const cookieStrategy = modal.root.querySelector("#set-cookie").value;
    await updateSettings({ maxBodyBytes: maxBodyKb * 1024, excludeTypes, excludeKeywords, cookieStrategy });
    modal.close();
  });
}

export async function openExportModal({ sessionId, requestIds: ids, sessionName = "Click2Request" }) {
  const records = ids?.length ? await getRequestsByIds(ids) : await getRequestsByIds(await requestIds(sessionId));
  if (!records.length) return alert("没有可导出的请求");
  const variables = await getVariables();
  const formatOptions = exporterOptions();
  const envOptions = variables.environments
    .map((env) => `<option value="${escapeHtml(env.id)}" ${variables.activeEnvId === env.id ? "selected" : ""}>${escapeHtml(env.name)}</option>`)
    .join("");

  const modal = openModal(
    `导出 ${records.length} 个请求`,
    `
    <h3 class="modal-sub">格式</h3>
    <div class="radio-group">
      ${formatOptions
        .map((item) => `<label class="radio"><input type="radio" name="export-format" value="${item.id}" ${item.id === "python" ? "checked" : ""}> ${escapeHtml(item.label)}</label>`)
        .join("")}
    </div>
    <h3 class="modal-sub">选项</h3>
    <div class="option-row">
      <label class="check"><input id="export-mask" type="checkbox"> 脱敏敏感头（Cookie / Authorization / token）</label>
    </div>
    <div class="option-row">
      <label class="check"><input id="export-dedupe" type="checkbox"> 仅导出去重后的 API（每种接口一条）</label>
    </div>
    <div class="option-row">
      <label>环境</label>
      <select id="export-env" class="input"><option value="">不使用变量</option>${envOptions}</select>
    </div>
    <h3 class="modal-sub">预览</h3>
    <textarea id="export-preview" class="input code" rows="14" readonly></textarea>
    <p class="modal-text small">提示：JMX 与 Postman 会保留 {{变量}} 作为其原生变量；curl / Python 会直接替换。</p>
  `,
    { width: "780px" }
  );
  modal.foot.innerHTML = `
    <button class="btn" data-close>关闭</button>
    <button class="btn" id="btn-copy">复制</button>
    <button class="btn primary" id="btn-download">下载文件</button>`;

  const current = () => {
    const formatId = modal.root.querySelector('input[name="export-format"]:checked')?.value || "python";
    const envId = modal.root.querySelector("#export-env").value;
    const variablesForEnv = envId ? { ...variables, activeEnvId: envId } : { vars: {}, environments: [], activeEnvId: null };
    const maskSensitive = modal.root.querySelector("#export-mask").checked;
    const dedupe = modal.root.querySelector("#export-dedupe").checked;
    let output = records;
    if (dedupe) {
      const seen = new Set();
      output = records.filter((record) => {
        const key = `${record.method} ${record.host}${record.path}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    const exporter = formatOptions.find((item) => item.id === formatId);
    const content = exporter.generate(output, { variables: variablesForEnv, maskSensitive, sessionName });
    return { exporter, content };
  };

  const refresh = () => {
    modal.root.querySelector("#export-preview").value = current().content;
  };
  modal.root.addEventListener("change", refresh);
  refresh();

  modal.foot.querySelector("#btn-copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(modal.root.querySelector("#export-preview").value);
    const button = modal.foot.querySelector("#btn-copy");
    button.textContent = "已复制";
    setTimeout(() => (button.textContent = "复制"), 1200);
  });
  modal.foot.querySelector("#btn-download").addEventListener("click", () => {
    const { exporter, content } = current();
    const safeName = sessionName.replace(/[^\w\u4e00-\u9fa5-]+/g, "_").slice(0, 60) || "click2request";
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeName}.${exporter.extension}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    const button = modal.foot.querySelector("#btn-download");
    button.textContent = "已开始下载";
    setTimeout(() => (button.textContent = "下载文件"), 1500);
  });
}

export async function openReplayModal({ requestIds: ids, sessionId, records }) {
  if (!records) records = ids?.length ? await getRequestsByIds(ids) : await getRequestsByIds(await requestIds(sessionId));
  if (!records.length) return alert("没有可回放的请求");
  const origins = [...new Set(records.map((record) => originOf(record.url)).filter(Boolean))];
  const missing = await ensureOriginsPermission(origins);
  if (missing.length) {
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: missing });
    } catch {
      granted = false;
    }
    if (!granted) return alert("未授予访问权限，回放需要访问对应站点的权限。");
  }
  const settings = await getSettings();
  const result = await chrome.runtime.sendMessage({
    type: "REPLAY",
    sessionId,
    requestIds: ids,
    options: { cookieStrategy: settings.cookieStrategy },
  });
  if (result?.needPermission) return alert("权限不足，无法回放");
  if (result?.error) return alert(result.error);
  openReplayResults(result.results, result.summary);
}

export function openReplayResults(results, summary) {
  const rows = results
    .map((result) => {
      const error = result.error ? `<div class="replay-error">${escapeHtml(result.error)}</div>` : "";
      const statusMatch = result.statusMatch === undefined ? "" : `<span class="badge ${result.statusMatch ? "ok" : "fail"}">状态${result.statusMatch ? "一致" : "不一致"}</span>`;
      const bodyMatch = result.bodyMatch === undefined ? "" : `<span class="badge ${result.bodyMatch ? "ok" : "fail"}">响应体${result.bodyMatch ? "一致" : "不一致"}</span>`;
      return `
      <div class="replay-row">
        <div class="replay-row-head">
          ${methodBadge(result.method)}
          <span class="req-path" title="${escapeHtml(result.url)}">${escapeHtml(result.url)}</span>
          <span class="badge ${result.ok ? "ok" : "fail"}">${result.ok ? "通过" : "失败"}</span>
        </div>
        <div class="replay-row-meta">
          <span>录制 ${result.recordedStatus ?? "-"} · ${formatDuration(result.recordedDuration)}</span>
          <span>→ 重放 ${result.replayedStatus ?? "-"} · ${formatDuration(result.replayedDuration)}</span>
          ${statusMatch}${bodyMatch}
        </div>
        ${error}
      </div>`;
    })
    .join("");
  const allOk = summary.ok === summary.total;
  const modal = openModal(
    `回放结果（${summary.ok}/${summary.total} 通过）`,
    `
    <div class="replay-summary">
      <span class="badge ${allOk ? "ok" : "fail"}">${allOk ? "全部通过" : `${summary.failed} 个失败`}</span>
      <span class="modal-text small">失败时优先检查设置中的 Cookie 策略，或确认接口是否仍可用</span>
    </div>
    <div class="replay-list">${rows}</div>
  `,
    { width: "860px" }
  );
  modal.foot.innerHTML = `<button class="btn primary" data-close>关闭</button>`;
}
