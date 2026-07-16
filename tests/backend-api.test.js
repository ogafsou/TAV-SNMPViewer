const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { createBackend } = require("../TAV_Monitoring_Backend/app");
const { MachineStore } = require("../TAV_Monitoring_Backend/classes/MachineStore");
const { listen, close } = require("./helpers");

function successfulData(machine) {
  return {
    machineId: machine.id,
    type: machine.type,
    host: machine.host,
    timestamp: new Date().toISOString(),
    controller: { workingStatus: { ok: true, value: "Online" }, genlockStatus: { ok: true, value: "Normal" }, genlockFrame: { ok: true, value: "50 Hz" } },
    inputSlots: { count: 0, slots: [] }, outputSlots: { count: 0, slots: [] }, screens: { count: 0, screens: [] }, receivingCards: []
  };
}

test("backend exposes sanitized CRUD, scans, snapshots and references", async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tav-backend-api-"));
  const config = {
    port: 0, monitor_interval_s: 0, machinesFile: path.join(folder, "machines.json"), machines_file: "./machines.json",
    monitoring_reference_mode: true, loglevel: "error", max_parallel_scans: 1, configPath: path.join(folder, "config.json")
  };
  fs.writeFileSync(config.configPath, JSON.stringify({ port: 0, monitor_interval_s: 0, machines_file: "./machines.json", monitoring_reference_mode: true }), "utf8");
  const store = new MachineStore(config.machinesFile);
  const backend = createBackend({ config, store, deviceMonitor: { monitor: async (machine) => successfulData(machine) } });
  const server = http.createServer(backend.app);
  const port = await listen(server);
  t.after(async () => { backend.monitoring.stop(); await close(server); fs.rmSync(folder, { recursive: true, force: true }); });
  const base = "http://127.0.0.1:" + port;

  let response = await fetch(base + "/api/machines", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "m1", type: "novastar-h", name: "Main", host: "192.0.2.10", readCommunity: "secret-read", writeCommunity: "secret-write", apiPassword: "secret-api", apiProjectId: "NDAz", apiSecretKey: "secret-openapi" })
  });
  assert.equal(response.status, 201);
  let created = await response.json();
  assert.equal(created.machine.readCommunity, undefined);
  assert.equal(created.machine.readCommunityConfigured, true);
  assert.equal(created.machine.apiPasswordConfigured, true);
  assert.equal(created.machine.apiSecretKey, undefined);
  assert.equal(created.machine.apiSecretKeyConfigured, true);
  assert.equal(created.monitoring.view.label, "Reference non definie");

  response = await fetch(base + "/api/machines/m1/scan", { method: "POST" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).view.connected, true);

  response = await fetch(base + "/api/monitoring/scan", { method: "POST" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).machines.length, 1);

  response = await fetch(base + "/api/machines/m1", {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Main updated", readCommunity: "" })
  });
  assert.equal(response.status, 200);
  assert.equal(store.find("m1").readCommunity, "secret-read");
  assert.equal(store.find("m1").apiSecretKey, "secret-openapi");

  response = await fetch(base + "/api/machines/m1/reference", { method: "PUT" });
  const referenced = await response.json();
  assert.equal(response.status, 200);
  assert.equal(referenced.monitoring.view.state, "ok");
  assert.equal(!!store.find("m1").monitoringReference, true);

  response = await fetch(base + "/api/config/monitoring-reference-mode", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: false })
  });
  assert.equal((await response.json()).enabled, false);
  assert.equal(JSON.parse(fs.readFileSync(config.configPath, "utf8")).monitoring_reference_mode, false);

  response = await fetch(base + "/api/monitoring");
  const snapshot = await response.json();
  assert.equal(snapshot.machines.length, 1);
  assert.equal(snapshot.machines[0].raw.controller.genlockFrame.value, "50 Hz");

  response = await fetch(base + "/api/machines/m1", { method: "DELETE" });
  assert.equal(response.status, 204);
  assert.equal(store.load().length, 0);
});
