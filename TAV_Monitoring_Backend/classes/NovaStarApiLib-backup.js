const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { URL } = require("url");
const logger = require("./Logger").child("NovaStarApiLibBackup");

const LOGIN_KEY = "mHAxsLYz";
const USER_NOT_LOGIN_STATUS = 106;

class NovaStarApiConnector {
  constructor(options = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl || options.host || "http://192.168.1.10");
    this.host = options.host || this.baseUrl.replace(/^https?:\/\//, "");
    this.username = options.username || "admin";
    this.password = options.password || "admin";
    this.deviceId = Number(options.deviceId || 0);
    this.timeout = Number(options.timeout || 5000);
    this.token = "";

    logger.debug("NovaStar API connector created", {
      baseUrl: this.baseUrl,
      deviceId: this.deviceId,
      username: this.username
    });
  }

  async init() {
    await this.login();
    return this;
  }

  async login() {
    const response = await this.post("/api/user/login", {
      username: encodeLoginValue(this.username),
      password: encodeLoginValue(this.password),
      verifyId: "",
      verifyCode: "",
      deviceId: this.deviceId
    }, { includeToken: false, referer: "/Login" });

    if (!response || response.status !== 0 || !response.data || !response.data.token) {
      throw new Error(response && response.msg ? response.msg : "NovaStar API login failed");
    }

    this.token = response.data.token;
    logger.info("NovaStar API login completed", {
      baseUrl: this.baseUrl,
      deviceId: this.deviceId,
      userName: response.data.userName || this.username
    });
    return this.token;
  }

  async post(path, payload, options = {}) {
    const includeToken = options.includeToken !== false;
    const result = await postJson(this.baseUrl, path, payload, {
      timeout: this.timeout,
      token: includeToken ? this.token : "",
      referer: options.referer || "/Device"
    });

    return result;
  }

  async authenticatedPost(path, payload, options = {}) {
    if (!this.token) {
      await this.login();
    }

    let response = await this.post(path, payload, options);
    if (response && response.status === USER_NOT_LOGIN_STATUS) {
      logger.info("NovaStar API token expired, logging in again", {
        baseUrl: this.baseUrl,
        path
      });
      await this.login();
      response = await this.post(path, payload, options);
    }

    if (response && response.status !== 0) {
      throw new Error(response.msg || `NovaStar API status ${response.status}`);
    }

    return response;
  }

  async readDetail() {
    const response = await this.authenticatedPost("/api/device/readDetail", {
      deviceId: this.deviceId
    });
    return response.data || {};
  }

  async readGenLockWorkStatus() {
    const response = await this.authenticatedPost("/api/device/readGenLockWorkStatus", {
      deviceId: this.deviceId
    });
    return response.data || {};
  }

  async readVideoServerInfo() {
    const response = await this.authenticatedPost("/api/main/readVideoServerInfo", {
      deviceId: this.deviceId
    });
    return response.data || {};
  }

  async readInitStatus() {
    const response = await this.authenticatedPost("/api/main/initStatus", {
      deviceId: this.deviceId
    });
    return response.data || {};
  }

  async readAll() {
    const detail = await this.readDetail();
    const genlockWorkStatus = await this.readGenLockWorkStatus().catch((error) => ({
      error: error.message
    }));
    const videoServerInfo = await this.readVideoServerInfo().catch((error) => ({
      error: error.message
    }));
    const initStatus = await this.readInitStatus().catch((error) => ({
      error: error.message
    }));

    return {
      detail,
      genlockWorkStatus,
      videoServerInfo,
      initStatus
    };
  }

  async monitor(options = {}) {
    logger.info("NovaStar API monitor started", { baseUrl: this.baseUrl });
    const all = await this.readAll();
    const result = normalizeApiMonitor({
      host: this.host,
      baseUrl: this.baseUrl,
      configuredModel: options.model || "",
      modelProfile: options.modelProfile || null,
      raw: all
    });
    logger.info("NovaStar API monitor completed", {
      baseUrl: this.baseUrl,
      inputSlots: result.inputSlots.count,
      outputSlots: result.outputSlots.count,
      outputPorts: result.outputPorts.length
    });
    return result;
  }
}

