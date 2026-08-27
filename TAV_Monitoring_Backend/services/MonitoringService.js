const EventEmitter = require("events");
const logger = require("../classes/Logger").child("MonitoringService");
const {
  buildMonitoringView,
  buildOfflineView,
  applyReferenceMode,
  buildReferenceSnapshot,
  diffTelemetry,
  structuralFingerprint
} = require("./MonitoringState");

class MonitoringService extends EventEmitter {
  constructor(options) {
    super();
    this.store = options.store;
    this.deviceMonitor = options.deviceMonitor;
    this.config = options.config;
    this.alerts = options.alerts || null;
    this.records = new Map();
    this.scans = new Map();
    this.revision = 0;
    this.timer = null;
    this.snmpWorkers = new Map();
    this.pendingTrapLosses = new Map();
    this.activeMicroInterruptions = new Map();
    this.recentTrapFingerprints = new Map();
  }

  start() {
    this.stop();
    const initialScan = this.scanAll().catch((error) => logger.error("Initial scan failed", { error: error.message }));
    this.refreshInterval();
    return initialScan;
  }

  refreshInterval() {
    this.stop();
    if (this.config.monitor_interval_s > 0) {
      this.timer = setInterval(() => {
        this.scanAll({ periodic: true }).catch((error) => logger.error("Scheduled scan failed", { error: error.message }));
      }, this.config.monitor_interval_s * 1000);
      if (this.timer.unref) this.timer.unref();
    }
    this.refreshSnmpWorkers();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.snmpWorkers.forEach((worker) => clearInterval(worker.timer));
    this.snmpWorkers.clear();
  }

  refreshSnmpWorkers() {
    this.snmpWorkers.forEach((worker) => clearInterval(worker.timer));
    this.snmpWorkers.clear();
    this.store.load().filter(isPeriodicNovaStarSnmp).forEach((machine) => {
      const worker = { running: null, timer: null };
      const run = () => {
        if (worker.running) {
          logger.warning("NovaStar SNMP worker tick skipped; previous scan still running", {
            machineId: machine.id,
            host: machine.host,
            port: Number(machine.snmpPort || 161),
            intervalSeconds: machine.snmpScanIntervalS
          });
          return worker.running;
        }
        worker.running = this.scanMachine(machine.id, true, { snmpPeriodic: true })
          .catch((error) => logger.error("Scheduled NovaStar SNMP scan failed", { machineId: machine.id, error: error.message }))
          .finally(() => { worker.running = null; });
        return worker.running;
      };
      worker.timer = setInterval(run, machine.snmpScanIntervalS * 1000);
      if (worker.timer.unref) worker.timer.unref();
      this.snmpWorkers.set(machine.id, worker);
      logger.info("NovaStar SNMP worker scheduled", {
        machineId: machine.id,
        host: machine.host,
        intervalSeconds: machine.snmpScanIntervalS
      });
    });
  }

  async scanAll(options) {
    options = options || {};
    const machines = this.store.load();
    const queue = options.periodic === true ? machines.filter((machine) => !isSnmpOnlyNovaStar(machine)) : machines.slice();
    const workers = Array.from({ length: Math.min(this.config.max_parallel_scans, Math.max(queue.length, 1)) }, async () => {
      while (queue.length) await this.scanMachine(queue.shift().id, false, options);
    });
    await Promise.all(workers);
    return this.snapshot();
  }

  scanMachine(id, forceAfterCurrent, options) {
    const machineId = String(id);
    const lane = options && options.periodic === true && !options.snmpPeriodic ? "api" : "full";
    const scanKey = machineId + ":" + lane;
    if (this.scans.has(scanKey)) {
      const current = this.scans.get(scanKey);
      return forceAfterCurrent ? current.then(() => this.scanMachine(machineId, false, options)) : current;
    }
    const task = this.performScan(machineId, options).finally(() => this.scans.delete(scanKey));
    this.scans.set(scanKey, task);
    return task;
  }

