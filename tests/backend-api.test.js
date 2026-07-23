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
  const backend = createBackend({ config, store, auth: false, deviceMonitor: { monitor: async (machine) => successfulData(machine) } });
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
  assert.equal(created.saved, true);
  assert.equal(created.monitoring, null);

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
  assert.deepEqual(
    referenced.machine.monitoringReference.snapshot,
    store.find("m1").monitoringReference.snapshot
  );
  assert.equal(referenced.machine.readCommunity, undefined);

  response = await fetch(base + "/api/config/monitoring-reference-mode", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: false })
  });
  assert.equal((await response.json()).enabled, false);
  assert.equal(JSON.parse(fs.readFileSync(config.configPath, "utf8")).monitoring_reference_mode, false);

  response = await fetch(base + "/api/config/monitor-interval", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ seconds: 45 })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).monitor_interval_s, 45);
  assert.equal(JSON.parse(fs.readFileSync(config.configPath, "utf8")).monitor_interval_s, 45);

  response = await fetch(base + "/api/maps", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Regie principale" })
  });
  assert.equal(response.status, 201);
  const createdMap = (await response.json()).map;
  response = await fetch(base + "/api/maps/" + createdMap.id, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Regie centrale" })
  });
  assert.equal((await response.json()).map.name, "Regie centrale");
  response = await fetch(base + "/api/maps");
  assert.equal((await response.json()).length, 1);
  const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  response = await fetch(base + "/api/maps/" + createdMap.id + "/background", {
    method: "PUT", headers: { "content-type": "image/png" }, body: pngBytes
  });
  assert.equal(response.status, 200);
  assert.match((await response.json()).map.backgroundUrl, /\/background$/);
  response = await fetch(base + "/api/maps/" + createdMap.id + "/background");
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), pngBytes);
  response = await fetch(base + "/api/maps/" + createdMap.id + "/segments", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ segments: [{
      id: "s1", orientation: "horizontal", x: 0.1, y: 0.2, length: 0.5, cases: 8,
      assignments: [{ machineId: "m1", machineName: "NovaStar 1", cardId: "2", outputId: "3" }]
    }] })
  });
  const savedSegment = (await response.json()).map.segments[0];
  assert.equal(savedSegment.cases, 8);
  assert.deepEqual(savedSegment.assignments[0], { machineId: "m1", machineName: "NovaStar 1", cardId: "2", outputId: "3" });
  assert.equal(savedSegment.assignments.length, 8);
  response = await fetch(base + "/api/maps/" + createdMap.id, { method: "DELETE" });
  assert.equal(response.status, 204);

  response = await fetch(base + "/api/monitoring");
  const snapshot = await response.json();
  assert.equal(snapshot.machines.length, 1);
  assert.equal(snapshot.machines[0].raw.controller.genlockFrame.value, "50 Hz");

  response = await fetch(base + "/api/machines/m1", { method: "DELETE" });
  assert.equal(response.status, 204);
  assert.equal(store.load().length, 0);
});

test("machine creation stays persisted when the initial scan fails", async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tav-backend-persistence-"));
  const machinesFile = path.join(folder, "machines.json");
  const config = {
    port: 0, monitor_interval_s: 0, machinesFile, machines_file: machinesFile,
    monitoring_reference_mode: false, loglevel: "error", max_parallel_scans: 1,
    configPath: path.join(folder, "config.json")
  };
  const backend = createBackend({
    auth: false,
    config,
    store: new MachineStore(machinesFile),
    deviceMonitor: { monitor: async () => { throw new Error("SNMP unavailable"); } }
  });
  const server = http.createServer(backend.app);
  const port = await listen(server);
  t.after(async () => { backend.monitoring.stop(); await close(server); fs.rmSync(folder, { recursive: true, force: true }); });

  const response = await fetch("http://127.0.0.1:" + port + "/api/machines", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "persistent-1", type: "netgear-m4300", name: "NETGEAR", host: "192.168.69.201", readCommunity: "secret" })
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.saved, true);
  assert.equal(result.monitoring, null);

  const restartedStore = new MachineStore(machinesFile);
  assert.equal(restartedStore.load().length, 1);
  assert.equal(restartedStore.find("persistent-1").host, "192.168.69.201");
});

test("machine store keeps an atomic backup of the previous valid state", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tav-machine-store-"));
  try {
    const machinesFile = path.join(folder, "machines.json");
    const store = new MachineStore(machinesFile);
    store.create({ id: "m1", type: "other", name: "First", host: "192.0.2.1" });
    store.create({ id: "m2", type: "other", name: "Second", host: "192.0.2.2" });

    const current = JSON.parse(fs.readFileSync(machinesFile, "utf8"));
    const backup = JSON.parse(fs.readFileSync(machinesFile + ".bak", "utf8"));
    assert.equal(current.length, 2);
    assert.equal(backup.length, 1);
    assert.equal(backup[0].id, "m1");
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
