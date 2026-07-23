const EventEmitter = require("events");
const logger = require("../classes/Logger");
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
        this.scanAll().catch((error) => logger.error("Scheduled scan failed", { error: error.message }));
      }, this.config.monitor_interval_s * 1000);
      if (this.timer.unref) this.timer.unref();
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async scanAll() {
    const machines = this.store.load();
    const queue = machines.slice();
    const workers = Array.from({ length: Math.min(this.config.max_parallel_scans, Math.max(queue.length, 1)) }, async () => {
      while (queue.length) await this.scanMachine(queue.shift().id);
    });
    await Promise.all(workers);
    return this.snapshot();
  }

  scanMachine(id, forceAfterCurrent) {
    const machineId = String(id);
    if (this.scans.has(machineId)) {
      const current = this.scans.get(machineId);
      return forceAfterCurrent ? current.then(() => this.scanMachine(machineId, false)) : current;
    }
    const task = this.performScan(machineId).finally(() => this.scans.delete(machineId));
    this.scans.set(machineId, task);
    return task;
  }

  async performScan(id) {
    const machine = this.store.find(id);
    if (!machine) {
      const error = new Error("Machine not found");
      error.status = 404;
      throw error;
    }
    const previous = this.records.get(id);
    let raw;
    let baseView;
    try {
      raw = await this.deviceMonitor.monitor(machine);
      baseView = buildMonitoringView(raw);
    } catch (error) {
      raw = { machineId: id, host: machine.host, type: machine.type, timestamp: new Date().toISOString(), error: error.message };
      baseView = buildOfflineView(machine, error.message, raw.timestamp);
    }
    if (!this.store.find(id)) return null;
    const view = machine.type === "other" ? baseView : applyReferenceMode(machine, baseView, this.config.monitoring_reference_mode);
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
      record.revision = ++this.revision;
      this.publish({ type: "monitoring.changed", revision: record.revision, machineId: machine.id, monitoring: record });
    });
  }

  removeMachine(id) {
    this.records.delete(String(id));
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
}

module.exports = MonitoringService;
