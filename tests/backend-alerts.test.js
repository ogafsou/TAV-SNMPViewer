const test = require("node:test");
const assert = require("node:assert/strict");
const NtfyClient = require("../TAV_Monitoring_Backend/services/NtfyClient");
const AlertService = require("../TAV_Monitoring_Backend/services/AlertService");
const { canonicalizeIo } = require("../TAV_Monitoring_Backend/services/CanonicalIo");
const { buildMonitoringView, buildReferenceSnapshot, applyReferenceMode } = require("../TAV_Monitoring_Backend/services/MonitoringState");

function config(overrides) {
  return Object.assign({
    enabled: true, provider: "ntfy", server_url: "https://ntfy.sh",
    topic: "tav-test-topic", token: "", frontend_url: "https://example.test",
    failure_threshold: 2, recovery_threshold: 2, request_timeout_ms: 1000,
    notify_recovery: true
  }, overrides || {});
}

test("ntfy client sends a protected JSON notification without exposing configuration", async () => {
  let request;
  const client = new NtfyClient(config({ token: "secret-token" }), {
    fetch: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: "message-1" }) };
    }
  });
  const result = await client.send({ title: "Test", message: "Hello", priority: 4, tags: ["warning"] });
  const body = JSON.parse(request.options.body);
  assert.equal(request.url, "https://ntfy.sh/");
  assert.equal(request.options.headers.authorization, "Bearer secret-token");
  assert.equal(body.topic, "tav-test-topic");
  assert.equal(body.click, "https://example.test");
  assert.equal(result.id, "message-1");
});

test("alert service confirms incidents, avoids duplicates and notifies recovery", async () => {
  const sent = [];
  const notifier = { isConfigured: () => true, send: async (message) => { sent.push(message); return { ok: true }; } };
  const alerts = new AlertService({ config: config(), notifier });
  const machine = { id: "m1", name: "H9 Test", host: "192.0.2.10" };
  const healthy = record([]);
  const warning = record([{ label: "1", state: "warning", changed: true, referenceKey: "fan:1" }]);

  await alerts.handleRecord(machine, healthy);
  await alerts.handleRecord(machine, healthy);
  assert.equal(sent.length, 0);
  await alerts.handleRecord(machine, warning);
  assert.equal(sent.length, 0);
  await alerts.handleRecord(machine, warning);
  assert.equal(sent.length, 1);
  assert.match(sent[0].title, /WARNING/);
  assert.match(sent[0].message, /Machine : H9 Test/);
  await alerts.handleRecord(machine, warning);
  assert.equal(sent.length, 1);
  await alerts.handleRecord(machine, healthy);
  await alerts.handleRecord(machine, healthy);
  assert.equal(sent.length, 2);
  assert.match(sent[1].title, /RETABLI/);
});

test("offline machines produce a critical issue", () => {
  assert.deepEqual(AlertService.collectIssues({ connected: false }), [
    { key: "machine:offline", label: "Machine", state: "offline", referenceState: "online" }
  ]);
});

test("warning and error states identical to the reference are not alerted", () => {
  assert.deepEqual(AlertService.collectIssues(record([{
    label: "1", state: "error", changed: false, referenceKey: "fan:1"
  }]).view), []);
});

test("input alerts identify the machine, card, input number and interface type", async () => {
  const sent = [];
  const notifier = { isConfigured: () => true, send: async (message) => { sent.push(message); return { ok: true }; } };
  const alerts = new AlertService({ config: config({ failure_threshold: 1 }), notifier });
  await alerts.handleRecord({ id: "m2", name: "H5 Regie" }, recordWithInput({
    label: "I-2.3", state: "error", changed: true, icon: "hdmi", referenceKey: "input:I-2:3"
  }));
  assert.match(sent[0].title, /H5 Regie/);
  assert.match(sent[0].message, /Machine : H5 Regie/);
  assert.match(sent[0].message, /Carte d'entree I-2, entree 3 \(HDMI\): Erreur/);
});

function record(fans) {
  return {
    view: {
      connected: true, controller: [], inputSlots: [], outputSlots: [], screens: [],
      systemHealth: [], mvrCards: [], usbPorts: [], fans, powerSupplies: [], receivingCards: []
    }
  };
}

function recordWithInput(input) {
  const result = record([]);
  result.view.inputSlots = [input];
  return result;
}

test("all reference differences are alerted regardless of current visual state", () => {
  for (const state of ["ok", "inactive", "unknown", "warning", "error"]) {
    const item = { label: "1", state, referenceKey: "fan:1" };
    assert.equal(AlertService.collectIssues(record([{ ...item, changed: true }]).view).length, 1);
    assert.equal(AlertService.collectIssues(record([{ ...item, changed: false }]).view).length, 0);
    assert.equal(AlertService.collectIssues(record([item]).view).length, 0);
  }
});

test("NovaStar disconnection against an active reference alerts once and reconnecting confirms recovery", async () => {
  function view(status) {
    const data = { controller: {}, outputSlots: { slots: [{
      slotId: "O-1", outputPorts: [{ portId: 2, fields: { status: { value: status, ok: true } } }]
    }] } };
    canonicalizeIo(data, "api");
    return buildMonitoringView(data);
  }
  const machine = { id: "output-test", name: "NovaStar test", monitoringReference: {
    setAt: new Date().toISOString(), snapshot: buildReferenceSnapshot(view(1))
  } };
  const disconnected = { view: applyReferenceMode(machine, view(0), true) };
  const connected = { view: applyReferenceMode(machine, view(1), true) };
  assert.equal(disconnected.view.outputSlots[0].state, "inactive");
  assert.equal(disconnected.view.outputSlots[0].changed, true);
  const sent = [];
  const alerts = new AlertService({ config: config(), notifier: {
    isConfigured: () => true, send: async (message) => { sent.push(message); }
  } });
  await alerts.handleRecord(machine, disconnected);
  assert.equal(sent.length, 0);
  await alerts.handleRecord(machine, disconnected);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].priority, 5);
  assert.match(sent[0].message, /Carte de sortie O-1, sortie 2: Inactif/);
  await alerts.handleRecord(machine, disconnected);
  assert.equal(sent.length, 1);
  await alerts.handleRecord(machine, connected);
  assert.equal(sent.length, 1);
  await alerts.handleRecord(machine, connected);
  assert.equal(sent.length, 2);
  assert.match(sent[1].title, /RETABLI/);
  machine.monitoringReference.snapshot = buildReferenceSnapshot(view(0));
  assert.deepEqual(AlertService.collectIssues(applyReferenceMode(machine, view(0), true)), []);
});
