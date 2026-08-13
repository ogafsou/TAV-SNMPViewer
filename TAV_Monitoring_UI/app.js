const express = require("express");
const path = require("path");
const morgan = require("morgan");
const http = require("http");
const https = require("https");
const { loadConfig } = require("./Config");
const { restProxy } = require("./proxy");

function createFrontend(options) {
  const settings = options || {};
  const config = settings.config || loadConfig(settings.configPath);
  const app = express();
  app.disable("x-powered-by");
  app.set("views", path.join(__dirname, "views"));
  app.set("view engine", "ejs");
  app.use(morgan("dev"));
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
        title: page === "monitoring" ? "TAV Monitoring" : (page === "monitoring-map" ? "Monitoring Map - TAV Monitoring" : (page === "monitoring-maps" ? "Map Configuration - TAV Monitoring" : (page === "users" ? "Utilisateurs - TAV Monitoring" : "Configuration - TAV Monitoring"))),
        page,
        canAccessConfiguration,
        canAccessMonitoringMaps,
        backend_url: config.backend_rest_url,
        rest_refresh_s: config.rest_refresh_s,
        bkgnd_opacity: config.bkgnd_opacity === undefined ? 1 : config.bkgnd_opacity
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
  app.get("/configuration", authorizePage(config, ["editor", "administrator"]), renderPage("configuration"));
  app.get("/monitoring-maps", authorizePage(config, ["administrator"], "Olivier"), renderPage("monitoring-maps"));
  app.get("/users", authorizePage(config, ["administrator"]), renderPage("users"));
  app.use((req, res) => res.status(404).render("error", { message: "Not found", error: {} }));
  return { app, config };
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
