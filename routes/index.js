var express = require('express');
var router = express.Router();
var SNMPConnector = require('../classes/SnmpLib');
var NovaStarApiConnector = require('../classes/NovaStarApiLib');
var machineStore = require('../classes/MachineStore');
var logger = require('../classes/Logger');
var modelProfiles = require('../classes/ModelProfiles');
var config = require('../classes/Config');
var PingConnector = require('../classes/PingLib');
var KiloviewApiConnector = require('../classes/KiloviewApiLib');

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', {
    title: 'Configuration',
    autorefresh_s: config.autorefresh_s,
    monitoring_reference_mode: config.monitoring_reference_mode
  });
});

router.put('/api/config/monitoring-reference-mode', function(req, res) {
  try {
    var enabled = req.body && req.body.enabled === true;
    config.saveMonitoringReferenceMode(enabled);
    res.json({ ok: true, enabled: config.monitoring_reference_mode });
  } catch (error) {
    logger.error('Monitoring reference mode save failed', { error: error.message });
    res.status(500).json({ error: 'Unable to save monitoring reference mode' });
  }
});

router.get('/api/machines', function(req, res) {
  var machines = machineStore.loadMachines();
  logger.debug('SNMP machines requested', { count: machines.length });
  res.json(machines);
});

router.put('/api/machines', function(req, res) {
  try {
    var machines = Array.isArray(req.body) ? req.body : [];
    machineStore.saveMachines(machines);
    res.json({ ok: true, count: machines.length });
  } catch (error) {
    logger.error('SNMP machines save failed', { error: error.message });
    res.status(500).json({ error: 'Unable to save SNMP machines' });
  }
});

router.route('/api/monitor')
  .get(handleMonitorRequest)
  .post(handleMonitorRequest);

async function handleMonitorRequest(req, res) {
  var params = req.method === 'POST' ? (req.body || {}) : req.query;
  var host = String(params.host || '').trim();
  var machineType = normalizeMachineType(params.type);
  var accessMethod = String(params.accessMethod || params.source || 'snmp').toLowerCase();

  if (!host) {
    logger.warning('Monitor request rejected: missing host');
    res.status(400).json({ error: 'host is required' });
    return;
  }

  if (machineType === 'kiloview') {
    await monitorWithKiloview(params, res, host);
    return;
  }

  if (machineType === 'other') {
    await monitorWithPing(params, res, host, machineType);
    return;
  }

  if (accessMethod === 'api') {
    await monitorWithApi(params, res, host);
    return;
  }

  if (accessMethod === 'snmp+api') {
    await monitorWithHybrid(params, res, host);
    return;
  }

  await monitorWithSnmp(params, res, host);
}

async function monitorWithKiloview(params, res, host) {
  var connector = new KiloviewApiConnector({
    host: String(params.apiBaseUrl || host),
    username: String(params.apiUsername || params.username || ''),
    password: String(params.apiPassword || params.password || ''),
    timeout: clampNumber(params.timeout, 500, 15000, 5000)
  });

  try {
    logger.info('Kiloview API monitor request started', { host: host });
    var data = await connector.monitor();
    logger.info('Kiloview API monitor request completed', {
      host: host,
      mode: data.kiloviewMode
    });
    res.json(data);
  } catch (error) {
    sendMonitorError(res, 'Kiloview API', host, error);
  }
}

async function monitorWithPing(params, res, host, machineType) {
  var result;
  try {
    result = await PingConnector.ping(host, params.timeout);
  } catch (error) {
    result = { online: false, error: 'Ping indisponible: ' + error.message };
  }
  var timestamp = new Date().toISOString();

  if (!result.online) {
    res.status(502).json({
      error: result.error,
      host: host,
      type: machineType,
      source: 'ping',
      timestamp: timestamp
    });
    return;
  }

  res.json({
    host: host,
    type: machineType,
    source: 'ping',
    timestamp: timestamp,
    controller: {
      workingStatus: { ok: true, value: 'Online' },
      latency: { ok: true, value: result.latencyMs + ' ms' }
    },
    inputSlots: { count: 0, slots: [] },
    outputSlots: { count: 0, slots: [] },
    screens: { count: 0, screens: [] },
    receivingCards: []
  });
}

