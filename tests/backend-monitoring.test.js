const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { MachineStore } = require("../TAV_Monitoring_Backend/classes/MachineStore");
const MonitoringService = require("../TAV_Monitoring_Backend/services/MonitoringService");
const SNMPConnector = require("../TAV_Monitoring_Backend/classes/SnmpLib");
const { buildMonitoringView, applyReferenceMode, buildReferenceSnapshot } = require("../TAV_Monitoring_Backend/services/MonitoringState");
const { createDeviceMonitor, buildHybridMonitor } = require("../TAV_Monitoring_Backend/services/DeviceMonitor");
const { canonicalizeIo, combineIo } = require("../TAV_Monitoring_Backend/services/CanonicalIo");

function data(frame, uptime) {
  return {
    machineId: "m1", type: "novastar-h", host: "192.0.2.10", timestamp: new Date().toISOString(),
    controller: {
      workingStatus: { ok: true, value: "Online" }, workingTime: { ok: true, value: uptime },
      genlockStatus: { ok: true, value: "Normal" }, genlockFrame: { ok: true, value: frame }
    },
    inputSlots: { count: 0, slots: [] }, outputSlots: { count: 0, slots: [] }, screens: { count: 0, screens: [] }, receivingCards: []
  };
}

test("NovaStar numeric input types select BNC, DVI and DisplayPort icons", () => {
  const sample = data("50 Hz", "1");
  sample.inputSlots = { slots: [{
    slotId: "I-1",
    inputSources: [6, 7, 8].map((rawType, index) => ({
      sourceId: index + 1,
      fields: {
        status: { ok: true, value: "Normal" },
        type: { ok: true, value: String(rawType) },
        rawType: { ok: true, value: rawType }
      }
    }))
  }] };
  canonicalizeIo(sample, "api");
  assert.deepEqual(buildMonitoringView(sample).inputSlots.map((item) => item.icon), ["bnc", "dvi", "dp"]);
});

test("NovaStar canonical model separates inventory from source observations", () => {
  const sample = data("50 Hz", "1");
  sample.source = "api";
  sample.inputSlots = { count: 1, slots: [{
    slotId: "I-3",
    rawSlotId: 2,
    fields: { status: { ok: true, value: "Normal" } },
    inputSources: [{ sourceId: 2, fields: { status: { ok: true, value: 1 } } }]
  }] };
  sample.outputSlots = { count: 1, slots: [{
    slotId: "O-11",
    rawSlotId: 10,
    fields: { status: { ok: true, value: "Normal" } },
    outputPorts: [{ portId: 4, status: 1 }]
  }] };

  canonicalizeIo(sample, "api");

  assert.deepEqual(
    sample.inventory.entities.map((entity) => entity.id),
    ["input:I-3", "input:I-3:2", "output:O-11", "output:O-11:4"]
  );
  assert.equal(sample.inventory.entities.find((entity) => entity.id === "input:I-3:2").parentId, "input:I-3");
  assert.equal(sample.observations.items.find((item) => item.entityId === "input:I-3:2").source, "api");
  assert.equal(sample.observations.items.find((item) => item.entityId === "input:I-3:2").fields.status.value, 1);
});

test("SNMP and API produce the same canonical IDs for the same physical IO", () => {
  const api = data("50 Hz", "1");
  api.inputSlots = { slots: [{ slotId: "I-3", rawSlotId: 2, inputSources: [{ sourceId: 1, fields: {} }] }] };
  const snmp = data("50 Hz", "1");
  snmp.inputSlots = { slots: [{ slotId: 3, inputSources: [{ inputSlotId: 3, sourceId: 1, fields: {} }] }] };

  canonicalizeIo(api, "api");
  canonicalizeIo(snmp, "snmp");

  assert.equal(api.inventory.entities.find((item) => item.kind === "input").id, "input:I-3:1");
  assert.equal(snmp.inventory.entities.find((item) => item.kind === "input").id, "input:I-3:1");
});

test("hybrid reconciliation keeps both observations and prefers SNMP for operational state", () => {
  const api = data("50 Hz", "1");
  api.inputSlots = { slots: [{ slotId: "I-3", rawSlotId: 2, inputSources: [
    { sourceId: 1, fields: { status: { ok: true, value: "Normal" } } }
  ] }] };
  const snmp = data("50 Hz", "1");
  snmp.inputSlots = { slots: [{ slotId: 3, inputSources: [
    { sourceId: 1, fields: { status: { ok: true, value: 0 } } },
    { sourceId: 2, fields: { status: { ok: true, value: 1 } } }
  ] }] };
  canonicalizeIo(api, "api");
  canonicalizeIo(snmp, "snmp");

  const hybrid = { timestamp: new Date().toISOString() };
  combineIo(hybrid, [snmp, api]);

  assert.deepEqual(hybrid.observations.items.filter((item) => item.entityId === "input:I-3:1").map((item) => item.source), ["snmp", "api"]);
  assert.equal(hybrid.resolvedState["input:I-3:1"].source, "snmp");
  assert.equal(hybrid.resolvedState["input:I-3:1"].state, "inactive");
  assert.equal(hybrid.resolvedState["input:I-3:1"].agreement, false);
  assert.ok(hybrid.inventory.entities.some((entity) => entity.id === "input:I-3:2"));
  assert.deepEqual(hybrid.divergences.summary, {
    total: 2,
    affectedEntities: 2,
    missingObservations: 1,
    missingFields: 0,
    stateMismatches: 1,
    valueMismatches: 0
  });
  const statusDifference = hybrid.divergences.items.find((item) => item.entityId === "input:I-3:1" && item.field === "status");
  assert.equal(statusDifference.reason, "state-mismatch");
  assert.deepEqual(statusDifference.observations.snmp, {
    present: true,
    observedAt: snmp.timestamp,
    value: 0,
    state: "inactive"
  });
  assert.equal(statusDifference.observations.api.value, "Normal");
  assert.deepEqual(statusDifference.selected, { source: "snmp", state: "inactive", value: 0 });
  const missingFromApi = hybrid.divergences.items.find((item) => item.entityId === "input:I-3:2");
  assert.equal(missingFromApi.reason, "missing-observation");
  assert.equal(missingFromApi.observations.api.present, false);
  assert.equal(hybrid.resolvedState["input:I-3:2"].agreement, false);
});