function normalizeApiMonitor({ host, baseUrl, configuredModel, modelProfile, raw }) {
  const detail = raw.detail || {};
  const slotList = Array.isArray(detail.slotList) ? detail.slotList : [];
  const inputSlots = slotList.filter((slot) => slot && slot.cardType === 1 && isPresent(slot));
  const outputSlots = slotList.filter((slot) => slot && slot.cardType === 2 && isPresent(slot));
  const mvrSlots = slotList.filter((slot) => slot && slot.cardType === 4 && isPresent(slot));
  const screens = buildScreens(detail);
  const outputPorts = outputSlots.flatMap(buildOutputPorts);

  return {
    source: "api",
    host,
    apiBaseUrl: baseUrl,
    configuredModel,
    modelProfile,
    timestamp: new Date().toISOString(),
    controller: buildController(detail, raw),
    inputSlots: {
      count: inputSlots.length,
      slots: inputSlots.map(buildInputSlot)
    },
    outputSlots: {
      count: outputSlots.length,
      slots: outputSlots.map(buildOutputSlot)
    },
    screens,
    outputPorts,
    receivingCards: [],
    mvrCards: mvrSlots.map(buildMvrCard),
    mvrVideo: buildMvrVideo(raw.videoServerInfo || {}),
    usbPorts: buildUsbPorts(detail.usbStatus),
    fans: buildFans(detail.fanList),
    powerSupplies: buildPowerSupplies(detail.powerList),
    apiDetails: {
      videoServerInfo: raw.videoServerInfo || {},
      genlockWorkStatus: raw.genlockWorkStatus || {},
      initStatus: raw.initStatus || {}
    }
  };
}

function buildController(detail, raw) {
  const model = detail.name || modelName(detail.modelId) || "";
  const ip = detail.network && detail.network.ip ? ipParts(detail.network.ip, "ip") : "";
  const powerList = Array.isArray(detail.powerList) ? detail.powerList : [];
  const fanList = Array.isArray(detail.fanList) ? detail.fanList : [];
  const genlock = raw.genlockWorkStatus && !raw.genlockWorkStatus.error
    ? raw.genlockWorkStatus
    : detail.genlock;

  return {
    oidVersion: field(detail.protoVersion || ""),
    summary: field(JSON.stringify({
      modelId: detail.modelId,
      status: detail.status,
      deviceType: detail.deviceType,
      workMode: detail.deviceWorkMode
    })),
    workingTime: field(""),
    model: field(model || configuredFallbackModel(detail)),
    firmware: field(raw.initStatus && raw.initStatus.softwareVersion || ""),
    serial: field(detail.sn || ""),
    macAddress: field(detail.MAC || ""),
    wiredIpAddress: field(ip),
    armVersion: field(""),
    temperatureStatus: normalStatusField(detail.temp),
    voltageStatus: normalStatusField(detail.volt),
    fanCount: field(fanList.length),
    powerCount: field(powerList.length),
    genlockStatus: normalStatusField(genlock && genlock.status !== undefined ? genlock.status : detail.extSignal),
    genlockFrame: field(genlock && genlock.refreshRate !== undefined ? genlock.refreshRate : ""),
    workingStatus: deviceStatusField(detail.status),
    cpuStatus: normalStatusField(detail.cpuStatus),
    memoryStatus: normalStatusField(detail.memStatus),
    ethernetStatus: binaryActiveField(detail.ethernetStatus),
    memoryValue: field(detail.memory || "")
  };
}

