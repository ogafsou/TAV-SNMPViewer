const DefaultSNMPConnector = require("../classes/SnmpLib");
const DefaultNovaStarApiConnector = require("../classes/NovaStarApiLib");
const DefaultNovaStarLegacyApiConnector = require("../classes/NovaStarApiLib-backup");
const DefaultKiloviewApiConnector = require("../classes/KiloviewApiLib");
const DefaultNetgearM4300SnmpConnector = require("../classes/NetgearM4300SnmpLib");
const DefaultPingConnector = require("../classes/PingLib");
const modelProfiles = require("../classes/ModelProfiles");
const logger = require("../classes/Logger");
const { normalizeMachineType } = require("../classes/MachineStore");

function createDeviceMonitor(overrides) {
  const dependencies = Object.assign({
    SNMPConnector: DefaultSNMPConnector,
    NovaStarApiConnector: DefaultNovaStarApiConnector,
    NovaStarLegacyApiConnector: DefaultNovaStarLegacyApiConnector,
    KiloviewApiConnector: DefaultKiloviewApiConnector,
    NetgearM4300SnmpConnector: DefaultNetgearM4300SnmpConnector,
    PingConnector: DefaultPingConnector
  }, overrides || {});

  async function monitor(machine) {
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
    else if (method === "snmp+api") data = await collectHybrid(params, host);
    else data = await collectSnmp(params, host);
    data.type = type;
    data.machineId = String(machine.id);
    return data;
  }

  async function collectKiloview(params, host) {
    const connector = new dependencies.KiloviewApiConnector({
      host: String(params.apiBaseUrl || host),
      username: String(params.apiUsername || params.username || ""),
      password: String(params.apiPassword || params.password || ""),
      timeout: clampNumber(params.timeout, 500, 15000, 5000)
    });
    return connector.monitor();
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
      inputSlots: { count: 0, slots: [] },
      outputSlots: { count: 0, slots: [] },
      screens: { count: 0, screens: [] },
      receivingCards: []
    };
  }

  async function collectSnmp(params, host) {
    const configuredModel = params.model ? modelProfiles.normalizeModel(params.model) : "";
    const connector = new dependencies.SNMPConnector({
      host,
      readCommunity: String(params.readCommunity || "public"),
      writeCommunity: String(params.writeCommunity || "private"),
      timeout: clampNumber(params.timeout, 500, 10000, 2000),
      retries: clampNumber(params.retries, 0, 5, 1)
    });
    logger.debug("SNMP scan started", { host });
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
    return data;
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
    await connector.init();
    return connector.monitor({
      model: configuredModel,
      modelProfile: modelProfiles.getProfile(configuredModel || "H9")
    });
  }

  async function collectHybrid(params, host) {
    const results = await Promise.allSettled([collectSnmp(params, host), collectApi(params, host)]);
    const snmpData = results[0].status === "fulfilled" ? results[0].value : null;
    const apiData = results[1].status === "fulfilled" ? results[1].value : null;
    if (!snmpData && !apiData) {
      throw new Error("SNMP: " + results[0].reason.message + "; API: " + results[1].reason.message);
    }
    const merged = buildHybridMonitor(snmpData, apiData);
    merged.source = "snmp+api";
    merged.sourceStatus = { snmp: snmpData ? "ok" : "error", api: apiData ? "ok" : "error" };
    merged.sourceErrors = {
      snmp: snmpData ? "" : results[0].reason.message,
      api: apiData ? "" : results[1].reason.message
    };
    merged.timestamp = new Date().toISOString();
    return merged;
  }

  return { monitor };
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
    ["temperatureStatus", "voltageStatus", "cpuStatus", "memoryStatus", "memoryValue", "ethernetStatus"].forEach((key) => {
      base.controller[key] = mergePreferred(apiData.controller[key], snmpData && snmpData.controller && snmpData.controller[key]);
    });
  }
  base.inputSlots = preferApiSlots(apiData && apiData.inputSlots, snmpData && snmpData.inputSlots);
  base.outputSlots = preferApiSlots(apiData && apiData.outputSlots, snmpData && snmpData.outputSlots);
  base.screens = preferSnmpScreens(snmpData && snmpData.screens, apiData && apiData.screens);
  base.receivingCards = snmpData && Array.isArray(snmpData.receivingCards) ? snmpData.receivingCards : [];
  ["outputPorts", "mvrCards", "usbPorts", "fans", "powerSupplies"].forEach((key) => {
    base[key] = apiData && Array.isArray(apiData[key]) ? apiData[key] : [];
  });
  base.mvrVideo = apiData && apiData.mvrVideo ? apiData.mvrVideo : {};
  if (apiData && apiData.apiDetails) base.apiDetails = apiData.apiDetails;
  return base;
}

function preferApiSlots(apiCollection, snmpCollection) {
  if (!apiCollection || apiCollection.error || !Array.isArray(apiCollection.slots)) return snmpCollection || { count: 0, slots: [] };
  const fallback = snmpCollection && Array.isArray(snmpCollection.slots) ? snmpCollection.slots : [];
  const slots = apiCollection.slots.map((item) => {
    const match = fallback.find((candidate) => itemIdentity(candidate) === itemIdentity(item));
    return match ? mergePreferred(item, match) : item;
  });
  return Object.assign({}, apiCollection, { count: slots.length, slots });
}

function preferSnmpScreens(snmpScreens, apiScreens) {
  if (!snmpScreens || snmpScreens.error || !Array.isArray(snmpScreens.screens)) return apiScreens || { count: 0, screens: [] };
  if (!snmpScreens.screens.length) return apiScreens && Array.isArray(apiScreens.screens) ? apiScreens : snmpScreens;
  const screens = snmpScreens.screens.slice();
  if (screens.length === 1 && apiScreens && Array.isArray(apiScreens.screens) && apiScreens.screens.length === 1) {
    screens[0] = mergePreferred(screens[0], apiScreens.screens[0]);
  }
  return Object.assign({}, snmpScreens, { count: screens.length, screens });
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
    if (Array.isArray(merged.slots)) merged.count = merged.slots.length;
    if (Array.isArray(merged.screens)) merged.count = merged.screens.length;
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