test("hybrid monitoring prefers API Genlock status and frame", () => {
  const snmp = data("50 Hz", "1");
  snmp.controller.genlockStatus = { ok: true, value: "Normal" };
  snmp.controller.genlockFrame = { ok: true, value: "50 Hz" };
  const api = data("0 Hz", "1");
  api.controller.genlockStatus = { ok: false, value: "Anomalie (2)" };
  api.controller.genlockFrame = { ok: true, value: "0 Hz" };

  const hybrid = buildHybridMonitor(snmp, api);

  assert.deepEqual(hybrid.controller.genlockStatus, api.controller.genlockStatus);
  assert.deepEqual(hybrid.controller.genlockFrame, api.controller.genlockFrame);
  assert.equal(buildMonitoringView(hybrid).systemHealth.find(item => item.label === "Genlock").state, "warning");
});

test("hybrid monitoring falls back to SNMP when API Genlock collection fails", () => {
  const snmp = data("50 Hz", "1");
  const api = data("", "1");
  api.controller.genlockStatus = { ok: false, value: null, error: "API unavailable" };

  assert.deepEqual(buildHybridMonitor(snmp, api).controller.genlockStatus, snmp.controller.genlockStatus);
});

test("divergence report compares semantic states before raw API and SNMP values", () => {
  const api = data("50 Hz", "1");
  api.inputSlots = { slots: [{ slotId: "I-1", inputSources: [{ sourceId: 1, fields: {
    status: { ok: true, value: "Normal" },
    type: { ok: true, value: "HDMI" },
    firmware: { ok: true, value: "1.0" }
  } }] }] };
  const snmp = data("50 Hz", "1");
  snmp.inputSlots = { slots: [{ slotId: 1, inputSources: [{ sourceId: 1, fields: {
    status: { ok: true, value: 1 },
    type: { ok: true, value: "DVI" }
  } }] }] };
  canonicalizeIo(api, "api");
  canonicalizeIo(snmp, "snmp");
  const hybrid = { timestamp: new Date().toISOString() };
  combineIo(hybrid, [snmp, api]);

  const differences = hybrid.divergences.items.filter((item) => item.entityId === "input:I-1:1");
  assert.equal(differences.some((item) => item.field === "status"), false);
  assert.equal(differences.find((item) => item.field === "type").reason, "value-mismatch");
  assert.equal(differences.find((item) => item.field === "firmware").reason, "missing-field");
});

test("IO reconciliation applies best, worst and source-priority strategies", () => {
  const source = (name, value) => {
    const sample = data("50 Hz", "1");
    sample.inputSlots = { slots: [{ slotId: 1, inputSources: [{ sourceId: 1, fields: {
      status: { ok: true, value }
    } }] }] };
    sample.source = name;
    return canonicalizeIo(sample, name);
  };
  const snmp = source("snmp", 0);
  const api = source("api", "Normal");
  const resolved = (operationalStrategy) => {
    const hybrid = { timestamp: new Date().toISOString() };
    combineIo(hybrid, [snmp, api], { operational_strategy: operationalStrategy });
    return hybrid.resolvedState["input:I-1:1"];
  };

  assert.deepEqual([resolved("worst-valid-state").state, resolved("worst-valid-state").reason], ["inactive", "worst-state-on-conflict"]);
  assert.deepEqual([resolved("best-valid-state").state, resolved("best-valid-state").source], ["ok", "api"]);
  assert.equal(resolved("snmp-first").source, "snmp");
  assert.equal(resolved("api-first").source, "api");
  assert.deepEqual([resolved("unknown-on-conflict").state, resolved("unknown-on-conflict").source], ["unknown", "none"]);
});

test("inactive NovaStar inputs and outputs stay inactive after canonical reconciliation", () => {
  const sample = data("50 Hz", "1");
  sample.inputSlots = { slots: [{ slotId: 1, inputSources: [{ sourceId: 1, fields: {
    status: { ok: true, value: 0 }
  } }] }] };
  sample.outputSlots = { slots: [{ slotId: 2, outputPorts: [{ portId: 1, status: 0 }] }] };
  canonicalizeIo(sample, "snmp");

  assert.equal(sample.resolvedState["input:I-1:1"].state, "inactive");
  assert.equal(sample.resolvedState["output:O-2:1"].state, "inactive");
  const view = buildMonitoringView(sample);
  assert.equal(view.inputSlots[0].state, "inactive");
  assert.equal(view.outputSlots[0].state, "inactive");
  assert.equal(view.inputSlots[0].ok, null);
  assert.equal(view.outputSlots[0].ok, null);
});

