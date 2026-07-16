const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const STATE_FILE = path.join(ROOT, "state.json");
const APP_CONFIG = loadAppConfig();
const PORT = clamp(process.env.PORT, 1, 65535, APP_CONFIG.port);
const HOST = process.env.HOST || APP_CONFIG.host;
const tokens = new Set();

let state = loadState();

const server = http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return send(res, 204, "");

  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/simulator/api/state") {
      return json(res, 200, publicState());
    }
    if (req.method === "PUT" && url.pathname === "/simulator/api/config") {
      const body = await readJson(req);
      state.config = normalizeConfig(body);
      state.components = buildComponents(state.config, state.components);
      saveState();
      return json(res, 200, publicState());
    }
    if (req.method === "PATCH" && url.pathname === "/simulator/api/component") {
      const body = await readJson(req);
      if (!state.components[body.id]) return json(res, 404, { error: "Composant inconnu" });
      if (!["ok", "warning", "error"].includes(body.status)) {
        return json(res, 400, { error: "Etat invalide" });
      }
      state.components[body.id].status = body.status;
      saveState();
      return json(res, 200, publicState());
    }
    if (req.method === "POST" && url.pathname === "/simulator/api/reset") {
      state = defaultState();
      saveState();
      return json(res, 200, publicState());
    }
    if (req.method === "POST" && url.pathname === "/api/user/login") {
      await readJson(req);
      const token = crypto.randomBytes(20).toString("hex");
      tokens.add(token);
      return novaJson(res, { token, userName: "admin", deviceId: 0 });
    }
    if (req.method === "POST" && url.pathname.startsWith("/open/api/")) {
      const request = await readJson(req);
      const projectId = "simulator";
      if (request.pId !== projectId) return openApiJson(res, null, 15, "Open_Id_Illegal_Err");
      const expectedSign = base64Md5Hex(String(request.timeStamp || "") + projectId);
      if (request.sign !== expectedSign) return openApiJson(res, null, 18, "Open_Signature_Err");
      if (!request.body || Number(request.body.deviceId) !== 0) return openApiJson(res, null, 1, "Params_Error");
      if (url.pathname === "/open/api/device/readDetail") return openApiJson(res, buildDetail());
      if (url.pathname === "/open/api/main/readVideoServerInfo") return openApiJson(res, buildVideoServerInfo());
      if (url.pathname === "/open/api/main/initStatus") return openApiJson(res, buildInitStatus());
      return openApiJson(res, null, 84, "Illegal command");
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/")) {
      await readJson(req);
      if (!tokens.has(String(req.headers.token || ""))) {
        return json(res, 200, { data: null, msg: "User not login", status: 106 });
      }
      if (url.pathname === "/api/device/readDetail") return novaJson(res, buildDetail());
      if (url.pathname === "/api/device/readGenLockWorkStatus") return novaJson(res, buildGenlock());
      if (url.pathname === "/api/main/readVideoServerInfo") return novaJson(res, buildVideoServerInfo());
      if (url.pathname === "/api/main/initStatus") return novaJson(res, buildInitStatus());
    }
    if (req.method === "GET") return serveStatic(url.pathname, res);
    return json(res, 404, { error: "Route inconnue" });
  } catch (error) {
    return json(res, error.statusCode || 500, { error: error.message });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`NovaStar Simulator: http://localhost:${PORT}`);
    console.log(`API NovaStar:       http://127.0.0.1:${PORT}`);
  });
}

function defaultState() {
  const config = normalizeConfig({
    model: "H9", name: "NovaStar H9 Simulator", ip: "127.0.0.1",
    inputCards: 2, inputsPerCard: 4, inputTypes: ["HDMI", "SDI", "DVI", "DP"],
    outputCards: 1, outputsPerCard: 16, fans: 3, powerSupplies: 2,
    width: 3840, height: 2160, refreshRate: 60
  });
  return { config, components: buildComponents(config, {}) };
}

function normalizeConfig(value = {}) {
  const types = Array.isArray(value.inputTypes) ? value.inputTypes : ["HDMI"];
  return {
    model: ["H2", "H5", "H9", "Custom"].includes(value.model) ? value.model : "H9",
    name: clean(value.name, "NovaStar H Simulator", 80),
    ip: clean(value.ip, "127.0.0.1", 45),
    inputCards: clamp(value.inputCards, 0, 16, 2),
    inputsPerCard: clamp(value.inputsPerCard, 1, 16, 4),
    inputTypes: types.slice(0, 16).map((v) => clean(v, "HDMI", 12)),
    outputCards: clamp(value.outputCards, 0, 8, 1),
    outputsPerCard: clamp(value.outputsPerCard, 1, 32, 16),
    fans: clamp(value.fans, 0, 16, 3),
    powerSupplies: clamp(value.powerSupplies, 0, 8, 2),
    width: clamp(value.width, 320, 16384, 3840),
    height: clamp(value.height, 240, 8640, 2160),
    refreshRate: clamp(value.refreshRate, 1, 240, 60)
  };
}

