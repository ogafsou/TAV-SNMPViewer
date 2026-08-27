const { selectIo } = require("./CanonicalIo");

function buildMonitoringView(data) {
  const controllerState = fieldsVisualState(data.controller);
  const controllerOk = stateHealth(controllerState);
  const kiloviewGroups = normalizeMachineType(data.type) === "kiloview" ? buildKiloviewGroups(data.controller || {}) : [];
  const netgearPorts = normalizeMachineType(data.type) === "netgear-m4300" ? buildNetgearPorts(data.netgearPorts || []) : [];
  const io = selectIo(data);
  const inputTables = [];
  const inputSlots = io.inputSlots.reduce((items, slot) => {
    const sources = slot.inputs;
    if (!sources.length) {
      let state = slot.selectorError ? "error" : fieldsVisualState(slot.fields);
      const item = Object.assign(referenceItem(slot.label, state, interfaceIcon(slot.fields), slot.id + ":-", { state, icon: interfaceIcon(slot.fields) }), {
        name: "Input " + slot.label,
        value: fieldValue(slot.fields && slot.fields.status) || "Aucun signal"
      });
      items.push(item);
      inputTables.push({ label: slot.label, ports: [Object.assign({}, item, { label: "-" })] });
      return items;
    }
    const ports = sources.map((source) => {
      const state = inputSignalState(source.fields && source.fields.status);
      const icon = interfaceIcon(source.fields);
      const item = Object.assign(referenceItem(slot.label + "." + source.label, state, icon, source.id, { state, icon }), {
        name: "Input " + slot.label + "." + source.label,
        value: fieldValue(source.fields && source.fields.status) || "Aucun signal"
      });
      items.push(item);
      return Object.assign({}, item, { label: source.label });
    });
    inputTables.push({ label: slot.label, ports });
    return items;
  }, []);

  const outputTables = [];
  const outputSlots = io.outputSlots.reduce((items, slot) => {
    const ports = slot.outputs;
    if (!ports.length) {
      let state = slot.selectorError ? "error" : fieldsVisualState(slot.fields);
      if (state === "ok") state = "inactive";
      const item = Object.assign(referenceItem(slot.label, state, "rj45", slot.id + ":-", { state, icon: "rj45" }), {
        name: "Output " + slot.label,
        value: "Aucun port actif"
      });
      items.push(item);
      outputTables.push({ label: slot.label, ports: [Object.assign({}, item, { label: "-" })] });
      return items;
    }
    const cells = ports.map((port) => {
      const state = port.state === "unknown" ? rawPortState(port.fields.status) : port.state;
      const item = Object.assign(referenceItem(slot.label + "." + port.label, state, "rj45", port.id, { state, icon: "rj45" }), {
        name: "Output " + slot.label + "." + port.label,
        value: fieldValue(port.fields.status) || stateTitle(state)
      });
      items.push(item);
      return Object.assign({}, item, { label: port.label });
    });
    outputTables.push({ label: slot.label, ports: cells });
    return items;
  }, []);

  const screens = io.screens.map((screen) => {
    const state = fieldsVisualState(screen.fields);
    return Object.assign(referenceItem(screen.label, state, "", screen.id, state), {
      name: "Ecran " + screen.label,
      value: fieldValue(screen.fields && (screen.fields.workingStatus || screen.fields.status)) || stateTitle(state)
    });
  });
  const receivingCards = io.receivingCards.map((card) => {
    const state = card.state === "unknown" ? fieldsVisualState(card.fields) : card.state;
    const label = card.id.replace(/^output:O-/, "").replace(/:receiving:/, ".").replace(/:/g, ".");
    return Object.assign(referenceItem(label, state, "", card.id, state), {
      name: "Receiving Card " + label,
      value: [fieldValue(card.fields && card.fields.workingStatus), fieldValue(card.fields && card.fields.temperatureValue), fieldValue(card.fields && card.fields.voltageValue)].filter(Boolean).join(" / ") || stateTitle(state)
    });
  });
  const outputPorts = (data.outputPorts || []).map((port) => {
    const state = outputPortHealth(port) === null ? "inactive" : fieldsVisualState(port.fields);
    return Object.assign(referenceItem(port.outputSlotId + "." + port.netPortId, state, "rj45"), { referenceKey: undefined });
  });
  const systemHealth = [
    iconStatusItem("Temp.", data.controller && data.controller.temperatureStatus, "temperature", "health:temperature"),
    iconStatusItem("Tension", data.controller && data.controller.voltageStatus, "psu", "health:voltage")
  ].filter((item) => item.ok !== null);
  if (normalizeMachineType(data.type) === "novastar-h") {
    const genlock = iconStatusItem("Genlock", data.controller && data.controller.genlockStatus, "bnc", "health:genlock");
    const frame = fieldValue(data.controller && data.controller.genlockFrame);
    const status = fieldValue(data.controller && data.controller.genlockStatus);
    genlock.referenceValue = stableFingerprint({ state: genlock.state, icon: genlock.icon, frame });
    genlock.title = "Genlock: " + (status || stateTitle(genlock.state)) + (frame ? " - Frame: " + frame : "");
    systemHealth.push(genlock);
  }
  const mvrCards = (data.mvrCards || []).map((card) => {
    const states = [fieldsVisualState(card.fields)].concat((card.interfaces || []).map((item) => fieldsVisualState(item.fields)));
    const state = combinedVisualState(states);
    return Object.assign(referenceItem(String(card.slotId), state, "", "mvr:" + card.slotId, state), {
      name: "MVR " + card.slotId,
      value: fieldValue(card.fields && (card.fields.workingStatus || card.fields.status)) || stateTitle(state)
    });
  });
  const usbPorts = (data.usbPorts || []).map((item) => iconStatusItem(String(item.usbId), item.status, "usb", "usb:" + item.usbId));
  const fans = (data.fans || []).map((item) => iconStatusItem(String(item.fanId), item.status, "fan", "fan:" + item.fanId));
  const powerSupplies = (data.powerSupplies || []).map((item) => iconStatusItem(String(item.powerId), item.status, "psu", "power:" + item.powerId));
  // Receiving cards are SNMP probes used to resolve output-port states. They
  // remain available in the detailed data, but must not duplicate ports in the
  // overview or influence the global state a second time.
  const all = [{ state: controllerState }].concat(inputSlots, outputSlots, screens, outputPorts, systemHealth, mvrCards, usbPorts, fans, powerSupplies, netgearPorts);
  const hasError = all.some((item) => item.state === "error");
  const hasWarning = all.some((item) => item.ok === false);
  const overall = hasError ? "error" : hasWarning ? "warning" : "ok";

  return {
    connected: true,
    state: overall,
    label: hasError ? "Erreur" : hasWarning ? "Avertissement" : "OK",
    message: "Dernier scan: " + formatDate(data.timestamp),
    controller: [Object.assign(referenceItem("C", controllerState, "", "controller", controllerState), {
      name: "Controleur",
      value: fieldValue(data.controller && data.controller.workingStatus) || stateTitle(controllerState)
    })],
    inputSlots, outputSlots, inputTables, outputTables, screens, outputPorts, systemHealth,
    mvrCards, usbPorts, fans, powerSupplies, receivingCards, kiloviewGroups, netgearPorts
  };
}