test("receiving-card probes do not duplicate output ports in monitoring references", () => {
  const sample = data("50 Hz", "1");
  sample.outputSlots = { slots: [{
    slotId: "O-11", rawSlotId: 10,
    outputPorts: [{ portId: 1, fields: { status: { ok: true, value: 1 } } }]
  }] };
  sample.receivingCards = [{
    outputSlotId: 10, netPortId: 0, recvCardId: 0,
    fields: { status: { ok: true, value: 1 } }
  }];
  canonicalizeIo(sample, "snmp");

  const view = buildMonitoringView(sample);
  const snapshot = buildReferenceSnapshot(view);
  assert.equal(view.receivingCards.length, 1);
  assert.equal(Object.keys(snapshot.controls).some((key) => key.includes("receiving")), false);

  snapshot.controls["receiving:11:1:1"] = "error";
  const compared = applyReferenceMode({ monitoringReference: { setAt: new Date().toISOString(), snapshot } }, view, true);
  assert.equal(compared.state, "ok");
  assert.equal(compared.receivingCards[0].changed, undefined);
});

test("IO reconciliation inventory strategy can use union, intersection or one source", () => {
  const api = data("50 Hz", "1");
  api.inputSlots = { slots: [{ slotId: 1, inputSources: [{ sourceId: 1, fields: { status: { ok: true, value: 1 } } }] }] };
  const snmp = data("50 Hz", "1");
  snmp.inputSlots = { slots: [{ slotId: 1, inputSources: [{ sourceId: 2, fields: { status: { ok: true, value: 1 } } }] }] };
  canonicalizeIo(api, "api");
  canonicalizeIo(snmp, "snmp");
  const ids = (strategy) => {
    const hybrid = {};
    combineIo(hybrid, [snmp, api], { inventory_strategy: strategy });
    return hybrid.inventory.entities.map((item) => item.id);
  };

  assert.deepEqual(ids("union-api-first"), ["input:I-1", "input:I-1:1", "input:I-1:2"]);
  assert.deepEqual(ids("intersection"), ["input:I-1"]);
  assert.deepEqual(ids("api-only"), ["input:I-1", "input:I-1:1"]);
  assert.deepEqual(ids("snmp-only"), ["input:I-1", "input:I-1:2"]);
});

test("Kiloview monitoring exposes system, network, video, audio and NDI groups", () => {
  const field = (value, ok = true) => ({ value, ok });
  const view = buildMonitoringView({
    type: "kiloview", timestamp: new Date().toISOString(),
    controller: {
      workingStatus: field("ready"), kiloviewMode: field("encoder"), cpuLoad: field("18%"),
      memoryUsed: field("128 Mo"), networkState: field("eth0: up"), networkInterfaces: field("eth0"),
      videoSignal: field("HDMI"), videoResolution: field("1920x1080p50"), videoBitrate: field("12000 Kbit/s"),
      audioPresence: field("present"), audioFormat: field("PCM"), ndiDeviceName: field("Kiloview Simulator"),
      ndiChannelName: field("Camera 1"), ndiConnection: field("multicast")
    },
    inputSlots: { slots: [] }, outputSlots: { slots: [] }, screens: { screens: [] }, receivingCards: []
  });
  assert.deepEqual(view.kiloviewGroups.map((group) => group.title), ["Systeme", "Reseau", "Video", "Audio", "Encodeur NDI"]);
  assert.equal(view.kiloviewGroups.find((group) => group.title === "Video").items[0].value, "HDMI");
});

test("Kiloview bitrate reference comparison uses the configured Mbps threshold", () => {
  const kiloviewData = (bitrate) => ({
    type: "kiloview", timestamp: new Date().toISOString(),
    controller: {
      workingStatus: { value: "ready", ok: true },
      kiloviewMode: { value: "encoder", ok: true },
      videoBitrate: { value: bitrate + " Kbit/s", ok: true }
    },
    inputSlots: { slots: [] }, outputSlots: { slots: [] }, screens: { screens: [] }, receivingCards: []
  });
  const referenceView = buildMonitoringView(kiloviewData(12000));
  const machine = {
    type: "kiloview",
    kiloviewBitrateThresholdMbps: 1,
    monitoringReference: { setAt: new Date().toISOString(), snapshot: buildReferenceSnapshot(referenceView) }
  };

  assert.equal(applyReferenceMode(machine, buildMonitoringView(kiloviewData(12999)), true).state, "ok");
  assert.equal(applyReferenceMode(machine, buildMonitoringView(kiloviewData(13000)), true).state, "ok");
  const overThreshold = applyReferenceMode(machine, buildMonitoringView(kiloviewData(13001)), true);
  assert.equal(overThreshold.state, "warning");
  const bitrateItem = overThreshold.kiloviewGroups.find((group) => group.title === "Video").items.find((item) => item.referenceKey === "kiloview:videoBitrate");
  assert.equal(bitrateItem.changed, true);
  assert.equal(bitrateItem.referenceExpectedValue, "12000 Kbit/s");
  assert.equal(bitrateItem.referenceToleranceMbps, 1);
});