function normalizeMachineType(value) {
  var type = String(value || 'novastar-h').toLowerCase();
  return ['novastar-h', 'kiloview', 'other'].indexOf(type) !== -1 ? type : 'novastar-h';
}

module.exports = router;

async function monitorWithSnmp(params, res, host) {
  try {
    res.json(await collectSnmpData(params, host));
  } catch (error) {
    sendMonitorError(res, 'SNMP', host, error);
  }
}

async function collectSnmpData(params, host) {
  var includeReceivingCards = params.includeReceivingCards === '1' || params.includeReceivingCards === true;
  var recvCardsPerPort = clampNumber(params.recvCardsPerPort, 1, 12, 1);
  var configuredModel = params.model ? modelProfiles.normalizeModel(params.model) : '';
  var profile = modelProfiles.getProfile(configuredModel || 'H9');
  var maxInputSlots = optionalClampedNumber(params.maxInputSlots, 1, 32);
  var maxOutputSlots = optionalClampedNumber(params.maxOutputSlots, 1, 32);
  var maxScreens = optionalClampedNumber(params.maxScreens, 1, 16);

  var connector = new SNMPConnector({
    host: host,
    readCommunity: String(params.readCommunity || 'public'),
    writeCommunity: String(params.writeCommunity || 'private'),
    timeout: clampNumber(params.timeout, 500, 10000, 2000),
    retries: clampNumber(params.retries, 0, 5, 1)
  });

  logger.info('SNMP monitor request started', {
    host: host,
    includeReceivingCards: includeReceivingCards
  });

  var data = await connector.monitor({
    includeReceivingCards: includeReceivingCards,
    recvCardsPerPort: recvCardsPerPort,
    maxInputSlots: maxInputSlots,
    maxOutputSlots: maxOutputSlots,
    maxScreens: maxScreens,
    model: configuredModel,
    modelProfile: profile
  });

  logger.info('SNMP monitor request completed', {
    host: host,
    inputSlots: data.inputSlots.count,
    outputSlots: data.outputSlots.count,
    screens: data.screens.count,
    receivingCards: data.receivingCards.length
  });
  data.source = 'snmp';
  return data;
}

async function monitorWithApi(params, res, host) {
  try {
    res.json(await collectApiData(params, host));
  } catch (error) {
    sendMonitorError(res, 'NovaStar API', host, error);
  }
}

async function collectApiData(params, host) {
  var configuredModel = params.model ? modelProfiles.normalizeModel(params.model) : '';
  var profile = modelProfiles.getProfile(configuredModel || 'H9');
  var baseUrl = String(params.apiBaseUrl || params.baseUrl || host || '').trim();
  var username = String(params.apiUsername || params.username || 'admin');
  var password = String(params.apiPassword || params.password || 'admin');
  var deviceId = clampNumber(params.apiDeviceId || params.deviceId, 0, 999, 0);

  var connector = new NovaStarApiConnector({
    baseUrl: baseUrl,
    host: host,
    username: username,
    password: password,
    deviceId: deviceId,
    timeout: clampNumber(params.timeout, 500, 15000, 5000)
  });

  logger.info('NovaStar API monitor request started', {
    host: host,
    baseUrl: baseUrl,
    deviceId: deviceId
  });

  await connector.init();
  var data = await connector.monitor({
    model: configuredModel,
    modelProfile: profile
  });

  logger.info('NovaStar API monitor request completed', {
    host: host,
    baseUrl: baseUrl,
    inputSlots: data.inputSlots.count,
    outputSlots: data.outputSlots.count,
    outputPorts: data.outputPorts.length
  });
  return data;
}

