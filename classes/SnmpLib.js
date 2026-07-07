const snmp = require("net-snmp");
const logger = require("./Logger");

const OIDS = {
  oidVersion: "1.3.6.1.4.1.319.10.1",

  controllerSummary: "1.3.6.1.4.1.319.10.10.1.0",
  controllerTime: "1.3.6.1.4.1.319.10.10.1.1",
  controllerModel: "1.3.6.1.4.1.319.10.10.1.2",
  controllerFirmware: "1.3.6.1.4.1.319.10.10.1.3",
  controllerSerial: "1.3.6.1.4.1.319.10.10.1.4",
  controllerMac: "1.3.6.1.4.1.319.10.10.1.5",
  controllerIp: "1.3.6.1.4.1.319.10.10.1.6",
  controllerArm: "1.3.6.1.4.1.319.10.10.1.7",
  controllerTemperatureStatus: "1.3.6.1.4.1.319.10.10.1.8",
  controllerFanCount: "1.3.6.1.4.1.319.10.10.1.9",
  controllerPowerCount: "1.3.6.1.4.1.319.10.10.1.10",
  controllerGenlockStatus: "1.3.6.1.4.1.319.10.10.1.11",
  controllerGenlockFrame: "1.3.6.1.4.1.319.10.10.1.12",
  controllerWorkingStatus: "1.3.6.1.4.1.319.10.10.1.13",
  controllerCpuStatus: "1.3.6.1.4.1.319.10.10.1.14",
  controllerMemoryStatus: "1.3.6.1.4.1.319.10.10.1.15",
  controllerFansStatus: "1.3.6.1.4.1.319.10.10.1.16",
  controllerPowerStatus: "1.3.6.1.4.1.319.10.10.1.17",

  inputSlotSelector: "1.3.6.1.4.1.319.10.10.20.0",
  inputSlotCount: "1.3.6.1.4.1.319.10.10.20.1",
  inputSlotStatus: "1.3.6.1.4.1.319.10.10.20.2.1",
  inputSlotFirmware: "1.3.6.1.4.1.319.10.10.20.2.2",
  inputSlotSerial: "1.3.6.1.4.1.319.10.10.20.2.3",
  inputSlotSourceCount: "1.3.6.1.4.1.319.10.10.20.2.4",
  inputSlotSummary: "1.3.6.1.4.1.319.10.10.20.3",
  inputSourceSelector: "1.3.6.1.4.1.319.10.10.20.4",
  inputSourceStatus: "1.3.6.1.4.1.319.10.10.20.5.1",
  inputSourceWidth: "1.3.6.1.4.1.319.10.10.20.5.2",
  inputSourceHeight: "1.3.6.1.4.1.319.10.10.20.5.3",
  inputSourceFrameRate: "1.3.6.1.4.1.319.10.10.20.5.4",
  inputSourceType: "1.3.6.1.4.1.319.10.10.20.5.5",

  outputSlotSelector: "1.3.6.1.4.1.319.10.10.30.0",
  outputSlotCount: "1.3.6.1.4.1.319.10.10.30.1",
  outputSlotStatus: "1.3.6.1.4.1.319.10.10.30.2.1",
  outputSlotFirmware: "1.3.6.1.4.1.319.10.10.30.2.2",
  outputSlotSerial: "1.3.6.1.4.1.319.10.10.30.2.3",
  outputSlotNetPortCount: "1.3.6.1.4.1.319.10.10.30.2.4",
  outputSlotSummary: "1.3.6.1.4.1.319.10.10.30.3",

  recvCardSelector: "1.3.6.1.4.1.319.10.10.30.4",
  netPortLinkStatus: "1.3.6.1.4.1.319.10.10.30.5.1",
  netPortBackupStatus: "1.3.6.1.4.1.319.10.10.30.5.3",
  backupNetPortLinkStatus: "1.3.6.1.4.1.319.10.10.30.5.4",
  fiberLinkStatus: "1.3.6.1.4.1.319.10.10.30.5.5",
  recvCardSummary: "1.3.6.1.4.1.319.10.10.30.6",
  recvCardWorkingStatus: "1.3.6.1.4.1.319.10.10.30.7.1",
  recvCardTemperatureStatus: "1.3.6.1.4.1.319.10.10.30.7.2",
  recvCardTemperatureValue: "1.3.6.1.4.1.319.10.10.30.7.3",
  recvCardVoltageStatus: "1.3.6.1.4.1.319.10.10.30.7.4",
  recvCardVoltageValue: "1.3.6.1.4.1.319.10.10.30.7.5",
  recvCardFpgaVersion: "1.3.6.1.4.1.319.10.10.30.7.6",
  recvCardMcuVersion: "1.3.6.1.4.1.319.10.10.30.7.7",
  recvCardMaxTemperature: "1.3.6.1.4.1.319.10.10.30.7.8",

  screenSelector: "1.3.6.1.4.1.319.10.10.40.0",
  screenCount: "1.3.6.1.4.1.319.10.10.40.1",
  screenName: "1.3.6.1.4.1.319.10.10.40.2.1",
  screenWidth: "1.3.6.1.4.1.319.10.10.40.2.2",
  screenHeight: "1.3.6.1.4.1.319.10.10.40.2.3",
  screenFrameRate: "1.3.6.1.4.1.319.10.10.40.2.4",
  screenBrightness: "1.3.6.1.4.1.319.10.10.40.2.5",
  screenSyncType: "1.3.6.1.4.1.319.10.10.40.2.6",
  screenSyncFrame: "1.3.6.1.4.1.319.10.10.40.2.7",
  screenDisplayMode: "1.3.6.1.4.1.319.10.10.40.2.8",
  screenSummary: "1.3.6.1.4.1.319.10.10.40.3"
};