function buildInputSlot(slot) {
  const resolution = slot.resolution || {};
  const interfaces = Array.isArray(slot.interfaces) ? slot.interfaces : [];

  return {
    slotId: `I-${Number(slot.slotId) + 1}`,
    rawSlotId: slot.slotId,
    selectorError: null,
    fields: {
      status: statusField(slot.status),
      firmware: field(slot.version || ""),
      serial: field(slot.sn || ""),
      sourceCount: field(interfaces.length),
      summary: field(JSON.stringify({
        slotId: slot.slotId,
        status: slot.status,
        workStatus: slot.workStatus,
        cardType: slot.cardType,
        cardCategory: slot.cardCategory,
        modelId: slot.modelId,
        resolution
      })),
      sourceStatus: signalField(firstInterfaceValue(interfaces, "iSignal")),
      sourceWidth: field(resolution.width || ""),
      sourceHeight: field(resolution.height || ""),
      sourceFrameRate: field(formatRefresh(resolution.refresh)),
      sourceType: field(firstInterfaceValue(interfaces, "interfaceType"))
    },
    inputSources: interfaces.map((intf) => buildInputSource(intf, resolution))
  };
}

function buildInputSource(intf, resolution) {
  return {
    inputSlotId: intf.inputSlotId,
    sourceId: Number(intf.interfaceId) + 1,
    selectorError: null,
    fields: {
      status: signalField(intf.iSignal),
      width: field(resolution.width || ""),
      height: field(resolution.height || ""),
      frameRate: field(formatRefresh(resolution.refresh)),
      type: field(interfaceTypeName(intf.interfaceType)),
      rawType: field(intf.interfaceType),
      used: field(intf.isUsed),
      overload: statusField(intf.overLoadState)
    }
  };
}

function buildOutputSlot(slot) {
  const statuses = Array.isArray(slot.senderInterfaceStatus)
    ? slot.senderInterfaceStatus.filter((item) => item && item.type === 0)
    : [];

  return {
    slotId: `O-${Number(slot.slotId) + 1}`,
    rawSlotId: slot.slotId,
    selectorError: null,
    fields: {
      status: statusField(slot.status),
      firmware: field(slot.version || ""),
      serial: field(slot.sn || ""),
      netPortCount: field(statuses.length),
      summary: field(JSON.stringify({
        slotId: slot.slotId,
        status: slot.status,
        workStatus: slot.workStatus,
        cardType: slot.cardType,
        cardCategory: slot.cardCategory,
        modelId: slot.modelId,
        linkstatus: slot.linkstatus || {},
        lightstatus: slot.lightstatus || {}
      }))
    },
    outputPorts: statuses.map((item) => ({
      portId: Number(item.id) + 1,
      status: item.status,
      type: item.type
    }))
  };
}

function buildOutputPorts(slot) {
  const statuses = Array.isArray(slot.senderInterfaceStatus)
    ? slot.senderInterfaceStatus.filter((item) => item && item.type === 0)
    : [];

  return statuses.map((item) => ({
    outputSlotId: `O-${Number(slot.slotId) + 1}`,
    netPortId: Number(item.id) + 1,
    recvCardId: "-",
    fields: {
      netPortLinkStatus: linkStatusField(item.status),
      netPortBackupStatus: field(""),
      backupNetPortLinkStatus: field(""),
      fiberLinkStatus: field(slot.linkstatus ? slot.linkstatus[`link${item.id}`] : ""),
      summary: field(JSON.stringify(item)),
      workingStatus: linkStatusField(item.status),
      temperatureStatus: field(""),
      temperatureValue: field(""),
      voltageStatus: field(""),
      voltageValue: field(""),
      fpgaVersion: field(""),
      mcuVersion: field(""),
      maxTemperature: field("")
    }
  }));
}

function buildMvrCard(slot) {
  const resolution = slot.resolution || {};
  const interfaces = Array.isArray(slot.interfaces) ? slot.interfaces : [];
  return {
    slotId: `MVR-${Number(slot.slotId) + 1}`,
    rawSlotId: slot.slotId,
    fields: {
      model: field(modelName(slot.modelId) || `Model ${slot.modelId || ""}`),
      serial: field(slot.sn || ""),
      status: deviceStatusField(slot.status),
      workingStatus: normalStatusField(slot.workStatus),
      resolution: field(resolution.width && resolution.height
        ? `${resolution.width} x ${resolution.height} @ ${formatRefresh(resolution.refresh)}`
        : ""),
      interfaceCount: field(interfaces.length)
    },
    interfaces: interfaces.map(buildMvrInterface)
  };
}