async function monitorWithHybrid(params, res, host) {
  var results = await Promise.allSettled([
    collectSnmpData(params, host),
    collectApiData(params, host)
  ]);
  var snmpData = results[0].status === 'fulfilled' ? results[0].value : null;
  var apiData = results[1].status === 'fulfilled' ? results[1].value : null;

  if (!snmpData && !apiData) {
    var message = 'SNMP: ' + results[0].reason.message + '; API: ' + results[1].reason.message;
    sendMonitorError(res, 'SNMP + API', host, new Error(message));
    return;
  }

  var merged = buildHybridMonitor(snmpData, apiData);
  merged.source = 'snmp+api';
  merged.sourcePriority = {
    controller: 'snmp',
    inputSlots: 'api',
    outputSlots: 'api',
    screens: 'snmp',
    receivingCards: 'snmp',
    outputPorts: 'api',
    mvrCards: 'api',
    systemPeripherals: 'api'
  };
  merged.sourceStatus = {
    snmp: snmpData ? 'ok' : 'error',
    api: apiData ? 'ok' : 'error'
  };
  merged.sourceErrors = {
    snmp: snmpData ? '' : results[0].reason.message,
    api: apiData ? '' : results[1].reason.message
  };
  merged.timestamp = new Date().toISOString();
  res.json(merged);
}

function buildHybridMonitor(snmpData, apiData) {
  var base = Object.assign({}, apiData || {}, snmpData || {});
  base.controller = mergePreferred(snmpData && snmpData.controller, apiData && apiData.controller);
  if (apiData && apiData.controller) {
    ["temperatureStatus", "voltageStatus", "cpuStatus", "memoryStatus", "memoryValue", "ethernetStatus"].forEach(function(key) {
      base.controller[key] = mergePreferred(apiData.controller[key], snmpData && snmpData.controller && snmpData.controller[key]);
    });
  }
  base.inputSlots = preferApiSlotCollection(apiData && apiData.inputSlots, snmpData && snmpData.inputSlots);
  base.outputSlots = preferApiSlotCollection(apiData && apiData.outputSlots, snmpData && snmpData.outputSlots);
  base.screens = preferSnmpScreens(snmpData && snmpData.screens, apiData && apiData.screens);
  base.receivingCards = snmpData && Array.isArray(snmpData.receivingCards) ? snmpData.receivingCards : [];
  base.outputPorts = apiData && Array.isArray(apiData.outputPorts) ? apiData.outputPorts : [];
  base.mvrCards = apiData && Array.isArray(apiData.mvrCards) ? apiData.mvrCards : [];
  base.mvrVideo = apiData && apiData.mvrVideo ? apiData.mvrVideo : {};
  base.usbPorts = apiData && Array.isArray(apiData.usbPorts) ? apiData.usbPorts : [];
  base.fans = apiData && Array.isArray(apiData.fans) ? apiData.fans : [];
  base.powerSupplies = apiData && Array.isArray(apiData.powerSupplies) ? apiData.powerSupplies : [];
  if (apiData && apiData.apiDetails) base.apiDetails = apiData.apiDetails;
  return base;
}

function preferApiSlotCollection(apiCollection, snmpCollection) {
  if (!apiCollection || apiCollection.error || !Array.isArray(apiCollection.slots)) {
    return snmpCollection || { count: 0, slots: [] };
  }
  var snmpSlots = snmpCollection && Array.isArray(snmpCollection.slots) ? snmpCollection.slots : [];
  var slots = apiCollection.slots.map(function(apiSlot) {
    var identity = itemIdentity(apiSlot);
    var snmpSlot = snmpSlots.find(function(candidate) { return itemIdentity(candidate) === identity; });
    return snmpSlot ? mergePreferred(apiSlot, snmpSlot) : apiSlot;
  });
  return Object.assign({}, apiCollection, { count: slots.length, slots: slots });
}