class SNMPConnector {
  constructor(options = {}) {
    this.host = options.host || "192.168.1.10";
    this.readCommunity = options.readCommunity || "public";
    this.writeCommunity = options.writeCommunity || "private";
    this.timeout = Number(options.timeout || 2000);
    this.retries = Number(options.retries || 1);
    this.port = Number(options.port || 161);
    logger.debug("SNMP connector created", {
      host: this.host,
      port: this.port,
      timeout: this.timeout,
      retries: this.retries
    });
  }

  createSession(community) {
    logger.debug("SNMP session opening", {
      host: this.host,
      port: this.port,
      community: maskCommunity(community)
    });

    return snmp.createSession(this.host, community, {
      version: snmp.Version2c,
      timeout: this.timeout,
      retries: this.retries,
      port: this.port
    });
  }

  get(oid) {
    return new Promise((resolve, reject) => {
      const session = this.createSession(this.readCommunity);
      logger.debug("SNMP GET request", { host: this.host, oid });

      session.get([oid], (error, varbinds) => {
        session.close();
        logger.debug("SNMP session closed", { host: this.host, operation: "get", oid });

        if (error) {
          logger.warning("SNMP GET failed", { host: this.host, oid, error: error.message });
          reject(error);
          return;
        }

        const vb = varbinds[0];
        if (snmp.isVarbindError(vb)) {
          const varbindError = snmp.varbindError(vb);
          logger.warning("SNMP GET varbind error", { host: this.host, oid, error: varbindError });
          reject(new Error(varbindError));
          return;
        }

        logger.debug("SNMP GET completed", { host: this.host, oid });
        resolve(vb.value);
      });
    });
  }

  set(oid, type, value) {
    return new Promise((resolve, reject) => {
      const session = this.createSession(this.writeCommunity);
      const varbinds = [{ oid, type, value }];
      logger.debug("SNMP SET request", { host: this.host, oid, type, value });

      session.set(varbinds, (error, result) => {
        session.close();
        logger.debug("SNMP session closed", { host: this.host, operation: "set", oid });

        if (error) {
          logger.warning("SNMP SET failed", { host: this.host, oid, error: error.message });
          reject(error);
          return;
        }

        for (const vb of result) {
          if (snmp.isVarbindError(vb)) {
            const varbindError = snmp.varbindError(vb);
            logger.warning("SNMP SET varbind error", { host: this.host, oid, error: varbindError });
            reject(new Error(varbindError));
            return;
          }
        }

        logger.debug("SNMP SET completed", { host: this.host, oid });
        resolve(true);
      });
    });
  }

