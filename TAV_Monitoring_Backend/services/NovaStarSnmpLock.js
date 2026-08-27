"use strict";

const logger = require("../classes/Logger").child("NovaStarSnmpLock");
const lanes = new Map();
let requestSequence = 0;

function keyFor(host, port) {
  const normalizedHost = String(host || "").trim().toLowerCase();
  const normalizedPort = Number(port || 161);
  if (!normalizedHost) throw new Error("NovaStar SNMP lock requires a host");
  return normalizedHost + ":" + (Number.isInteger(normalizedPort) && normalizedPort > 0 ? normalizedPort : 161);
}

async function withLock(host, port, context, operation) {
  const key = keyFor(host, port);
  const metadata = Object.assign({}, context || {});
  const requestId = ++requestSequence;
  let lane = lanes.get(key);
  if (!lane) {
    lane = { tail: Promise.resolve(), waiting: 0, active: 0 };
    lanes.set(key, lane);
  }
  lane.waiting += 1;
  const queuedAt = Date.now();
  const previous = lane.tail;
  let release;
  const turn = new Promise((resolve) => { release = resolve; });
  lane.tail = previous.catch(() => {}).then(() => turn);
  logger.info("NovaStar SNMP lock requested", Object.assign({}, metadata, {
    lockKey: key, requestId, waiting: lane.waiting, operation: metadata.operation || "snmp"
  }));
  await previous.catch(() => {});
  lane.waiting -= 1;
  lane.active += 1;
  const acquiredAt = Date.now();
  logger.info("NovaStar SNMP lock acquired", Object.assign({}, metadata, {
    lockKey: key, requestId, waitedMs: acquiredAt - queuedAt, waiting: lane.waiting,
    active: lane.active, operation: metadata.operation || "snmp"
  }));
  let outcome = "completed";
  try {
    return await operation();
  } catch (error) {
    outcome = "failed";
    throw error;
  } finally {
    lane.active -= 1;
    release();
    logger.info("NovaStar SNMP lock released", Object.assign({}, metadata, {
      lockKey: key, requestId, heldMs: Date.now() - acquiredAt, waiting: lane.waiting,
      active: lane.active, outcome, operation: metadata.operation || "snmp"
    }));
    if (lane.waiting === 0 && lane.active === 0 && lanes.get(key) === lane) lanes.delete(key);
  }
}

module.exports = { keyFor, withLock };
