const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const morgan = require("morgan");
const { loadConfig, saveConfig } = require("./classes/Config");
const { MachineStore, sanitizeMachine } = require("./classes/MachineStore");
const { MapStore } = require("./classes/MapStore");
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
  const mapsFile = config.mapsFile || path.resolve(path.dirname(config.configPath || "."), config.maps_file || "maps.json");
  const mapStore = settings.mapStore || new MapStore(mapsFile);
  const deviceMonitor = settings.deviceMonitor || createDeviceMonitor(undefined, config.io_reconciliation);
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
  app.use(bodyParser.raw({ type: ["image/png", "image/jpeg", "image/webp", "image/gif"], limit: "15mb" }));
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
    if (!auth) { req.user = { id: "test", login: "Olivier", role: "administrator" }; return next(); }
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
  app.get("/api/maps", requireMapAdministrator, (req, res, next) => {
    try { res.json(mapStore.load()); } catch (error) { next(error); }
  });
  app.post("/api/maps", requireMapAdministrator, (req, res, next) => {
    try { res.status(201).json({ map: mapStore.create(req.body || {}) }); } catch (error) { next(error); }
  });
  app.patch("/api/maps/:id", requireMapAdministrator, (req, res, next) => {
    try { res.json({ map: mapStore.update(req.params.id, req.body || {}) }); } catch (error) { next(error); }
  });
  app.delete("/api/maps/:id", requireMapAdministrator, (req, res, next) => {
    try { mapStore.remove(req.params.id); res.status(204).end(); } catch (error) { next(error); }
  });
  app.put("/api/maps/:id/background", requireMapAdministrator, (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Image vide" });
      res.json({ map: mapStore.setBackground(req.params.id, req.body, String(req.headers["content-type"] || "").toLowerCase()) });
    } catch (error) { next(error); }
  });
  app.get("/api/maps/:id/background", requireMapAdministrator, (req, res, next) => {
    try {
      const map = mapStore.find(req.params.id);
      const filePath = mapStore.backgroundPath(map);
      if (!map || !filePath || !require("fs").existsSync(filePath)) return res.status(404).json({ error: "Background introuvable" });
      res.type(map.backgroundMimeType).sendFile(filePath);
    } catch (error) { next(error); }
  });
  app.put("/api/maps/:id/segments", requireMapAdministrator, (req, res, next) => {
    try { res.json({ map: mapStore.setSegments(req.params.id, req.body && req.body.segments) }); }
    catch (error) { next(error); }
  });
  app.put("/api/maps/:id/reference", requireMapAdministrator, (req, res, next) => {
    try { res.json({ map: mapStore.setReference(req.params.id, req.body && req.body.outputs) }); }
    catch (error) { next(error); }
  });

  app.get("/api/config", (req, res) => res.json({
    monitor_interval_s: config.monitor_interval_s,
    monitoring_reference_mode: config.monitoring_reference_mode,
    ping_monitoring_reference: config.ping_monitoring_reference,
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
  app.put("/api/config/monitor-interval", requireRole("editor", "administrator"), (req, res, next) => {
    try {
      const interval = Number(req.body && req.body.seconds);
      if (!Number.isInteger(interval) || interval < 1 || interval > 86400) {
        return res.status(400).json({ error: "L'intervalle doit etre un nombre entier entre 1 et 86400 secondes" });
      }
      saveConfig(config, { monitor_interval_s: interval });
      monitoring.refreshInterval();
      res.json({ ok: true, monitor_interval_s: config.monitor_interval_s });
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
  app.put("/api/monitoring/ping/reference", requireRole("editor", "administrator"), (req, res, next) => {
    try {
      const reference = monitoring.buildPingReference();
      saveConfig(config, { ping_monitoring_reference: reference });
      res.json({ reference: config.ping_monitoring_reference });
    } catch (error) { next(error); }
  });
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

  return { app, config, store, mapStore, monitoring, alerts, notifier, publicStatus, auth };
}

function requireRole() {
  const allowed = Array.prototype.slice.call(arguments);
  return (req, res, next) => allowed.includes(req.user.role) ? next() : res.status(403).json({ error: "Insufficient permissions" });
}

function requireMapAdministrator(req, res, next) {
  return req.user.role === "administrator" && String(req.user.login || "").toLowerCase() === "olivier"
    ? next() : res.status(403).json({ error: "Acces reserve a l'administrateur Olivier" });
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