  setInteger(oid, value) {
    return this.set(oid, snmp.ObjectType.Integer, Number(value));
  }

  setString(oid, value) {
    return this.set(oid, snmp.ObjectType.OctetString, String(value));
  }

  async getString(oid) {
    return SNMPConnector.formatValue(await this.get(oid));
  }

  async getNumber(oid) {
    const value = await this.getString(oid);
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  async readFields(definitions) {
    const result = {};

    for (const definition of definitions) {
      result[definition.key] = await this.readField(definition);
    }

    return result;
  }

  async readField({ key, oid, type = "string" }) {
    try {
      const value = type === "number" ? await this.getNumber(oid) : await this.getString(oid);
      logger.debug("SNMP field read", { host: this.host, key, oid });
      return { ok: true, value, oid };
    } catch (error) {
      logger.warning("SNMP field read failed", { host: this.host, key, oid, error: error.message });
      return { ok: false, value: null, oid, error: error.message };
    }
  }

  async readController() {
    logger.info("SNMP controller read started", { host: this.host });
    const fields = await this.readFields([
      { key: "oidVersion", oid: OIDS.oidVersion },
      { key: "summary", oid: OIDS.controllerSummary },
      { key: "workingTime", oid: OIDS.controllerTime },
      { key: "model", oid: OIDS.controllerModel },
      { key: "firmware", oid: OIDS.controllerFirmware },
      { key: "serial", oid: OIDS.controllerSerial },
      { key: "macAddress", oid: OIDS.controllerMac },
      { key: "wiredIpAddress", oid: OIDS.controllerIp },
      { key: "armVersion", oid: OIDS.controllerArm },
      { key: "temperatureStatus", oid: OIDS.controllerTemperatureStatus },
      { key: "fanCount", oid: OIDS.controllerFanCount, type: "number" },
      { key: "powerCount", oid: OIDS.controllerPowerCount, type: "number" },
      { key: "genlockStatus", oid: OIDS.controllerGenlockStatus },
      { key: "genlockFrame", oid: OIDS.controllerGenlockFrame },
      { key: "workingStatus", oid: OIDS.controllerWorkingStatus },
      { key: "cpuStatus", oid: OIDS.controllerCpuStatus },
      { key: "memoryStatus", oid: OIDS.controllerMemoryStatus },
      { key: "fansStatus", oid: OIDS.controllerFansStatus },
      { key: "powerStatus", oid: OIDS.controllerPowerStatus }
    ]);

    this.applyControllerSummary(fields);
    return fields;
  }

  applyControllerSummary(fields) {
    const summary = parseJsonField(fields.summary);

    if (!summary) {
      return;
    }

    const aliases = {
      workingTime: "time",
      model: "name",
      firmware: "version",
      serial: "SN",
      macAddress: "MAC",
      wiredIpAddress: "ip",
      armVersion: "ARMVersion",
      temperatureStatus: "temperature",
      fanCount: "fansCount",
      powerCount: "powerCount",
      genlockStatus: "genlockStatus",
      genlockFrame: "genlockFrame",
      workingStatus: "status",
      cpuStatus: "cpuStatus",
      memoryStatus: "memStatus"
    };

    Object.keys(aliases).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(summary, aliases[key])) {
        fields[key] = {
          ok: true,
          value: summary[aliases[key]],
          oid: fields[key] ? fields[key].oid : OIDS.controllerSummary,
          source: "summary"
        };
      }
    });
  }

  async setSelector(oid, type, value) {
    try {
      if (type === "string") {
        await this.setString(oid, value);
      } else {
        await this.setInteger(oid, value);
      }

      return null;
    } catch (error) {
      logger.warning("SNMP selector write failed; reading current context", {
        host: this.host,
        oid,
        error: error.message
      });
      return error.message;
    }
  }

  async readInputSlot(slotId) {
    logger.debug("SNMP input slot read started", { host: this.host, slotId });
    const selectorError = await this.setSelector(OIDS.inputSlotSelector, "integer", slotId);

    return {
      slotId,
      selectorError,
      fields: await this.readFields([
        { key: "status", oid: OIDS.inputSlotStatus, type: "number" },
        { key: "firmware", oid: OIDS.inputSlotFirmware },
        { key: "serial", oid: OIDS.inputSlotSerial },
        { key: "sourceCount", oid: OIDS.inputSlotSourceCount, type: "number" },
        { key: "summary", oid: OIDS.inputSlotSummary },
        { key: "sourceStatus", oid: OIDS.inputSourceStatus, type: "number" },
        { key: "sourceWidth", oid: OIDS.inputSourceWidth, type: "number" },
        { key: "sourceHeight", oid: OIDS.inputSourceHeight, type: "number" },
        { key: "sourceFrameRate", oid: OIDS.inputSourceFrameRate },
        { key: "sourceType", oid: OIDS.inputSourceType, type: "number" }
      ])
    };
  }

  async readInputSlots(maxSlots) {
    const count = maxSlots || await this.getNumber(OIDS.inputSlotCount);
    const slots = [];
    logger.info("SNMP input slots read started", { host: this.host, count });

    for (let slotId = 1; slotId <= count; slotId += 1) {
      const slot = await this.readInputSlot(slotId);
      slots.push(slot);

      if (slot.selectorError) {
        break;
      }
    }

    return { count, slots };
  }

  async readOutputSlot(slotId) {
    logger.debug("SNMP output slot read started", { host: this.host, slotId });
    const selectorError = await this.setSelector(OIDS.outputSlotSelector, "integer", slotId);

    return {
      slotId,
      selectorError,
      fields: await this.readFields([
        { key: "status", oid: OIDS.outputSlotStatus },
        { key: "firmware", oid: OIDS.outputSlotFirmware },
        { key: "serial", oid: OIDS.outputSlotSerial },
        { key: "netPortCount", oid: OIDS.outputSlotNetPortCount, type: "number" },
        { key: "summary", oid: OIDS.outputSlotSummary }
      ])
    };
  }

  async readOutputSlots(maxSlots) {
    const count = maxSlots || await this.getNumber(OIDS.outputSlotCount);
    const slots = [];
    logger.info("SNMP output slots read started", { host: this.host, count });

    for (let slotId = 1; slotId <= count; slotId += 1) {
      const slot = await this.readOutputSlot(slotId);
      slots.push(slot);

      if (slot.selectorError) {
        break;
      }
    }

    return { count, slots };
  }

  buildReceivingCardSelector({ outputSlotId, netPortId, recvCardId }) {
    return JSON.stringify({
      outputSlotid: Number(outputSlotId),
      netportId: Number(netPortId),
      recvCardId: Number(recvCardId)
    });
  }

  async readReceivingCard(selection) {
    logger.debug("SNMP receiving card read started", Object.assign({ host: this.host }, selection));
    await this.setString(OIDS.recvCardSelector, this.buildReceivingCardSelector(selection));

    return {
      ...selection,
      fields: await this.readFields([
        { key: "netPortLinkStatus", oid: OIDS.netPortLinkStatus, type: "number" },
        { key: "netPortBackupStatus", oid: OIDS.netPortBackupStatus, type: "number" },
        { key: "backupNetPortLinkStatus", oid: OIDS.backupNetPortLinkStatus, type: "number" },
        { key: "fiberLinkStatus", oid: OIDS.fiberLinkStatus },
        { key: "summary", oid: OIDS.recvCardSummary },
        { key: "workingStatus", oid: OIDS.recvCardWorkingStatus, type: "number" },
        { key: "temperatureStatus", oid: OIDS.recvCardTemperatureStatus, type: "number" },
        { key: "temperatureValue", oid: OIDS.recvCardTemperatureValue, type: "number" },
        { key: "voltageStatus", oid: OIDS.recvCardVoltageStatus, type: "number" },
        { key: "voltageValue", oid: OIDS.recvCardVoltageValue, type: "number" },
        { key: "fpgaVersion", oid: OIDS.recvCardFpgaVersion },
        { key: "mcuVersion", oid: OIDS.recvCardMcuVersion },
        { key: "maxTemperature", oid: OIDS.recvCardMaxTemperature, type: "number" }
      ])
    };
  }

  async readReceivingCards({ slots = [], recvCardsPerPort = 1 } = {}) {
    const cards = [];
    logger.info("SNMP receiving cards read started", {
      host: this.host,
      slots: slots.length,
      recvCardsPerPort
    });

    for (const slot of slots) {
      const netPortCount = Number(slot.fields.netPortCount && slot.fields.netPortCount.value) || 0;

      for (let netPortId = 1; netPortId <= netPortCount; netPortId += 1) {
        for (let recvCardId = 1; recvCardId <= recvCardsPerPort; recvCardId += 1) {
          cards.push(await this.readReceivingCard({
            outputSlotId: slot.slotId,
            netPortId,
            recvCardId
          }));
        }
      }
    }

    return cards;
  }

  async readScreen(screenId) {
    logger.debug("SNMP screen read started", { host: this.host, screenId });
    const selectorError = await this.setSelector(OIDS.screenSelector, "integer", screenId);

    return {
      screenId,
      selectorError,
      fields: await this.readFields([
        { key: "name", oid: OIDS.screenName },
        { key: "width", oid: OIDS.screenWidth, type: "number" },
        { key: "height", oid: OIDS.screenHeight, type: "number" },
        { key: "frameRate", oid: OIDS.screenFrameRate, type: "number" },
        { key: "brightness", oid: OIDS.screenBrightness },
        { key: "syncType", oid: OIDS.screenSyncType },
        { key: "syncFrame", oid: OIDS.screenSyncFrame },
        { key: "displayMode", oid: OIDS.screenDisplayMode, type: "number" },
        { key: "summary", oid: OIDS.screenSummary }
      ])
    };
  }

  async readScreens(maxScreens) {
    const count = maxScreens || await this.getNumber(OIDS.screenCount);
    const screens = [];
    logger.info("SNMP screens read started", { host: this.host, count });

    for (let screenId = 1; screenId <= count; screenId += 1) {
      const screen = await this.readScreen(screenId);
      screens.push(screen);

      if (screen.selectorError) {
        break;
      }
    }

    return { count, screens };
  }

  async monitor(options = {}) {
    logger.info("SNMP monitor started", { host: this.host });
    const controller = await this.readController();
    const inputSlots = await this.readInputSlots(options.maxInputSlots).catch((error) => ({
      count: 0,
      slots: [],
      error: error.message
    }));
    const outputSlots = await this.readOutputSlots(options.maxOutputSlots).catch((error) => ({
      count: 0,
      slots: [],
      error: error.message
    }));
    const screens = await this.readScreens(options.maxScreens).catch((error) => ({
      count: 0,
      screens: [],
      error: error.message
    }));
    const receivingCards = options.includeReceivingCards
      ? await this.readReceivingCards({
        slots: outputSlots.slots,
        recvCardsPerPort: options.recvCardsPerPort || 1
      })
      : [];

    const result = {
      host: this.host,
      configuredModel: options.model || "",
      modelProfile: options.modelProfile || null,
      timestamp: new Date().toISOString(),
      controller,
      inputSlots,
      outputSlots,
      screens,
      receivingCards
    };
    logger.info("SNMP monitor completed", { host: this.host });
    return result;
  }

  static formatValue(value) {
    if (Buffer.isBuffer(value)) {
      return value.toString("utf8").replace(/\0+$/, "");
    }

    if (value === null || value === undefined) {
      return "";
    }

    return String(value);
  }
}

SNMPConnector.OIDS = OIDS;

module.exports = SNMPConnector;

function maskCommunity(value) {
  return value ? "***" : "";
}

function parseJsonField(field) {
  if (!field || !field.ok || typeof field.value !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(field.value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    return null;
  }
}