  async performScan(id, options) {
    const scanStartedAt = new Date().toISOString();
    const machine = this.store.find(id);
    if (!machine) {
      const error = new Error("Machine not found");
      error.status = 404;
      throw error;
    }
    const previous = this.records.get(id);
    const method = String(machine.accessMethod || "snmp").toLowerCase();
    const snmpDisabled = machine.type === "novastar-h" && machine.snmpScanEnabled === false;
    if (this.deviceMonitor.configureTraps) {
      await this.deviceMonitor.configureTraps(machine, this.config.novastar_traps).catch((error) => {
        logger.warning("NovaStar trap configuration failed", { machineId: id, host: machine.host, error: error.message });
      });
    }
    if (snmpDisabled && method === "snmp") {
      logger.info("NovaStar SNMP scan skipped by machine configuration", { machineId: id, host: machine.host });
      return previous || null;
    }
    let raw;
    let baseView;
    try {
      raw = await this.deviceMonitor.monitor(machine, {
        skipSnmp: snmpDisabled || (options && options.periodic === true && !options.snmpPeriodic)
      });
      baseView = buildMonitoringView(raw);
    } catch (error) {
      raw = { machineId: id, host: machine.host, type: machine.type, timestamp: new Date().toISOString(), error: error.message };
      baseView = buildOfflineView(machine, error.message, raw.timestamp);
    }
    if (!this.store.find(id)) return null;
    const view = machine.type === "other" ? baseView : applyReferenceMode(machine, baseView, this.config.monitoring_reference_mode);
    this.clearMicroInterruptionsBefore(id, scanStartedAt);
    view.microInterruptions = this.microInterruptionsFor(id);
    const rawChanges = diffTelemetry(previous && previous.raw, raw);
    const significant = !previous || structuralFingerprint(previous.view) !== structuralFingerprint(view);
    const hasChanges = !previous || Object.keys(rawChanges).length > 0 || significant;
    if (hasChanges) this.revision += 1;
    const record = {
      machineId: id,
      revision: this.revision,
      timestamp: raw.timestamp || new Date().toISOString(),
      raw,
      view,
      lastSuccessfulAt: baseView.connected === true
        ? raw.timestamp || new Date().toISOString()
        : previous && previous.lastSuccessfulAt || null
    };
    if (baseView.connected === true) record.lastSuccessfulAt = record.timestamp;
    this.records.set(id, record);
    if (!previous) this.publish({ type: "monitoring.initialized", revision: record.revision, machineId: id, monitoring: record });
    else if (significant) this.publish({ type: "monitoring.changed", revision: record.revision, machineId: id, monitoring: record });
    else if (Object.keys(rawChanges).length) {
      this.publish({
        type: "telemetry.patch",
        revision: record.revision,
        machineId: id,
        timestamp: record.timestamp,
        message: view.message,
        changes: rawChanges
      });
    }
    if (this.alerts) this.alerts.handleRecord(machine, record);
    return record;
  }

  setReference(id) {
    const record = this.records.get(String(id));
    if (!record || !record.view.connected) {
      const error = new Error("A successful scan is required before setting the reference");
      error.status = 409;
      throw error;
    }
    const reference = { version: 1, setAt: new Date().toISOString(), snapshot: buildReferenceSnapshot(record.view) };
    const machine = this.store.update(id, { monitoringReference: reference });
    const baseView = buildMonitoringView(record.raw);
    record.view = applyReferenceMode(machine, baseView, this.config.monitoring_reference_mode);
    record.revision = ++this.revision;
    this.publish({ type: "monitoring.changed", revision: record.revision, machineId: String(id), monitoring: record });
    return record;
  }

  buildPingReference() {
    const pingMachines = this.store.load().filter((machine) => machine.type === "other");
    if (!pingMachines.length) {
      const error = new Error("No Ping machine is configured");
      error.status = 409;
      throw error;
    }
    if (pingMachines.some((machine) => !this.records.has(machine.id))) {
      const error = new Error("A completed Ping scan is required before setting the reference");
      error.status = 409;
      throw error;
    }
    return {
      version: 1,
      setAt: new Date().toISOString(),
      respondingMachineIds: pingMachines.filter((machine) => {
        const record = this.records.get(machine.id);
        return record && record.view && record.view.connected === true && record.view.state === "ok";
      }).map((machine) => machine.id).sort()
    };
  }