test("NETGEAR M4300 monitoring maps link, optical speed and optional PoE", () => {
  const field = (value) => ({ value, ok: true });
  const view = buildMonitoringView({
    type: "netgear-m4300", timestamp: new Date().toISOString(),
    controller: { workingStatus: field("Online"), model: field("NETGEAR M4300") },
    netgearPorts: [
      { index: 1, name: "1/0/1", media: "copper", speedMbps: 1000, adminUp: true, linkUp: false },
      { index: 25, name: "SFP+ 1/0/25", media: "fiber", speedMbps: 10000, adminUp: true, linkUp: true,
        poe: { supported: true, enabled: true, delivering: true } }
    ],
    inputSlots: { slots: [] }, outputSlots: { slots: [] }, screens: { screens: [] }, receivingCards: []
  });
  assert.equal(view.netgearPorts[0].state, "warning");
  assert.equal(view.netgearPorts[1].state, "ok");
  assert.equal(view.netgearPorts[1].speed, "10 Gb/s");
  assert.equal(view.netgearPorts[1].poe, "PoE On");
});

test("NETGEAR M4300 uses its SNMP v2c connector and forwards the PoE option", async () => {
  let connectorOptions;
  let monitorOptions;
  class FakeNetgearConnector {
    constructor(options) { connectorOptions = options; }
    async monitor(options) {
      monitorOptions = options;
      return {
        controller: { workingStatus: { value: "Online", ok: true } }, netgearPorts: [],
        inputSlots: { slots: [] }, outputSlots: { slots: [] }, screens: { screens: [] }, receivingCards: []
      };
    }
  }
  const monitor = createDeviceMonitor({ NetgearM4300SnmpConnector: FakeNetgearConnector });
  const result = await monitor.monitor({ id: "sw1", type: "netgear-m4300", host: "192.0.2.20", readCommunity: "monitor", includePoe: true });
  assert.equal(connectorOptions.readCommunity, "monitor");
  assert.deepEqual(monitorOptions, { includePoe: true });
  assert.equal(result.type, "netgear-m4300");
});

test("monitoring emits initialization, light telemetry and significant changes", async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tav-monitoring-"));
  const store = new MachineStore(path.join(folder, "machines.json"));
  store.save([{ id: "m1", type: "novastar-h", name: "Main", host: "192.0.2.10" }]);
  const samples = [data("50 Hz", "1"), data("50 Hz", "2"), data("60 Hz", "3")];
  const service = new MonitoringService({
    store,
    config: { monitor_interval_s: 0, monitoring_reference_mode: false, max_parallel_scans: 1 },
    deviceMonitor: { monitor: async () => samples.shift() }
  });
  const messages = [];
  service.on("message", (message) => messages.push(message));
  t.after(() => { service.stop(); fs.rmSync(folder, { recursive: true, force: true }); });

  await service.scanMachine("m1");
  await service.scanMachine("m1");
  await service.scanMachine("m1");
  assert.deepEqual(messages.map((message) => message.type), ["monitoring.initialized", "telemetry.patch", "monitoring.changed"]);
  assert.equal(messages[1].changes["controller.workingTime.value"], "2");
  assert.equal(messages[2].monitoring.view.systemHealth.some((item) => item.referenceKey === "health:genlock"), true);
});

test("start performs an immediate scan even when periodic monitoring is disabled", async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tav-monitoring-start-"));
  const store = new MachineStore(path.join(folder, "machines.json"));
  store.save([{ id: "m1", name: "Main", host: "192.0.2.10" }]);
  let scans = 0;
  const service = new MonitoringService({ store, config: { monitor_interval_s: 0, monitoring_reference_mode: false, max_parallel_scans: 1 }, deviceMonitor: { monitor: async () => { scans += 1; return data("50 Hz", "1"); } } });
  t.after(() => { service.stop(); fs.rmSync(folder, { recursive: true, force: true }); });
  await service.start();
  assert.equal(scans, 1);
  assert.equal(service.snapshot().machines.length, 1);
});

test("Ping reference stores exactly the machines responding at snapshot time", async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tav-monitoring-ping-reference-"));
  const store = new MachineStore(path.join(folder, "machines.json"));
  store.save([
    { id: "ping-up", type: "other", name: "Up", host: "192.0.2.1" },
    { id: "ping-down", type: "other", name: "Down", host: "192.0.2.2" }
  ]);
  let pingUpResponds = true;
  const service = new MonitoringService({
    store,
    config: { monitor_interval_s: 0, monitoring_reference_mode: true, max_parallel_scans: 2 },
    deviceMonitor: { monitor: async (machine) => {
      if (machine.id === "ping-down" || !pingUpResponds) throw new Error("Machine offline");
      return { ...data("50 Hz", "1"), machineId: machine.id, type: "other", host: machine.host };
    } }
  });
  t.after(() => { service.stop(); fs.rmSync(folder, { recursive: true, force: true }); });

  assert.throws(() => service.buildPingReference(), /completed Ping scan/);
  await service.scanAll();
  assert.equal(service.records.get("ping-up").view.state, "ok");
  assert.equal(service.records.get("ping-down").view.state, "offline");
  assert.deepEqual(service.buildPingReference().respondingMachineIds, ["ping-up"]);
  const lastSuccessfulAt = service.records.get("ping-up").lastSuccessfulAt;
  assert.ok(lastSuccessfulAt);
  pingUpResponds = false;
  await service.scanMachine("ping-up");
  assert.equal(service.records.get("ping-up").view.state, "offline");
  assert.equal(service.records.get("ping-up").lastSuccessfulAt, lastSuccessfulAt);
});