function buildOfflineView(machine, error, timestamp) {
  return {
    connected: false,
    state: "offline",
    label: "Offline",
    message: error || "Equipement non connecte.",
    timestamp: timestamp || new Date().toISOString(),
    controller: [{ label: "C", ok: false, state: "error", referenceKey: "controller", referenceValue: "offline" }],
    inputSlots: [], outputSlots: [], inputTables: [], outputTables: [], screens: [], outputPorts: [],
    systemHealth: [], mvrCards: [], usbPorts: [], fans: [], powerSupplies: [], receivingCards: [], kiloviewGroups: [], netgearPorts: []
  };
}

function applyReferenceMode(machine, baseView, enabled) {
  const view = clone(baseView);
  if (!enabled) return view;
  const reference = migrateReferenceSnapshot(machine.monitoringReference && machine.monitoringReference.snapshot);
  if (!reference || !reference.controls) {
    view.state = "unknown";
    view.label = "Reference non definie";
    view.message = view.connected ? view.message + " - Utilisez Set reference." : "Lancez un scan avant de definir la reference.";
    return view;
  }
  const current = buildReferenceSnapshot(view);
  const same = referenceSnapshotsEqual(reference, current, machine);
  markReferenceChanges(view, reference, current, machine);
  view.state = same ? "ok" : "warning";
  view.label = same ? "OK" : "Probleme";
  view.message = baseView.message + " - Reference: " + formatDate(machine.monitoringReference.setAt);
  return view;
}