function buildComponents(config, previous) {
  const next = {};
  add("controller", "Controleur", "system");
  add("temperature", "Temperature", "system");
  add("voltage", "Tension", "system");
  add("genlock", "Genlock", "system");
  for (let c = 0; c < config.inputCards; c++) {
    add(`input-card-${c}`, `Carte Input ${c + 1}`, "input-card");
    for (let i = 0; i < config.inputsPerCard; i++) {
      add(`input-${c}-${i}`, `${config.inputTypes[i % config.inputTypes.length]} ${c + 1}.${i + 1}`, "input");
    }
  }
  for (let c = 0; c < config.outputCards; c++) {
    add(`output-card-${c}`, `Carte Output ${c + 1}`, "output-card");
    for (let i = 0; i < config.outputsPerCard; i++) add(`output-${c}-${i}`, `Output ${c + 1}.${i + 1}`, "output");
  }
  for (let i = 0; i < config.fans; i++) add(`fan-${i}`, `Ventilateur ${i + 1}`, "fan");
  for (let i = 0; i < config.powerSupplies; i++) add(`power-${i}`, `Alimentation ${i + 1}`, "power");
  return next;

  function add(id, label, group) {
    next[id] = { id, label, group, status: previous[id] ? previous[id].status : "ok" };
  }
}

function buildDetail() {
  const c = state.config;
  const slots = [];
  for (let card = 0; card < c.inputCards; card++) {
    const cardStatus = componentStatus(`input-card-${card}`);
    slots.push({
      slotId: card, cardType: 1, cardCategory: 19, modelId: 31502,
      status: cardStatus === "error" ? 2 : 1, workStatus: rawNormal(cardStatus),
      version: "SIM-1.0", sn: serial("IN", card),
      resolution: resolution(),
      interfaces: Array.from({ length: c.inputsPerCard }, (_, index) => {
        const status = componentStatus(`input-${card}-${index}`);
        return {
          inputSlotId: card, interfaceId: index,
          interfaceType: interfaceType(c.inputTypes[index % c.inputTypes.length]),
          iSignal: rawSignal(status), isUsed: 1, isSupportAudio: 1,
          overLoadState: status === "error" ? 2 : 0
        };
      })
    });
  }
  for (let card = 0; card < c.outputCards; card++) {
    const slotId = c.inputCards + card;
    const cardStatus = componentStatus(`output-card-${card}`);
    const statuses = Array.from({ length: c.outputsPerCard }, (_, index) => ({
      id: index, type: 0, status: rawLink(componentStatus(`output-${card}-${index}`))
    }));
    slots.push({
      slotId, cardType: 2, cardCategory: 1, modelId: 31558,
      status: cardStatus === "error" ? 2 : 1, workStatus: rawNormal(cardStatus),
      version: "SIM-1.0", sn: serial("OUT", card), resolution: resolution(),
      senderInterfaceStatus: statuses,
      linkstatus: Object.fromEntries(statuses.map((item) => [`link${item.id}`, item.status === 1 ? 1 : 0])),
      lightstatus: {}
    });
  }
  return {
    deviceId: 0, modelId: modelId(c.model), name: c.name, deviceType: 0, deviceWorkMode: 0,
    status: componentStatus("controller") === "error" ? 0 : 1,
    temp: rawNormal(componentStatus("temperature")),
    volt: rawNormal(componentStatus("voltage")), cpuStatus: 0, memStatus: 0,
    ethernetStatus: 1, extSignal: componentStatus("genlock") === "ok" ? 1 : 0, memory: 8192,
    protoVersion: "1.0.0.0", sn: "SIMH90000000001", MAC: "02-00-00-00-00-01",
    network: { ip: ipObject(c.ip), dhcp: 0 },
    deviceSpecs: { inputCardNumMax: 16, outputCardNumMax: 8 },
    genlock: { deviceId: 0, enable: 1, type: 1, status: rawNormal(componentStatus("genlock")), extSignal: componentStatus("genlock") === "ok" ? 1 : 0 },
    fanList: Array.from({ length: c.fans }, (_, i) => ({ fanId: i, status: rawNormal(componentStatus(`fan-${i}`)) })),
    powerList: Array.from({ length: c.powerSupplies }, (_, i) => ({ powerId: i, iSignal: rawPower(componentStatus(`power-${i}`)) })),
    usbStatus: [{ usbId: 0, status: 0 }, { usbId: 1, status: 0 }], slotList: slots
  };
}

