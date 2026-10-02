const DefaultSNMPConnector = require("../classes/SnmpLib");
const DefaultNovaStarApiConnector = require("../classes/NovaStarApiLib");
const DefaultNovaStarLegacyApiConnector = require("../classes/NovaStarApiLib-backup");
const DefaultKiloviewApiConnector = require("../classes/KiloviewApiLib");
const DefaultNetgearM4300SnmpConnector = require("../classes/NetgearM4300SnmpLib");
const DefaultPingConnector = require("../classes/PingLib");
const modelProfiles = require("../classes/ModelProfiles");
const logger = require("../classes/Logger").child("DeviceMonitor");
const { normalizeMachineType } = require("../classes/MachineStore");
const { canonicalizeIo, combineIo } = require("./CanonicalIo");
const novaStarSnmpLock = require("./NovaStarSnmpLock");

const kiloviewScanLocks = new Map();
const TRAP_DESTINATION_OID = "1.3.6.1.4.1.319.10.200.1";
const TRAP_REPORT_ENABLE_OID = "1.3.6.1.4.1.319.10.200.3";

function createDeviceMonitor(overrides, reconciliation) {
  const dependencies = Object.assign({
    SNMPConnector: DefaultSNMPConnector,
    NovaStarApiConnector: DefaultNovaStarApiConnector,
    NovaStarLegacyApiConnector: DefaultNovaStarLegacyApiConnector,
    KiloviewApiConnector: DefaultKiloviewApiConnector,
    NetgearM4300SnmpConnector: DefaultNetgearM4300SnmpConnector,
    PingConnector: DefaultPingConnector
  }, overrides || {});
  const configuredTrapDestinations = new Map();
  const trapStatuses = new Map();
  const snmpSnapshots = new Map();

  async function monitor(machine, options) {
    options = options || {};
    const params = Object.assign({}, machine, { includeReceivingCards: true });
    const host = String(params.host || "").trim();
    const type = normalizeMachineType(params.type);
    const method = String(params.accessMethod || "snmp").toLowerCase();
    if (!host) throw new Error("host is required");

    let data;
    if (type === "kiloview") data = await collectKiloview(params, host);
    else if (type === "netgear-m4300") data = await collectNetgearM4300(params, host);
    else if (type === "other") data = await collectPing(params, host, type);
    else if (method === "api") data = await collectApi(params, host);
    else if (method === "snmp+api" && options.skipSnmp === true) data = await collectApiWithCachedSnmp(params, host);
    else if (method === "snmp+api") data = await collectHybrid(params, host);
    else data = await collectSnmp(params, host);
    data.type = type;
    data.machineId = String(machine.id);
    if (!data.inventory || !data.observations) canonicalizeIo(data, data.source);
    return data;
  }

  async function collectKiloview(params, host) {
    return withKiloviewScanLock(host, async () => {
      const connector = new dependencies.KiloviewApiConnector({
        host: String(params.apiBaseUrl || host),
        username: String(params.apiUsername || params.username || ""),
        password: String(params.apiPassword || params.password || ""),
        timeout: clampNumber(params.timeout, 500, 15000, 5000)
      });
      return connector.monitor();
    });
  }

  async function collectNetgearM4300(params, host) {
    const connector = new dependencies.NetgearM4300SnmpConnector({
      host,
      readCommunity: String(params.readCommunity || "public"),
      timeout: clampNumber(params.timeout, 500, 10000, 2000),
      retries: clampNumber(params.retries, 0, 5, 1),
      port: clampNumber(params.snmpPort, 1, 65535, 161)
    });
    return connector.monitor({ includePoe: params.includePoe === true });
  }

  async function collectPing(params, host, type) {
    const result = await dependencies.PingConnector.ping(host, params.timeout);
    if (!result.online) throw new Error(result.error || "Machine offline");
    return {
      host,
      type,
      source: "ping",
      timestamp: new Date().toISOString(),
      controller: {
        workingStatus: { ok: true, value: "Online" },
        latency: { ok: true, value: result.latencyMs + " ms" }
      },
      inventory: { schemaVersion: 1, entities: [] },
      observations: { schemaVersion: 1, collectedAt: new Date().toISOString(), items: [] },
      resolvedState: {}
    };
  }

  async function collectSnmp(params, host) {
    const configuredModel = params.model ? modelProfiles.normalizeModel(params.model) : "";
    const port = clampNumber(params.snmpPort, 1, 65535, 161);
    return novaStarSnmpLock.withLock(host, port, {
      machineId: String(params.id), operation: "scan"
    }, async () => {
      const connector = new dependencies.SNMPConnector({
        host,
        readCommunity: String(params.readCommunity || "public"),
        writeCommunity: String(params.writeCommunity || "public"),
        timeout: clampNumber(params.timeout, 500, 10000, 2000),
        retries: clampNumber(params.retries, 0, 5, 1),
        port
      });
      logger.debug("SNMP scan started", { host, port, machineId: String(params.id) });
      const data = await connector.monitor({
        includeReceivingCards: true,
        recvCardsPerPort: clampNumber(params.recvCardsPerPort, 1, 12, 1),
        maxInputSlots: optionalClampedNumber(params.maxInputSlots, 1, 32),
        maxOutputSlots: optionalClampedNumber(params.maxOutputSlots, 1, 32),
        maxScreens: optionalClampedNumber(params.maxScreens, 1, 16),
        model: configuredModel,
        modelProfile: modelProfiles.getProfile(configuredModel || "H9")
      });
      data.source = "snmp";
      canonicalizeIo(data, "snmp");
      logger.info("SNMP scan completed", { host, port, machineId: String(params.id) });
      return data;
    });
  }

  async function collectApi(params, host) {
    const configuredModel = params.model ? modelProfiles.normalizeModel(params.model) : "";
    const protocol = normalizeApiProtocol(params);
    const Connector = protocol === "legacy" ? dependencies.NovaStarLegacyApiConnector : dependencies.NovaStarApiConnector;
    const connector = new Connector({
      baseUrl: apiBaseUrl(params, host, protocol),
      host,
      username: String(params.apiUsername || params.username || "admin"),
      password: String(params.apiPassword || params.password || "admin"),
      projectId: String(params.apiProjectId || params.projectId || ""),
      secretKey: String(params.apiSecretKey || params.secretKey || ""),
      encryption: params.apiEncryption === true,
      deviceId: clampNumber(params.apiDeviceId || params.deviceId, 0, 999, 0),
      timeout: clampNumber(params.timeout, 500, 15000, 5000)
    });
    logger.info("NovaStar API scan started", { host, protocol });
    await connector.init();
    const data = await connector.monitor({
      model: configuredModel,
      modelProfile: modelProfiles.getProfile(configuredModel || "H9")
    });
    data.source = "api";
    canonicalizeIo(data, "api");
    logger.info("NovaStar API scan completed", { host, protocol });
    return data;
  }

  async function collectHybrid(params, host) {
    const results = await Promise.allSettled([collectSnmp(params, host), collectApi(params, host)]);
    const snmpData = results[0].status === "fulfilled" ? results[0].value : null;
    const apiData = results[1].status === "fulfilled" ? results[1].value : null;
    if (!snmpData && !apiData) {
      throw new Error("SNMP: " + results[0].reason.message + "; API: " + results[1].reason.message);
    }
    if (snmpData) snmpSnapshots.set(String(params.id), snmpData);
    const merged = buildHybridMonitor(snmpData, apiData);
    merged.source = "snmp+api";
    merged.sourceStatus = { snmp: snmpData ? "ok" : "error", api: apiData ? "ok" : "error" };
    merged.sourceErrors = {
      snmp: snmpData ? "" : results[0].reason.message,
      api: apiData ? "" : results[1].reason.message
    };
    merged.timestamp = new Date().toISOString();
    combineIo(merged, [snmpData, apiData], reconciliation);
    return merged;
  }

  async function collectApiWithCachedSnmp(params, host) {
    const apiData = await collectApi(params, host);
    const snmpData = params.snmpScanEnabled === false ? null : snmpSnapshots.get(String(params.id));
    if (!snmpData) return apiData;
    const merged = buildHybridMonitor(snmpData, apiData);
    merged.source = "snmp+api";
    merged.sourceStatus = { snmp: "cached", api: "ok" };
    merged.sourceErrors = { snmp: "", api: "" };
    merged.timestamp = new Date().toISOString();
    combineIo(merged, [snmpData, apiData], reconciliation);
    return merged;
  }

  async function configureTraps(machine, trapConfig) {
    if (!trapConfig || !trapConfig.enabled || !trapConfig.configure_devices ||
      normalizeMachineType(machine.type) !== "novastar-h" || machine.trapSnmpEnabled !== true) return null;
    const host = String(machine.host || "").trim();
    const port = clampNumber(machine.snmpPort, 1, 65535, 161);
    const key = novaStarSnmpLock.keyFor(host, port);
    const destination = trapConfig.advertised_address + ":" + trapConfig.port;
    if (configuredTrapDestinations.get(key) === destination) return Object.assign({}, trapStatuses.get(String(machine.id)), { unchanged: true });
    return novaStarSnmpLock.withLock(host, port, {
      machineId: String(machine.id), operation: "trap-configuration"
    }, async () => {
      if (configuredTrapDestinations.get(key) === destination) return Object.assign({}, trapStatuses.get(String(machine.id)), { unchanged: true });
      const connector = new dependencies.SNMPConnector({
        host,
        readCommunity: String(machine.readCommunity || "public"),
        writeCommunity: String(machine.writeCommunity || "public"),
        timeout: clampNumber(machine.timeout, 500, 10000, 2000),
        retries: clampNumber(machine.retries, 0, 5, 1),
        port
      });
      const machineId = String(machine.id);
      const status = { machineId, host, port, setSucceeded: false, configured: false,
        destination: "", reportingEnabled: false, verifiedAt: null, error: "" };
      trapStatuses.set(machineId, status);
      try {
        await connector.configureTrapReporting(trapConfig.advertised_address, trapConfig.port);
        status.setSucceeded = true;
        const readDestination = await connector.getString(TRAP_DESTINATION_OID);
        const readEnabled = await connector.getNumber(TRAP_REPORT_ENABLE_OID);
        status.destination = String(readDestination || "");
        status.reportingEnabled = Number(readEnabled) === 1;
        status.configured = status.destination === destination && status.reportingEnabled;
        status.verifiedAt = new Date().toISOString();
        if (!status.configured) status.error = "Trap SNMP readback does not match the requested configuration";
        else configuredTrapDestinations.set(key, destination);
        logger.info("NovaStar trap configuration verified", { host, port, destination,
          readDestination: status.destination, reportingEnabled: status.reportingEnabled,
          configured: status.configured, machineId });
        return Object.assign({}, status);
      } catch (error) {
        status.error = error.message;
        logger.warning("NovaStar trap configuration or readback failed", {
          host, port, destination, setSucceeded: status.setSucceeded, machineId, error: error.message
        });
        throw error;
      }
    });
  }

  function trapStatus(machineId) {
    const status = trapStatuses.get(String(machineId));
    return status ? Object.assign({}, status) : null;
  }

  return { monitor, configureTraps, trapStatus };
}

