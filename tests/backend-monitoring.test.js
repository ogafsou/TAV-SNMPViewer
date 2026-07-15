const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { MachineStore } = require("../TAV_Monitoring_Backend/classes/MachineStore");
const MonitoringService = require("../TAV_Monitoring_Backend/services/MonitoringService");
const SNMPConnector = require("../TAV_Monitoring_Backend/classes/SnmpLib");
const { buildMonitoringView } = require("../TAV_Monitoring_Backend/services/MonitoringState");

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
  assert.deepEqual(buildMonitoringView(sample).inputSlots.map((item) => item.icon), ["bnc", "dvi", "dp"]);
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
