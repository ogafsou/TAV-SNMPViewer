const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const PublicStatusService = require("../TAV_Monitoring_Backend/services/PublicStatusService");
const { createBackend } = require("../TAV_Monitoring_Backend/app");
const { createFrontend } = require("../TAV_Monitoring_UI/app");
const { listen, close } = require("./helpers");

function fixture(now) {
  const config = {
    public_status_enabled: true,
    public_status_secret: "a-strong-test-secret-with-at-least-32-characters",
    public_status_ttl_s: 60,
    frontend_url: "https://tav.example.test/app/"
  };
  const monitoring = { snapshot: () => ({
    revision: 3,
    generatedAt: "2026-07-19T12:00:00.000Z",
    machines: [{
      machineId: "m1",
      timestamp: "2026-07-19T11:59:30.000Z",
      raw: { host: "192.0.2.10", secret: "must-not-leak" },
      view: { connected: false, state: "offline", message: "192.0.2.10 unavailable" }
    }]
  }) };
  const store = { load: () => [{ id: "m1", name: "Mur principal", host: "192.0.2.10", readCommunity: "private" }] };
  return new PublicStatusService({ config, monitoring, store, now });
}

test("public status links are signed, expire, and expose only a sanitized summary", () => {
  let current = Date.UTC(2026, 6, 19, 12, 0, 0);
  const service = fixture(() => current);
  const link = new URL(service.createLink());
  assert.equal(link.pathname, "/app/status");
  assert.equal(link.search, "");
  assert.ok(link.hash.length > 20);

  const token = link.hash.slice(1);
  const status = service.snapshot(token);
  assert.equal(status.state, "error");
  assert.deepEqual(status.counts, { ok: 0, warning: 0, error: 1, unknown: 0 });
  assert.deepEqual(status.machines[0], {
    name: "Mur principal", state: "error", label: "Incident", issues: 1,
    anomalies: [{ label: "Machine", state: "error", status: "Hors ligne", expected: "En ligne" }],
    hiddenIssues: 0, updatedAt: "2026-07-19T11:59:30.000Z"
  });
  assert.equal(JSON.stringify(status).includes("192.0.2.10"), false);
  assert.throws(() => service.snapshot(token.slice(0, -1) + "x"), /invalide ou expire/);

  current += 61000;
  assert.throws(() => service.snapshot(token), /invalide ou expire/);
});

test("public status API and page do not require an authenticated session", async (t) => {
  const publicStatus = fixture(() => Date.UTC(2026, 6, 19, 12, 0, 0));
  const config = { port: 0, loglevel: "error", alerts: {}, machinesFile: "unused", usersFile: "unused", monitor_interval_s: 0, max_parallel_scans: 1 };
  const backend = createBackend({
    config,
    store: { load: () => [] },
    monitoring: publicStatus.monitoring,
    publicStatus,
    auth: { authenticateRequest: () => null }
  });
  const backendServer = http.createServer(backend.app);
  const backendPort = await listen(backendServer);
  t.after(() => close(backendServer));

  const token = new URL(publicStatus.createLink()).hash.slice(1);
  const apiResponse = await fetch(`http://127.0.0.1:${backendPort}/api/public/status`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token })
  });
  assert.equal(apiResponse.status, 200);
  assert.equal(apiResponse.headers.get("cache-control"), "no-store");

  const frontend = createFrontend({ config: { backend_rest_url: `http://127.0.0.1:${backendPort}`, rest_refresh_s: 30 } });
  const frontendServer = http.createServer(frontend.app);
  const frontendPort = await listen(frontendServer);
  t.after(() => close(frontendServer));
  const pageResponse = await fetch(`http://127.0.0.1:${frontendPort}/status`);
  assert.equal(pageResponse.status, 200);
  assert.match(await pageResponse.text(), /État général/);
  assert.match(pageResponse.headers.get("content-security-policy"), /frame-ancestors 'none'/);
});