async function withKiloviewScanLock(host, scan) {
  const key = String(host || "").toLowerCase();
  const previous = kiloviewScanLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  kiloviewScanLocks.set(key, current);
  await previous.catch(() => {});
  try {
    return await scan();
  } finally {
    release();
    if (kiloviewScanLocks.get(key) === current) kiloviewScanLocks.delete(key);
  }
}

function normalizeApiProtocol(params) {
  const value = String(params.apiProtocol || "").toLowerCase();
  if (value === "openapi" || value === "legacy") return value;
  // Compatibilite des machines existantes: sans pId, conserver l'API web.
  return params.apiProjectId ? "openapi" : "legacy";
}

function apiBaseUrl(params, host, protocol) {
  const configured = String(params.apiBaseUrl || params.baseUrl || "").trim();
  if (configured) return configured;
  const cleanHost = String(host).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return protocol === "openapi" ? `http://${cleanHost}:8000/open/api` : `http://${cleanHost}`;
}

function buildHybridMonitor(snmpData, apiData) {
  const base = Object.assign({}, apiData || {}, snmpData || {});
  base.controller = mergePreferred(snmpData && snmpData.controller, apiData && apiData.controller);
  if (apiData && apiData.controller) {
    ["temperatureStatus", "voltageStatus", "cpuStatus", "memoryStatus", "memoryValue", "ethernetStatus", "genlockFrame"].forEach((key) => {
      base.controller[key] = mergePreferred(apiData.controller[key], snmpData && snmpData.controller && snmpData.controller[key]);
    });
    const apiGenlock = apiData.controller.genlockStatus;
    if (isField(apiGenlock) && !apiGenlock.error && isPresent(apiGenlock.value)) {
      base.controller.genlockStatus = apiGenlock;
    }
  }
  ["outputPorts", "mvrCards", "usbPorts", "fans", "powerSupplies"].forEach((key) => {
    base[key] = apiData && Array.isArray(apiData[key]) ? apiData[key] : [];
  });
  base.mvrVideo = apiData && apiData.mvrVideo ? apiData.mvrVideo : {};
  if (apiData && apiData.apiDetails) base.apiDetails = apiData.apiDetails;
  return base;
}

