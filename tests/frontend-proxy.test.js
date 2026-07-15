const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { createFrontend } = require("../TAV_Monitoring_UI/app");
const { attachWebSocketProxy } = require("../TAV_Monitoring_UI/proxy");
const { WebSocketServer } = require("../TAV_Monitoring_Backend/lib/WebSocketServer");
const { listen, close, readWebSocketMessage } = require("./helpers");

test("frontend renders EJS and proxies REST and WebSocket traffic", async (t) => {
  const backendServer = http.createServer((req, res) => {
    if (req.url === "/api/health") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, service: "fake-backend" }));
      return;
    }
    res.statusCode = 404; res.end();
  });
  const backendWs = new WebSocketServer({ path: "/ws", snapshot: () => ({ revision: 7, machines: [] }) }).attach(backendServer);
  const backendPort = await listen(backendServer);
  const frontend = createFrontend({ config: {
    port: 0,
    backend_rest_url: "http://127.0.0.1:" + backendPort,
    backend_ws_url: "ws://127.0.0.1:" + backendPort + "/ws",
    rest_refresh_s: 45
  } });
  const frontendServer = http.createServer(frontend.app);
  attachWebSocketProxy(frontendServer, frontend.config.backend_ws_url, "/ws");
  const frontendPort = await listen(frontendServer);
  t.after(async () => { backendWs.close(); await close(frontendServer); await close(backendServer); });

  const page = await fetch("http://127.0.0.1:" + frontendPort + "/");
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.equal(html.includes("TAV Monitoring"), true);
  assert.equal(html.includes("var AUTOREFRESH_S = Number(45)"), true);

  const bncIcon = await fetch("http://127.0.0.1:" + frontendPort + "/images/BNC-white.png");
  assert.equal(bncIcon.status, 200);
  assert.equal(String(bncIcon.headers.get("content-type")).startsWith("image/png"), true);

  const health = await fetch("http://127.0.0.1:" + frontendPort + "/api/health");
  assert.deepEqual(await health.json(), { ok: true, service: "fake-backend" });

  const message = await readWebSocketMessage(frontendPort, "/ws");
  assert.equal(message.type, "monitoring.snapshot");
  assert.equal(message.revision, 7);
});
