const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const config = readJson("config.json", { host: "0.0.0.0", port: 8081 });
const STATE_FILE = path.join(ROOT, "state.json");
let state = normalize(readJson("state.json", defaults()));

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/") return file(res, "public/index.html", "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/app.js") return file(res, "public/app.js", "text/javascript; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/style.css") return file(res, "public/style.css", "text/css; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/simulator/api/state") return json(res, 200, state);
    if (req.method === "PUT" && url.pathname === "/simulator/api/config") {
      state.config = Object.assign({}, state.config, await body(req));
      state = normalize(state); save(); return json(res, 200, state);
    }
    if (req.method === "PATCH" && url.pathname === "/simulator/api/component") {
      const update = await body(req);
      if (!Object.prototype.hasOwnProperty.call(state.components, update.id)) return json(res, 404, { error: "Composant inconnu" });
      if (!["ok", "warning", "error"].includes(update.status)) return json(res, 400, { error: "Statut invalide" });
      state.components[update.id] = update.status; save(); return json(res, 200, state);
    }
    if (req.method === "POST" && url.pathname === "/simulator/api/reset") {
      state = defaults(); save(); return json(res, 200, state);
    }

    if (req.method === "GET" && url.pathname === "/api/users/login.json") {
      if (state.config.apiProtocol === "v1") return json(res, 404, { result: "error", msg: "V2 disabled" });
      if (state.components.api === "error") return json(res, 503, { result: "error", msg: "Device unavailable" });
      return json(res, 200, { result: "ok", data: { changed: true, alias: "Admin", software: 1, session: "", token: "kiloview-simulator-token" } });
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/") && url.pathname.endsWith(".json")) {
      if (state.config.apiProtocol === "v1") return json(res, 404, { result: "error", msg: "V2 disabled" });
      if (!String(req.headers.cookie || "").split(/;\s*/).includes("token=kiloview-simulator-token")) {
        return json(res, 200, { result: "error", msg: "Invalid token" });
      }
      return kiloviewV2(url.pathname, url, res);
    }
    if (req.method === "POST" && url.pathname === "/api/v1/user/authorize") {
      if (state.components.api === "error") return json(res, 503, { result: "error", msg: "Device unavailable" });
      return json(res, 200, { result: "ok", data: { session: "kiloview-simulator-session", token: "kiloview-simulator-token" } });
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/v1/")) {
      if (!authorized(req)) return json(res, 401, { result: "error", msg: "Unauthorized" });
      return kiloview(url.pathname, res);
    }
    json(res, 404, { error: "Route inconnue" });
  } catch (error) { json(res, 500, { error: error.message }); }
});

function kiloviewV2(route, url, res) {
  const c = state.config;
  const s = state.components;
  if (route === "/api/mode/get.json") return ok(res, { mode: c.mode });
  if (route === "/api/users/session.json") return ok(res);
  if (route === "/api/device/status.json") return component(res, "system", {
    audio_sampling: c.audioSampling, audio_format: c.audioFormat, yRes: 1080, xRes: 1920,
    interlaced: c.interlaced, serial_number: c.serialNumber, frame_rate: c.frameRate,
    bitrate: c.videoBitrate, audio_channels: c.audioChannels,
    audio_signal: s.audio === "error" ? "none" : c.audioSource,
    resolution: s.video === "error" ? "No signal" : c.inputResolution,
    video_signal: s.video !== "error"
  });
  if (route === "/api/device/get.json") return component(res, "encoder", {
    device_group: c.deviceGroup, device_name: c.deviceName, channel_name: c.channelName,
    quality: c.quality, ndi_connection: c.ndiConnection
  });
  if (route === "/api/audio/get.json") return component(res, "audio", {
    level: c.audioLevel, channels: c.audioChannels, volume: c.audioVolume, signal: c.audioSource,
    mapping: Array.from({ length: Math.min(c.audioChannels, 8) }, (_, index) => ({ input_channel: index + 1, encoding_channel: index + 1 }))
  });
  if (route === "/api/network/get.json") {
    if (s.network === "error") return failure(res, "Network API error");
    return json(res, 200, { result: "ok", data: [{ device: c.networkInterface, state: s.network === "ok" ? "up" : "down", ip: c.deviceAddress, mask: "255.255.255.0", mac: c.networkMac }], data_size: 1 });
  }
  if (route === "/api/network/getProtocol.json") return ok(res, { http: true, https: true, httpPort: 80, httpsPort: 443 });
  if (route === "/api/firmware/get.json") return ok(res, { ndiVersion: c.ndiVersion, hardwareVersion: c.hardwareVersion, softwareVersion: c.softwareVersion, firmwareVersion: c.firmwareVersion });
  if (route === "/api/users/software_status.json") return ok(res, { user: url.searchParams.get("user") || "admin", software: 1 });
  return json(res, 404, { result: "error", msg: "Unknown Kiloview V2 route" });
}