function buildMvrInterface(intf) {
  return {
    interfaceId: Number(intf.interfaceId) + 1,
    fields: {
      type: field(interfaceTypeName(intf.interfaceType)),
      signal: signalField(intf.iSignal),
      used: field(Number(intf.isUsed) === 1 ? "Utilisee" : "Disponible"),
      audio: field(Number(intf.isSupportAudio) === 1 ? "Oui" : "Non")
    }
  };
}

function buildMvrVideo(info) {
  return {
    online: binaryActiveField(info.mvrCardOnline),
    videoStatus: binaryActiveField(info.videoStatus),
    mvrUrl: field(info.mvrUrl || ""),
    echoUrl: field(info.echoUrl || "")
  };
}

function buildUsbPorts(value) {
  return (Array.isArray(value) ? value : []).map((usb) => ({
    usbId: Number(usb.usbId) + 1,
    status: inactiveOrActiveField(usb.status)
  }));
}

function buildFans(value) {
  return (Array.isArray(value) ? value : []).map((fan) => ({
    fanId: Number(fan.fanId) + 1,
    status: normalStatusField(fan.status)
  }));
}

function buildPowerSupplies(value) {
  return (Array.isArray(value) ? value : []).map((power) => ({
    powerId: Number(power.powerId) + 1,
    status: powerSignalField(power.iSignal)
  }));
}

function buildScreens(detail) {
  const width = detail.slotList && detail.slotList[0] && detail.slotList[0].resolution
    ? detail.slotList[0].resolution.width
    : "";
  const height = detail.slotList && detail.slotList[0] && detail.slotList[0].resolution
    ? detail.slotList[0].resolution.height
    : "";
  const refresh = detail.slotList && detail.slotList[0] && detail.slotList[0].resolution
    ? formatRefresh(detail.slotList[0].resolution.refresh)
    : "";

  return {
    count: 0,
    screens: width && height ? [{
      screenId: "Device",
      fields: {
        name: field("Resolution courante"),
        width: field(width),
        height: field(height),
        frameRate: field(refresh),
        brightness: field(""),
        syncType: field(detail.genlock && detail.genlock.type !== undefined ? detail.genlock.type : ""),
        syncFrame: field(""),
        displayMode: field(""),
        summary: field(JSON.stringify(detail.genlock || {}))
      }
    }] : []
  };
}

function field(value, ok = true) {
  return {
    ok,
    value: value === undefined || value === null ? "" : value
  };
}

function statusField(value) {
  const text = value === undefined || value === null || value === "" ? "" : String(value);
  return field(text, value === undefined || value === null || value === "" || Number(value) === 0 || Number(value) === 1);
}

function normalStatusField(value) {
  const number = Number(value);
  if (value === undefined || value === null || value === "") return field("");
  return field(number === 0 ? "Normal" : `Anomalie (${value})`, number === 0);
}

function deviceStatusField(value) {
  const number = Number(value);
  return field(number === 1 ? "En ligne" : "Hors ligne", number === 1);
}

function binaryActiveField(value) {
  const number = Number(value);
  if (value === undefined || value === null || value === "") return field("");
  return field(number === 1 ? "Actif" : "Inactif", number === 0 || number === 1);
}

function inactiveOrActiveField(value) {
  const number = Number(value);
  if (value === undefined || value === null || value === "") return field("");
  return field(number === 1 ? "Actif" : number === 0 ? "Inactif" : `Anomalie (${value})`, number === 0 || number === 1);
}

function powerSignalField(value) {
  const number = Number(value);
  if (value === undefined || value === null || value === "") return field("");
  return field(number === 1 ? "Normal" : number === 0 ? "Inactif" : `Anomalie (${value})`, number === 0 || number === 1);
}

