import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";

const CHROME = process.env.C2R_CHROME || "E:\\click2request\\.e2e-cft\\chrome-win64\\chrome.exe";
const EXTENSION = "E:\\click2request";
const PROFILE = "E:\\click2request\\.e2e-profile";
const OUT_DIR = "E:\\click2request\\.e2e-out";
const CDP_PORT = 9222;
const TEST_ORIGIN = "http://127.0.0.1:8734";

const server = spawn(process.execPath, ["scripts/e2e-server.mjs"], { stdio: "ignore", detached: true });

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " :: " + detail : ""}`);
  if (!ok) failures++;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Cdp {
  constructor(url, onEvent) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (onEvent) {
        onEvent(msg);
      }
    };
  }
  ready() {
    return new Promise((resolve) => (this.ws.onopen = resolve));
  }
  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const result = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error("eval exception: " + JSON.stringify(result.exceptionDetails.exception?.description || result.exceptionDetails));
    return result.result?.value;
  }
}

async function getTargets() {
  return (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
}

async function waitFor(predicate, timeoutMs = 30000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    try {
      last = await predicate();
      if (last) return last;
    } catch {}
    await sleep(500);
  }
  throw new Error("timeout waiting for condition, last: " + JSON.stringify(last));
}

async function screenshot(page, name) {
  try {
    const shot = await page.call("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${OUT_DIR}/${name}.png`, Buffer.from(shot.data, "base64"));
    console.log(`INFO screenshot: ${name}.png`);
  } catch (error) {
    console.log(`WARN screenshot failed: ${name} :: ${error.message}`);
  }
}

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1280,900",
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${CDP_PORT}`,
    `--disable-extensions-except=${EXTENSION}`,
    `--load-extension=${EXTENSION}`,
    "about:blank",
  ],
  { stdio: "ignore", detached: true }
);

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  await waitFor(async () => {
    try {
      const response = await fetch(TEST_ORIGIN + "/");
      return response.ok;
    } catch {
      return false;
    }
  }, 15000);
  console.log("INFO e2e server ready");

  const targets = await waitFor(async () => {
    const list = await getTargets();
    const sw = list.find((t) => t.type === "service_worker" && t.url.includes("background/service-worker.js"));
    const page = list.find((t) => t.type === "page" && t.url !== "chrome://newtab/");
    return sw && page ? { sw, page } : null;
  });
  const extId = targets.sw.url.match(/chrome-extension:\/\/([^/]+)/)[1];
  const popupUrl = `chrome-extension://${extId}/src/popup/popup.html`;
  const dashboardUrl = `chrome-extension://${extId}/src/dashboard/dashboard.html`;
  console.log("INFO extension id:", extId);

  const page = new Cdp(targets.page.webSocketDebuggerUrl);
  await page.ready();
  await page.call("Page.enable");
  await page.call("Runtime.enable");

  const browserInfo = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
  const browser = new Cdp(browserInfo.webSocketDebuggerUrl);
  await browser.ready();

  await page.call("Page.navigate", { url: TEST_ORIGIN + "/" });
  await sleep(1500);

  const popupTarget = await browser.call("Target.createTarget", { url: popupUrl, newWindow: true });
  await sleep(1200);
  let lastDialog = null;
  const popup = new Cdp((await getTargets()).find((t) => t.id === popupTarget.targetId).webSocketDebuggerUrl, (msg) => {
    if (msg.method === "Page.javascriptDialogOpening") {
      lastDialog = msg.params.message;
      console.log("INFO popup dialog:", msg.params.message);
      popup.call("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    }
  });
  await popup.ready();
  await popup.call("Runtime.enable");
  await popup.call("Page.enable");

  const btnRecordVisible = await popup.eval(`!document.querySelector('#btn-record').classList.contains('hidden')`);
  check("popup 显示开始按钮", btnRecordVisible);
  await popup.eval(`window.close = () => {}; document.querySelector('#btn-record').click()`);
  await sleep(1500);
  check("无弹窗报错", lastDialog === null, lastDialog || "");

  const popupState = await popup.eval(`(() => ({
    dot: document.querySelector('#status-dot').className,
    recordHidden: document.querySelector('#btn-record').classList.contains('hidden'),
    stopVisible: !document.querySelector('#btn-stop').classList.contains('hidden'),
    meta: document.querySelector('#session-meta').textContent,
  }))()`);
  check("开始录制生效", popupState.dot.includes("recording") && popupState.stopVisible, JSON.stringify(popupState));

  await page.call("Page.reload");
  await sleep(2500);

  const sw = new Cdp(targets.sw.webSocketDebuggerUrl);
  await sw.ready();
  const swDebug = await sw.eval(`(async () => {
    const targets = await chrome.debugger.getTargets();
    const stored = await chrome.storage.session.get('activeRecording');
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('click2request');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    let count = -1;
    if (db.objectStoreNames.contains('requests')) {
      count = await new Promise((resolve, reject) => {
        const req = db.transaction('requests', 'readonly').objectStore('requests').count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return JSON.stringify({
      targets: targets.map((t) => ({ tabId: t.tabId, url: t.url, attached: t.attached })),
      stored,
      dbStores: [...db.objectStoreNames],
      requestCount: count,
    });
  })()`);
  console.log("DEBUG SW:", swDebug);
  const swInfo = JSON.parse(swDebug);
  check("录制捕获请求数≥2", swInfo.requestCount >= 2, `dbRequestCount=${swInfo.requestCount}`);

  await popup.eval(`document.querySelector('#btn-stop').click()`);
  await sleep(1200);
  const stopped = await popup.eval(`document.querySelector('#status-dot').className`);
  check("停止录制生效", stopped.includes("idle"), stopped);

  await page.call("Page.navigate", { url: dashboardUrl + "#/sessions" });
  await waitFor(async () => (await page.eval(`document.querySelectorAll('.session-card').length`)) > 0);
  await sleep(500);
  const sessionId = await page.eval(`document.querySelector('.session-card').dataset.id`);
  check("面板显示会话", Boolean(sessionId), `sessionId=${sessionId}`);
  await screenshot(page, "sessions");

  await page.call("Page.navigate", { url: dashboardUrl + `#/session/${sessionId}` });
  await waitFor(async () => (await page.eval(`document.querySelector('.request-row.header') !== null`)));
  await sleep(500);

  const headerInfo = JSON.parse(
    await page.eval(`(() => {
      const header = document.querySelector('.request-row.header');
      const style = getComputedStyle(header);
      const rect = header.getBoundingClientRect();
      const rows = [...document.querySelectorAll('.request-row:not(.header)')].slice(0, 3).map((r) => {
        const b = r.getBoundingClientRect();
        return { top: Math.round(b.top), bottom: Math.round(b.bottom) };
      });
      return JSON.stringify({ position: style.position, headerBottom: Math.round(rect.bottom), rows });
    })()`)
  );
  check(
    "bug1 标题栏不悬浮不压内容",
    headerInfo.position !== "sticky" && headerInfo.rows.every((row) => row.top >= headerInfo.headerBottom - 1),
    JSON.stringify(headerInfo)
  );
  await screenshot(page, "session-detail");

  await page.eval(`document.querySelector('#btn-export-session').click()`);
  await waitFor(async () => (await page.eval(`document.querySelector('.modal') !== null`)));
  await page.eval(`document.querySelector('input[name="export-format"][value="jmx"]').click()`);
  await sleep(500);
  const previewStart = await page.eval(`document.querySelector('#export-preview').value.slice(0, 80)`);
  check("bug2 选择 JMX 预览为 JMX", previewStart.includes("<jmeterTestPlan"), previewStart);

  const dlDir = OUT_DIR + "\\dl";
  rmSync(dlDir, { recursive: true, force: true });
  mkdirSync(dlDir, { recursive: true });
  await browser.call("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir, eventsEnabled: true });
  await page.eval(`document.querySelector('#btn-download').click()`);
  await sleep(2500);
  const dlFiles = readdirSync(dlDir).filter((file) => !file.endsWith(".crdownload"));
  const dlFile = dlFiles[0];
  const dlContent = dlFile ? readFileSync(`${dlDir}\\${dlFile}`, "utf8").slice(0, 60) : "";
  check("下载落盘文件名含 .jmx", Boolean(dlFile && dlFile.endsWith(".jmx")), JSON.stringify(dlFiles));
  check("下载内容为 JMX", dlContent.includes("<jmeterTestPlan"), dlContent);

  await page.eval(`document.querySelector('.request-row.header button[data-sort="method"]').click()`);
  await sleep(300);
  const methodAsc = await page.eval(`document.querySelector('.request-row:not(.header) .method').textContent`);
  check("issue3 请求列表按方法升序", methodAsc === "GET", methodAsc);
  await page.eval(`document.querySelector('.request-row.header button[data-sort="method"]').click()`);
  await sleep(300);
  const methodDesc = await page.eval(`document.querySelector('.request-row:not(.header) .method').textContent`);
  check("issue3 请求列表按方法降序", methodDesc === "POST", methodDesc);

  await page.call("Page.navigate", { url: dashboardUrl + `#/stats/${sessionId}` });
  await waitFor(async () => (await page.eval(`document.querySelector('.api-table') !== null`)));
  await sleep(500);
  const apiTableInfo = JSON.parse(
    await page.eval(`(() => {
      const ths = [...document.querySelectorAll('.api-table th')];
      return JSON.stringify({
        styles: ths.map((th) => getComputedStyle(th).whiteSpace),
        headers: ths.map((th) => th.textContent.trim()),
        sortableCount: document.querySelectorAll('.api-table .sortable').length,
        tbodyRows: document.querySelectorAll('#api-tbody tr').length,
      });
    })()`)
  );
  check(
    "issue2 API 表头横向排列",
    apiTableInfo.styles.every((style) => style === "nowrap") && apiTableInfo.headers.length === 7,
    JSON.stringify(apiTableInfo)
  );
  check("issue3 API 表可排序且有数据", apiTableInfo.sortableCount === 7 && apiTableInfo.tbodyRows > 0, JSON.stringify(apiTableInfo));
  await page.eval(`document.querySelector('.api-table button[data-sort="count"]').click()`);
  await sleep(300);
  check("issue3 API 表点击排序生效", await page.eval(`document.querySelector('.api-table button[data-sort="count"] .sort-arrow') !== null`));
  await screenshot(page, "stats");

  const footClose = await page.eval(`document.querySelectorAll('.modal-foot [data-close]').length`);
  await page.eval(`document.querySelector('.modal-foot [data-close]').click()`);
  await sleep(300);
  check("bug3 导出弹窗脚部关闭生效", await page.eval(`document.querySelector('.modal') === null`), `footCloseCount=${footClose}`);

  await page.eval(`document.querySelector('#btn-settings').click()`);
  await sleep(400);
  await page.eval(`document.querySelector('.modal-foot [data-close]').click()`);
  await sleep(300);
  check("bug3 设置弹窗取消生效", await page.eval(`document.querySelector('.modal') === null`));

  await screenshot(page, "dashboard-final");
}

main()
  .then(() => {
    console.log(failures ? `\n${failures} check(s) FAILED` : "\nALL E2E CHECKS PASSED");
    cleanup(0);
  })
  .catch((error) => {
    console.error("\nE2E ERROR:", error.message);
    cleanup(1);
  });

function cleanup(code) {
  try {
    spawn("taskkill", ["/pid", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {}
  try {
    spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {}
  setTimeout(() => process.exit(code), 1500);
}