function kiloview(route, res) {
  const c = state.config;
  const s = state.components;
  if (route === "/api/v1/mode/get") return ok(res, { mode: c.mode });
  if (route === "/api/v1/mode/status") return component(res, "system", { status: s.system === "ok" ? "ready" : s.system });
  if (route === "/api/v1/sys/server_info") return component(res, "system", {
    addr: c.deviceAddress, persis: c.uptime, start_time: c.startTime,
    cpu_payload: c.cpuLoad, mem_used: c.memoryUsed, mem_total: c.memoryTotal
  });
  if (route === "/api/v1/network/get") {
    if (s.network === "error") return failure(res, "Network API error");
    return json(res, 200, { result: "ok", data: [{ device: c.networkInterface, state: s.network === "ok" ? "up" : "down", address: c.deviceAddress }] });
  }
  if (route === "/api/v1/encoder/ndi/get_config") return component(res, "encoder", {
    device_name: c.deviceName, channel_name: c.channelName, device_group: c.deviceGroup,
    ndi_connection: c.ndiConnection, quality: c.quality
  });
  if (route === "/api/v1/encoder/ndi/status") return component(res, "video", {
    video_signal: s.video === "ok" ? c.videoInput : "none", resolution: c.inputResolution,
    interlaced: c.interlaced, bitrate: c.videoBitrate,
    audio_signal: s.audio === "ok" ? "present" : "none", audio_format: c.audioFormat,
    audio_sampling: c.audioSampling, audio_channels: c.audioChannels
  });
  if (route === "/api/v1/encoder/ndi/get_audio") return component(res, "audio", { signal: c.audioSource, volume: c.audioVolume });
  if (route === "/api/v1/decoder/current/status") return component(res, "source", {
    online: s.source === "ok", name: c.sourceName, url: c.sourceUrl, ip: c.sourceIp,
    resolution: c.inputResolution, inst_frame_rate: c.frameRate, interlaced: c.interlaced,
    de_interlace: c.deinterlaced, bitrate: c.videoBitrate,
    audio_format: c.audioFormat, audio_sampling: c.audioSampling,
    audio_channels: s.audio === "error" ? 0 : c.audioChannels,
    warning: decoderWarning(s)
  });
  if (route === "/api/v1/decoder/output/get") return component(res, "output", { resolution: c.outputResolution, frame_rate: c.frameRate });
  return json(res, 404, { result: "error", msg: "Unknown Kiloview route" });
}

function decoderWarning(s) {
  if (s.video === "error") return "ERROR:no-video-output";
  if (s.audio === "error") return "ERROR:no-audio-output";
  if (s.source === "warning") return "WARN:url-changed";
  if (s.source === "error") return "WARN:offline";
  if (s.output === "warning") return "WARN:match-error";
  if (s.output === "error") return "WARN:unsupported-resolution";
  return "";
}

function component(res, name, data) { return state.components[name] === "error" && !["video", "audio", "source", "output"].includes(name) ? failure(res, `${name} error`) : ok(res, data); }
function ok(res, data) { return json(res, 200, { result: "ok", data }); }
function failure(res, message) { return json(res, 200, { result: "error", msg: message }); }
function authorized(req) { return req.headers["api-session"] === "kiloview-simulator-session" && req.headers["api-token"] === "kiloview-simulator-token"; }