function signalField(value) {
  const number = Number(value);
  const labels = {
    0: "0 - Aucun signal",
    1: "1 - OK",
    2: "2 - Warning"
  };
  return field(labels[number] || String(value), number === 0 || number === 1);
}

function linkStatusField(value) {
  const number = Number(value);
  const labels = {
    0: "0 - Inactif",
    1: "1 - OK",
    2: "2 - Warning",
    3: "3 - OK"
  };
  return field(labels[number] || String(value), number === 0 || number === 1 || number === 3);
}

function isPresent(slot) {
  return slot.status === 1 || (slot.sn && slot.sn !== "0000000000000000");
}

function configuredFallbackModel(detail) {
  return detail.modelId ? `Model ${detail.modelId}` : "";
}

function modelName(modelId) {
  const names = {
    29963: "H Series",
    29965: "H Series",
    31502: "Input card",
    31558: "Output card",
    31559: "MVR card"
  };
  return names[modelId] || "";
}

function ipParts(value, prefix) {
  return [0, 1, 2, 3].map((index) => value[`${prefix}${index}`]).join(".");
}

function firstInterfaceValue(interfaces, key) {
  return interfaces.length ? interfaces[0][key] : "";
}

function formatRefresh(value) {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  const number = Number(value);
  if (!Number.isFinite(number)) {
    return value;
  }

  return number >= 1000 ? number / 100 : number;
}

function interfaceTypeName(value) {
  const names = {
    2: "Ethernet",
    4: "HDMI",
    5: "HDMI",
    6: "SDI",
    7: "DVI",
    8: "DisplayPort",
    13: "MVR"
  };
  return names[value] ? `${names[value]} (${value})` : String(value);
}

function normalizeBaseUrl(value) {
  let base = String(value || "").trim();
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  return base.replace(/\/+$/, "");
}

