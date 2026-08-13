const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  port: 3001,
  monitor_interval_s: 30,
  machines_file: "./machines.json",
  maps_file: "./maps.json",
  users_file: "./users.json",
  monitoring_reference_mode: true,
  ping_monitoring_reference: null,
  loglevel: "info",
  max_parallel_scans: 8,
  io_reconciliation: {
    inventory_strategy: "union-api-first",
    operational_strategy: "worst-valid-state",
    single_source_strategy: "use-available",
    missing_state: "unknown",
    recovery_confirmation_scans: 2,
    inventory_removal_confirmation_scans: 3
  },
  alerts: {
    enabled: false,
    provider: "ntfy",
    server_url: "https://ntfy.sh",
    topic: "",
    token: "",
    frontend_url: "",
    public_status_enabled: false,
    public_status_secret: "",
    public_status_ttl_s: 86400,
    failure_threshold: 2,
    recovery_threshold: 2,
    request_timeout_ms: 5000,
    notify_recovery: true
  }
};

function loadConfig(configPath) {
  const filePath = path.resolve(configPath || process.env.TAV_BACKEND_CONFIG || path.join(__dirname, "..", "config.json"));
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const merged = Object.assign({}, DEFAULTS, stored);
  const configuredMachinesFile = process.env.TAV_MACHINES_FILE || merged.machines_file || DEFAULTS.machines_file;
  const configuredUsersFile = process.env.TAV_USERS_FILE || merged.users_file || DEFAULTS.users_file;
  const configuredMapsFile = process.env.TAV_MAPS_FILE || merged.maps_file || DEFAULTS.maps_file;
  return {
    configPath: filePath,
    port: numberInRange(merged.port, 0, 65535, DEFAULTS.port),
    monitor_interval_s: numberInRange(merged.monitor_interval_s, 0, 86400, DEFAULTS.monitor_interval_s),
    machinesFile: path.resolve(path.dirname(filePath), String(configuredMachinesFile)),
    machines_file: String(configuredMachinesFile),
    mapsFile: path.resolve(path.dirname(filePath), String(configuredMapsFile)),
    maps_file: String(configuredMapsFile),
    usersFile: path.resolve(path.dirname(filePath), String(configuredUsersFile)),
    users_file: String(configuredUsersFile),
    monitoring_reference_mode: merged.monitoring_reference_mode === true,
    ping_monitoring_reference: normalizePingReference(merged.ping_monitoring_reference),
    loglevel: ["debug", "info", "warning", "error"].includes(String(merged.loglevel).toLowerCase())
      ? String(merged.loglevel).toLowerCase() : DEFAULTS.loglevel,
    max_parallel_scans: numberInRange(merged.max_parallel_scans, 1, 32, DEFAULTS.max_parallel_scans),
    io_reconciliation: normalizeIoReconciliation(merged.io_reconciliation),
    alerts: normalizeAlerts(merged.alerts)
  };
}

function normalizeIoReconciliation(value) {
  const stored = value && typeof value === "object" ? value : {};
  const defaults = DEFAULTS.io_reconciliation;
  return {
    inventory_strategy: enumValue(stored.inventory_strategy,
      ["union-api-first", "union-snmp-first", "api-only", "snmp-only", "intersection"], defaults.inventory_strategy),
    operational_strategy: enumValue(stored.operational_strategy,
      ["worst-valid-state", "best-valid-state", "snmp-first", "api-first", "unknown-on-conflict"], defaults.operational_strategy),
    single_source_strategy: enumValue(stored.single_source_strategy,
      ["use-available", "require-both", "snmp-required", "api-required"], defaults.single_source_strategy),
    missing_state: enumValue(stored.missing_state, ["unknown", "warning", "error", "inactive"], defaults.missing_state),
    recovery_confirmation_scans: numberInRange(stored.recovery_confirmation_scans, 1, 20, defaults.recovery_confirmation_scans),
    inventory_removal_confirmation_scans: numberInRange(stored.inventory_removal_confirmation_scans, 1, 20, defaults.inventory_removal_confirmation_scans)
  };
}

function enumValue(value, allowed, fallback) {
  const normalized = String(value || "").toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizePingReference(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.respondingMachineIds)) return null;
  return {
    version: 1,
    setAt: String(value.setAt || ""),
    respondingMachineIds: Array.from(new Set(value.respondingMachineIds.map(String))).sort()
  };
}

function saveConfig(config, patch) {
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(config.configPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const next = Object.assign({}, DEFAULTS, stored, patch || {});
  fs.writeFileSync(config.configPath, JSON.stringify(next, null, 2) + "\n", "utf8");
  Object.assign(config, loadConfig(config.configPath));
  return config;
}

function numberInRange(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? Math.floor(number) : fallback;
}

function normalizeAlerts(value) {
  const stored = value && typeof value === "object" ? value : {};
  const merged = Object.assign({}, DEFAULTS.alerts, stored);
  return {
    enabled: merged.enabled === true,
    provider: String(merged.provider || "ntfy").toLowerCase(),
    server_url: String(merged.server_url || DEFAULTS.alerts.server_url).replace(/\/+$/, ""),
    topic: String(merged.topic || "").trim(),
    token: String(merged.token || "").trim(),
    frontend_url: String(merged.frontend_url || "").trim(),
    public_status_enabled: merged.public_status_enabled === true,
    public_status_secret: String(process.env.TAV_PUBLIC_STATUS_SECRET || merged.public_status_secret || ""),
    public_status_ttl_s: numberInRange(merged.public_status_ttl_s, 60, 604800, DEFAULTS.alerts.public_status_ttl_s),
    failure_threshold: numberInRange(merged.failure_threshold, 1, 20, DEFAULTS.alerts.failure_threshold),
    recovery_threshold: numberInRange(merged.recovery_threshold, 1, 20, DEFAULTS.alerts.recovery_threshold),
    request_timeout_ms: numberInRange(merged.request_timeout_ms, 500, 30000, DEFAULTS.alerts.request_timeout_ms),
    notify_recovery: merged.notify_recovery !== false
  };
}

module.exports = { loadConfig, saveConfig, DEFAULTS };
