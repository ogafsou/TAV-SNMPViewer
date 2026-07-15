const express = require("express");
const path = require("path");
const morgan = require("morgan");
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
  app.get("/", (req, res) => res.render("index", {
    title: "TAV Monitoring",
    rest_refresh_s: config.rest_refresh_s
  }));
  app.use((req, res) => res.status(404).render("error", { message: "Not found", error: {} }));
  return { app, config };
}

module.exports = { createFrontend };
