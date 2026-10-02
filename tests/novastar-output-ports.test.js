const test = require("node:test");
const assert = require("node:assert/strict");
const Connector = require("../TAV_Monitoring_Backend/classes/NovaStarApiLib-backup");
const { canonicalizeIo, combineIo } = require("../TAV_Monitoring_Backend/services/CanonicalIo");
const { buildMonitoringView } = require("../TAV_Monitoring_Backend/services/MonitoringState");
const captured = require("./fixtures/novastar-output-slots.json");

function normalize(detail = captured) {
  return Connector.normalizeApiMonitor({ host: "192.0.2.1", raw: { detail } });
}

test("captured NovaStar fiber card retains four groups of eight independent ports", () => {
  const data = normalize();
  assert.deepEqual(data.outputSlots.slots.map(s => s.outputPorts.length), [32, 4, 2, 4]);
  const ports = data.outputSlots.slots[0].outputPorts;
  assert.equal(new Set(ports.map(p => p.portId)).size, 32);
  canonicalizeIo(data, "api");
  const view = buildMonitoringView(data);
  assert.deepEqual(view.outputTables.slice(0, 4).map(g => g.label),
    ["O-13 / OPT 1", "O-13 / OPT 2", "O-13 / OPT 3", "O-13 / OPT 4"]);
  for (const group of view.outputTables.slice(0, 4)) {
    assert.deepEqual(group.ports.map(p => p.label), ["1", "2", "3", "4", "5", "6", "7", "8"]);
    assert.ok(group.ports.every(p => p.state === "inactive"));
  }
  assert.equal(new Set(view.outputSlots.map(p => p.referenceKey)).size, 42);
});

test("fiber child states stay independent and survive hybrid reconciliation", () => {
  const detail = structuredClone(captured);
  detail.slotList[0].senderInterfaceStatus[1].subsetStatus[0].status = 1;
  const api = normalize(detail);
  canonicalizeIo(api, "api");
  const snmp = { controller: {}, outputSlots: { slots: [{slotId: "O-13", fields: {}}] } };
  canonicalizeIo(snmp, "snmp");
  const combined = combineIo(Object.assign({}, api), [snmp, api]);
  const view = buildMonitoringView(combined);
  assert.equal(view.outputTables.find(g => g.label === "O-13 / OPT 2").ports[0].state, "ok");
  assert.equal(view.outputTables.find(g => g.label === "O-13 / OPT 1").ports[0].state, "inactive");
});

test("flat network outputs keep their existing numeric identifiers", () => {
  const data = normalize({slotList: [{slotId: 0, cardType: 2, status: 1,
    senderInterfaceStatus: [{id: 0, type: 0, status: 1}, {id: 1, type: 0, status: 0}]}]});
  assert.deepEqual(data.outputSlots.slots[0].outputPorts.map(p => p.portId), [1, 2]);
});

test("output connector types use the two captured card-specific mappings", () => {
  const data = normalize();
  const bySlot = new Map(data.outputSlots.slots.map(slot => [slot.slotId, slot.outputPorts]));
  assert.ok(bySlot.get("O-17").every(port => port.interfaceType === "HDMI (6)"));
  assert.ok(bySlot.get("O-19").every(port => port.interfaceType === "SDI (25)"));
});

test("type 6 and type 25 keep their default meaning outside those categories", () => {
  const data = normalize({slotList: [
    {slotId: 0, cardType: 2, cardCategory: 99, status: 1, interfaces: [{interfaceId: 0, interfaceType: 6, iSignal: 0}]},
    {slotId: 1, cardType: 2, cardCategory: 99, status: 1, interfaces: [{interfaceId: 0, interfaceType: 25, iSignal: 0}]}
  ]});
  assert.equal(data.outputSlots.slots[0].outputPorts[0].interfaceType, "SDI (6)");
  assert.equal(data.outputSlots.slots[1].outputPorts[0].interfaceType, "25");
});

test("captured input connector types 6 and 9 map to HDMI 2.0 and 3G-SDI", () => {
  const data = normalize({slotList: [
    {slotId: 0, cardType: 1, cardCategory: 11, status: 1, interfaces: [
      {interfaceId: 0, interfaceType: 6, iSignal: 2},
      {interfaceId: 1, interfaceType: 8, iSignal: 0}
    ]},
    {slotId: 6, cardType: 1, cardCategory: 0, status: 1, interfaces: [
      {interfaceId: 0, interfaceType: 9, iSignal: 0}
    ]}
  ]});
  assert.equal(data.inputSlots.slots[0].inputSources[0].fields.type.value, "HDMI 2.0 (6)");
  assert.equal(data.inputSlots.slots[0].inputSources[1].fields.type.value, "DisplayPort (8)");
  assert.equal(data.inputSlots.slots[1].inputSources[0].fields.type.value, "3G-SDI (9)");
  canonicalizeIo(data, "api");
  assert.deepEqual(buildMonitoringView(data).inputSlots.map(item => item.icon), ["hdmi", "dp", "bnc"]);
});

test("unused category 18 SDI outputs and inactive USB ports render inactive", () => {
  const data = normalize(Object.assign({usbStatus: [{usbId: 0, status: 0}, {usbId: 1, status: 1}]}, captured));
  canonicalizeIo(data, "api");
  const view = buildMonitoringView(data);
  assert.ok(view.outputTables.find(group => group.label === "O-19").ports.every(port => port.state === "inactive"));
  assert.deepEqual(view.usbPorts.map(port => port.state), ["inactive", "ok"]);
});

test("a used category 18 SDI output still follows its signal state", () => {
  const detail = structuredClone(captured);
  const slot = detail.slotList.find(item => item.slotId === 18);
  slot.interfaces[0].isUsed = 1;
  const data = normalize(detail);
  canonicalizeIo(data, "api");
  assert.equal(buildMonitoringView(data).outputTables.find(group => group.label === "O-19").ports[0].state, "ok");
});
