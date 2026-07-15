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
  }

  async init() {
    const candidates = /^https?:\/\//i.test(this.host)
      ? [this.host]
      : [`https://${this.host}`, `http://${this.host}`];
    let lastError;

    for (const candidate of candidates) {
      try {
        const response = await requestJson(candidate, "/api/v1/user/authorize", {
          username: this.username,
          password: this.password
        }, {}, this.timeout);
        ensureSuccess(response, "Autorisation Kiloview refusee");
        this.baseUrl = candidate.replace(/\/$/, "");
        this.session = String(response.data && response.data.session || "");
        this.token = String(response.data && response.data.token || "");
        if (!this.session || !this.token) throw new Error("Session ou token Kiloview absent");
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Connexion API Kiloview impossible");
  }

  async api(path, options = {}) {
    if (!this.session || !this.token) await this.init();
    const response = await requestJson(this.baseUrl, path, {}, {
      "API-Session": this.session,
      "API-Token": this.token
    }, this.timeout);
    if (!options.allowResultError) ensureSuccess(response, `API Kiloview ${path} en erreur`);
    return response;
  }

  async monitor() {
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

    return normalizeMonitor(this.host.replace(/^https?:\/\//i, ""), mode, common, specific);
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

function requestJson(baseUrl, path, payload, headers, timeout) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const body = JSON.stringify(payload || {});
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(url, {
      method: "POST",
      rejectUnauthorized: false,
      headers: Object.assign({
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
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