function postJson(baseUrl, path, payload, options) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const body = JSON.stringify(payload || {});
    const transport = url.protocol === "https:" ? https : http;
    const headers = {
      "Accept": "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "Origin": `${url.protocol}//${url.host}`,
      "Referer": `${url.protocol}//${url.host}${options.referer || "/Device"}`
    };

    if (options.token) {
      headers.token = options.token;
    }

    const request = transport.request({
      method: "POST",
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      headers,
      timeout: options.timeout
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}: ${text}`));
          return;
        }

        try {
          resolve(JSON.parse(text));
        } catch (error) {
          reject(new Error(`Invalid JSON response: ${error.message}`));
        }
      });
    });

    request.on("timeout", () => request.destroy(new Error("NovaStar API request timeout")));
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function encodeLoginValue(value) {
  try {
    return encryptWithNodeCrypto(value);
  } catch (error) {
    logger.debug("Native DES unavailable, using pure JS DES helper", { error: error.message });
    return encryptDesEcbPkcs7(String(value), LOGIN_KEY);
  }
}

function encryptWithNodeCrypto(value) {
  const cipher = crypto.createCipheriv("des-ecb", Buffer.from(LOGIN_KEY, "utf8"), null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]).toString("base64");
}

NovaStarApiConnector.encodeLoginValue = encodeLoginValue;
NovaStarApiConnector.normalizeApiMonitor = normalizeApiMonitor;

module.exports = NovaStarApiConnector;

const DES_IP = [
  58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4,
  62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
  57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
  61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7
];
const DES_FP = [
  40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31,
  38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
  36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27,
  34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25
];
const DES_E = [
  32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11,
  12, 13, 12, 13, 14, 15, 16, 17, 16, 17, 18, 19, 20, 21, 20, 21,
  22, 23, 24, 25, 24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1
];
const DES_P = [
  16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10,
  2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25
];
const DES_PC1 = [
  57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18,
  10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36,
  63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22,
  14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4
];
const DES_PC2 = [
  14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10,
  23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2,
  41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48,
  44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32
];
const DES_SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
const DES_SBOX = [
  [
    [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7],
    [0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8],
    [4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0],
    [15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13]
  ],
  [
    [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10],
    [3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5],
    [0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15],
    [13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9]
  ],
  [
    [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8],
    [13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1],
    [13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7],
    [1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12]
  ],
  [
    [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15],
    [13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9],
    [10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4],
    [3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14]
  ],
  [
    [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9],
    [14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6],
    [4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14],
    [11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3]
  ],
  [
    [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11],
    [10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8],
    [9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6],
    [4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13]
  ],
  [
    [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1],
    [13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6],
    [1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2],
    [6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12]
  ],
  [
    [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7],
    [1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2],
    [7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8],
    [2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11]
  ]
];

function encryptDesEcbPkcs7(value, key) {
  const keyBytes = Buffer.from(key, "utf8");
  const data = pkcs7Pad(Buffer.from(value, "utf8"), 8);
  const out = Buffer.alloc(data.length);
  const subkeys = createDesSubkeys(bufferToBits(keyBytes));

  for (let offset = 0; offset < data.length; offset += 8) {
    bitsToBuffer(desEncryptBlock(bufferToBits(data.slice(offset, offset + 8)), subkeys)).copy(out, offset);
  }

  return out.toString("base64");
}

function pkcs7Pad(buffer, blockSize) {
  const pad = blockSize - (buffer.length % blockSize || blockSize);
  const padding = Buffer.alloc(pad === 0 ? blockSize : pad, pad === 0 ? blockSize : pad);
  return Buffer.concat([buffer, padding]);
}

function createDesSubkeys(keyBits) {
  const permuted = permuteBits(keyBits, DES_PC1);
  let left = permuted.slice(0, 28);
  let right = permuted.slice(28);

  return DES_SHIFTS.map((shift) => {
    left = rotateLeftBits(left, shift);
    right = rotateLeftBits(right, shift);
    return permuteBits(left.concat(right), DES_PC2);
  });
}

function desEncryptBlock(blockBits, subkeys) {
  const permuted = permuteBits(blockBits, DES_IP);
  let left = permuted.slice(0, 32);
  let right = permuted.slice(32);

  subkeys.forEach((subkey) => {
    const nextLeft = right;
    const nextRight = xorBits(left, desRound(right, subkey));
    left = nextLeft;
    right = nextRight;
  });

  return permuteBits(right.concat(left), DES_FP);
}

function desRound(right, subkey) {
  const expanded = permuteBits(right, DES_E);
  const mixed = xorBits(expanded, subkey);
  const sboxOutput = [];

  for (let box = 0; box < 8; box += 1) {
    const chunk = mixed.slice(box * 6, box * 6 + 6);
    const row = (chunk[0] << 1) | chunk[5];
    const column = (chunk[1] << 3) | (chunk[2] << 2) | (chunk[3] << 1) | chunk[4];
    const value = DES_SBOX[box][row][column];
    for (let bit = 3; bit >= 0; bit -= 1) {
      sboxOutput.push((value >> bit) & 1);
    }
  }

  return permuteBits(sboxOutput, DES_P);
}

function permuteBits(bits, table) {
  return table.map((position) => bits[position - 1]);
}

function rotateLeftBits(bits, count) {
  return bits.slice(count).concat(bits.slice(0, count));
}

function xorBits(left, right) {
  return left.map((bit, index) => bit ^ right[index]);
}

function bufferToBits(buffer) {
  const bits = [];
  for (const byte of buffer) {
    for (let bit = 7; bit >= 0; bit -= 1) {
      bits.push((byte >> bit) & 1);
    }
  }
  return bits;
}

function bitsToBuffer(bits) {
  const buffer = Buffer.alloc(bits.length / 8);
  for (let index = 0; index < bits.length; index += 8) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit += 1) {
      byte = (byte << 1) | bits[index + bit];
    }
    buffer[index / 8] = byte;
  }
  return buffer;
}
