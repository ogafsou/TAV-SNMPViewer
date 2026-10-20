const express = require("express");
const path = require("path");
const morgan = require("morgan");
const http = require("http");
const https = require("https");
const { loadConfig } = require("./Config");
const { restProxy } = require("./proxy");
const logger = require("./Logger");
const appLogger = logger.child("UIApp");

function createFrontend(options) {
  const settings = options || {};
  const config = settings.config || loadConfig(settings.configPath);
  logger.configure(config.logging || { level: "info", file_enabled: false });
  const app = express();
  app.disable("x-powered-by");
  app.set("views", path.join(__dirname, "views"));
  app.set("view engine", "ejs");
  app.use(morgan("dev", { stream: logger.morgan("HTTP") }));
  const browserRateLimits = new Map();
  app.post("/api/ui-logs", express.json({ limit: "64kb" }), (req, res) => {
    if (!config.logging || config.logging.browser_logs_enabled !== true) return res.status(404).end();
    authenticateRequest(config, req, (authorized) => {
      if (!authorized) return res.status(401).json({ error: "Authentication required" });
      const events = req.body && Array.isArray(req.body.events) ? req.body.events.slice(0, 50) : [];
      if (!events.length) return res.status(204).end();
      const key = String(req.socket.remoteAddress || "unknown");
      if (!consumeRateLimit(browserRateLimits, key, events.length, config.logging.browser_max_events_per_minute)) {
        return res.status(429).json({ error: "Browser log rate limit exceeded" });
      }
      events.forEach((event) => {
        const level = ["debug", "info", "warning", "error"].includes(String(event.level).toLowerCase())
          ? String(event.level).toLowerCase() : "info";
        const moduleName = "browser:" + String(event.module || "unknown");
        const clientMetadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
        const metadata = {
          clientAt: String(event.timestamp || ""),
          page: String(event.page || "").slice(0, 256),
          action: String(clientMetadata.action || "").slice(0, 80),
          controlId: String(clientMetadata.controlId || "").slice(0, 80),
          targetId: String(clientMetadata.targetId || "").slice(0, 80),
          targetName: String(clientMetadata.targetName || "").slice(0, 160),
          label: String(clientMetadata.label || "").slice(0, 160),
          checked: typeof clientMetadata.checked === "boolean" ? clientMetadata.checked : undefined,
          destination: String(clientMetadata.destination || "").slice(0, 256)
        };
        logger.child(moduleName)[level](String(event.message || "").slice(0, 4000), metadata);
      });
      res.status(204).end();
    });
  });
  app.use(express.static(path.join(__dirname, "public")));
  app.use("/api", restProxy(config.backend_rest_url));
  function renderPage(page) {
    return (req, res) => {
      const currentUser = res.locals.currentUser;
      const canAccessConfiguration = currentUser
        && (currentUser.role === "editor" || currentUser.role === "administrator");
      const canAccessMonitoringMaps = currentUser && currentUser.role === "administrator"
        && String(currentUser.login || "").toLowerCase() === "olivier";
      res.render("index", {
        title: (page === "map-v2" || page === "map-v2-edit") ? "Map V2 - TAV Monitoring" : page === "monitoring" ? "TAV Monitoring" : (page === "monitoring-map" ? "Monitoring Map - TAV Monitoring" : (page === "monitoring-maps" ? "Map Configuration - TAV Monitoring" : (page === "users" ? "Utilisateurs - TAV Monitoring" : "Configuration - TAV Monitoring"))),
        page,
        canAccessConfiguration,
        canViewMapV2: !!currentUser,
        canEditMapV2: canAccessConfiguration,
        canAccessMonitoringMaps,
        backend_url: config.backend_rest_url,
        rest_refresh_s: config.rest_refresh_s,
        bkgnd_opacity: config.bkgnd_opacity === undefined ? 1 : config.bkgnd_opacity,
        monitoring_problem_sound: config.monitoring_problem_sound || "",
        monitoring_recovery_sound: config.monitoring_recovery_sound || "",
        browser_logs_enabled: !!(config.logging && config.logging.browser_logs_enabled),
        browser_batch_interval_ms: config.logging && config.logging.browser_batch_interval_ms || 5000
      });
    };
  }

  app.get("/", (req, res) => res.redirect("/monitoring"));
  app.get("/login", (req, res) => res.render("login", { title: "Login - TAV Monitoring" }));
  app.get("/status", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.render("status", { title: "Etat général - TAV Monitoring" });
  });
  app.get("/monitoring", authorizePage(config, ["user", "editor", "administrator"]), renderPage("monitoring"));
  app.get("/monitoring-map", authorizePage(config, ["administrator"], "Olivier"), renderPage("monitoring-map"));
  app.get("/map-v2/edit", authorizePage(config, ["editor", "administrator"]), renderPage("map-v2-edit"));
  app.get("/map-v2", authorizePage(config, ["user", "editor", "administrator"]), renderPage("map-v2"));
  app.get("/configuration", authorizePage(config, ["editor", "administrator"]), renderPage("configuration"));
  app.get("/monitoring-maps", authorizePage(config, ["administrator"], "Olivier"), renderPage("monitoring-maps"));
  app.get("/users", authorizePage(config, ["administrator"]), renderPage("users"));
  app.use((req, res) => res.status(404).render("error", { message: "Not found", error: {} }));
  return { app, config };
}