function migrateReferenceSnapshot(snapshot) {
  if (!snapshot || !snapshot.controls) return snapshot;
  const controls = {};
  Object.entries(snapshot.controls).forEach(([key, value]) => {
    if (key.startsWith("receiving:")) return;
    const parts = key.split(":");
    const canonicalKey = parts[0] === "receiving" && parts.length === 4
      ? `output:O-${parts[1]}:${parts[2]}:receiving:${parts[3]}`
      : key;
    if (canonicalKey.includes(":receiving:")) return;
    controls[canonicalKey] = value;
  });
  return Object.assign({}, snapshot, { controls });
}

function buildReferenceSnapshot(view) {
  const controls = {};
  collectReferenceItems(view).forEach((item) => {
    if (item.referenceKey) controls[item.referenceKey] = item.referenceValue;
  });
  return { connected: view.connected === true, controls };
}

function collectReferenceItems(view) {
  return [].concat(view.controller || [], view.inputSlots || [], view.outputSlots || [], view.systemHealth || [],
    view.mvrCards || [], view.screens || [], view.usbPorts || [], view.fans || [], view.powerSupplies || [],
    view.netgearPorts || [], ...(view.kiloviewGroups || []).map((group) => group.items || []));
}

function referenceSnapshotsEqual(a, b, machine) {
  if (a.connected !== b.connected) return false;
  const keys = Object.keys(Object.assign({}, a.controls, b.controls));
  return keys.every((key) => Object.prototype.hasOwnProperty.call(a.controls, key) &&
    Object.prototype.hasOwnProperty.call(b.controls, key) && referenceValuesEqual(key, a.controls[key], b.controls[key], machine));
}

function markReferenceChanges(view, reference, current, machine) {
  const mark = (item) => {
    if (!item || !item.referenceKey) return;
    item.changed = !Object.prototype.hasOwnProperty.call(reference.controls, item.referenceKey) ||
      !Object.prototype.hasOwnProperty.call(current.controls, item.referenceKey) ||
      !referenceValuesEqual(item.referenceKey, reference.controls[item.referenceKey], current.controls[item.referenceKey], machine);
    if (Object.prototype.hasOwnProperty.call(reference.controls, item.referenceKey)) {
      let expected = reference.controls[item.referenceKey];
      try { expected = JSON.parse(expected); } catch (_) {}
      item.referenceState = expected && typeof expected === "object" ? expected.state : expected;
    }
  };
  collectReferenceItems(view).forEach(mark);
  (view.inputTables || []).forEach((group) => (group.ports || []).forEach(mark));
  (view.outputTables || []).forEach((group) => (group.ports || []).forEach(mark));
  if (reference.connected !== current.connected && view.controller && view.controller[0]) view.controller[0].changed = true;
}

function referenceValuesEqual(key, expectedFingerprint, currentFingerprint, machine) {
  if (expectedFingerprint === currentFingerprint) return true;
  if (key !== "kiloview:videoBitrate") return false;
  let expected;
  let current;
  try { expected = JSON.parse(expectedFingerprint); } catch (_) { return false; }
  try { current = JSON.parse(currentFingerprint); } catch (_) { return false; }
  if (!expected || !current || expected.state !== current.state) return false;
  const expectedMbps = bitrateMbps(expected.value);
  const currentMbps = bitrateMbps(current.value);
  if (expectedMbps === null || currentMbps === null) return false;
  const configured = Number(machine && machine.kiloviewBitrateThresholdMbps);
  const thresholdMbps = Number.isFinite(configured) && configured >= 0 ? configured : 1;
  return Math.abs(currentMbps - expectedMbps) <= thresholdMbps;
}

function bitrateMbps(value) {
  const match = String(value || "").trim().match(/(-?\d+(?:[.,]\d+)?)\s*(kbit\/s|kbps|mbit\/s|mbps|mbs)?/i);
  if (!match) return null;
  const amount = Number(match[1].replace(",", "."));
  if (!Number.isFinite(amount)) return null;
  return /^k/i.test(match[2] || "") ? amount / 1000 : amount;
}

function diffTelemetry(previousRaw, nextRaw) {
  const previous = flatten(stripVolatile(previousRaw));
  const next = flatten(stripVolatile(nextRaw));
  const changes = {};
  Object.keys(Object.assign({}, previous, next)).forEach((path) => {
    if (stableFingerprint(previous[path]) !== stableFingerprint(next[path])) changes[path] = next[path] === undefined ? null : next[path];
  });
  return changes;
}