function mergePreferred(primary, fallback) {
  if (isField(primary) || isField(fallback)) return isUsableField(primary) ? primary : fallback;
  if (Array.isArray(primary) || Array.isArray(fallback)) return mergeArrays(primary || [], fallback || []);
  if (isPlainObject(primary) || isPlainObject(fallback)) {
    const preferred = isPlainObject(primary) ? primary : {};
    const backup = isPlainObject(fallback) ? fallback : {};
    if (preferred.error && !backup.error && Object.keys(backup).length) return backup;
    const merged = {};
    Object.keys(Object.assign({}, backup, preferred)).forEach((key) => { merged[key] = mergePreferred(preferred[key], backup[key]); });
    return merged;
  }
  return isPresent(primary) ? primary : fallback;
}

function mergeArrays(primary, fallback) {
  if (!primary.length) return fallback;
  if (!fallback.length) return primary;
  const merged = primary.map((item) => {
    const match = fallback.find((candidate) => itemIdentity(candidate) === itemIdentity(item));
    return match ? mergePreferred(item, match) : item;
  });
  fallback.forEach((item) => {
    if (!merged.some((candidate) => itemIdentity(candidate) === itemIdentity(item))) merged.push(item);
  });
  return merged;
}

function itemIdentity(item) {
  if (!isPlainObject(item)) return "";
  if (item.slotId !== undefined) return "slot:" + (item.rawSlotId !== undefined ? Number(item.rawSlotId) + 1 : normalizePosition(item.slotId));
  if (item.screenId !== undefined) return "screen:" + item.screenId;
  if (item.outputSlotId !== undefined) return "card:" + [normalizePosition(item.outputSlotId), item.netPortId].join(":");
  if (item.sourceId !== undefined) return "source:" + [normalizePosition(item.inputSlotId), item.sourceId].join(":");
  if (item.portId !== undefined) return "port:" + item.portId;
  return "";
}

function normalizePosition(value) { const match = String(value).match(/(\d+)$/); return match ? Number(match[1]) : String(value); }
function isField(value) { return isPlainObject(value) && ("value" in value || "ok" in value); }
function isUsableField(field) { return isField(field) && field.ok !== false && isPresent(field.value); }
function isPlainObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isPresent(value) { return value !== undefined && value !== null && value !== ""; }
function clampNumber(value, min, max, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), min), max) : fallback; }
function optionalClampedNumber(value, min, max) { return value === undefined || value === null || value === "" ? null : clampNumber(value, min, max, null); }

module.exports = { createDeviceMonitor, buildHybridMonitor, mergePreferred, normalizeApiProtocol, apiBaseUrl };
