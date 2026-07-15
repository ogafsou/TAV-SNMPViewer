const express = require("express");
const morgan = require("morgan");
const { loadConfig, saveConfig } = require("./classes/Config");
const { MachineStore, sanitizeMachine } = require("./classes/MachineStore");
const logger = require("./classes/Logger");
const { createDeviceMonitor } = require("./services/DeviceMonitor");
const MonitoringService = require("./services/MonitoringService");
const NtfyClient = require("./services/NtfyClient");
const AlertService = require("./services/AlertService");

function createBackend(options) {
  const settings = options || {};
  const config = settings.config || loadConfig(settings.configPath);
  logger.setLevel(config.loglevel);
  const store = settings.store || new MachineStore(config.machinesFile);
  const deviceMonitor = settings.deviceMonitor || createDeviceMonitor();
  const notifier = settings.notifier || new NtfyClient(config.alerts || {});
  const alerts = settings.alerts || new AlertService({ config: config.alerts || {}, notifier });
  const monitoring = settings.monitoring || new MonitoringService({ store, deviceMonitor, config, alerts });
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  app.use(morgan(config.loglevel === "debug" ? "dev" : "combined"));

  app.get("/api/health", (req, res) => res.json({ ok: true, service: "TAV_Monitoring_Backend" }));
  app.get("/api/config", (req, res) => res.json({
    monitor_interval_s: config.monitor_interval_s,
    monitoring_reference_mode: config.monitoring_reference_mode,
    alerts: alerts.status()
  }));
  app.post("/api/alerts/test", asyncHandler(async (req, res) => {
    await alerts.sendTest();
    res.json({ ok: true, message: "Notification ntfy envoyee" });
  }));
  app.put("/api/config/monitoring-reference-mode", (req, res, next) => {
    try {
      saveConfig(config, { monitoring_reference_mode: req.body && req.body.enabled === true });
      monitoring.refreshReferenceMode();
      res.json({ ok: true, enabled: config.monitoring_reference_mode });
    } catch (error) { next(error); }
  });

  app.get("/api/machines", (req, res, next) => {
    try { res.json(store.load().map(sanitizeMachine)); } catch (error) { next(error); }
  });
  app.post("/api/machines", asyncHandler(async (req, res) => {
    const machine = store.create(req.body || {});
    const record = await monitoring.scanMachine(machine.id, true);
    res.status(201).json({ machine: sanitizeMachine(store.find(machine.id)), monitoring: record });
  }));
  app.patch("/api/machines/:id", asyncHandler(async (req, res) => {
    const machine = store.update(req.params.id, req.body || {});
    const record = await monitoring.scanMachine(machine.id, true);
    res.json({ machine: sanitizeMachine(store.find(machine.id)), monitoring: record });
  }));
  app.delete("/api/machines/:id", (req, res, next) => {
    try {
      store.remove(req.params.id);
      monitoring.removeMachine(req.params.id);
      res.status(204).end();
    } catch (error) { next(error); }
  });

  app.get("/api/monitoring", (req, res) => res.json(monitoring.snapshot()));
  app.post("/api/monitoring/scan", asyncHandler(async (req, res) => res.json(await monitoring.scanAll())));
  app.post("/api/machines/:id/scan", asyncHandler(async (req, res) => res.json(await monitoring.scanMachine(req.params.id, true))));
  app.put("/api/machines/:id/reference", (req, res, next) => {
    try {
      const record = monitoring.setReference(req.params.id);
      res.json({ machine: sanitizeMachine(store.find(req.params.id)), monitoring: record });
    } catch (error) { next(error); }
  });

  app.use((req, res) => res.status(404).json({ error: "Not found" }));
  app.use((error, req, res, next) => {
    logger.error("Backend request failed", { method: req.method, url: req.originalUrl, error: error.message });
    res.status(error.status || 500).json({ error: error.message || "Internal server error" });
  });

  return { app, config, store, monitoring, alerts, notifier };
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

module.exports = { createBackend };
