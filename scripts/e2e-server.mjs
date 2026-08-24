import { createServer } from "node:http";

const PORT = 8734;

const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>E2E Test Page</title></head>
<body>
<h1>E2E Test Page</h1>
<button id="btn">触发请求</button>
<script>
function fire() {
  fetch('/api/items?page=1').then(function (r) { return r.json(); }).then(console.log);
  fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'tester', pwd: '123' })
  }).then(function (r) { return r.json(); }).then(console.log);
}
document.getElementById('btn').addEventListener('click', fire);
fire();
</script>
</body>
</html>`;

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }
  if (url.pathname === "/api/items") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ items: [{ id: 1, name: "a" }, { id: 2, name: "b" }], page: url.searchParams.get("page") }));
    return;
  }
  if (url.pathname === "/api/login" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, token: "e2e-token-123", echo: body }));
    });
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => console.log(`e2e server: http://127.0.0.1:${PORT}`));
