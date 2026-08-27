const crypto = require("crypto");
const http = require("http");
const https = require("https");
const LegacyNovaStarApiConnector = require("./NovaStarApiLib-backup");
const logger = require("./Logger").child("NovaStarApiLib");

class NovaStarOpenApiConnector extends LegacyNovaStarApiConnector {
  constructor(options = {}) {
    const baseUrl = normalizeOpenApiUrl(options.baseUrl || options.host || "");
    super({ baseUrl, host: options.host, deviceId: options.deviceId, timeout: options.timeout });
    this.baseUrl = baseUrl;
    this.projectId = String(options.projectId || options.pId || "").trim();
    this.secretKey = String(options.secretKey || "");
    this.encryption = options.encryption === true;
  }

  async init() {
    if (!this.projectId) throw new Error("NovaStar OpenAPI Project ID (pId) manquant");
    if (this.encryption && !this.secretKey) throw new Error("NovaStar OpenAPI Secret Key manquante pour le chiffrement");
    return this;
  }

  async readAll() {
    await this.init();
    const detail = await this.openApiPost("/device/readDetail", { deviceId: this.deviceId });
    const [videoServerInfo, initStatus] = await Promise.all([
      this.openApiPost("/main/readVideoServerInfo", { deviceId: this.deviceId }).catch(asOptionalError),
      this.openApiPost("/main/initStatus", { deviceId: this.deviceId }).catch(asOptionalError)
    ]);
    return {
      detail,
      genlockWorkStatus: normalizeGenlock(detail),
      videoServerInfo: normalizeVideoServer(videoServerInfo),
      initStatus
    };
  }

  async openApiPost(pathname, businessBody) {
    const timeStamp = String(Date.now());
    const plainBody = businessBody || {};
    const body = this.encryption ? encryptBody(plainBody, this.secretKey) : plainBody;
    const signSource = this.encryption
      ? body + timeStamp + this.projectId + this.secretKey
      : timeStamp + this.projectId;
    const payload = {
      body,
      sign: base64Md5Hex(signSource),
      pId: this.projectId,
      timeStamp
    };
    const response = await postJson(this.baseUrl + pathname, payload, this.timeout);
    const status = Number(response && (response.status !== undefined ? response.status : response["status "]));
    if (status !== 0) throw new Error(response && response.msg || `NovaStar OpenAPI status ${status}`);
    const responseBody = response && response.body;
    if (this.encryption && typeof responseBody === "string") return decryptBody(responseBody, this.secretKey);
    if (!responseBody || typeof responseBody !== "object") throw new Error("NovaStar OpenAPI body JSON absent");
    return responseBody;
  }
}

function normalizeGenlock(detail) {
  const genlock = detail && detail.genlock || {};
  const type = Number(genlock.type);
  const externalSignal = genlock.extSignal !== undefined ? genlock.extSignal : detail && detail.extSignal;
  // L'ancien normaliseur attend 0 = normal et 1 = anormal. Un signal
  // externe n'est requis que lorsque le mode Genlock externe (type 0) est actif.
  const status = Number(genlock.enable) !== 1 || type !== 0 || Number(externalSignal) === 1 ? 0 : 1;
  return {
    status,
    enable: genlock.enable,
    type: genlock.type,
    inputId: genlock.inputId,
    extSignal: externalSignal,
    refreshRate: genlock.refreshRate !== undefined ? genlock.refreshRate : genlock.extFreq
  };
}

function normalizeVideoServer(info) {
  if (!info || info.error) return info || {};
  return Object.assign({}, info, {
    mvrCardOnline: info.mvrCardOnline !== undefined
      ? info.mvrCardOnline
      : (info.mvrUrl || info.echoUrl || Number(info.videoStatus) === 1 ? 1 : 0)
  });
}

function normalizeOpenApiUrl(value) {
  let base = String(value || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("NovaStar OpenAPI URL manquante");
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  if (!/\/open\/api$/i.test(base)) base += "/open/api";
  return base;
}

function base64Md5Hex(value) {
  const hex = crypto.createHash("md5").update(String(value), "utf8").digest("hex");
  return Buffer.from(hex, "ascii").toString("base64");
}

function desKey(secretKey) {
  const key = Buffer.alloc(8);
  Buffer.from(String(secretKey), "utf8").copy(key, 0, 0, 8);
  return Buffer.concat([key, key, key]);
}

function encryptBody(value, secretKey) {
  const cipher = crypto.createCipheriv("des-ede3", desKey(secretKey), null);
  return Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]).toString("base64");
}

function decryptBody(value, secretKey) {
  const decipher = crypto.createDecipheriv("des-ede3", desKey(secretKey), null);
  const plain = Buffer.concat([decipher.update(String(value), "base64"), decipher.final()]).toString("utf8");
  return JSON.parse(plain);
}

function postJson(urlValue, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlValue);
    const body = JSON.stringify(payload);
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(url, {
      method: "POST",
      rejectUnauthorized: false,
      agent: false,
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) }
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`HTTP ${response.statusCode}`));
        try { resolve(JSON.parse(text)); }
        catch (_) { reject(new Error("Reponse JSON NovaStar OpenAPI invalide")); }
      });
    });
    request.setTimeout(Number(timeoutMs) || 5000, () => request.destroy(new Error("Timeout NovaStar OpenAPI")));
    request.on("error", reject);
    request.end(body);
  });
}

function asOptionalError(error) { return { error: error.message }; }

NovaStarOpenApiConnector.normalizeGenlock = normalizeGenlock;
NovaStarOpenApiConnector.normalizeVideoServer = normalizeVideoServer;
NovaStarOpenApiConnector.normalizeOpenApiUrl = normalizeOpenApiUrl;
NovaStarOpenApiConnector.base64Md5Hex = base64Md5Hex;
NovaStarOpenApiConnector.encryptBody = encryptBody;
NovaStarOpenApiConnector.decryptBody = decryptBody;
module.exports = NovaStarOpenApiConnector;
