"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const snmp = require("net-snmp");
const { decodeNovaStarTrap } = require("../TAV_Monitoring_Backend/services/NovaStarTrapDecoder");
const TrapReceiverService = require("../TAV_Monitoring_Backend/services/TrapReceiverService");
const MonitoringService = require("../TAV_Monitoring_Backend/services/MonitoringService");

test("NovaStar trap decoder preserves raw data and creates a canonical output event", () => {
  const notification = { rinfo: { address: "192.168.69.86" }, pdu: { type: 7, varbinds: [{
    oid: "1.3.6.1.4.1.319.10.100.7", type: snmp.ObjectType.OctetString,
    value: Buffer.from('{"kind":"output","slot":11,"port":2,"state":"loss"}')
  }] } };
  const event = decodeNovaStarTrap(notification, { id: "h5", name: "H5" }, "2026-08-13T10:00:00.000Z");
  assert.equal(event.entityId, "output:O-11:2");
  assert.equal(event.transition, "loss");
  assert.equal(event.decoded, true);
  assert.equal(event.varbinds[0].oid, "1.3.6.1.4.1.319.10.100.7");
});

test("loss and recovery create a temporary micro-interruption cleared by the next scan", async () => {
  const machine = { id: "h5", name: "H5", type: "novastar-h", host: "192.168.69.86" };
  const service = new MonitoringService({
    store: { load: () => [machine], find: () => machine },
    deviceMonitor: { monitor: async () => ({ machineId: "h5", host: machine.host, type: machine.type, timestamp: new Date().toISOString(), inventory: { entities: [] }, observations: { items: [] }, resolvedState: {} }) },
    config: { monitor_interval_s: 0, max_parallel_scans: 1, monitoring_reference_mode: false, novastar_traps: { deduplication_window_ms: 0 } }
  });
  await service.scanMachine("h5");
  const base = { machineId: "h5", entityId: "input:I-3:2", kind: "input", decoded: true, trapOid: "1.3.6.1.4.1.319.10.100.6", payload: {} };
  service.handleTrapEvent(Object.assign({}, base, { transition: "loss", receivedAt: "2026-08-13T10:00:00.000Z" }));
  const incident = service.handleTrapEvent(Object.assign({}, base, { transition: "recovery", receivedAt: "2026-08-13T10:00:00.250Z" }));
  assert.equal(incident.durationMs, 250);
  assert.equal(service.snapshot().machines[0].view.microInterruptions.length, 1);
  await service.scanMachine("h5");
  assert.equal(service.snapshot().machines[0].view.microInterruptions.length, 0);
});

test("integrated Node receiver accepts an authorized simulated NovaStar trap", async () => {
  const port = 22162;
  let received;
  const monitoring = { handleTrapEvent: (event) => { received = event; } };
  const receiver = new TrapReceiverService({
    config: { enabled: true, listen_address: "127.0.0.1", advertised_address: "127.0.0.1", port, event_log_file: "" },
    store: { load: () => [{ id: "sim", name: "Sim", type: "novastar-h", host: "127.0.0.1", trapSnmpEnabled: true }] }, monitoring
  });
  receiver.start();
  const session = snmp.createSession("127.0.0.1", "public", { version: snmp.Version2c, trapPort: port, retries: 0 });
  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await new Promise((resolve, reject) => session.trap("1.3.6.1.4.1.319.10.100.6", [{
      oid: "1.3.6.1.4.1.319.10.100.6", type: snmp.ObjectType.OctetString,
      value: '{"kind":"input","slot":3,"port":2,"state":"loss"}'
    }], (error) => error ? reject(error) : resolve()));
    for (let index = 0; index < 20 && !received; index += 1) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(received.entityId, "input:I-3:2");
    assert.equal(Number.isNaN(new Date(receiver.lastTrapAt("sim")).getTime()), false);
  } finally { session.close(); receiver.stop(); }
});

test("integrated receiver ignores a known NovaStar when Trap SNMP is disabled", () => {
  let received = false;
  const receiver = new TrapReceiverService({
    config: { enabled: false, event_log_file: "" },
    store: { load: () => [{ id: "disabled", type: "novastar-h", host: "192.0.2.40", trapSnmpEnabled: false }] },
    monitoring: { handleTrapEvent: () => { received = true; } }
  });
  receiver.handleNotification({ rinfo: { address: "192.0.2.40" }, pdu: { type: 7, varbinds: [] } });
  assert.equal(received, false);
  assert.equal(receiver.recentEvents(1)[0].authorized, false);
});