test("scanAll scans machines concurrently up to max_parallel_scans", async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tav-monitoring-parallel-"));
  const store = new MachineStore(path.join(folder, "machines.json"));
  store.save(Array.from({ length: 5 }, (_, index) => ({
    id: `m${index + 1}`,
    name: `Machine ${index + 1}`,
    host: `192.0.2.${index + 1}`
  })));

  let active = 0;
  let maxActive = 0;
  const service = new MonitoringService({
    store,
    config: { monitor_interval_s: 0, monitoring_reference_mode: false, max_parallel_scans: 3 },
    deviceMonitor: {
      monitor: async (machine) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 30));
        active -= 1;
        return { ...data("50 Hz", "1"), machineId: machine.id, host: machine.host };
      }
    }
  });
  t.after(() => { service.stop(); fs.rmSync(folder, { recursive: true, force: true }); });

  await service.scanAll();
  assert.equal(maxActive, 3);
  assert.equal(service.snapshot().machines.length, 5);
});

test("periodic API scans leave NovaStar SNMP work to the per-machine workers", async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tav-monitoring-snmp-workers-"));
  const store = new MachineStore(path.join(folder, "machines.json"));
  store.save([
    { id: "hybrid", type: "novastar-h", name: "Hybrid", host: "192.0.2.10", accessMethod: "snmp+api", snmpScanIntervalS: 240 },
    { id: "snmp", type: "novastar-h", name: "SNMP", host: "192.0.2.11", accessMethod: "snmp", snmpScanIntervalS: 300 },
    { id: "api", type: "novastar-h", name: "API", host: "192.0.2.12", accessMethod: "api" }
  ]);
  const calls = [];
  const service = new MonitoringService({
    store,
    config: { monitor_interval_s: 0, monitoring_reference_mode: false, max_parallel_scans: 3 },
    deviceMonitor: { monitor: async (machine, options) => {
      calls.push({ id: machine.id, options });
      return { ...data("50 Hz", "1"), machineId: machine.id, host: machine.host };
    } }
  });
  t.after(() => { service.stop(); fs.rmSync(folder, { recursive: true, force: true }); });

  service.refreshInterval();
  assert.deepEqual(Array.from(service.snmpWorkers.keys()).sort(), ["hybrid", "snmp"]);
  await service.scanAll({ periodic: true });
  assert.deepEqual(calls.map((call) => call.id).sort(), ["api", "hybrid"]);
  assert.equal(calls.every((call) => call.options.skipSnmp === true), true);
});

