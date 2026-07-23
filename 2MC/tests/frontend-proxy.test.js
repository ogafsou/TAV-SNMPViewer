const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { createFrontend } = require("../TAV_Monitoring_UI/app");
const { attachWebSocketProxy } = require("../TAV_Monitoring_UI/proxy");
const { WebSocketServer } = require("../TAV_Monitoring_Backend/lib/WebSocketServer");
const { listen, close, readWebSocketMessage } = require("./helpers");

test("frontend renders EJS and proxies REST and WebSocket traffic", async (t) => {
  const backendServer = http.createServer((req, res) => {
    if (req.url === "/api/auth/me") {
      res.setHeader("content-type", "application/json");
      const olivier = String(req.headers.cookie || "").includes("session=olivier");
      res.end(JSON.stringify({ user: { id: "admin", login: olivier ? "Olivier" : "admin", role: "administrator" } }));
      return;
    }
    if (req.url === "/api/health") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, service: "fake-backend" }));
      return;
    }
    if (req.url === "/api/reset") {
      req.socket.destroy();
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
    rest_refresh_s: 45,
    bkgnd_opacity: 0.6
  } });
  const frontendServer = http.createServer(frontend.app);
  attachWebSocketProxy(frontendServer, frontend.config.backend_ws_url, "/ws");
  const frontendPort = await listen(frontendServer);
  t.after(async () => { backendWs.close(); await close(frontendServer); await close(backendServer); });

  const root = await fetch("http://127.0.0.1:" + frontendPort + "/", { redirect: "manual" });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get("location"), "/monitoring");

  const page = await fetch("http://127.0.0.1:" + frontendPort + "/monitoring");
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.equal(html.includes("TAV Monitoring"), true);
  assert.equal(html.includes('data-rest-refresh-s="45"'), true);
  assert.equal(html.includes('data-backend-url="http://127.0.0.1:' + backendPort + '"'), true);
  assert.equal(html.includes("Connexion Backend : Erreur"), true);
  assert.equal(html.includes('--map-background-opacity:0.6'), true);
  assert.equal(html.includes('/javascripts/application.js'), true);
  assert.equal((html.match(/<main class="app-shell">/g) || []).length, 1);
  assert.equal((html.match(/id="monitoringTab"/g) || []).length, 1);
  assert.equal(html.includes('href="/monitoring"'), true);
  assert.equal(html.includes('href="/configuration"'), true);
  assert.equal(html.includes('href="/monitoring-maps"'), false);
  assert.equal(html.includes('id="monitoringMapsTab"'), false);
  assert.equal(html.includes('/javascripts/monitoring-maps.js'), false);
  assert.match(html, /id="monitoringTab" class="tab-panel active"/);
  assert.match(html, /id="configurationTab" class="tab-panel" hidden/);
  const configurationMarkup = html.slice(html.indexOf('id="configurationTab"'), html.indexOf('id="monitoringTab"'));
  assert.equal((configurationMarkup.match(/<section\b/g) || []).length, (configurationMarkup.match(/<\/section>/g) || []).length);

  const configurationPage = await fetch("http://127.0.0.1:" + frontendPort + "/configuration");
  const configurationHtml = await configurationPage.text();
  assert.equal(configurationPage.status, 200);
  assert.match(configurationHtml, /id="configurationTab" class="tab-panel active"/);
  assert.match(configurationHtml, /id="monitoringTab" class="tab-panel" hidden/);

  const forbiddenMapsPage = await fetch("http://127.0.0.1:" + frontendPort + "/monitoring-maps", { redirect: "manual" });
  assert.equal(forbiddenMapsPage.status, 302);
  assert.equal(forbiddenMapsPage.headers.get("location"), "/monitoring");

  const olivierPage = await fetch("http://127.0.0.1:" + frontendPort + "/monitoring", { headers: { cookie: "session=olivier" } });
  const olivierHtml = await olivierPage.text();
  assert.equal(olivierHtml.includes('href="/monitoring-maps"'), true);
  assert.equal(olivierHtml.includes('id="monitoringMapsTab"'), true);
  assert.equal(olivierHtml.includes('/javascripts/monitoring-maps.js'), true);

  const allowedMapsPage = await fetch("http://127.0.0.1:" + frontendPort + "/monitoring-maps", {
    headers: { cookie: "session=olivier" },
    redirect: "manual"
  });
  assert.equal(allowedMapsPage.status, 200);

  const applicationScript = await fetch("http://127.0.0.1:" + frontendPort + "/javascripts/application.js");
  assert.equal(applicationScript.status, 200);
  assert.equal((await applicationScript.text()).includes("document.body.dataset.restRefreshS"), true);

  const bncIcon = await fetch("http://127.0.0.1:" + frontendPort + "/images/BNC-white.png");
  assert.equal(bncIcon.status, 200);
  assert.equal(String(bncIcon.headers.get("content-type")).startsWith("image/png"), true);

  const health = await fetch("http://127.0.0.1:" + frontendPort + "/api/health");
  assert.deepEqual(await health.json(), { ok: true, service: "fake-backend" });

  const resetResponse = await fetch("http://127.0.0.1:" + frontendPort + "/api/reset");
  assert.equal(resetResponse.status, 502);
  assert.match((await resetResponse.json()).error, /Backend unavailable/);
  const healthAfterReset = await fetch("http://127.0.0.1:" + frontendPort + "/api/health");
  assert.equal(healthAfterReset.status, 200);

  const message = await readWebSocketMessage(frontendPort, "/ws");
  assert.equal(message.type, "monitoring.snapshot");
  assert.equal(message.revision, 7);
});
