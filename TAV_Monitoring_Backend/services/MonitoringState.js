function buildMonitoringView(data) {
  const controllerState = fieldsVisualState(data.controller);
  const controllerOk = stateHealth(controllerState);
  const kiloviewGroups = normalizeMachineType(data.type) === "kiloview" ? buildKiloviewGroups(data.controller || {}) : [];
  const netgearPorts = normalizeMachineType(data.type) === "netgear-m4300" ? buildNetgearPorts(data.netgearPorts || []) : [];
  const primarySlots = data.inputSlots || data.outputSlots || { slots: [] };
  const inputTables = [];
  const inputSlots = (primarySlots.slots || []).reduce((items, slot) => {
    const sources = Array.isArray(slot.inputSources) ? slot.inputSources : [];
    if (!sources.length) {
      let state = slot.selectorError ? "error" : fieldsVisualState(slot.fields);
      const item = referenceItem(String(slot.slotId), state, interfaceIcon(slot.fields), "input:" + slot.slotId + ":-", { state, icon: interfaceIcon(slot.fields) });
      items.push(item);
      inputTables.push({ label: String(slot.slotId), ports: [Object.assign({}, item, { label: "-" })] });
      return items;
    }
    const ports = sources.map((source) => {
      const state = inputSignalState(source.fields && source.fields.status);
      const icon = interfaceIcon(source.fields);
      const item = referenceItem(String(slot.slotId) + "." + source.sourceId, state, icon, "input:" + slot.slotId + ":" + source.sourceId, { state, icon });
      items.push(item);
      return Object.assign({}, item, { label: String(source.sourceId) });
    });
    inputTables.push({ label: String(slot.slotId), ports });
    return items;
  }, []);

  const outputTables = [];
  const outputSlots = (((data.outputSlots || {}).slots) || []).reduce((items, slot) => {
    const ports = Array.isArray(slot.outputPorts) ? slot.outputPorts : [];
    if (!ports.length) {
      let state = slot.selectorError ? "error" : fieldsVisualState(slot.fields);
      if (state === "ok") state = "inactive";
      const item = referenceItem(String(slot.slotId), state, "rj45", "output:" + slot.slotId + ":-", { state, icon: "rj45" });
      items.push(item);
      outputTables.push({ label: String(slot.slotId), ports: [Object.assign({}, item, { label: "-" })] });
      return items;
    }
    const cells = ports.map((port) => {
      const state = rawPortState(port.status);
      const item = referenceItem(String(slot.slotId) + "." + port.portId, state, "rj45", "output:" + slot.slotId + ":" + port.portId, { state, icon: "rj45" });
      items.push(item);
      return Object.assign({}, item, { label: String(port.portId) });
    });
    outputTables.push({ label: String(slot.slotId), ports: cells });
    return items;
  }, []);

  const screens = ((((data.screens || {}).screens) || [])).map((screen) => {
    const state = fieldsVisualState(screen.fields);
    return referenceItem(String(screen.screenId), state, "", "screen:" + screen.screenId, state);
  });
  const receivingCards = (data.receivingCards || []).map((card) => {
    const state = fieldsVisualState(card.fields);
    const label = [card.outputSlotId, card.netPortId, card.recvCardId].join(".");
    return referenceItem(label, state, "", "receiving:" + [card.outputSlotId, card.netPortId, card.recvCardId].join(":"), state);
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
    return referenceItem(String(card.slotId), state, "", "mvr:" + card.slotId, state);
  });
  const usbPorts = (data.usbPorts || []).map((item) => iconStatusItem(String(item.usbId), item.status, "usb", "usb:" + item.usbId));
  const fans = (data.fans || []).map((item) => iconStatusItem(String(item.fanId), item.status, "fan", "fan:" + item.fanId));
  const powerSupplies = (data.powerSupplies || []).map((item) => iconStatusItem(String(item.powerId), item.status, "psu", "power:" + item.powerId));
  const all = [{ state: controllerState }].concat(inputSlots, outputSlots, screens, outputPorts, systemHealth, mvrCards, usbPorts, fans, powerSupplies, receivingCards, netgearPorts);
  const hasError = all.some((item) => item.state === "error");
  const hasWarning = all.some((item) => item.ok === false);
  const overall = hasError ? "error" : hasWarning ? "warning" : "ok";

  return {
    connected: true,
    state: overall,
    label: hasError ? "Erreur" : hasWarning ? "Avertissement" : "OK",
    message: "Dernier scan: " + formatDate(data.timestamp),
    controller: [referenceItem("C", controllerState, "", "controller", controllerState)],
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
  const reference = machine.monitoringReference && machine.monitoringReference.snapshot;
  if (!reference || !reference.controls) {
    view.state = "unknown";
    view.label = "Reference non definie";
    view.message = view.connected ? view.message + " - Utilisez Set reference." : "Lancez un scan avant de definir la reference.";
    return view;
  }
  const current = buildReferenceSnapshot(view);
  const same = referenceSnapshotsEqual(reference, current);
  markReferenceChanges(view, reference, current);
  view.state = same ? "ok" : "warning";
  view.label = same ? "OK" : "Probleme";
  view.message = baseView.message + " - Reference: " + formatDate(machine.monitoringReference.setAt);
  return view;
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
    view.mvrCards || [], view.screens || [], view.receivingCards || [], view.usbPorts || [], view.fans || [], view.powerSupplies || [],
    view.netgearPorts || [], ...(view.kiloviewGroups || []).map((group) => group.items || []));
}

function referenceSnapshotsEqual(a, b) {
  return a.connected === b.connected && stableFingerprint(a.controls) === stableFingerprint(b.controls);
}

function markReferenceChanges(view, reference, current) {
  const mark = (item) => {
    if (!item || !item.referenceKey) return;
    item.changed = !Object.prototype.hasOwnProperty.call(reference.controls, item.referenceKey) || reference.controls[item.referenceKey] !== current.controls[item.referenceKey];
  };
  collectReferenceItems(view).forEach(mark);
  (view.inputTables || []).forEach((group) => (group.ports || []).forEach(mark));
  (view.outputTables || []).forEach((group) => (group.ports || []).forEach(mark));
  if (reference.connected !== current.connected && view.controller && view.controller[0]) view.controller[0].changed = true;
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
    ["Systeme", [["workingStatus", "Statut"], ["kiloviewMode", "Mode"], ["cpuLoad", "CPU"], ["memoryUsed", "Memoire"], ["workingTime", "Uptime"]]],
    ["Reseau", [["networkState", "Etat"], ["networkInterfaces", "Interfaces"], ["deviceAddress", "Adresse"]]],
    ["Video", [["videoSignal", "Signal"], ["videoInputType", "Entree"], ["videoResolution", "Resolution"], ["instantFrameRate", "Frequence"], ["videoBitrate", "Debit"]]],
    ["Audio", [["audioPresence", "Signal"], ["audioSource", "Source"], ["audioFormat", "Format"], ["audioSampling", "Echantillonnage"], ["audioChannels", "Canaux"]]],
    mode === "decoder"
      ? ["Source NDI", [["ndiSourceOnline", "En ligne"], ["ndiSourceActive", "Active"], ["ndiSourceName", "Nom"], ["ndiSourceIp", "IP"], ["decoderWarning", "Avertissement"]]]
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
function iconStatusItem(label, field, icon, key) { const state = fieldVisualState(field); return referenceItem(label, state, icon, key, { state, icon }); }
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