test("NovaStar SNMP scan settings default to ten minutes and enforce four minutes", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tav-monitoring-snmp-config-"));
  const store = new MachineStore(path.join(folder, "machines.json"));
  try {
    store.save([
      { id: "default", type: "novastar-h", name: "Default", host: "192.0.2.20", accessMethod: "snmp+api" },
      { id: "short", type: "novastar-h", name: "Short", host: "192.0.2.21", accessMethod: "snmp", snmpScanIntervalS: 120 },
      { id: "api", type: "novastar-h", name: "API", host: "192.0.2.22", accessMethod: "api", snmpScanEnabled: true }
    ]);
    const machines = store.load();
    assert.deepEqual(
      machines.map((machine) => [machine.id, machine.snmpScanEnabled, machine.snmpScanIntervalS]),
      [["default", true, 600], ["short", true, 240], ["api", false, 600]]
    );
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test("manual scans honor the NovaStar Scan SNMP checkbox", async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tav-monitoring-manual-snmp-option-"));
  const store = new MachineStore(path.join(folder, "machines.json"));
  store.save([
    { id: "hybrid-off", type: "novastar-h", name: "Hybrid off", host: "192.0.2.30", accessMethod: "snmp+api", snmpScanEnabled: false },
    { id: "snmp-off", type: "novastar-h", name: "SNMP off", host: "192.0.2.31", accessMethod: "snmp", snmpScanEnabled: false }
  ]);
  const calls = [];
  const service = new MonitoringService({
    store,
    config: { monitor_interval_s: 0, monitoring_reference_mode: false, max_parallel_scans: 2 },
    deviceMonitor: { monitor: async (machine, options) => {
      calls.push({ id: machine.id, options });
      return { ...data("50 Hz", "1"), machineId: machine.id, host: machine.host };
    } }
  });
  t.after(() => { service.stop(); fs.rmSync(folder, { recursive: true, force: true }); });

  await service.scanMachine("hybrid-off", true);
  const snmpOnlyResult = await service.scanMachine("snmp-off", true);
  assert.deepEqual(calls, [{ id: "hybrid-off", options: { skipSnmp: true } }]);
  assert.equal(snmpOnlyResult, null);
});

test("NovaStar SNMP lock serializes different machine IDs sharing one host and port", async () => {
  let active = 0;
  let maximumActive = 0;
  const order = [];
  class SlowSnmpConnector {
    constructor(options) { this.options = options; }
    async monitor() {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      order.push("start:" + this.options.host + ":" + this.options.port);
      await new Promise((resolve) => setTimeout(resolve, 15));
      order.push("end:" + this.options.host + ":" + this.options.port);
      active -= 1;
      return { host: this.options.host, controller: {}, inputSlots: [], outputSlots: [], screens: [] };
    }
  }
  const monitor = createDeviceMonitor({ SNMPConnector: SlowSnmpConnector });
  await Promise.all([
    monitor.monitor({ id: "old-id", type: "novastar-h", host: "192.0.2.80", snmpPort: 1161, accessMethod: "snmp" }),
    monitor.monitor({ id: "new-id", type: "novastar-h", host: "192.0.2.80", snmpPort: 1161, accessMethod: "snmp" })
  ]);
  assert.equal(maximumActive, 1);
  assert.deepEqual(order, [
    "start:192.0.2.80:1161", "end:192.0.2.80:1161",
    "start:192.0.2.80:1161", "end:192.0.2.80:1161"
  ]);
});

test("NovaStar SNMP lock keeps distinct host-port agents independent", async () => {
  let active = 0;
  let maximumActive = 0;
  class SlowSnmpConnector {
    constructor(options) { this.options = options; }
    async monitor() {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return { host: this.options.host, controller: {}, inputSlots: [], outputSlots: [], screens: [] };
    }
  }
  const monitor = createDeviceMonitor({ SNMPConnector: SlowSnmpConnector });
  await Promise.all([
    monitor.monitor({ id: "one", type: "novastar-h", host: "192.0.2.81", snmpPort: 161, accessMethod: "snmp" }),
    monitor.monitor({ id: "two", type: "novastar-h", host: "192.0.2.82", snmpPort: 161, accessMethod: "snmp" })
  ]);
  assert.equal(maximumActive, 2);
});

test("NovaStar trap configuration and scan share the same host-port lock", async () => {
  let active = 0;
  let maximumActive = 0;
  class SlowSnmpConnector {
    constructor(options) { this.options = options; }
    async monitor() {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return { host: this.options.host, controller: {}, inputSlots: [], outputSlots: [], screens: [] };
    }
    async configureTrapReporting() {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return { configured: true };
    }
    async getString() { return "192.0.2.10:1162"; }
    async getNumber() { return 1; }
  }
  const monitor = createDeviceMonitor({ SNMPConnector: SlowSnmpConnector });
  const machine = { id: "shared", type: "novastar-h", host: "192.0.2.83", snmpPort: 161,
    accessMethod: "snmp", trapSnmpEnabled: true };
  await Promise.all([
    monitor.monitor(machine),
    monitor.configureTraps(machine, { enabled: true, configure_devices: true,
      advertised_address: "192.0.2.10", port: 1162 })
  ]);
  assert.equal(maximumActive, 1);
});

test("Scan SNMP and Trap SNMP support all four independent combinations", async (t) => {
  const combinations = [
    { id: "none", snmpScanEnabled: false, trapSnmpEnabled: false },
    { id: "scan", snmpScanEnabled: true, trapSnmpEnabled: false },
    { id: "trap", snmpScanEnabled: false, trapSnmpEnabled: true },
    { id: "both", snmpScanEnabled: true, trapSnmpEnabled: true }
  ].map((item, index) => Object.assign({
    type: "novastar-h", name: itemName(item.id), host: `192.0.2.${50 + index}`,
    accessMethod: "snmp+api", snmpScanIntervalS: 240
  }, item));
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tav-monitoring-snmp-options-"));
  const store = new MachineStore(path.join(folder, "machines.json"));
  store.save(combinations);
  const configured = [];
  class FakeSnmpConnector {
    constructor(options) { this.host = options.host; }
    async configureTrapReporting() { configured.push(this.host); return { ok: true }; }
    async getString() { return "192.0.2.1:1162"; }
    async getNumber() { return 1; }
  }
  const monitor = createDeviceMonitor({ SNMPConnector: FakeSnmpConnector });
  const trapConfig = { enabled: true, configure_devices: true, advertised_address: "192.0.2.1", port: 1162 };
  const service = new MonitoringService({
    store,
    config: { monitor_interval_s: 0, monitoring_reference_mode: false, max_parallel_scans: 4 },
    deviceMonitor: monitor
  });
  t.after(() => { service.stop(); fs.rmSync(folder, { recursive: true, force: true }); });

  service.refreshInterval();
  assert.deepEqual(Array.from(service.snmpWorkers.keys()).sort(), ["both", "scan"]);
  for (const machine of store.load()) await monitor.configureTraps(machine, trapConfig);
  assert.deepEqual(configured.sort(), ["192.0.2.52", "192.0.2.53"]);
});

test("NovaStar trap status distinguishes SET success from confirmed readback", async () => {
  class FakeSnmpConnector {
    async configureTrapReporting() { return { ok: true }; }
    async getString() { return "192.0.2.10:1162"; }
    async getNumber() { return 1; }
  }
  const monitor = createDeviceMonitor({ SNMPConnector: FakeSnmpConnector });
  const machine = { id: "verified", type: "novastar-h", host: "192.0.2.90", trapSnmpEnabled: true };
  await monitor.configureTraps(machine, { enabled: true, configure_devices: true,
    advertised_address: "192.0.2.10", port: 1162 });
  const status = monitor.trapStatus(machine.id);
  assert.equal(status.setSucceeded, true);
  assert.equal(status.configured, true);
  assert.equal(status.reportingEnabled, true);
  assert.equal(status.destination, "192.0.2.10:1162");
  assert.equal(Number.isNaN(new Date(status.verifiedAt).getTime()), false);
  assert.equal(Object.prototype.hasOwnProperty.call(status, "readCommunity"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(status, "writeCommunity"), false);
});

test("NovaStar trap status reports a mismatching readback without marking it configured", async () => {
  class FakeSnmpConnector {
    async configureTrapReporting() { return { ok: true }; }
    async getString() { return "192.0.2.99:1162"; }
    async getNumber() { return 0; }
  }
  const monitor = createDeviceMonitor({ SNMPConnector: FakeSnmpConnector });
  const machine = { id: "mismatch", type: "novastar-h", host: "192.0.2.91", trapSnmpEnabled: true };
  await monitor.configureTraps(machine, { enabled: true, configure_devices: true,
    advertised_address: "192.0.2.10", port: 1162 });
  const status = monitor.trapStatus(machine.id);
  assert.equal(status.setSucceeded, true);
  assert.equal(status.configured, false);
  assert.equal(status.reportingEnabled, false);
  assert.match(status.error, /readback/i);
});

test("a periodic API lane continues while the same NovaStar SNMP lane is active", async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tav-monitoring-api-lane-"));
  const store = new MachineStore(path.join(folder, "machines.json"));
  store.save([{ id: "hybrid", type: "novastar-h", name: "Hybrid", host: "192.0.2.60", accessMethod: "snmp+api" }]);
  let releaseSnmp;
  let fullStarted = false;
  let apiCompleted = false;
  const snmpGate = new Promise((resolve) => { releaseSnmp = resolve; });
  const service = new MonitoringService({
    store,
    config: { monitor_interval_s: 0, monitoring_reference_mode: false, max_parallel_scans: 2 },
    deviceMonitor: { monitor: async (machine, options) => {
      if (!options.skipSnmp) {
        fullStarted = true;
        await snmpGate;
      } else {
        apiCompleted = true;
      }
      return { ...data("50 Hz", options.skipSnmp ? "api" : "snmp"), machineId: machine.id, host: machine.host };
    } }
  });
  t.after(() => { service.stop(); fs.rmSync(folder, { recursive: true, force: true }); });

  const snmpScan = service.scanMachine("hybrid", false, { snmpPeriodic: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fullStarted, true);
  await service.scanMachine("hybrid", false, { periodic: true });
  assert.equal(apiCompleted, true);
  releaseSnmp();
  await snmpScan;
});

function itemName(value) { return value.charAt(0).toUpperCase() + value.slice(1); }

test("SNMP controller fields are read concurrently and fail fast when the device is absent", async () => {
  const connector = new SNMPConnector({ host: "192.0.2.1", timeout: 500, retries: 0 });
  let active = 0;
  let maxActive = 0;
  connector.readField = async ({ key, oid }) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return { ok: false, value: null, oid, error: `${key} timeout` };
  };

  await assert.rejects(() => connector.readController(), /SNMP device unavailable/);
  assert.equal(maxActive, 19);
});

test("NovaStar SNMP defaults use public for both read and write communities", () => {
  const connector = new SNMPConnector({ host: "192.0.2.1" });

  assert.equal(connector.readCommunity, "public");
  assert.equal(connector.writeCommunity, "public");
});

test("NovaStar monitor exposes only the canonical IO contract", async () => {
  class FakeSnmpConnector {
    async monitor() {
      return {
        timestamp: new Date().toISOString(),
        controller: { workingStatus: { ok: true, value: "Online" } },
        inputSlots: { slots: [{ slotId: 1, inputSources: [] }] },
        outputSlots: { slots: [] }, screens: { screens: [] }, receivingCards: []
      };
    }
  }
  const monitor = createDeviceMonitor({ SNMPConnector: FakeSnmpConnector });
  const result = await monitor.monitor({ id: "nova-1", type: "novastar-h", host: "192.0.2.30" });

  ["inputSlots", "outputSlots", "screens", "receivingCards"].forEach((key) => {
    assert.equal(Object.prototype.hasOwnProperty.call(result, key), false);
  });
  assert.ok(result.inventory.entities.some((entity) => entity.id === "input:I-1"));
  assert.ok(result.observations.items.some((item) => item.entityId === "input:I-1"));
});

test("NovaStar SNMP scans physical slot IDs and skips unpopulated gaps", async () => {
  const connector = new SNMPConnector({ host: "192.0.2.1" });
  const operations = [];

  connector.getNumber = async (oid) => {
    if (oid === SNMPConnector.OIDS.inputSlotCount) return 2;
    if (oid === SNMPConnector.OIDS.outputSlotCount) return 2;
    if (oid === SNMPConnector.OIDS.screenCount) return 2;
    throw new Error(`Unexpected count OID: ${oid}`);
  };
  connector.setSelector = async (oid, type, value) => {
    operations.push(["set", oid, type, value]);
    return null;
  };
  connector.readInputSources = async () => [];
  connector.readFieldsSequential = async (definitions) => {
    operations.push(["get", definitions.map((definition) => definition.oid)]);
    const selector = operations.filter((operation) => operation[0] === "set").at(-1);
    const selectedId = selector && selector[3];
    const populated = selector && (
      (selector[1] === SNMPConnector.OIDS.inputSlotSelector && (selectedId === 0 || selectedId === 2)) ||
      (selector[1] === SNMPConnector.OIDS.outputSlotSelector && (selectedId === 10 || selectedId === 11))
    );
    return Object.fromEntries(definitions.map((definition) => [
      definition.key,
      populated
        ? { ok: true, value: definition.key === "sourceCount" ? 4 : definition.key === "netPortCount" ? 16 : definition.key === "serial" ? `serial-${selectedId}` : 1, oid: definition.oid }
        : { ok: false, value: "ERROR: the slot is empty", oid: definition.oid, state: "notApplicable" }
    ]));
  };

  await connector.readInputSlots();
  await connector.readOutputSlots();

  operations.forEach((operation, index) => {
    if (operation[0] === "get") assert.equal(operations[index - 1][0], "set");
  });

  assert.deepEqual(
    operations
      .filter((operation) => operation[0] === "set" && operation[1] === SNMPConnector.OIDS.inputSlotSelector)
      .map((operation) => operation[3]),
    [0, 1, 2, 0, 2]
  );
  assert.deepEqual(
    operations
      .filter((operation) => operation[0] === "set" && operation[1] === SNMPConnector.OIDS.outputSlotSelector)
      .map((operation) => operation[3]),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  );
});

test("NovaStar SNMP uses global scalar input selectors and exact output JSON key casing", () => {
  const connector = new SNMPConnector({ host: "192.0.2.1" });

  assert.equal(connector.buildInputSourceSelector({ globalSourceId: 4 }), "4");
  assert.equal(
    connector.buildReceivingCardSelector({ outputSlotId: 10, netPortId: 0, recvCardId: 0 }),
    '{"outputSlotId":10,"netPortId":0,"recvCardId":0}'
  );
});

test("NovaStar SNMP assigns cumulative global source IDs across non-contiguous input slots", async () => {
  const connector = new SNMPConnector({ host: "192.0.2.1" });
  const selectedSources = [];
  connector.getNumber = async () => 2;
  connector.setSelector = async () => null;
  connector.readInputSlot = async (slotId) => ({
    slotId: `I-${slotId + 1}`,
    rawSlotId: slotId,
    selectorError: null,
    fields: (slotId === 0 || slotId === 2)
      ? { serial: { ok: true, value: `serial-${slotId}` }, sourceCount: { ok: true, value: 4 } }
      : { serial: { ok: false, value: "ERROR: the slot is empty" }, sourceCount: { ok: false, value: null } },
    inputSources: []
  });
  connector.readInputSource = async (selection) => {
    selectedSources.push(selection);
    return Object.assign({}, selection, { selectorError: null, fields: {} });
  };

  const result = await connector.readInputSlots();

  assert.deepEqual(result.slots.map((slot) => slot.slotId), ["I-1", "I-3"]);
  assert.deepEqual(selectedSources.map((source) => source.globalSourceId), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(result.slots[1].inputSources.map((source) => source.sourceId), [1, 2, 3, 4]);
});

test("NovaStar SNMP scans output ports from zero with receiving card zero", async () => {
  const connector = new SNMPConnector({ host: "192.0.2.1" });
  const selections = [];
  connector.readReceivingCard = async (selection) => {
    selections.push(selection);
    return Object.assign({}, selection, { selectorError: null, fields: {} });
  };

  await connector.readReceivingCards({
    slots: [{ slotId: "O-11", rawSlotId: 10, fields: { netPortCount: { ok: true, value: 3 } } }]
  });

  assert.deepEqual(selections, [
    { outputSlotId: 10, netPortId: 0, recvCardId: 0 },
    { outputSlotId: 10, netPortId: 1, recvCardId: 0 },
    { outputSlotId: 10, netPortId: 2, recvCardId: 0 }
  ]);
});

test("NovaStar SNMP output summary exposes a binary common status", async () => {
  const connector = new SNMPConnector({ host: "192.0.2.1" });
  let summary = { tempStatus: 0, workStatus: 1, voltStatus: 2, temp: 0, volt: 0, tempMax: 70 };
  const reads = [];
  connector.setSelector = async () => null;
  connector.readFieldsSequential = async (descriptors) => {
    reads.push(descriptors);
    return { summary: { ok: true, value: JSON.stringify(summary) } };
  };

  const active = await connector.readReceivingCard({ outputSlotId: 10, netPortId: 0, recvCardId: 0 });
  assert.equal(active.fields.status.value, 1);
  assert.equal(active.fields.temperatureStatus.value, 0);
  assert.deepEqual(reads[0], [{ key: "summary", oid: "1.3.6.1.4.1.319.10.10.30.6" }]);
  assert.equal(active.fields.workingStatus.value, 1);
  assert.equal(active.fields.voltageStatus.value, 2);

  summary = Object.assign({}, summary, { tempStatus: 2 });
  const inactive = await connector.readReceivingCard({ outputSlotId: 10, netPortId: 10, recvCardId: 0 });
  assert.equal(inactive.fields.status.value, 0);
  assert.equal(inactive.fields.temperatureStatus.value, 2);
});

test("NovaStar SNMP never reads a selector context after a failed SET", async () => {
  const connector = new SNMPConnector({ host: "192.0.2.1" });
  let reads = 0;
  connector.setSelector = async () => "timeout";
  connector.readFieldsSequential = async () => { reads += 1; return {}; };

  const slot = await connector.readInputSlot(0);
  const card = await connector.readReceivingCard({ outputSlotId: 10, netPortId: 0, recvCardId: 0 });

  assert.equal(reads, 0);
  assert.equal(slot.selectorError, "timeout");
  assert.equal(card.selectorError, "timeout");
});

test("hybrid output reconciliation compares API 2 or 3 with active SNMP without false divergence", () => {
  const source = (name, value) => {
    const sample = data("50 Hz", "1");
    sample.source = name;
    sample.outputSlots = { slots: [{
      slotId: "O-11",
      rawSlotId: 10,
      outputPorts: [{ portId: 1, fields: { status: { ok: true, value } } }]
    }] };
    return canonicalizeIo(sample, name);
  };
  const snmp = source("snmp", 1);

  for (const apiValue of [2, 3]) {
    const hybrid = {};
    combineIo(hybrid, [snmp, source("api", apiValue)]);
    assert.equal(hybrid.divergences.items.some((item) => item.entityId === "output:O-11:1" && item.field === "status"), false);
    assert.equal(hybrid.resolvedState["output:O-11:1"].agreement, true);
    assert.equal(hybrid.resolvedState["output:O-11:1"].source, "api");
  }
});