function consumeRateLimit(entries, key, amount, maximum) {
  const now = Date.now();
  const current = entries.get(key);
  const bucket = !current || now - current.startedAt >= 60000 ? { startedAt: now, count: 0 } : current;
  if (bucket.count + amount > Number(maximum || 300)) return false;
  bucket.count += amount;
  entries.set(key, bucket);
  if (entries.size > 1000) entries.forEach((value, entryKey) => { if (now - value.startedAt >= 60000) entries.delete(entryKey); });
  return true;
}

function authenticateRequest(config, req, callback) {
  const target = new URL(config.backend_rest_url);
  const transport = target.protocol === "https:" ? https : http;
  let completed = false;
  const complete = (authorized) => {
    if (completed) return;
    completed = true;
    callback(authorized);
  };
  const request = transport.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === "https:" ? 443 : 80),
    method: "GET",
    path: (target.pathname === "/" ? "" : target.pathname.replace(/\/$/, "")) + "/api/auth/me",
    headers: { cookie: req.headers.cookie || "", accept: "application/json" }
  }, (response) => {
    let body = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => { body += chunk; });
    response.on("error", () => complete(false));
    response.on("end", () => {
      if (response.statusCode !== 200) return complete(false);
      try { complete(!!JSON.parse(body).user); } catch (_) { complete(false); }
    });
  });
  request.setTimeout(5000, () => request.destroy(new Error("Authentication timeout")));
  request.on("error", (error) => { appLogger.warning("Browser log authentication failed", { error: error.message }); complete(false); });
  request.end();
}

module.exports = { createFrontend };

function authorizePage(config, roles, requiredLogin) {
  return (req, res, next) => {
    const target = new URL(config.backend_rest_url);
    const transport = target.protocol === "https:" ? https : http;
    let completed = false;
    const backendUnavailable = () => {
      if (completed) return;
      completed = true;
      res.setHeader("Cache-Control", "no-store");
      res.status(503).render("backend-unavailable", {
        title: "Backend indisponible - TAV Monitoring",
        retryUrl: req.originalUrl || "/monitoring"
      });
    };
    const request = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      method: "GET",
      path: (target.pathname === "/" ? "" : target.pathname.replace(/\/$/, "")) + "/api/auth/me",
      headers: { cookie: req.headers.cookie || "", accept: "application/json" }
    }, (backendResponse) => {
      let body = "";
      backendResponse.setEncoding("utf8");
      backendResponse.on("data", (chunk) => { body += chunk; });
      backendResponse.on("error", backendUnavailable);
      backendResponse.on("end", () => {
        if (completed) return;
        if (backendResponse.statusCode === 401) {
          completed = true;
          return res.redirect("/login");
        }
        if (backendResponse.statusCode !== 200) return backendUnavailable();
        let result;
        try { result = JSON.parse(body); } catch (error) { return backendUnavailable(); }
        if (!result.user) return backendUnavailable();
        completed = true;
        if (!roles.includes(result.user.role) || (requiredLogin && String(result.user.login || "").toLowerCase() !== requiredLogin.toLowerCase())) return res.redirect("/monitoring");
        res.locals.currentUser = result.user;
        next();
      });
    });
    request.setTimeout(Number(config.backend_request_timeout_ms) || 5000, () => {
      request.destroy(new Error("Backend authentication timeout"));
    });
    request.on("error", backendUnavailable);
    request.end();
  };
}