function structuralFingerprint(view) {
  return stableFingerprint({
    connected: view.connected,
    state: view.state,
    label: view.label,
    controls: buildReferenceSnapshot(view).controls
  });
}

function stripVolatile(raw) {
  if (!raw) return {};
  const copy = clone(raw);
  delete copy.timestamp;
  return copy;
}

function flatten(value, prefix, result) {
  const output = result || {};
  const path = prefix || "";
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, path ? path + "." + index : String(index), output));
  } else if (value && typeof value === "object") {
    Object.keys(value).forEach((key) => flatten(value[key], path ? path + "." + key : key, output));
  } else if (path) output[path] = value;
  return output;
}

function referenceItem(label, state, icon, referenceKey, referenceValue) {
  return { label, ok: stateHealth(state), state, icon: icon || "", referenceKey, referenceValue: stableFingerprint(referenceValue) };
}
function buildKiloviewGroups(controller) {
  const mode = fieldValue(controller.kiloviewMode).toLowerCase();
  const definitions = [
    ["Systeme", [["workingStatus", "Statut"], ["kiloviewMode", "Mode"], ["serialNumber", "Serie"], ["softwareVersion", "Logiciel"], ["hardwareVersion", "Materiel"], ["firmwareVersion", "Firmware"], ["ndiVersion", "NDI"], ["apiSessionStatus", "Session"], ["cpuLoad", "CPU"], ["memoryUsed", "Memoire"], ["workingTime", "Uptime"]]],
    ["Reseau", [["networkState", "Etat"], ["networkInterfaces", "Interfaces"], ["deviceAddress", "Adresse"], ["networkMac", "MAC"], ["networkProtocols", "Protocoles"]]],
    ["Video", [["videoSignal", "Signal"], ["videoInputType", "Entree"], ["videoResolution", "Resolution"], ["instantFrameRate", "Frequence"], ["videoBitrate", "Debit"]]],
    ["Audio", [["audioPresence", "Signal"], ["audioSource", "Source"], ["audioFormat", "Format"], ["audioSampling", "Echantillonnage"], ["audioChannels", "Canaux"], ["audioVolume", "Volume"], ["audioLevel", "Niveau"], ["audioMapping", "Mapping"]]],
    mode === "decoder"
      ? ["Source NDI", [["decoderProtocolStatus", "Protocole"], ["ndiSourceOnline", "En ligne"], ["ndiSourceActive", "Active"], ["ndiSourceName", "Nom"], ["ndiSourceIp", "IP"], ["decoderWarning", "Avertissement"]]]
      : ["Encodeur NDI", [["ndiDeviceName", "Equipement"], ["ndiChannelName", "Canal"], ["ndiGroup", "Groupe"], ["ndiConnection", "Connexion"], ["encodingQuality", "Qualite"]]],
    ["Sortie", [["outputResolution", "Resolution"], ["outputFrameRate", "Frequence"], ["errorNoVideo", "Video"], ["errorNoAudio", "Audio"], ["warningMatch", "Format"], ["warningUnsupportedResolution", "Resolution supportee"]]]
  ];
  return definitions.map(([title, fields]) => ({
    title,
    items: fields.filter(([key]) => controller[key] !== undefined).map(([key, label]) => kiloviewItem(key, label, controller[key]))
  })).filter((group) => group.items.length);
}
function buildNetgearPorts(ports) {
  return ports.map((port) => {
    const state = !port.adminUp ? "inactive" : port.linkUp ? "ok" : "warning";
    const speed = formatPortSpeed(port.speedMbps);
    const poe = port.poe && port.poe.supported
      ? port.poe.delivering ? "PoE On" : port.poe.enabled ? "PoE attente" : "PoE Off"
      : "";
    return Object.assign(referenceItem(port.name || String(port.index), state, port.media === "fiber" ? "fiber" : "rj45",
      "netgear:port:" + port.index, { state, speedMbps: port.speedMbps, media: port.media, poe }), {
      index: port.index,
      name: port.name || "Port " + port.index,
      media: port.media || "",
      speed,
      poe,
      title: [port.description, port.linkUp ? "Lien actif" : "Lien inactif", speed, poe].filter(Boolean).join(" - ")
    });
  });
}
function formatPortSpeed(value) {
  const speed = Number(value || 0);
  if (speed >= 1000) return (speed / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " Gb/s";
  return speed ? speed + " Mb/s" : "-";
}
function kiloviewItem(key, label, field) {
  const state = fieldVisualState(field);
  const value = fieldValue(field) || "-";
  return Object.assign(referenceItem(label, state, "", "kiloview:" + key, { state, value }), { value, title: `${label}: ${value}` });
}
function iconStatusItem(label, field, icon, key) {
  const state = fieldVisualState(field);
  return Object.assign(referenceItem(label, state, icon, key, { state, icon }), {
    name: label,
    value: fieldValue(field) || stateTitle(state)
  });
}
function fieldVisualState(field) {
  if (!field || field.value === "" || field.value === null || field.value === undefined || field.state === "notApplicable") return "inactive";
  if (field.error || looksLikeError(field.value)) return "error";
  if (field.ok === false || looksLikeProblem(field.value)) return "warning";
  return "ok";
}
function fieldsVisualState(fields) { return combinedVisualState(Object.keys(fields || {}).map((key) => fieldVisualState(fields[key]))); }
function combinedVisualState(states) {
  if (states.some((state) => state === "error")) return "error";
  if (states.some((state) => state === "warning")) return "warning";
  if (states.length && states.every((state) => state === "inactive")) return "inactive";
  return "ok";
}
function inputSignalState(field) { const value = fieldValue(field).trim(); return !value || /^0\b/.test(value) ? "inactive" : fieldVisualState(field); }
function rawPortState(value) { const n = Number(value); return n === 0 ? "inactive" : n === 1 || n === 3 ? "ok" : "warning"; }
function stateHealth(state) { return state === "ok" ? true : state === "inactive" ? null : false; }
function outputPortHealth(port) { const link = fieldValue(port && port.fields && port.fields.netPortLinkStatus).toLowerCase(); return !link || link.includes("inactif") || /^0\b/.test(link) ? null : true; }
function fieldValue(field) { return !field ? "" : field.ok === false && field.error ? "Erreur" : String(field.value || ""); }
function looksLikeError(value) { const text = String(value || "").toLowerCase(); return ["error", "fault", "fail", "failed"].some((word) => text.includes(word)); }
function looksLikeProblem(value) {
  const raw = String(value || "").trim();
  if (/^error:\s*biziderror$/i.test(raw)) return false;
  const text = raw.toLowerCase();
  return ["alarm", "error", "fault", "fail", "failed", "problem", "abnormal", "disconnect", "offline", "down"].some((word) => text.includes(word));
}
function interfaceIcon(fields) {
  const type = (fieldValue(fields && fields.type) + " " + fieldValue(fields && fields.rawType)).toLowerCase();
  if (type.includes("hdmi") || /(^|\s)(4|5)(\s|$)/.test(type)) return "hdmi";
  if (type.includes("sdi") || type.includes("bnc") || /(^|\s)6(\s|$)/.test(type)) return "bnc";
  if (type.includes("displayport") || /(^|\s)(dp|8)(\s|$)/.test(type)) return "dp";
  if (type.includes("dvi") || /(^|\s)7(\s|$)/.test(type)) return "dvi";
  if (type.includes("ethernet") || type.includes("rj45") || /(^|\s)2(\s|$)/.test(type)) return "rj45";
  return "";
}
function normalizeMachineType(value) { const type = String(value || "novastar-h").toLowerCase(); return ["novastar-h", "kiloview", "netgear-m4300", "other"].includes(type) ? type : "novastar-h"; }
function stateTitle(state) { return state === "ok" ? "OK" : state === "warning" ? "Avertissement" : state === "error" ? "Erreur" : "Inactif / Inconnu / Aucun signal"; }
function formatDate(value) { return new Date(value).toLocaleString("fr-FR"); }
function stableFingerprint(value) {
  function normalize(item) {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") return Object.keys(item).sort().reduce((result, key) => { if (item[key] !== undefined) result[key] = normalize(item[key]); return result; }, {});
    return item;
  }
  return JSON.stringify(normalize(value));
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

module.exports = {
  buildMonitoringView,
  buildOfflineView,
  applyReferenceMode,
  buildReferenceSnapshot,
  diffTelemetry,
  structuralFingerprint,
  stableFingerprint
};
