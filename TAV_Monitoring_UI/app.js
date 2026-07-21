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
    return (req, res) => res.render("index", {
      title: page === "monitoring" ? "TAV Monitoring" : (page === "users" ? "Utilisateurs - TAV Monitoring" : "Configuration - TAV Monitoring"),
      page,
      rest_refresh_s: config.rest_refresh_s
    });
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
  app.get("/configuration", authorizePage(config, ["editor", "administrator"]), renderPage("configuration"));
  app.get("/users", authorizePage(config, ["administrator"]), renderPage("users"));
  app.use((req, res) => res.status(404).render("error", { message: "Not found", error: {} }));
  return { app, config };
}

module.exports = { createFrontend };

function authorizePage(config, roles) {
  return (req, res, next) => {
    const target = new URL(config.backend_rest_url);
    const transport = target.protocol === "https:" ? https : http;
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
      backendResponse.on("end", () => {
        if (backendResponse.statusCode === 401) return res.redirect("/login");
        let result;
        try { result = JSON.parse(body); } catch (error) { return res.status(502).send("Backend authentication unavailable"); }
        if (!result.user || !roles.includes(result.user.role)) return res.redirect("/monitoring");
        next();
      });
    });
    request.on("error", () => res.status(502).send("Backend authentication unavailable"));
    request.end();
  };
}
