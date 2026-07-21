const express = require("express");
const morgan = require("morgan");
const { loadConfig, saveConfig } = require("./classes/Config");
const { MachineStore, sanitizeMachine } = require("./classes/MachineStore");
const logger = require("./classes/Logger");
const { createDeviceMonitor } = require("./services/DeviceMonitor");
const MonitoringService = require("./services/MonitoringService");
const NtfyClient = require("./services/NtfyClient");
const AlertService = require("./services/AlertService");
const PublicStatusService = require("./services/PublicStatusService");
const { AuthService, sessionCookie, clearSessionCookie } = require("./classes/AuthService");

function createBackend(options) {
  const settings = options || {};
  const config = settings.config || loadConfig(settings.configPath);
  logger.setLevel(config.loglevel);
  const store = settings.store || new MachineStore(config.machinesFile);
  const deviceMonitor = settings.deviceMonitor || createDeviceMonitor();
  const notifier = settings.notifier || new NtfyClient(config.alerts || {});
  let alerts = settings.alerts || null;
  const monitoring = settings.monitoring || new MonitoringService({ store, deviceMonitor, config, alerts: null });
  const publicStatus = settings.publicStatus || new PublicStatusService({ config: config.alerts || {}, monitoring, store });
  if (!alerts) alerts = new AlertService({ config: config.alerts || {}, notifier, publicStatus });
  if (!settings.monitoring) monitoring.alerts = alerts;
  const auth = settings.auth === false ? null : (settings.auth || new AuthService({
    filePath: config.usersFile,
    initialPassword: process.env.TAV_ADMIN_PASSWORD || "administrator"
  }));
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  app.use(morgan(config.loglevel === "debug" ? "dev" : "combined"));

  app.get("/api/health", (req, res) => res.json({ ok: true, service: "TAV_Monitoring_Backend" }));
  app.post("/api/auth/login", (req, res) => {
    const result = auth && auth.login(req.body && req.body.login, req.body && req.body.password);
    if (!result) return res.status(401).json({ error: "Invalid login or password" });
    res.setHeader("Set-Cookie", sessionCookie(result.token, Math.floor(auth.sessionTtlMs / 1000)));
    res.json({ user: result.user });
  });
  app.post("/api/auth/logout", (req, res) => {
    if (auth) auth.logout(req);
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.status(204).end();
  });
  app.post("/api/public/status", (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(publicStatus.snapshot(req.body && req.body.token));
    } catch (error) { next(error); }
  });

  app.use((req, res, next) => {
    if (!auth) { req.user = { id: "test", login: "test", role: "administrator" }; return next(); }
    req.user = auth.authenticateRequest(req);
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    next();
  });
  app.get("/api/auth/me", (req, res) => res.json({ user: req.user }));
  app.put("/api/auth/password", (req, res, next) => {
    try {
      auth.changePassword(req.user.id, req.body && req.body.currentPassword, req.body && req.body.newPassword);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });
  app.get("/api/users", requireRole("administrator"), (req, res) => res.json({ users: auth.listUsers() }));
  app.post("/api/users", requireRole("administrator"), (req, res, next) => {
    try { res.status(201).json({ user: auth.createUser(req.body || {}) }); } catch (error) { next(error); }
  });
  app.patch("/api/users/:id", requireRole("administrator"), (req, res, next) => {
    try { res.json({ user: auth.updateUser(req.params.id, req.body || {}, req.user) }); } catch (error) { next(error); }
  });
  app.delete("/api/users/:id", requireRole("administrator"), (req, res, next) => {
    try { auth.deleteUser(req.params.id, req.user); res.status(204).end(); } catch (error) { next(error); }
  });

  app.get("/api/config", (req, res) => res.json({
    monitor_interval_s: config.monitor_interval_s,
    monitoring_reference_mode: config.monitoring_reference_mode,
    alerts: alerts.status()
  }));
  app.post("/api/alerts/test", requireRole("administrator"), asyncHandler(async (req, res) => {
    await alerts.sendTest();
    res.json({ ok: true, message: "Notification ntfy envoyee" });
  }));
  app.put("/api/config/monitoring-reference-mode", requireRole("editor", "administrator"), (req, res, next) => {
    try {
      saveConfig(config, { monitoring_reference_mode: req.body && req.body.enabled === true });
      monitoring.refreshReferenceMode();
      res.json({ ok: true, enabled: config.monitoring_reference_mode });
    } catch (error) { next(error); }
  });

  app.get("/api/machines", (req, res, next) => {
    try { res.json(store.load().map(sanitizeMachine)); } catch (error) { next(error); }
  });
  app.post("/api/machines", requireRole("editor", "administrator"), (req, res, next) => {
    try {
      const machine = store.create(req.body || {});
      res.status(201).json({ machine: sanitizeMachine(machine), monitoring: null, saved: true });
      scanAfterSave(monitoring, machine, logger);
    } catch (error) { next(error); }
  });
  app.patch("/api/machines/:id", requireRole("editor", "administrator"), (req, res, next) => {
    try {
      const machine = store.update(req.params.id, req.body || {});
      res.json({ machine: sanitizeMachine(machine), monitoring: null, saved: true });
      scanAfterSave(monitoring, machine, logger);
    } catch (error) { next(error); }
  });
  app.delete("/api/machines/:id", requireRole("editor", "administrator"), (req, res, next) => {
    try {
      store.remove(req.params.id);
      monitoring.removeMachine(req.params.id);
      res.status(204).end();
    } catch (error) { next(error); }
  });

  app.get("/api/monitoring", (req, res) => res.json(monitoring.snapshot()));
  app.post("/api/monitoring/scan", requireRole("editor", "administrator"), asyncHandler(async (req, res) => res.json(await monitoring.scanAll())));
  app.post("/api/machines/:id/scan", requireRole("editor", "administrator"), asyncHandler(async (req, res) => res.json(await monitoring.scanMachine(req.params.id, true))));
  app.put("/api/machines/:id/reference", requireRole("editor", "administrator"), (req, res, next) => {
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

  return { app, config, store, monitoring, alerts, notifier, publicStatus, auth };
}

function requireRole() {
  const allowed = Array.prototype.slice.call(arguments);
  return (req, res, next) => allowed.includes(req.user.role) ? next() : res.status(403).json({ error: "Insufficient permissions" });
}

function scanAfterSave(monitoring, machine, appLogger) {
  Promise.resolve()
    .then(() => monitoring.scanMachine(machine.id, true))
    .catch((error) => appLogger.warning("Initial machine scan failed", {
      machineId: machine.id,
      error: error.message
    }));
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

module.exports = { createBackend };