function buildGenlock() {
  const status = componentStatus("genlock");
  return { deviceId: 0, status: rawNormal(status), refreshRate: state.config.refreshRate, type: 1 };
}

function buildVideoServerInfo() {
  return { mvrCardOnline: 0, videoStatus: 0, mvrUrl: "", echoUrl: "" };
}

function buildInitStatus() {
  return { deviceId: 0, initStatus: 1, mainModelId: modelId(state.config.model), softwareVersion: "SIM-1.0.0", port: PORT };
}

function resolution() {
  return { width: state.config.width, height: state.config.height, refresh: state.config.refreshRate * 100, outputCount: state.config.inputsPerCard, isInterlace: 0 };
}

function componentStatus(id) { return state.components[id] ? state.components[id].status : "ok"; }
function rawNormal(status) { return status === "ok" ? 0 : status === "warning" ? 1 : 2; }
function rawSignal(status) { return status === "ok" ? 1 : status === "warning" ? 2 : 3; }
function rawLink(status) { return status === "ok" ? 1 : status === "warning" ? 2 : 4; }
function rawPower(status) { return status === "ok" ? 1 : status === "warning" ? 2 : 3; }
function serial(prefix, index) { return `SIM${prefix}${String(index + 1).padStart(11, "0")}`.slice(0, 16); }
function modelId(model) { return model === "H2" ? 29963 : 29965; }
function interfaceType(type) {
  return ({ HDMI: 4, SDI: 6, DVI: 7, DP: 8, MVR: 13, Ethernet: 2 })[type] || 4;
}
function ipObject(ip) {
  const parts = String(ip).split(".").map(Number);
  if (parts.length !== 4 || parts.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) return { ip0: 127, ip1: 0, ip2: 0, ip3: 1 };
  return Object.fromEntries(parts.map((v, i) => [`ip${i}`, v]));
}

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const config = normalizeConfig(saved.config);
    return { config, components: buildComponents(config, saved.components || {}) };
  } catch (_) { return defaultState(); }
}
function loadAppConfig() {
  try {
    const stored = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
    return {
      host: clean(stored.host, "0.0.0.0", 255),
      port: clamp(stored.port, 1, 65535, 8080)
    };
  } catch (_) {
    return { host: "0.0.0.0", port: 8080 };
  }
}
function saveState() { fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8"); }
function publicState() { return { config: state.config, components: Object.values(state.components), apiBaseUrl: `http://127.0.0.1:${PORT}` }; }
function base64Md5Hex(value) { const hex = crypto.createHash("md5").update(value, "utf8").digest("hex"); return Buffer.from(hex, "ascii").toString("base64"); }
function openApiJson(res, body, status = 0, msg = "Success") { return json(res, 200, { body: body || {}, msg, sign: "", status }); }

module.exports = { server };

function serveStatic(requestPath, res) {
  const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const file = path.resolve(PUBLIC, relative);
  if (!file.startsWith(`${PUBLIC}${path.sep}`) && file !== path.join(PUBLIC, "index.html")) return json(res, 403, { error: "Acces refuse" });
  try {
    const content = fs.readFileSync(file);
    const ext = path.extname(file);
    const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(content);
  } catch (_) { json(res, 404, { error: "Fichier introuvable" }); }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", (chunk) => { size += chunk.length; if (size > 1024 * 1024) req.destroy(); else chunks.push(chunk); });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (_) { const error = new Error("JSON invalide"); error.statusCode = 400; reject(error); }
    });
    req.on("error", reject);
  });
}
function novaJson(res, data) { return json(res, 200, { data, msg: "Success", status: 0 }); }
function json(res, status, value) { send(res, status, JSON.stringify(value), "application/json; charset=utf-8"); }
function send(res, status, body, type = "text/plain; charset=utf-8") { res.writeHead(status, { "Content-Type": type }); res.end(body); }
function setCors(res) { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Headers", "Content-Type, token"); res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS"); }
function clamp(value, min, max, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback; }
function clean(value, fallback, max) { const text = String(value || "").trim(); return (text || fallback).slice(0, max); }
