var express = require('express');
var router = express.Router();
var SNMPConnector = require('../classes/SnmpLib');
var machineStore = require('../classes/MachineStore');
var logger = require('../classes/Logger');
var modelProfiles = require('../classes/ModelProfiles');

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Configuration' });
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

router.get('/api/monitor', async function(req, res) {
  var host = String(req.query.host || '').trim();

  if (!host) {
    logger.warning('SNMP monitor request rejected: missing host');
    res.status(400).json({ error: 'host is required' });
    return;
  }

  var includeReceivingCards = req.query.includeReceivingCards === '1';
  var recvCardsPerPort = clampNumber(req.query.recvCardsPerPort, 1, 12, 1);
  var model = modelProfiles.normalizeModel(req.query.model);
  var profile = modelProfiles.getProfile(model);
  var maxInputSlots = optionalClampedNumber(req.query.maxInputSlots, 1, 32);
  var maxOutputSlots = optionalClampedNumber(req.query.maxOutputSlots, 1, 32);
  var maxScreens = optionalClampedNumber(req.query.maxScreens, 1, 16);

  var connector = new SNMPConnector({
    host: host,
    readCommunity: String(req.query.readCommunity || 'public'),
    writeCommunity: String(req.query.writeCommunity || 'private'),
    timeout: clampNumber(req.query.timeout, 500, 10000, 2000),
    retries: clampNumber(req.query.retries, 0, 5, 1)
  });

  try {
    logger.info('SNMP monitor request started', {
      host: host,
      model: model,
      includeReceivingCards: includeReceivingCards
    });

    var data = await connector.monitor({
      includeReceivingCards: includeReceivingCards,
      recvCardsPerPort: recvCardsPerPort,
      maxInputSlots: maxInputSlots,
      maxOutputSlots: maxOutputSlots,
      maxScreens: maxScreens,
      model: model,
      modelProfile: profile
    });

    logger.info('SNMP monitor request completed', {
      host: host,
      model: model,
      inputSlots: data.inputSlots.count,
      outputSlots: data.outputSlots.count,
      screens: data.screens.count,
      receivingCards: data.receivingCards.length
    });
    res.json(data);
  } catch (error) {
    logger.error('SNMP monitor request failed', {
      host: host,
      error: error.message
    });
    res.status(502).json({
      error: error.message,
      host: host,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;

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
