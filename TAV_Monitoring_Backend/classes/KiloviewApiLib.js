const http = require("http");
const https = require("https");

class KiloviewApiConnector {
  constructor(options = {}) {
    this.host = String(options.host || "").trim();
    this.username = String(options.username || "");
    this.password = String(options.password || "");
    this.timeout = Math.min(Math.max(Number(options.timeout) || 5000, 500), 15000);
    this.baseUrl = "";
    this.session = "";
    this.token = "";
    this.protocol = "";
  }

  async init() {
    const candidates = /^https?:\/\//i.test(this.host)
      ? [this.host]
      : [`http://${this.host}`, `https://${this.host}`];
    let lastError;

    // Firmware 2.02.x (BSP 2015.4): API web observee sur le materiel reel.
    for (const candidate of candidates) {
      try {
        const query = new URLSearchParams({ user: this.username, password: this.password });
        const response = await requestJson(candidate, `/api/users/login.json?${query}`, null, browserHeaders(candidate, "/login"), this.timeout, "GET");
        ensureSuccess(response, "Autorisation Kiloview refusee");
        this.baseUrl = candidate.replace(/\/$/, "");
        this.session = String(response.data && response.data.session || "");
        this.token = String(response.data && response.data.token || "");
        this.protocol = "v2";
        return;
      } catch (error) {
        lastError = error;
      }
    }

    // Compatibilite avec le protocole initial et les autres firmwares Kiloview.
    for (const candidate of candidates) {
      try {
        const response = await requestJson(candidate, "/api/v1/user/authorize", {
          username: this.username,
          password: this.password
        }, {}, this.timeout, "POST");
        ensureSuccess(response, "Autorisation Kiloview refusee");
        this.baseUrl = candidate.replace(/\/$/, "");
        this.session = String(response.data && response.data.session || "");
        this.token = String(response.data && response.data.token || "");
        if (!this.session || !this.token) throw new Error("Session ou token Kiloview absent");
        this.protocol = "v1";
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Connexion API Kiloview impossible");
  }

  async api(path, options = {}) {
    if (!this.protocol) await this.init();
    const isV2 = this.protocol === "v2";
    const v2Headers = isV2 ? Object.assign(browserHeaders(this.baseUrl, v2Referer(path)), {
      "Cookie": `token=${this.token}`
    }) : null;
    const response = await requestJson(this.baseUrl, path, isV2 ? null : {}, isV2 ? v2Headers : {
      "API-Session": this.session,
      "API-Token": this.token
    }, this.timeout, isV2 ? "GET" : "POST");
    if (!options.allowResultError && (!response || response.result !== "ok")) {
      const detail = response && (response.msg || response.reason || response.error) || "erreur inconnue";
      throw new Error(`API Kiloview ${path}: ${detail}`);
    }
    return response;
  }

  async monitor() {
    if (!this.protocol) await this.init();
    if (this.protocol === "v2") return this.monitorV2();

    const modeResponse = await this.api("/api/v1/mode/get");
    const mode = String(modeResponse.data && modeResponse.data.mode || "").toLowerCase();
    if (mode !== "encoder" && mode !== "decoder") {
      throw new Error(`Mode Kiloview inconnu: ${mode || "non retourne"}`);
    }

    const [statusResponse, serverResponse, networkResponse] = await Promise.all([
      this.api("/api/v1/mode/status", { allowResultError: true }).catch(asErrorResponse),
      this.api("/api/v1/sys/server_info").catch(asErrorResponse),
      this.api("/api/v1/network/get").catch(asErrorResponse)
    ]);
    const common = normalizeCommon(mode, statusResponse, serverResponse, networkResponse);
    const specific = mode === "encoder"
      ? await this.readEncoder()
      : await this.readDecoder();

    const result = normalizeMonitor(this.host.replace(/^https?:\/\//i, ""), mode, common, specific);
    result.kiloviewProtocol = "v1";
    return result;
  }

  async monitorV2() {
    const modeResponse = await this.api("/api/mode/get.json");
    const mode = String(modeResponse.data && modeResponse.data.mode || "").toLowerCase();
    if (mode !== "encoder" && mode !== "decoder") {
      throw new Error(`Mode Kiloview inconnu: ${mode || "non retourne"}`);
    }

    // L'interface officielle valide la session juste apres la detection du mode.
    await this.api("/api/users/session.json");

    const [status, device, audio, network, networkProtocol, firmware, softwareStatus] = await Promise.all([
      this.api("/api/device/status.json").catch(asErrorResponse),
      this.api("/api/device/get.json").catch(asErrorResponse),
      this.api("/api/audio/get.json").catch(asErrorResponse),
      this.api("/api/network/get.json").catch(asErrorResponse),
      this.api("/api/network/getProtocol.json").catch(asErrorResponse),
      this.api("/api/firmware/get.json").catch(asErrorResponse),
      this.api(`/api/users/software_status.json?user=${encodeURIComponent(this.username)}`).catch(asErrorResponse)
    ]);
    const common = normalizeV2Common(mode, status, network, networkProtocol, firmware, softwareStatus);
    const specific = mode === "encoder"
      ? normalizeV2Encoder(status, device, audio)
      : normalizeV2DecoderPlaceholder();
    const result = normalizeMonitor(this.host.replace(/^https?:\/\//i, ""), mode, common, specific);
    result.source = "kiloview-api-v2";
    result.kiloviewProtocol = "v2";
    return result;
  }

  async readEncoder() {
    const [config, status, audio] = await Promise.all([
      this.api("/api/v1/encoder/ndi/get_config").catch(asErrorResponse),
      this.api("/api/v1/encoder/ndi/status").catch(asErrorResponse),
      this.api("/api/v1/encoder/ndi/get_audio").catch(asErrorResponse)
    ]);
    return normalizeEncoder(config, status, audio);
  }

  async readDecoder() {
    const [status, output] = await Promise.all([
      this.api("/api/v1/decoder/current/status").catch(asErrorResponse),
      this.api("/api/v1/decoder/output/get").catch(asErrorResponse)
    ]);
    return normalizeDecoder(status, output);
  }
}

function normalizeMonitor(host, mode, common, specific) {
  return {
    host,
    type: "kiloview",
    source: "kiloview-api",
    timestamp: new Date().toISOString(),
    controller: Object.assign({}, common, specific),
    inputSlots: { count: 0, slots: [] },
    outputSlots: { count: 0, slots: [] },
    screens: { count: 0, screens: [] },
    receivingCards: [],
    kiloviewMode: mode
  };
}

function normalizeCommon(mode, statusResponse, serverResponse, networkResponse) {
  const status = dataOf(statusResponse);
  const server = dataOf(serverResponse);
  const networks = Array.isArray(networkResponse && networkResponse.data) ? networkResponse.data : [];
  const serverError = responseError(serverResponse);
  const networkError = responseError(networkResponse);
  return {
    workingStatus: field(status.status || statusResponse.reason || responseError(statusResponse) || "ready", statusResponse.result === "ok"),
    kiloviewMode: field(mode),
    deviceAddress: field(server.addr || serverError, !serverError),
    workingTime: field(server.persis || ""),
    startTime: field(server.start_time || ""),
    cpuLoad: field(numberWithUnit(server.cpu_payload, "%")),
    memoryUsed: field(numberWithUnit(server.mem_used, " Mo")),
    memoryTotal: field(numberWithUnit(server.mem_total, " Mo")),
    networkInterfaces: field(networks.map((item) => item.device).filter(Boolean).join(", ") || networkError, !networkError),
    networkState: field(networks.map((item) => `${item.device || "interface"}: ${item.state || "inconnu"}`).join(", ") || networkError, !networkError && networks.every((item) => item.state === "up"))
  };
}

function normalizeV2Common(mode, statusResponse, networkResponse, protocolResponse, firmwareResponse, softwareResponse) {
  const status = dataOf(statusResponse);
  const networks = Array.isArray(networkResponse && networkResponse.data) ? networkResponse.data : [];
  const protocols = dataOf(protocolResponse);
  const firmware = dataOf(firmwareResponse);
  const software = dataOf(softwareResponse);
  const statusError = responseError(statusResponse);
  const networkError = responseError(networkResponse);
  const firmwareError = responseError(firmwareResponse);
  const activeNetworks = networks.filter((item) => item && item.state === "up");
  return {
    workingStatus: field(statusError || "ready", !statusError),
    kiloviewMode: field(mode),
    deviceAddress: field(activeNetworks.map((item) => item.ip).filter(Boolean).join(", ") || networkError, !networkError),
    networkInterfaces: field(networks.map((item) => item.device).filter(Boolean).join(", ") || networkError, !networkError),
    networkState: field(networks.map((item) => `${item.device || "interface"}: ${item.state || "inconnu"}`).join(", ") || networkError, !networkError && networks.every((item) => item.state === "up")),
    networkMac: field(networks.map((item) => item.mac).filter(Boolean).join(", ") || ""),
    networkProtocols: field(protocolLabels(protocols)),
    serialNumber: field(status.serial_number || ""),
    ndiVersion: field(firmware.ndiVersion || firmwareError, !firmwareError),
    hardwareVersion: field(firmware.hardwareVersion || firmwareError, !firmwareError),
    softwareVersion: field(firmware.softwareVersion || firmwareError, !firmwareError),
    firmwareVersion: field(firmware.firmwareVersion || firmwareError, !firmwareError),
    apiUser: field(software.user || ""),
    apiSessionStatus: field(software.software === 1 ? "active" : "inconnu", software.software === 1)
  };
}

function normalizeV2Encoder(statusResponse, deviceResponse, audioResponse) {
  const status = dataOf(statusResponse);
  const device = dataOf(deviceResponse);
  const audio = dataOf(audioResponse);
  const statusError = responseError(statusResponse);
  const deviceError = responseError(deviceResponse);
  const audioError = responseError(audioResponse);
  const hasVideo = status.video_signal === true;
  const resolution = String(status.resolution || resolutionFromDimensions(status.xRes, status.yRes));
  return {
    ndiDeviceName: field(device.device_name || deviceError, !deviceError),
    ndiChannelName: field(device.channel_name || ""),
    ndiGroup: field(device.device_group || "public"),
    ndiConnection: field(device.ndi_connection || ""),
    encodingQuality: field(numberWithUnit(device.quality, "%")),
    videoSignal: field(hasVideo ? "present" : "absent", hasVideo && !statusError),
    videoInputType: field(hasVideo ? "present" : "aucun", hasVideo && !statusError),
    videoResolution: field(resolution || statusError, hasVideo && !statusError && !/no signal/i.test(resolution)),
    instantFrameRate: field(numberWithUnit(status.frame_rate, " fps"), !statusError),
    interlaced: booleanField(status.interlaced),
    videoBitrate: field(numberWithUnit(status.bitrate, " Kbit/s"), !statusError),
    audioPresence: field(audioPresence(status.audio_signal), !!status.audio_signal && status.audio_signal !== "none" && !statusError),
    audioSource: field(audio.signal || status.audio_signal || audioError, !audioError),
    audioFormat: field(status.audio_format || statusError, !statusError),
    audioSampling: field(numberWithUnit(status.audio_sampling, " Hz"), !statusError),
    audioChannels: field(status.audio_channels, !statusError),
    audioVolume: field(audio.volume, !audioError),
    audioLevel: field(audio.level || "", !audioError),
    audioMapping: field(Array.isArray(audio.mapping) ? audio.mapping.length + " canaux" : "", !audioError)
  };
}

function normalizeV2DecoderPlaceholder() {
  return {
    decoderProtocolStatus: field("En attente du HAR decodeur")
  };
}

function protocolLabels(protocols) {
  const labels = [];
  if (protocols.http) labels.push(`HTTP${protocols.httpPort ? `:${protocols.httpPort}` : ""}`);
  if (protocols.https) labels.push(`HTTPS${protocols.httpsPort ? `:${protocols.httpsPort}` : ""}`);
  return labels.join(", ");
}

function resolutionFromDimensions(width, height) {
  return width && height ? `${width}x${height}` : "";
}

function v2Referer(path) {
  return path === "/api/mode/get.json" ? "/login" : "/encoder";
}

function browserHeaders(baseUrl, refererPath) {
  return {
    "Accept": "application/json, text/plain, */*",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Referer": new URL(refererPath, baseUrl).toString(),
    "User-Agent": "Mozilla/5.0 TAV-Monitoring/Kiloview-V2"
  };
}

function normalizeEncoder(configResponse, statusResponse, audioResponse) {
  const config = dataOf(configResponse);
  const status = dataOf(statusResponse);
  const audio = dataOf(audioResponse);
  const configError = responseError(configResponse);
  const statusError = responseError(statusResponse);
  const audioError = responseError(audioResponse);
  return {
    ndiDeviceName: field(config.device_name || configError, !configError),
    ndiChannelName: field(config.channel_name || ""),
    ndiGroup: field(config.device_group || "public"),
    ndiConnection: field(config.ndi_connection || ""),
    encodingQuality: field(numberWithUnit(config.quality, "%")),
    videoSignal: field(status.video_signal || statusError, status.video_signal !== "none" && !statusError),
    videoInputType: field(status.video_signal || ""),
    videoResolution: field(status.resolution || ""),
    interlaced: booleanField(status.interlaced),
    videoBitrate: field(numberWithUnit(status.bitrate, " Kbit/s")),
    audioPresence: field(audioPresence(status.audio_signal)),
    audioSource: field(audio.signal || status.audio_signal || audioError, !audioError),
    audioFormat: field(status.audio_format || ""),
    audioSampling: field(numberWithUnit(status.audio_sampling, " Hz")),
    audioChannels: field(status.audio_channels),
    audioVolume: field(audio.volume)
  };
}

function normalizeDecoder(statusResponse, outputResponse) {
  const status = dataOf(statusResponse);
  const output = dataOf(outputResponse);
  const warning = String(status.warning || "");
  const statusError = responseError(statusResponse);
  const outputError = responseError(outputResponse);
  return {
    videoSignal: field(statusError || (status.online === false ? "none" : "NDI"), !statusError && status.online !== false),
    videoResolution: field(status.resolution || ""),
    instantFrameRate: field(numberWithUnit(status.inst_frame_rate, " fps")),
    interlaced: booleanField(status.interlaced),
    deinterlaced: booleanField(status.de_interlace),
    videoBitrate: field(numberWithUnit(status.bitrate, " Kbit/s")),
    audioPresence: field(audioPresence(status.audio_channels ? "present" : "none")),
    audioFormat: field(status.audio_format || ""),
    audioSampling: field(numberWithUnit(status.audio_sampling, " Hz")),
    audioChannels: field(status.audio_channels),
    ndiSourceName: field(status.name || ""),
    ndiSourceUrl: field(status.url || ""),
    ndiSourceIp: field(status.ip || ""),
    ndiSourceOnline: field(status.online === true ? "online" : "offline", status.online === true),
    ndiSourceActive: field(status.name && status.name !== "(Blank)" ? "oui" : "non"),
    outputResolution: field(output.resolution || outputError, !outputError),
    outputFrameRate: field(numberWithUnit(output.frame_rate, " fps")),
    decoderWarning: field(warning || statusError, !warning && !statusError),
    warningOffline: warningField(warning, "WARN:offline"),
    warningUrlChanged: warningField(warning, "WARN:url-changed"),
    errorNoVideo: warningField(warning, "ERROR:no-video-output"),
    errorNoAudio: warningField(warning, "ERROR:no-audio-output"),
    warningInvalid: warningField(warning, "WARN:invalid"),
    warningMatch: warningField(warning, "WARN:match-error"),
    warningUnsupportedCodec: warningField(warning, "WARN:unsupported-codec"),
    warningUnsupportedResolution: warningField(warning, "WARN:unsupported-resolution")
  };
}

function requestJson(baseUrl, path, payload, headers, timeout, method = "POST") {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const body = method === "GET" ? "" : JSON.stringify(payload || {});
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(url, {
      method,
      rejectUnauthorized: false,
      headers: Object.assign(method === "GET" ? { "Accept": "application/json" } : {
        "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body)
      }, headers)
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        try { resolve(JSON.parse(text)); }
        catch (error) { reject(new Error("Reponse JSON Kiloview invalide")); }
      });
    });
    request.setTimeout(timeout, () => request.destroy(new Error("Timeout API Kiloview")));
    request.on("error", reject);
    request.end(body);
  });
}

function ensureSuccess(response, fallback) {
  if (!response || response.result !== "ok") {
    throw new Error(response && (response.msg || response.reason) || fallback);
  }
}

function asErrorResponse(error) { return { result: "error", error: error.message }; }
function dataOf(response) { return response && response.data && !Array.isArray(response.data) ? response.data : {}; }
function responseError(response) { return response && (response.error || response.msg || response.reason) || ""; }
function field(value, ok = true) { return { ok, value: value === undefined || value === null ? "" : value }; }
function booleanField(value) { return field(value === true ? "oui" : value === false ? "non" : ""); }
function numberWithUnit(value, unit) { return value === undefined || value === null || value === "" ? "" : `${value}${unit}`; }
function audioPresence(value) { return !value || value === "none" ? "absent" : "present"; }
function warningField(warning, expected) { return field(warning === expected ? expected : "aucun", warning !== expected); }

module.exports = KiloviewApiConnector;
module.exports.normalizeCommon = normalizeCommon;
module.exports.normalizeEncoder = normalizeEncoder;
module.exports.normalizeDecoder = normalizeDecoder;
module.exports.normalizeV2Common = normalizeV2Common;
module.exports.normalizeV2Encoder = normalizeV2Encoder;