  refreshReferenceMode() {
    this.store.load().forEach((machine) => {
      const record = this.records.get(machine.id);
      if (!record) return;
      const base = record.raw && record.raw.error ? buildOfflineView(machine, record.raw.error, record.raw.timestamp) : buildMonitoringView(record.raw);
      record.view = machine.type === "other" ? base : applyReferenceMode(machine, base, this.config.monitoring_reference_mode);
      record.view.microInterruptions = this.microInterruptionsFor(machine.id);
      record.revision = ++this.revision;
      this.publish({ type: "monitoring.changed", revision: record.revision, machineId: machine.id, monitoring: record });
    });
  }

  removeMachine(id) {
    this.records.delete(String(id));
    this.activeMicroInterruptions.delete(String(id));
    this.revision += 1;
    this.publish({ type: "machine.deleted", revision: this.revision, machineId: String(id) });
  }

  snapshot() {
    return {
      revision: this.revision,
      generatedAt: new Date().toISOString(),
      machines: Array.from(this.records.values())
    };
  }

  publish(message) {
    this.emit("message", message);
  }

  handleTrapEvent(event) {
    if (!event || !event.machineId) return null;
    const now = Date.parse(event.receivedAt) || Date.now();
    const fingerprint = [event.machineId, event.trapOid, event.entityId, event.transition, JSON.stringify(event.payload)].join("|");
    const previousAt = this.recentTrapFingerprints.get(fingerprint) || 0;
    const windowMs = this.config.novastar_traps && this.config.novastar_traps.deduplication_window_ms || 0;
    if (now - previousAt <= windowMs) return null;
    this.recentTrapFingerprints.set(fingerprint, now);
    if (!event.decoded || !event.entityId) return null;
    const key = event.machineId + "|" + event.entityId;
    if (event.transition === "loss") {
      this.pendingTrapLosses.set(key, event);
      return null;
    }
    if (event.transition !== "recovery") return null;
    const loss = this.pendingTrapLosses.get(key);
    if (!loss) return null;
    this.pendingTrapLosses.delete(key);
    const incident = {
      id: key + "|" + event.receivedAt,
      machineId: event.machineId,
      entityId: event.entityId,
      kind: event.kind,
      startedAt: loss.receivedAt,
      recoveredAt: event.receivedAt,
      durationMs: Math.max(0, (Date.parse(event.receivedAt) || now) - (Date.parse(loss.receivedAt) || now)),
      trapOid: event.trapOid
    };
    const active = this.activeMicroInterruptions.get(event.machineId) || new Map();
    active.set(event.entityId, incident);
    this.activeMicroInterruptions.set(event.machineId, active);
    const record = this.records.get(event.machineId);
    if (record) {
      record.view.microInterruptions = this.microInterruptionsFor(event.machineId);
      record.revision = ++this.revision;
      this.publish({ type: "monitoring.changed", revision: record.revision, machineId: event.machineId, monitoring: record });
    }
    logger.warning("NovaStar micro-interruption detected", incident);
    return incident;
  }

  microInterruptionsFor(machineId) {
    return Array.from((this.activeMicroInterruptions.get(String(machineId)) || new Map()).values());
  }

  clearMicroInterruptionsBefore(machineId, scanStartedAt) {
    const active = this.activeMicroInterruptions.get(String(machineId));
    if (!active) return;
    active.forEach((incident, entityId) => {
      if (String(incident.recoveredAt) < String(scanStartedAt)) active.delete(entityId);
    });
    if (!active.size) this.activeMicroInterruptions.delete(String(machineId));
  }
}

function isPeriodicNovaStarSnmp(machine) {
  const method = String(machine.accessMethod || "snmp").toLowerCase();
  return machine.type === "novastar-h" && machine.snmpScanEnabled !== false &&
    (method === "snmp" || method === "snmp+api");
}

function isSnmpOnlyNovaStar(machine) {
  return machine.type === "novastar-h" && String(machine.accessMethod || "snmp").toLowerCase() === "snmp";
}

module.exports = MonitoringService;
