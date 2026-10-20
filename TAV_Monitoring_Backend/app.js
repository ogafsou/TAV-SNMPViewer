const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const morgan = require("morgan");
const { loadConfig, saveConfig } = require("./classes/Config");
const { MachineStore, sanitizeMachine, normalizeMachineType } = require("./classes/MachineStore");
const { MapStore } = require("./classes/MapStore");
const logger = require("./classes/Logger");
const appLogger = logger.child("BackendApp");
const { createDeviceMonitor } = require("./services/DeviceMonitor");
const MonitoringService = require("./services/MonitoringService");
const NtfyClient = require("./services/NtfyClient");
const AlertService = require("./services/AlertService");
const PublicStatusService = require("./services/PublicStatusService");
const TrapReceiverService = require("./services/TrapReceiverService");
const { AuthService, sessionCookie, clearSessionCookie } = require("./classes/AuthService");

function createBackend(options) {
  const settings = options || {};
  const config = settings.config || loadConfig(settings.configPath);
  logger.configure(config.logging || { level: config.loglevel, file_enabled: false });
  const store = settings.store || new MachineStore(config.machinesFile);
  const mapsFile = config.mapsFile || path.resolve(path.dirname(config.configPath || "."), config.maps_file || "maps.json");
  const mapStore = settings.mapStore || new MapStore(mapsFile);
  const mapV2Store = settings.mapV2Store || new MapStore(mapsFile + ".v2.json", "/api/maps-v2");
  const deviceMonitor = settings.deviceMonitor || createDeviceMonitor(undefined, config.io_reconciliation);
  const notifier = settings.notifier || new NtfyClient(config.alerts || {});
  let alerts = settings.alerts || null;
  const monitoring = settings.monitoring || new MonitoringService({ store, deviceMonitor, config, alerts: null });
  const publicStatus = settings.publicStatus || new PublicStatusService({ config: config.alerts || {}, monitoring, store });
  if (!alerts) alerts = new AlertService({ config: config.alerts || {}, notifier, publicStatus });
  if (!settings.monitoring) monitoring.alerts = alerts;
  const trapReceiver = settings.trapReceiver || new TrapReceiverService({ config: config.novastar_traps, store, monitoring });
  const auth = settings.auth === false ? null : (settings.auth || new AuthService({
    filePath: config.usersFile,
    initialPassword: process.env.TAV_ADMIN_PASSWORD || "administrator"
  }));
  const app = express();
  app.disable("x-powered-by");
  app.use(bodyParser.raw({ type: ["image/png", "image/jpeg", "image/webp", "image/gif"], limit: "15mb" }));
  app.use(bodyParser.raw({ type: "application/x-maptav", limit: "25mb" }));
  app.use(express.json({ limit: "2mb" }));
  app.use(morgan(config.loglevel === "debug" ? "dev" : "combined", { stream: logger.morgan("HTTP") }));

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
  for (const [mapsBase, activeMapStore] of [["/api/maps", mapStore], ["/api/maps-v2", mapV2Store]]) {
    const readMap = activeMapStore === mapV2Store ? requireRole("user", "editor", "administrator") : requireMapAdministrator;
    const editMap = activeMapStore === mapV2Store ? requireRole("editor", "administrator") : requireMapAdministrator;
    app.get(mapsBase, readMap, (req, res, next) => {
      try {
        if (activeMapStore === mapV2Store && !require("fs").existsSync(mapV2Store.filePath)) {
          mapV2Store.save([]);
          for (const source of mapStore.load()) {
            const copied = mapV2Store.importArchive(mapStore.exportArchive(source.id), store.load().map((machine) => machine.id)).map;
            mapV2Store.setSegments(copied.id, copied.segments.map((segment) => Object.assign({}, segment, { assignments: [], moduleRanges: [] })));
          }
        }
        res.json(activeMapStore.load()); } catch (error) { next(error); }
    });
    app.post(mapsBase, editMap, (req, res, next) => {
      try { res.status(201).json({ map: activeMapStore.create(req.body || {}) }); } catch (error) { next(error); }
    });
    app.get(mapsBase + "/:id/export", editMap, (req, res, next) => {
      try {
        const map = activeMapStore.find(req.params.id);
        if (!map) { const error = new Error("Map introuvable"); error.status = 404; throw error; }
        const filename = String(map.name || "Map").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_") + ".MapTav";
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + encodeURIComponent(filename));
        res.send(activeMapStore.exportArchive(map.id));
      } catch (error) { next(error); }
    });
    app.post(mapsBase + "/import", editMap, (req, res, next) => {
      try {
        if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Fichier MapTav vide" });
        const result = activeMapStore.importArchive(req.body, store.load().map((machine) => machine.id));
        res.status(201).json(result);
      } catch (error) { next(error); }
    });
    app.patch(mapsBase + "/:id", editMap, (req, res, next) => {
      try { res.json({ map: activeMapStore.update(req.params.id, req.body || {}) }); } catch (error) { next(error); }
    });
    app.delete(mapsBase + "/:id", editMap, (req, res, next) => {
      try { activeMapStore.remove(req.params.id); res.status(204).end(); } catch (error) { next(error); }
    });
    app.put(mapsBase + "/:id/background", editMap, (req, res, next) => {
      try {
        if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Image vide" });
        res.json({ map: activeMapStore.setBackground(req.params.id, req.body, String(req.headers["content-type"] || "").toLowerCase()) });
      } catch (error) { next(error); }
    });
    app.get(mapsBase + "/:id/background", readMap, (req, res, next) => {
      try {
        const map = activeMapStore.find(req.params.id);
        const filePath = activeMapStore.backgroundPath(map);
        if (!map || !filePath || !require("fs").existsSync(filePath)) return res.status(404).json({ error: "Background introuvable" });
        res.type(map.backgroundMimeType).sendFile(filePath);
      } catch (error) { next(error); }
    });
    app.put(mapsBase + "/:id/segments", editMap, (req, res, next) => {
      try { res.json({ map: activeMapStore.setSegments(req.params.id, req.body && req.body.segments) }); }
      catch (error) { next(error); }
    });
    app.put(mapsBase + "/:id/reference", editMap, (req, res, next) => {
      try { res.json({ map: activeMapStore.setReference(req.params.id, req.body && req.body.outputs) }); }
      catch (error) { next(error); }
    });
  }

  app.get("/api/config", (req, res) => res.json({
    monitor_interval_s: config.monitor_interval_s,
    monitoring_reference_mode: config.monitoring_reference_mode,
    ping_monitoring_reference: config.ping_monitoring_reference,
    alerts: alerts.status(),
    novastar_traps: trapReceiver.status()
  }));
  app.get("/api/novastar-traps/status", (req, res) => res.json(buildNovaStarTrapStatus(
    trapReceiver, deviceMonitor, store
  )));
  app.get("/api/novastar-traps/events", (req, res) => res.json({ events: trapReceiver.recentEvents(req.query.limit) }));
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
      monitoring.refreshInterval();
      res.status(201).json({ machine: sanitizeMachine(machine), monitoring: null, saved: true });
      scanAfterSave(monitoring, machine, logger);
    } catch (error) { next(error); }
  });
  app.patch("/api/machines/:id", requireRole("editor", "administrator"), (req, res, next) => {
    try {
      const machine = store.update(req.params.id, req.body || {});
      monitoring.refreshInterval();
      res.json({ machine: sanitizeMachine(machine), monitoring: null, saved: true });
      scanAfterSave(monitoring, machine, logger);
    } catch (error) { next(error); }
  });
  app.delete("/api/machines/:id", requireRole("editor", "administrator"), (req, res, next) => {
    try {
      store.remove(req.params.id);
      monitoring.removeMachine(req.params.id);
      monitoring.refreshInterval();
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
    appLogger.error("Backend request failed", { method: req.method, url: req.originalUrl, error: error.message });
    res.status(error.status || 500).json({ error: error.message || "Internal server error" });
  });

  return { app, config, store, mapStore, monitoring, alerts, notifier, publicStatus, auth, trapReceiver };
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

function buildNovaStarTrapStatus(trapReceiver, deviceMonitor, store) {
  const receiver = trapReceiver.status();
  const machines = store.load()
    .filter((machine) => normalizeMachineType(machine.type) === "novastar-h")
    .map((machine) => {
      const verification = deviceMonitor.trapStatus && deviceMonitor.trapStatus(machine.id) || {};
      return {
        machineId: String(machine.id),
        name: String(machine.name || ""),
        host: String(machine.host || ""),
        trapEnabled: machine.trapSnmpEnabled === true,
        receiverActive: receiver.listening === true,
        setSucceeded: verification.setSucceeded === true,
        configured: verification.configured === true,
        destination: String(verification.destination || ""),
        reportingEnabled: verification.reportingEnabled === true,
        verifiedAt: verification.verifiedAt || null,
        lastTrapAt: trapReceiver.lastTrapAt ? trapReceiver.lastTrapAt(machine.id) : null,
        error: String(verification.error || "")
      };
    });
  return Object.assign({}, receiver, { machines });
}

module.exports = { createBackend, buildNovaStarTrapStatus };