function defaults() {
  return normalize({
    config: {
      model: "E2", mode: "encoder", apiProtocol: "v2", deviceName: "Kiloview Simulator", channelName: "Camera 1",
      deviceGroup: "public", ndiConnection: "multicast", quality: 80, deviceAddress: "127.0.0.1",
      networkInterface: "eth0", uptime: "1 day", startTime: new Date().toISOString(), cpuLoad: 18,
      memoryUsed: 128, memoryTotal: 512, videoInput: "HDMI", inputResolution: "1920x1080p50",
      outputResolution: "1920x1080p50", frameRate: 50, interlaced: false, deinterlaced: false,
      videoBitrate: 12000, audioSource: "embedded", audioFormat: "PCM", audioSampling: 48000,
      audioChannels: 2, audioVolume: 80, sourceName: "Studio (Camera 1)",
      sourceUrl: "ndi://studio/camera1", sourceIp: "192.168.1.20", serialNumber: "3103103002067",
      ndiVersion: "5.0.11", hardwareVersion: "2.0", softwareVersion: "2.02.0246",
      firmwareVersion: "2015.4", networkMac: "18:C3:F4:20:20:67", audioLevel: "smpte"
    },
    components: { api: "ok", system: "ok", network: "ok", encoder: "ok", video: "ok", audio: "ok", source: "ok", output: "ok" }
  });
}

function normalize(value) {
  const base = value && typeof value === "object" ? value : {};
  const d = defaultsRaw();
  const result = { config: Object.assign({}, d.config, base.config || {}), components: Object.assign({}, d.components, base.components || {}) };
  result.config.mode = result.config.mode === "decoder" ? "decoder" : "encoder";
  Object.keys(result.components).forEach((key) => { if (!["ok", "warning", "error"].includes(result.components[key])) result.components[key] = "ok"; });
  return result;
}
function defaultsRaw() { return {
  config: { model: "E2", mode: "encoder", apiProtocol: "v2", deviceName: "Kiloview Simulator", channelName: "Camera 1", deviceGroup: "public", ndiConnection: "multicast", quality: 80, deviceAddress: "127.0.0.1", networkInterface: "eth0", uptime: "1 day", startTime: "", cpuLoad: 18, memoryUsed: 128, memoryTotal: 512, videoInput: "HDMI", inputResolution: "1920x1080p50", outputResolution: "1920x1080p50", frameRate: 50, interlaced: false, deinterlaced: false, videoBitrate: 12000, audioSource: "embedded", audioFormat: "PCM", audioSampling: 48000, audioChannels: 2, audioVolume: 80, sourceName: "Studio (Camera 1)", sourceUrl: "ndi://studio/camera1", sourceIp: "192.168.1.20", serialNumber: "3103103002067", ndiVersion: "5.0.11", hardwareVersion: "2.0", softwareVersion: "2.02.0246", firmwareVersion: "2015.4", networkMac: "18:C3:F4:20:20:67", audioLevel: "smpte" },
  components: { api: "ok", system: "ok", network: "ok", encoder: "ok", video: "ok", audio: "ok", source: "ok", output: "ok" }
}; }
function readJson(name, fallback) { try { return JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8")); } catch (_) { return fallback; } }
function save() { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n", "utf8"); }
function json(res, status, value) { const data = JSON.stringify(value); res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(data), "access-control-allow-origin": "*" }); res.end(data); }
function file(res, name, type) { const data = fs.readFileSync(path.join(ROOT, name)); res.writeHead(200, { "content-type": type, "content-length": data.length }); res.end(data); }
function body(req) { return new Promise((resolve, reject) => { let text = ""; req.on("data", (chunk) => { text += chunk; if (text.length > 1e6) req.destroy(); }); req.on("end", () => { try { resolve(text ? JSON.parse(text) : {}); } catch (error) { reject(new Error("JSON invalide")); } }); req.on("error", reject); }); }

const host = process.env.HOST || config.host;
const port = Number(process.env.PORT || config.port);
if (require.main === module) server.listen(port, host, () => console.log(`Kiloview Simulator: http://localhost:${port}`));
module.exports = { server, defaults };