function preferSnmpScreens(snmpScreens, apiScreens) {
  if (!snmpScreens || snmpScreens.error || !Array.isArray(snmpScreens.screens)) {
    return apiScreens || { count: 0, screens: [] };
  }
  if (!snmpScreens.screens.length) {
    return apiScreens && Array.isArray(apiScreens.screens) ? apiScreens : snmpScreens;
  }
  var screens = snmpScreens.screens.slice();
  if (screens.length === 1 && apiScreens && Array.isArray(apiScreens.screens) && apiScreens.screens.length === 1) {
    screens[0] = mergePreferred(screens[0], apiScreens.screens[0]);
  }
  return Object.assign({}, snmpScreens, { count: screens.length, screens: screens });
}

function mergePreferred(primary, fallback) {
  if (isField(primary) || isField(fallback)) {
    return isUsableField(primary) ? primary : fallback;
  }
  if (Array.isArray(primary) || Array.isArray(fallback)) {
    return mergeArrays(Array.isArray(primary) ? primary : [], Array.isArray(fallback) ? fallback : []);
  }
  if (isPlainObject(primary) || isPlainObject(fallback)) {
    var preferredObject = isPlainObject(primary) ? primary : {};
    var fallbackObject = isPlainObject(fallback) ? fallback : {};
    if (preferredObject.error && !fallbackObject.error && Object.keys(fallbackObject).length) {
      return fallbackObject;
    }
    var merged = {};
    Object.keys(Object.assign({}, fallbackObject, preferredObject)).forEach(function(key) {
      merged[key] = mergePreferred(preferredObject[key], fallbackObject[key]);
    });
    if (Array.isArray(merged.slots)) merged.count = merged.slots.length;
    if (Array.isArray(merged.screens)) merged.count = merged.screens.length;
    return merged;
  }
  return isPresent(primary) ? primary : fallback;
}

function mergeArrays(primary, fallback) {
  if (!primary.length) return fallback;
  if (!fallback.length) return primary;
  var merged = primary.map(function(item) {
    var identity = itemIdentity(item);
    var match = fallback.find(function(candidate) { return itemIdentity(candidate) === identity; });
    return identity && match ? mergePreferred(item, match) : item;
  });
  fallback.forEach(function(item) {
    var identity = itemIdentity(item);
    if (!identity || !merged.some(function(candidate) { return itemIdentity(candidate) === identity; })) {
      merged.push(item);
    }
  });
  return merged;
}

function itemIdentity(item) {
  if (!isPlainObject(item)) return '';
  if (item.slotId !== undefined) {
    return 'slot:' + (item.rawSlotId !== undefined ? Number(item.rawSlotId) + 1 : normalizePosition(item.slotId));
  }
  if (item.screenId !== undefined) return 'screen:' + item.screenId;
  if (item.outputSlotId !== undefined) {
    return 'card:' + [normalizePosition(item.outputSlotId), item.netPortId].join(':');
  }
  if (item.sourceId !== undefined) return 'source:' + [normalizePosition(item.inputSlotId), item.sourceId].join(':');
  if (item.portId !== undefined) return 'port:' + item.portId;
  return '';
}

function normalizePosition(value) {
  var match = String(value).match(/(\d+)$/);
  return match ? Number(match[1]) : String(value);
}

function isField(value) {
  return isPlainObject(value) && ('value' in value || 'ok' in value);
}

function isUsableField(field) {
  return isField(field) && field.ok !== false && isPresent(field.value);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPresent(value) {
  return value !== undefined && value !== null && value !== '';
}

function sendMonitorError(res, source, host, error) {
  logger.error(source + ' monitor request failed', { host: host, error: error.message });
  res.status(502).json({
    error: error.message,
    host: host,
    timestamp: new Date().toISOString()
  });
}

function clampNumber(value, min, max, fallback) {
  var number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(Math.max(Math.floor(number), min), max);
}

function optionalClampedNumber(value, min, max) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return clampNumber(value, min, max, null);
}
