var referencePreviewMachineId = "";
var referenceContextMachineId = "";

function renderMonitoringCards() {
  if (!machines.length) {
    monitoringCards.innerHTML = '<div class="notice neutral">Ajoutez des machines dans Configuration pour alimenter le monitoring.</div>';
    return;
  }

  monitoringCards.classList.toggle("minimized", monitoringMinimized);
  var toggleLabel = monitoringMinimized ? "Maximiser toutes les cartes" : "Minimiser toutes les cartes";
  monitoringViewToggleButton.innerHTML = '<img src="/images/' + (monitoringMinimized ? 'Maximize.png' : 'Minimize.png') + '" alt="" />';
  monitoringViewToggleButton.setAttribute("aria-label", toggleLabel);
  monitoringViewToggleButton.title = toggleLabel;
  var pingMachines = machines.filter(function(machine) { return machine.type === "other"; });
  var machineById = machines.filter(function(machine) { return machine.type !== "other"; }).reduce(function(result, machine) {
    result[machine.id] = machine;
    return result;
  }, {});
  var miniCards = [];
  var cards = [];
  monitoringCardKeys().forEach(function(cardId) {
    if (cardId === "__ping__") {
      if (monitoringMinimized || minimizedMonitoringCards.__ping__) miniCards.push(renderPingMonitoringMiniCard(pingMachines));
      else cards.push(renderPingMonitoringCard(pingMachines));
      return;
    }
    var machine = machineById[cardId];
    if (!machine) return;
    var baseState = monitoringState[machine.id] || buildUnknownState(machine);
    if (monitoringMinimized || minimizedMonitoringCards[machine.id]) {
      miniCards.push(renderMonitoringMiniCard(machine, baseState));
      return;
    }
    var previewingReference = referencePreviewMachineId === machine.id;
    var state = previewingReference ? buildReferencePreviewState(machine, baseState) : baseState;
    cards.push(renderFullMonitoringCard(machine, state, previewingReference));
  });
  monitoringCards.innerHTML = renderMiniCardStacks(miniCards) + cards.join("");
}

function monitoringCardKeys() {
  var available = machines.filter(function(machine) { return machine.type !== "other"; }).map(function(machine) { return machine.id; });
  if (machines.some(function(machine) { return machine.type === "other"; })) available.push("__ping__");
  var ordered = monitoringCardOrder.filter(function(id, index) {
    return available.indexOf(id) !== -1 && monitoringCardOrder.indexOf(id) === index;
  });
  available.forEach(function(id) { if (ordered.indexOf(id) === -1) ordered.push(id); });
  return ordered;
}

function renderMiniCardStacks(miniCards) {
  var stacks = [];
  for (var index = 0; index < miniCards.length; index += 4) {
    stacks.push('<div class="monitoring-mini-stack">' + miniCards.slice(index, index + 4).join("") + '</div>');
  }
  return stacks.join("");
}

function renderPingMonitoringCard(pingMachines) {
  var previewingReference = referencePreviewMachineId === "__ping__" && !!PING_MONITORING_REFERENCE;
  var pingReferenceState = buildPingReferenceState(pingMachines, previewingReference);
  var expectedIds = PING_MONITORING_REFERENCE && PING_MONITORING_REFERENCE.respondingMachineIds || [];
  var rows = pingMachines.map(function(machine) {
    var state = monitoringState[machine.id] || buildUnknownState(machine);
    var record = monitoringRecords[machine.id];
    var isOk = previewingReference
      ? expectedIds.map(String).indexOf(String(machine.id)) !== -1
      : state.connected === true && state.state === "ok";
    var lastSuccessfulAt = record && (record.lastSuccessfulAt || (isOk && record.timestamp));
    var statusText = isOk ? "OK" : !previewingReference && lastSuccessfulAt ? pingSuccessfulTime(lastSuccessfulAt) : "Not OK";
    var statusTitle = lastSuccessfulAt
      ? "Dernier ping : " + formatDate(lastSuccessfulAt)
      : "Aucun ping reussi depuis le demarrage du monitoring";
    return '<tr>' +
      '<td>' + escapeHtml(machine.name) + '</td>' +
      '<td>' + escapeHtml(machine.host) + '</td>' +
      '<td class="ping-status ' + (isOk ? 'ok' : 'error') + '" title="' + escapeHtml(statusTitle) + '">' + escapeHtml(statusText) + '</td>' +
    '</tr>';
  }).join("");
  var allOk = pingMachines.every(function(machine) {
    var state = monitoringState[machine.id] || buildUnknownState(machine);
    return state.connected === true && state.state === "ok";
  });

  var cardState = REFERENCE_MODE_ENABLED ? pingReferenceState.state : (allOk ? "ok" : "error");
  var referenceButton = REFERENCE_MODE_ENABLED
    ? '<button class="reference-button" type="button" data-ping-reference data-machine-id="__ping__" title="' + escapeHtml(pingReferenceState.title) + '">' + (PING_MONITORING_REFERENCE ? 'Reference' : 'Set Reference') + '</button>'
    : '';
  var refreshButton = monitoringCardRefreshButton("__ping__", "Relancer tous les pings");
  return '<article class="monitoring-card ping-monitoring-card ' + cardState + (previewingReference ? ' reference-preview' : '') + '" data-monitoring-card-id="__ping__">' +
    '<div class="card-head"><h3 class="monitoring-drag-handle" draggable="true">Ping</h3>' +
      '<div class="card-head-meta"><span>' + pingMachines.length + ' machine' + (pingMachines.length > 1 ? 's' : '') + '</span>' +
      '<div class="card-head-actions">' + monitoringCardMinimizeButton("__ping__", "Minimiser la carte Ping") + refreshButton + referenceButton + '</div></div></div>' +
    '<div class="ping-table-wrap"><table class="ping-monitoring-table">' +
      '<tbody>' + rows + '</tbody>' +
    '</table></div><p class="card-message">' + cardMessageHtml(pingReferenceState.message) + '</p>' +
  '</article>';
}

function pingSuccessfulTime(value) {
  var date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not OK";
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function buildPingReferenceState(pingMachines, previewingReference) {
  var lastPing = latestPingDate(pingMachines);
  var lastPingMessage = lastPing ? "Dernier ping : " + formatDate(lastPing) : "Aucun ping effectue";
  if (!REFERENCE_MODE_ENABLED) return { state: "ok", message: lastPingMessage, title: "" };
  if (!PING_MONITORING_REFERENCE) return {
    state: "unknown",
    message: lastPingMessage + "\nReference non definie - Utilisez Set Reference.",
    title: "Aucune reference definie - Cliquer pour memoriser les machines qui repondent"
  };
  var current = pingMachines.filter(function(machine) {
    var state = monitoringState[machine.id] || buildUnknownState(machine);
    return state.connected === true && state.state === "ok";
  }).map(function(machine) { return String(machine.id); }).sort();
  var expected = (PING_MONITORING_REFERENCE.respondingMachineIds || []).map(String).sort();
  var same = current.length === expected.length && current.every(function(id, index) { return id === expected[index]; });
  var date = PING_MONITORING_REFERENCE.setAt ? formatDate(PING_MONITORING_REFERENCE.setAt) : "date inconnue";
  if (previewingReference) return {
    state: "ok",
    message: "Etat de reference : " + date,
    title: "Reference Ping du " + date + " - Clic droit pour la modifier"
  };
  return {
    state: same ? "ok" : "warning",
    message: lastPingMessage + "\nReference : " + date,
    title: "Reference Ping du " + date + " - Clic droit pour la modifier"
  };
}

function latestPingDate(pingMachines) {
  var timestamps = pingMachines.map(function(machine) {
    var record = monitoringRecords[machine.id];
    var value = record && record.timestamp;
    var timestamp = value ? new Date(value).getTime() : NaN;
    return Number.isFinite(timestamp) ? timestamp : 0;
  });
  var latest = timestamps.length ? Math.max.apply(Math, timestamps) : 0;
  return latest ? new Date(latest).toISOString() : "";
}

async function setPingReference() {
  if (!REFERENCE_MODE_ENABLED) return;
  try {
    var response = await fetch("/api/monitoring/ping/reference", { method: "PUT" });
    var result = await response.json();
    if (!response.ok) throw new Error(result.error || "Reference Ping impossible");
    PING_MONITORING_REFERENCE = result.reference;
    renderMonitoringCards();
    setStatus("Reference Ping enregistree", "ok");
  } catch (error) {
    setStatus(error.message || "Sauvegarde impossible", "error");
  }
}

function renderMonitoringMiniCard(machine, state) {
  var colorAttribute = novastarColorAttribute(machine);
  return '<article class="monitoring-mini-card ' + escapeHtml(state.state || "unknown") + (colorAttribute ? ' novastar-colored' : '') + '"' + colorAttribute + ' data-machine-id="' + escapeHtml(machine.id) + '" data-monitoring-card-id="' + escapeHtml(machine.id) + '">' +
      monitoringCardMaximizeButton(machine.id, "Agrandir la carte " + machine.name) +
      '<strong class="monitoring-drag-handle" draggable="true">' + escapeHtml(machine.name) + '</strong>' +
      '<span>' + escapeHtml(machine.host) + '</span>' +
      '<small>' + escapeHtml(state.label || state.state || "Inconnu") + '</small>' +
    '</article>';
}

function renderPingMonitoringMiniCard(pingMachines) {
  var okCount = pingMachines.filter(function(machine) {
    var state = monitoringState[machine.id] || buildUnknownState(machine);
    return state.connected === true && state.state === "ok";
  }).length;
  var stateClass = REFERENCE_MODE_ENABLED ? buildPingReferenceState(pingMachines).state : (okCount === pingMachines.length ? "ok" : "error");
  return '<article class="monitoring-mini-card ' + stateClass + '" data-machine-id="__ping__" data-monitoring-card-id="__ping__">' +
    monitoringCardMaximizeButton("__ping__", "Agrandir la carte Ping") +
    '<strong class="monitoring-drag-handle" draggable="true">Ping</strong><span>' + pingMachines.length + ' machine' + (pingMachines.length > 1 ? 's' : '') + '</span>' +
    '<small>' + okCount + ' OK / ' + (pingMachines.length - okCount) + ' Not OK</small></article>';
}

function renderFullMonitoringCard(machine, state, previewingReference) {
    var record = monitoringRecords[machine.id];
    var neverConnected = !previewingReference && state.connected !== true && !(record && record.lastSuccessfulAt);
    var referenceButtonLabel = machine.monitoringReference ? "Reference" : "Set Reference";
    var referenceButton = REFERENCE_MODE_ENABLED && (machine.monitoringReference || !neverConnected)
      ? '<button class="reference-button" type="button" data-machine-id="' + escapeHtml(machine.id) + '"' +
          ' title="' + escapeHtml(referenceButtonTitle(machine)) + '">' + referenceButtonLabel + '</button>'
      : '';
    var refreshButton = monitoringCardRefreshButton(machine.id, "Rafraîchir " + machine.name);
    var content = neverConnected
      ? '<div class="equipment-no-information"><strong>' + escapeHtml(machineTypeLabel(machine.type)) + '</strong>' +
          '<p>Aucune information retournée par l’équipement.</p></div>'
      : '<div class="pill-section">' +
          (machine.type === "kiloview" ? kiloviewMonitoring(state) :
            machine.type === "netgear-m4300" ? netgearMonitoring(state) :
            ioStatusTable("Inputs", state.inputTables, state.inputSlots) +
            ioStatusTable("Outputs", state.outputTables, state.outputSlots) +
            hardwareStatusTable(state.usbPorts, state.fans, state.powerSupplies) +
            statusOverviewRow(state)) +
        '</div><p class="card-message">' + cardMessageHtml(state.message) + '</p>';

    var colorAttribute = novastarColorAttribute(machine);
    return '<article class="monitoring-card ' + escapeHtml(state.state) + (previewingReference ? ' reference-preview' : '') + (neverConnected ? ' never-connected' : '') + (colorAttribute ? ' novastar-colored' : '') + '"' + colorAttribute + ' data-machine-id="' + escapeHtml(machine.id) + '" data-monitoring-card-id="' + escapeHtml(machine.id) + '">' +
      '<div class="card-head">' +
        '<h3 class="monitoring-drag-handle" draggable="true" title="' + escapeHtml(machine.name) + '">' + escapeHtml(machine.name) + '</h3>' +
        '<div class="card-head-meta"><span>' + escapeHtml(machine.host) + '</span>' +
        '<div class="card-head-actions">' + monitoringCardMinimizeButton(machine.id, "Minimiser la carte " + machine.name) + refreshButton + referenceButton + '</div></div>' +
      '</div>' +
      content +
    '</article>';
}

function monitoringCardMinimizeButton(machineId, title) {
  return '<button class="card-minimize-button" type="button" data-monitoring-minimize="' + escapeHtml(machineId) +
    '" aria-label="' + escapeHtml(title) + '" title="' + escapeHtml(title) +
    '"><img src="/images/Minimize.png" alt="" /></button>';
}

function monitoringCardMaximizeButton(machineId, title) {
  return '<button class="mini-maximize-button" type="button" data-monitoring-maximize="' + escapeHtml(machineId) +
    '" aria-label="' + escapeHtml(title) + '" title="' + escapeHtml(title) +
    '"><img src="/images/Maximize.png" alt="" /></button>';
}

function monitoringCardRefreshButton(machineId, title) {
  var disabled = targetedMonitoringRefreshes[machineId] ? " disabled" : "";
  return '<button class="card-refresh-button" type="button" data-monitoring-refresh="' + escapeHtml(machineId) +
    '" aria-label="' + escapeHtml(title) + '" title="' + escapeHtml(title) + '"' + disabled +
    '><img src="/images/Refresh.png" alt="" /></button>';
}

function novastarColorAttribute(machine) {
  if (!machine || ["novastar-h", "kiloview"].indexOf(machine.type) === -1 || !/^#[0-9a-f]{6}$/i.test(machine.color || "")) return "";
  return ' style="--novastar-color:' + escapeHtml(machine.color) + '"';
}

function cardMessageHtml(message) {
  var normalized = escapeHtml(message || "").replace(/\s+-\s+Reference:\s*/g, "\nReference : ");
  return normalized.split("\n").map(function(line) {
    var datedLine = line.match(/^(Dernier (?:scan|ping)|Reference)\s*:\s*(.*)$/);
    if (!datedLine) return '<span class="card-message-text">' + line + '</span>';
    return '<span class="card-message-row"><span class="card-message-label">' + datedLine[1] + ' :</span>' +
      '<span class="card-message-date">' + datedLine[2] + '</span></span>';
  }).join("");
}

function renderMonitoringCardDialog(machineId, previewingReference) {
  if (machineId === "__ping__") {
    referencePreviewMachineId = previewingReference ? "__ping__" : "";
    var pingMachines = machines.filter(function(machine) { return machine.type === "other"; });
    monitoringCardDialog.dataset.machineId = "__ping__";
    monitoringCardDialogContent.innerHTML = renderPingMonitoringCard(pingMachines);
    return;
  }
  var machine = getMachineById(machineId);
  if (!machine) return;
  var baseState = monitoringState[machine.id] || buildUnknownState(machine);
  var state = previewingReference ? buildReferencePreviewState(machine, baseState) : baseState;
  monitoringCardDialog.dataset.machineId = machine.id;
  monitoringCardDialogContent.innerHTML = renderFullMonitoringCard(machine, state, !!previewingReference);
}

function openMonitoringCardDialog(machineId) {
  renderMonitoringCardDialog(machineId, false);
  monitoringCardDialog.showModal();
}

function buildReferencePreviewState(machine, baseState) {
  var state = JSON.parse(JSON.stringify(baseState));
  var reference = machine.monitoringReference && machine.monitoringReference.snapshot;
  var controls = reference && reference.controls || {};

  function apply(item) {
    if (!item || !item.referenceKey || !Object.prototype.hasOwnProperty.call(controls, item.referenceKey)) return;
    var expected = controls[item.referenceKey];
    try { expected = JSON.parse(expected); } catch (_) {}
    var expectedState = expected && typeof expected === "object" ? expected.state : expected;
    if (expectedState) {
      item.state = expectedState;
      item.ok = stateHealth(expectedState);
      item.referenceState = expectedState;
    }
    if (expected && typeof expected === "object" && expected.icon) item.icon = expected.icon;
    item.changed = false;
  }

  ["controller", "inputSlots", "outputSlots", "systemHealth", "mvrCards", "screens", "usbPorts", "fans", "powerSupplies", "netgearPorts"].forEach(function(key) {
    (state[key] || []).forEach(apply);
  });
  (state.inputTables || []).forEach(function(group) { (group.ports || []).forEach(apply); });
  (state.outputTables || []).forEach(function(group) { (group.ports || []).forEach(apply); });
  (state.kiloviewGroups || []).forEach(function(group) { (group.items || []).forEach(apply); });
  state.message = "Etat de reference" + (machine.monitoringReference.setAt ? " : " + formatDate(machine.monitoringReference.setAt) : "");
  return state;
}

async function setMachineReference(machineId) {
  var machine = getMachineById(machineId);
  var state = monitoringState[machineId];

  if (!REFERENCE_MODE_ENABLED || !machine || !state || !state.connected) {
    setStatus("Un scan connecte est necessaire avant de definir la reference", "error");
    return;
  }

  try {
    var response = await fetch("/api/machines/" + encodeURIComponent(machineId) + "/reference", { method: "PUT" });
    var result = await response.json();
    if (!response.ok) throw new Error(result.error || "Reference impossible");
    machines = machines.map(function(item) { return item.id === machineId ? result.machine : item; });
    applyMonitoringRecord(result.monitoring);
    renderMonitoringCards();
    if (monitoringCardDialog.open && monitoringCardDialog.dataset.machineId === machineId) {
      renderMonitoringCardDialog(machineId, false);
    }
    setStatus("Reference enregistree", "ok");
  } catch (error) {
    setStatus(error.message || "Sauvegarde impossible", "error");
  }
}

function referenceButtonTitle(machine) {
  var setAt = machine.monitoringReference && machine.monitoringReference.setAt;
  return setAt
    ? "Maintenir pour afficher la reference du " + formatDate(setAt) + " - Clic droit pour la modifier"
    : "Aucune reference definie - Cliquer pour utiliser le dernier etat scanne";
}

function stableFingerprint(value) {
  function normalize(item) {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") {
      return Object.keys(item).sort().reduce(function(result, key) {
        if (item[key] !== undefined) result[key] = normalize(item[key]);
        return result;
      }, {});
    }
    return item;
  }

  return JSON.stringify(normalize(value));
}

function buildUnknownState(machine) {
  return {
    connected: false,
    state: "unknown",
    label: "Non scanne",
    message: "Aucun resultat disponible.",
    controller: [{ label: "C", ok: null }],
    inputSlots: [],
    outputSlots: [],
    inputTables: [],
    outputTables: [],
    screens: [],
    outputPorts: [],
    systemHealth: [],
    mvrCards: [],
    usbPorts: [],
    fans: [],
    powerSupplies: [],
    receivingCards: [],
    kiloviewGroups: [],
    netgearPorts: []
  };
}

function buildOfflineState(machine, message) {
  return {
    connected: false,
    state: "offline",
    label: "Offline",
    message: message || "Equipement non connecte.",
    controller: [{ label: "C", ok: false }],
    inputSlots: [],
    outputSlots: [],
    inputTables: [],
    outputTables: [],
    screens: [],
    outputPorts: [],
    systemHealth: [],
    mvrCards: [],
    usbPorts: [],
    fans: [],
    powerSupplies: [],
    receivingCards: [],
    kiloviewGroups: [],
    netgearPorts: []
  };
}

function buildTransientMonitoringState(machine, state, label, message) {
  var previous = monitoringState[machine.id] || buildUnknownState(machine);
  return Object.assign({}, previous, {
    connected: false,
    state: state,
    label: label,
    message: message
  });
}

function buildMonitoringState(data) {
  var controllerState = fieldsVisualState(data.controller);
  var controllerOk = stateHealth(controllerState);
  var primarySlots = data.inputSlots || data.outputSlots;
  var inputTables = [];
  var inputSlots = (primarySlots && primarySlots.slots ? primarySlots.slots : []).reduce(function(items, slot) {
    var inputSources = Array.isArray(slot.inputSources) ? slot.inputSources : [];

    if (!inputSources.length) {
      var fallbackInputState = slot.selectorError ? "error" : fieldsVisualState(slot.fields);
      var fallbackInput = {
        label: String(slot.slotId),
        name: "Input " + String(slot.slotId),
        value: fieldValue(slot.fields && slot.fields.status) || "Aucun signal",
        ok: stateHealth(fallbackInputState),
        state: fallbackInputState,
        icon: interfaceIcon(slot.fields),
        referenceKey: "input:" + String(slot.slotId) + ":-",
        referenceValue: stableFingerprint({ state: fallbackInputState, icon: interfaceIcon(slot.fields) })
      };
      items.push(fallbackInput);
      inputTables.push({ label: String(slot.slotId), ports: [Object.assign({}, fallbackInput, { label: "-" })] });
      return items;
    }

    var inputPorts = [];
    inputSources.forEach(function(source) {
      var inputState = inputSignalState(source.fields && source.fields.status);
        var inputPort = {
          label: String(slot.slotId) + "." + String(source.sourceId),
          portLabel: String(source.sourceId),
          name: "Input " + String(slot.slotId) + "." + String(source.sourceId),
          value: fieldValue(source.fields && source.fields.status) || "Aucun signal",
        ok: stateHealth(inputState),
        state: inputState,
        icon: interfaceIcon(source.fields),
        referenceKey: "input:" + String(slot.slotId) + ":" + String(source.sourceId),
        referenceValue: stableFingerprint({ state: inputState, icon: interfaceIcon(source.fields) })
      };
      items.push(inputPort);
      inputPorts.push(Object.assign({}, inputPort, { label: inputPort.portLabel }));
    });
    inputTables.push({ label: String(slot.slotId), ports: inputPorts });

    return items;
  }, []);
  var outputTables = [];
  var outputSlots = (data.outputSlots && data.outputSlots.slots ? data.outputSlots.slots : []).reduce(function(items, slot) {
    var ports = Array.isArray(slot.outputPorts) ? slot.outputPorts : [];

    if (!ports.length) {
      var fallbackOutputState = slot.selectorError ? "error" : fieldsVisualState(slot.fields);
      if (fallbackOutputState === "ok") fallbackOutputState = "inactive";
        var fallbackOutput = {
          label: String(slot.slotId),
          name: "Output " + String(slot.slotId),
          value: "Aucun port actif",
        ok: stateHealth(fallbackOutputState),
        state: fallbackOutputState,
        icon: "rj45",
        referenceKey: "output:" + String(slot.slotId) + ":-",
        referenceValue: stableFingerprint({ state: fallbackOutputState, icon: "rj45" })
      };
      items.push(fallbackOutput);
      outputTables.push({ label: String(slot.slotId), ports: [Object.assign({}, fallbackOutput, { label: "-" })] });
      return items;
    }

    var outputTablePorts = ports.map(function(port) {
        var outputPort = {
          label: String(slot.slotId) + "." + String(port.portId),
          portLabel: String(port.portId),
          name: "Output " + String(slot.slotId) + "." + String(port.portId),
          value: String(port.status === undefined ? "-" : port.status),
        ok: rawPortHealth(port.status),
        state: rawPortState(port.status),
        icon: "rj45",
        referenceKey: "output:" + String(slot.slotId) + ":" + String(port.portId),
        referenceValue: stableFingerprint({ state: rawPortState(port.status), icon: "rj45" })
      };
      items.push(outputPort);
      return Object.assign({}, outputPort, { label: outputPort.portLabel });
    });
    outputTables.push({ label: String(slot.slotId), ports: outputTablePorts });
    return items;
  }, []);
  var screens = data.screens.screens.map(function(screen) {
    var state = fieldsVisualState(screen.fields);
    return {
      label: String(screen.screenId),
      name: "Ecran " + String(screen.screenId),
      value: fieldValue(screen.fields && (screen.fields.workingStatus || screen.fields.status)) || stateTitle(state),
      ok: stateHealth(state),
      state: state,
      referenceKey: "screen:" + String(screen.screenId),
      referenceValue: state
    };
  });
  var receivingCards = data.receivingCards.map(function(card) {
    var state = fieldsVisualState(card.fields);
    return {
      label: card.outputSlotId + "." + card.netPortId + "." + card.recvCardId,
      name: "Receiving Card " + card.outputSlotId + "." + card.netPortId + "." + card.recvCardId,
      value: [fieldValue(card.fields && card.fields.workingStatus), fieldValue(card.fields && card.fields.temperatureValue), fieldValue(card.fields && card.fields.voltageValue)].filter(Boolean).join(" / ") || stateTitle(state),
      ok: stateHealth(state),
      state: state,
      referenceKey: "receiving:" + card.outputSlotId + ":" + card.netPortId + ":" + card.recvCardId,
      referenceValue: state
    };
  });
  var outputPorts = (data.outputPorts || []).map(function(port) {
    var state = outputPortHealth(port) === null ? "inactive" : fieldsVisualState(port.fields);
    return {
      label: port.outputSlotId + "." + port.netPortId,
      ok: stateHealth(state),
      state: state,
      icon: "rj45"
    };
  });
  var systemHealth = [
    iconStatusItem("Temp.", data.controller && data.controller.temperatureStatus, "temperature", "health:temperature"),
    iconStatusItem("Tension", data.controller && data.controller.voltageStatus, "psu", "health:voltage")
  ].filter(function(item) { return item.ok !== null; });
  if (normalizeMachineType(data.type) === "novastar-h") {
    var genlock = iconStatusItem("Genlock", data.controller && data.controller.genlockStatus, "bnc", "health:genlock");
    var genlockFrame = fieldValue(data.controller && data.controller.genlockFrame);
    var genlockStatus = fieldValue(data.controller && data.controller.genlockStatus);
    genlock.referenceValue = stableFingerprint({
      state: genlock.state,
      icon: genlock.icon,
      frame: genlockFrame
    });
    genlock.title = "Genlock: " + (genlockStatus || stateTitle(genlock.state)) +
      (genlockFrame ? " - Frame: " + genlockFrame : "");
    systemHealth.push(genlock);
  }
  var mvrCards = (data.mvrCards || []).map(function(card) {
    var states = [fieldsVisualState(card.fields)].concat(card.interfaces.map(function(intf) { return fieldsVisualState(intf.fields); }));
    var state = combinedVisualState(states);
    return {
      label: card.slotId,
      name: "MVR " + card.slotId,
      value: fieldValue(card.fields && (card.fields.workingStatus || card.fields.status)) || stateTitle(state),
      ok: stateHealth(state),
      state: state,
      referenceKey: "mvr:" + String(card.slotId),
      referenceValue: state
    };
  });
  var usbPorts = (data.usbPorts || []).map(function(usb) {
    return iconStatusItem(String(usb.usbId), usb.status, "usb", "usb:" + String(usb.usbId));
  });
  var fans = (data.fans || []).map(function(fan) {
    return iconStatusItem(String(fan.fanId), fan.status, "fan", "fan:" + String(fan.fanId));
  });
  var powerSupplies = (data.powerSupplies || []).map(function(power) {
    return iconStatusItem(String(power.powerId), power.status, "psu", "power:" + String(power.powerId));
  });
  var hasWarning = !controllerOk ||
    inputSlots.some(function(item) { return item.ok === false; }) ||
    outputSlots.some(function(item) { return item.ok === false; }) ||
    screens.some(function(item) { return item.ok === false; }) ||
    outputPorts.some(function(item) { return item.ok === false; }) ||
    systemHealth.some(function(item) { return item.ok === false; }) ||
    mvrCards.some(function(item) { return item.ok === false; }) ||
    usbPorts.some(function(item) { return item.ok === false; }) ||
    fans.some(function(item) { return item.ok === false; }) ||
    powerSupplies.some(function(item) { return item.ok === false; });
  var allStatusItems = [{ state: controllerState }]
    .concat(inputSlots, outputSlots, screens, outputPorts, systemHealth, mvrCards, usbPorts, fans, powerSupplies);
  var hasError = allStatusItems.some(function(item) { return item.state === "error"; });
  var overallState = hasError ? "error" : hasWarning ? "warning" : "ok";

  return {
    connected: true,
    state: overallState,
    label: hasError ? "Erreur" : hasWarning ? "Avertissement" : "OK",
    message: "Dernier scan: " + formatDate(data.timestamp),
    controller: [{
      label: "C",
      name: "Controleur",
      value: fieldValue(data.controller && data.controller.workingStatus) || stateTitle(controllerState),
      ok: controllerOk,
      state: controllerState,
      referenceKey: "controller",
      referenceValue: controllerState
    }],
    inputSlots: inputSlots,
    outputSlots: outputSlots,
    inputTables: inputTables,
    outputTables: outputTables,
    screens: screens,
    outputPorts: outputPorts,
    systemHealth: systemHealth,
    mvrCards: mvrCards,
    usbPorts: usbPorts,
    fans: fans,
    powerSupplies: powerSupplies,
    receivingCards: receivingCards
  };
}

function outputPortHealth(port) {
  var link = fieldValue(port && port.fields && port.fields.netPortLinkStatus).toLowerCase();
  if (!link || link.indexOf("inactif") !== -1 || /^0\b/.test(link)) {
    return null;
  }
  return fieldsAreHealthy(port.fields);
}

function inputSignalHealth(field) {
  var value = fieldValue(field).trim();
  if (!value || /^0\b/.test(value)) return null;
  return fieldHealth(field);
}

function inputSignalState(field) {
  var value = fieldValue(field).trim();
  if (!value || /^0\b/.test(value)) return "inactive";
  return fieldVisualState(field);
}

function rawPortState(value) {
  var number = Number(value);
  if (number === 0) return "inactive";
  if (number === 1 || number === 3) return "ok";
  return "warning";
}

function stateHealth(state) {
  if (state === "ok") return true;
  if (state === "inactive") return null;
  return false;
}

function fieldVisualState(field) {
  if (!field || field.value === "" || field.value === null || field.value === undefined || field.state === "notApplicable") {
    return "inactive";
  }
  if (field.error || looksLikeError(field.value)) return "error";
  if (field.ok === false || looksLikeProblem(field.value)) return "warning";
  return "ok";
}

function fieldsVisualState(fields) {
  return combinedVisualState(Object.keys(fields || {}).map(function(key) {
    return fieldVisualState(fields[key]);
  }));
}

function combinedVisualState(states) {
  if (states.some(function(state) { return state === "error"; })) return "error";
  if (states.some(function(state) { return state === "warning"; })) return "warning";
  if (states.length && states.every(function(state) { return state === "inactive"; })) return "inactive";
  return "ok";
}

function iconStatusItem(label, field, icon, referenceKey) {
  var state = fieldVisualState(field);
  return {
    label: label,
    name: label,
    value: fieldValue(field) || stateTitle(state),
    ok: stateHealth(state),
    state: state,
    icon: icon,
    referenceKey: referenceKey,
    referenceValue: stableFingerprint({ state: state, icon: icon })
  };
}

function looksLikeError(value) {
  var text = String(value || "").toLowerCase();
  return ["error", "fault", "fail", "failed"].some(function(pattern) {
    return text.indexOf(pattern) !== -1;
  });
}

function rawPortHealth(value) {
  var number = Number(value);
  if (number === 0) return null;
  if (number === 1 || number === 3) return true;
  return false;
}

function fieldHealth(field) {
  if (!field || field.value === "" || field.value === null || field.value === undefined) return null;
  return field.ok !== false && !looksLikeProblem(field.value);
}

function fieldsAreHealthy(fields) {
  return Object.keys(fields || {}).every(function(key) {
    var field = fields[key];

    if (!field || field.ok === false) {
      return false;
    }

    return !looksLikeProblem(field.value);
  });
}

function looksLikeProblem(value) {
  var text = String(value || "").toLowerCase();

  if (/^error:\s*biziderror$/i.test(String(value || "").trim())) {
    return false;
  }

  return [
    "alarm",
    "error",
    "fault",
    "fail",
    "failed",
    "problem",
    "abnormal",
    "disconnect",
    "offline",
    "down"
  ].some(function(pattern) {
    return text.indexOf(pattern) !== -1;
  });
}

function pillGroup(title, items) {
  var safeItems = items && items.length ? items : [{ label: "-", ok: null }];

  return '<div class="pill-group"><span>' + escapeHtml(title) + '</span><div>' +
    safeItems.map(statusPill).join("") +
  '</div></div>';
}

function ioStatusTable(title, groups, fallbackItems) {
  var safeGroups = groups && groups.length ? groups : [];

  if (!safeGroups.length) {
    return pillGroup(title, fallbackItems);
  }

  var dense = safeGroups.some(function(group) {
    return (group.ports || []).length > 8;
  });
  var rows = safeGroups.map(function(group) {
    var ports = group.ports || [];
    var portRows = ports.length > 8
      ? [
          ports.filter(function(port) { return Number(port.label) % 2 === 0; }),
          ports.filter(function(port) { return Number(port.label) % 2 !== 0; })
        ]
      : [ports];

    return portRows.map(function(portRow, rowIndex) {
      return '<tr>' +
        (rowIndex === 0 ? '<th rowspan="' + portRows.length + '">' + escapeHtml(group.label) + '</th>' : '') +
        portRow.map(ioStatusCell).join("") +
      '</tr>';
    }).join("");
  }).join("");

  return '<div class="io-status-group' + (dense ? ' dense' : '') + '"><span>' + escapeHtml(title) + '</span>' +
    '<div class="io-status-scroll"><table class="io-status-table"><tbody>' + rows + '</tbody></table></div>' +
  '</div>';
}

function hardwareStatusTable(usbPorts, fans, powerSupplies) {
  function row(label, items, icon) {
    var ports = items && items.length ? items : [{ label: "-", ok: null, state: "inactive", icon: icon }];
    return { label: label, ports: ports };
  }

  return ioStatusTable("Materiel", [
    row("USB", usbPorts, "usb"),
    row("Fans", fans, "fan"),
    row("PSU", powerSupplies, "psu")
  ], []);
}

function statusOverviewRow(state) {
  function prefixed(items, prefix) {
    return (items || []).map(function(item) {
      return Object.assign({}, item, { label: prefix + (item.label || "") });
    });
  }

  var healthItems = prefixed(state.systemHealth, "");
  var equipmentItems = []
    .concat(prefixed(state.controller, "Ctrl "))
    .concat(prefixed(state.mvrCards, "MVR "))
    .concat(prefixed(state.screens, "Ecran "));

  function systemRow(label, items) {
    var safeItems = items && items.length ? items : [{ label: "-", ok: null }];
    return '<div class="system-status-row"><small>' + escapeHtml(label) + '</small><div>' +
      safeItems.map(statusPill).join("") +
    '</div></div>';
  }

  return '<div class="monitoring-overview-row">' +
    '<div class="pill-group system-pill-group"><span>Systeme</span>' +
      systemRow("Sante", healthItems) +
      systemRow("Equipements", equipmentItems) +
    '</div>' +
  '</div>';
}

function netgearMonitoring(state) {
  var ports = state.netgearPorts || [];
  if (!ports.length) return '<div class="notice neutral">Aucun port NETGEAR retourne.</div>';
  return '<div class="netgear-port-grid">' + ports.map(function(port) {
    var status = port.state || "inactive";
    var media = port.media === "fiber" ? "Optique" : "Cuivre";
    return '<div class="netgear-port ' + escapeHtml(status) + '" title="' + escapeHtml(monitoringItemTooltip({ name: port.name, value: [port.speed, media, port.poe].filter(Boolean).join(" / ") }, status)) + '">' +
      '<strong>' + escapeHtml(port.name) + '</strong>' +
      '<span>' + escapeHtml(port.speed || "-") + '</span>' +
      '<small>' + escapeHtml(media + (port.poe ? " · " + port.poe : "")) + '</small>' +
    '</div>';
  }).join("") + '</div>';
}

function kiloviewMonitoring(state) {
  var groups = state.kiloviewGroups || [];
  if (!groups.length) return '<div class="notice neutral">Aucune information Kiloview retournee.</div>';
  var networkGroup = groups.find(function(group) { return group.title === "Reseau"; });
  var networkSummary = networkGroup ? kiloviewNetworkGroup(networkGroup) : "";
  return networkSummary + kiloviewStatusSummary(groups) + '<div class="kiloview-monitoring">' + groups.map(function(group) {
    if (group.title === "Reseau") return "";
    if (group.title === "Systeme") return kiloviewSystemGroup(group);
    if (group.title === "Video") return kiloviewVideoGroup(group);
    if (group.title === "Audio") return kiloviewAudioGroup(group);
    if (group.title === "Sortie") return kiloviewOutputGroup(group);
    if (group.title === "Source NDI" || group.title === "Encodeur NDI") return kiloviewNdiGroup(group);
    return '<section class="kiloview-status-group"><div>' +
      (group.items || []).map(kiloviewStatusItem).join("") + '</div></section>';
  }).join("") + '</div>';
}

function kiloviewNetworkGroup(group) {
  var visibleItems = (group.items || []).filter(function(item) {
    return item.label !== "Interfaces" && item.label !== "Protocoles";
  });
  if (!visibleItems.length) return "";
  return '<section class="kiloview-status-group kiloview-network-group"><div>' +
    visibleItems.map(kiloviewStatusItem).join("") +
  '</div></section>';
}

function kiloviewStatusSummary(groups) {
  function findGroup(titles) {
    return groups.find(function(group) { return titles.indexOf(group.title) !== -1; });
  }
  function itemState(items) {
    items = items || [];
    if (items.some(function(item) { return item.state === "error"; })) return "error";
    if (items.some(function(item) { return item.state === "warning"; })) return "warning";
    if (items.some(function(item) { return item.state === "inactive"; })) return "inactive";
    return items.some(function(item) { return item.state === "ok"; }) ? "ok" : "inactive";
  }
  function groupItems(titles) {
    var group = findGroup(titles);
    return group ? group.items || [] : [];
  }
  function cell(items) {
    var state = itemState(items);
    var label = state === "ok" ? "OK" : state === "warning" ? "Warn." : state === "inactive" ? "-" : "Err.";
    var changed = (items || []).some(function(item) { return item.changed === true; });
    var changedItems = (items || []).filter(function(item) { return item.changed === true; });
    var title = changedItems.map(function(item) {
      return monitoringItemTooltip(item, item.state || (item.ok === false ? "warning" : "ok"));
    }).join("\n\n");
    return '<td class="' + escapeHtml(state) + (changed ? ' reference-changed' : '') + '"' +
      (title ? ' title="' + escapeHtml(title) + '"' : '') + '>' + label + '</td>';
  }

  var systemItems = groupItems(["Systeme"]);
  var networkItems = groupItems(["Reseau"]);
  var ndiItems = groupItems(["Source NDI", "Encodeur NDI"]);
  var signalItems = groupItems(["Video"]).concat(groupItems(["Audio"]));
  var outputItems = groupItems(["Sortie"]);
  var sourceItems = ndiItems.filter(function(item) {
    return item.label === "En ligne" || item.label === "Active";
  });
  var cells = [
    systemItems,
    networkItems,
    ndiItems,
    signalItems,
    sourceItems.length ? sourceItems : ndiItems,
    outputItems
  ];

  return '<div class="kiloview-summary-table-wrap"><table class="kiloview-summary-table">' +
    '<thead><tr><th>Sys.</th><th>Net.</th><th>NDI.</th><th>Signal</th><th>In.</th><th>Out.</th></tr></thead>' +
    '<tbody><tr>' + cells.map(cell).join("") + '</tr></tbody>' +
  '</table></div>';
}

function kiloviewNdiGroup(group) {
  var items = group.items || [];
  var values = {};
  items.forEach(function(item) { values[item.label] = item.value || ""; });

  var name = values.Nom || values.Canal || values.Equipement || "-";
  var online = String(values["En ligne"] || values.Active || "on").toLowerCase();
  var isOff = ["offline", "off", "non", "none", "0", "false"].indexOf(online) !== -1;
  var value = 'NDI : "' + name + '" ' + (isOff ? "Off" : "On") + (values.IP ? " - " + values.IP : "");
  var state = items.some(function(item) { return item.state === "error"; }) ? "error"
    : items.some(function(item) { return item.state === "warning"; }) ? "warning"
    : isOff ? "inactive"
    : items.some(function(item) { return item.state === "ok"; }) ? "ok" : "inactive";

  return '<section class="kiloview-status-group kiloview-ndi-group">' +
    '<div class="kiloview-video-summary ' + escapeHtml(state) + '" title="' + escapeHtml(monitoringItemTooltip({ name: group.title, value: value }, state)) + '">' +
      '<strong>' + escapeHtml(value) + '</strong>' +
    '</div></section>';
}

function kiloviewSystemGroup(group) {
  var items = group.items || [];
  var values = {};
  items.forEach(function(item) { values[item.label] = item.value || ""; });

  function capitalize(value) {
    value = String(value || "-");
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  var modeAndStatus = capitalize(values.Mode) + " / " + capitalize(values.Statut);
  var resources = [values.CPU, values.Memoire, values.Uptime].filter(Boolean).join(" - ") || "-";
  var state = items.some(function(item) { return item.state === "error"; }) ? "error"
    : items.some(function(item) { return item.state === "warning"; }) ? "warning"
    : items.some(function(item) { return item.state === "ok"; }) ? "ok" : "inactive";

  return '<section class="kiloview-status-group kiloview-system-group">' +
    '<div class="kiloview-system-summary ' + escapeHtml(state) + '">' +
      '<strong>' + escapeHtml(modeAndStatus) + '</strong>' +
      '<strong>' + escapeHtml(resources) + '</strong>' +
    '</div></section>';
}

function kiloviewVideoGroup(group) {
  var items = group.items || [];
  var values = {};
  items.forEach(function(item) { values[item.label] = item.value || ""; });

  var resolution = values.Resolution || "-";
  var frequency = values.Frequence || "";
  var embeddedFrequency = resolution.match(/(?:p|i)(\d+(?:[.,]\d+)?)$/i);
  if (embeddedFrequency) {
    if (!frequency) frequency = embeddedFrequency[1] + " fps";
    resolution = resolution.slice(0, embeddedFrequency.index);
  }
  frequency = frequency.replace(/\s*fps\s*$/i, "");

  var bitrate = values.Debit || "";
  var bitrateMatch = bitrate.match(/([\d.,]+)\s*Kbit\/s/i);
  if (bitrateMatch) {
    var mbps = Number(bitrateMatch[1].replace(",", ".")) / 1000;
    bitrate = (Number.isInteger(mbps) ? mbps : mbps.toFixed(1).replace(/\.0$/, "")) + "Mbs";
  }

  var state = items.some(function(item) { return item.state === "error"; }) ? "error"
    : items.some(function(item) { return item.state === "warning"; }) ? "warning"
    : items.some(function(item) { return item.state === "ok"; }) ? "ok" : "inactive";
  var value = "NDI " + resolution + (frequency ? "@" + frequency + "fps" : "") + (bitrate ? " - " + bitrate : "");

  return '<section class="kiloview-status-group kiloview-video-group">' +
    '<div class="kiloview-video-summary ' + escapeHtml(state) + '" title="' + escapeHtml(monitoringItemTooltip({ name: group.title, value: value }, state)) + '">' +
      '<strong>' + escapeHtml(value) + '</strong>' +
    '</div></section>';
}

function kiloviewAudioGroup(group) {
  var items = group.items || [];
  var values = {};
  items.forEach(function(item) { values[item.label] = item.value || ""; });

  var presence = (values.Signal || "").toLowerCase();
  var isOff = !presence || ["none", "off", "absent", "aucun", "0"].indexOf(presence) !== -1;
  var value = "Audio Off";
  if (!isOff) {
    var format = values.Format || "";
    var sampling = values.Echantillonnage || "";
    var samplingMatch = sampling.match(/([\d.,]+)\s*Hz/i);
    if (samplingMatch) {
      var khz = Number(samplingMatch[1].replace(",", ".")) / 1000;
      sampling = (Number.isInteger(khz) ? khz : khz.toFixed(1).replace(/\.0$/, "")) + "KHz";
    }
    var channels = values.Canaux || "";
    value = ["Audio", format, sampling, channels ? channels + " canaux" : ""].filter(Boolean).join(" ");
  }

  var state = items.some(function(item) { return item.state === "error"; }) ? "error"
    : items.some(function(item) { return item.state === "warning"; }) ? "warning"
    : isOff ? "inactive"
    : items.some(function(item) { return item.state === "ok"; }) ? "ok" : "inactive";

  return '<section class="kiloview-status-group kiloview-audio-group">' +
    '<div class="kiloview-video-summary ' + escapeHtml(state) + '" title="' + escapeHtml(monitoringItemTooltip({ name: group.title, value: value }, state)) + '">' +
      '<strong>' + escapeHtml(value) + '</strong>' +
    '</div></section>';
}

function kiloviewOutputGroup(group) {
  var items = group.items || [];
  var values = {};
  items.forEach(function(item) { values[item.label] = item.value || ""; });

  var resolution = values.Resolution || "-";
  var frequency = values.Frequence || "";
  var embeddedFrequency = resolution.match(/(?:p|i)(\d+(?:[.,]\d+)?)$/i);
  if (embeddedFrequency) {
    if (!frequency) frequency = embeddedFrequency[1] + " fps";
    resolution = resolution.slice(0, embeddedFrequency.index);
  }
  frequency = frequency.replace(/\s*fps\s*$/i, "");
  var value = resolution + (frequency ? "@" + frequency + "fps" : "");
  var state = items.some(function(item) { return item.state === "error"; }) ? "error"
    : items.some(function(item) { return item.state === "warning"; }) ? "warning"
    : items.some(function(item) { return item.state === "ok"; }) ? "ok" : "inactive";

  return '<section class="kiloview-status-group kiloview-output-group">' +
    '<div class="kiloview-video-summary ' + escapeHtml(state) + '" title="' + escapeHtml(monitoringItemTooltip({ name: group.title, value: value }, state)) + '">' +
      '<strong>' + escapeHtml(value) + '</strong>' +
    '</div></section>';
}

function kiloviewStatusItem(item) {
  var state = item.state || (item.ok === true ? "ok" : item.ok === false ? "error" : "inactive");
  return '<div class="kiloview-status-item ' + escapeHtml(state) + (item.changed ? ' reference-changed' : '') + '" title="' + escapeHtml(monitoringItemTooltip(item, state)) + '">' +
    '<span>' + escapeHtml(item.label) + '</span><strong>' + escapeHtml(item.value || "-") + '</strong></div>';
}

function ioStatusCell(item) {
  var className = item.state || (item.ok === true ? "ok" : item.ok === false ? "warning" : "inactive");
  var title = monitoringItemTooltip(item, className);
  var referenceAttribute = item.referenceKey ? ' data-reference-key="' + escapeHtml(item.referenceKey) + '"' : "";
  return '<td class="' + className + referenceComparisonClass(item) + (item.microInterruption ? ' micro-interruption' : '') + '"' + referenceAttribute + ' title="' + escapeHtml(title) + '">' +
    (item.icon ? statusIcon(item.icon, className, item.label) : "") +
    '<span>' + escapeHtml(item.label) + '</span></td>';
}

function statusPill(item) {
  var state = item.state || (item.ok === true ? "ok" : item.ok === false ? "error" : "inactive");
  var className = state === "error" ? "bad" : state === "inactive" ? "unknown" : state;
  var title = monitoringItemTooltip(item, state);

  return '<span class="monitor-pill ' + className + (item.icon ? ' icon-pill' : '') + referenceComparisonClass(item) + '" title="' + escapeHtml(title) + '">' +
    (item.icon ? statusIcon(item.icon, state, item.label) : "") +
    '<span>' + escapeHtml(item.label) + '</span>' +
  '</span>';
}

function referenceComparisonClass(item) {
  if (item && item.changed === true) return ' reference-changed';
  if (item && item.changed === false && item.referenceState !== undefined) return ' reference-matched';
  return '';
}

function stateTitle(state) {
  if (state === "ok") return "OK";
  if (state === "warning") return "Avertissement";
  if (state === "error") return "Erreur";
  return "Inactif / Inconnu / Aucun signal";
}

function monitoringItemTooltip(item, state) {
  var lines = [monitoringItemIdentity(item) + (state ? " - " + stateTitle(state) : "")];
  if (item && item.changed) {
    var currentValue = item.value === undefined || item.value === null || item.value === "" ? "-" : String(item.value);
    var expectedValue = item.referenceExpectedValue === undefined || item.referenceExpectedValue === null || item.referenceExpectedValue === ""
      ? null : String(item.referenceExpectedValue);
    lines.push("Valeur courante : " + currentValue);
    if (expectedValue !== null) lines.push("Valeur de reference : " + expectedValue);
    else if (item.referenceState) lines.push("Etat de reference : " + stateTitle(item.referenceState));
    if (item.referenceKey === "kiloview:videoBitrate" && expectedValue !== null) {
      var currentMbps = monitoringBitrateMbps(currentValue);
      var expectedMbps = monitoringBitrateMbps(expectedValue);
      if (currentMbps !== null && expectedMbps !== null) {
        lines.push("Ecart : " + formatMonitoringNumber(Math.abs(currentMbps - expectedMbps)) + " Mbit/s");
      }
      if (item.referenceToleranceMbps !== undefined) {
        lines.push("Tolerance : " + formatMonitoringNumber(Number(item.referenceToleranceMbps)) + " Mbit/s");
      }
    }
  }
  if (item && item.microInterruption) lines.push("Microcoupure détectée : " + item.microInterruption.startedAt + " → " + item.microInterruption.recoveredAt);
  return lines.join("\n");
}

function monitoringBitrateMbps(value) {
  var match = String(value || "").trim().match(/(-?\d+(?:[.,]\d+)?)\s*(kbit\/s|kbps|mbit\/s|mbps|mbs)?/i);
  if (!match) return null;
  var amount = Number(match[1].replace(",", "."));
  if (!Number.isFinite(amount)) return null;
  return /^k/i.test(match[2] || "") ? amount / 1000 : amount;
}

function formatMonitoringNumber(value) {
  if (!Number.isFinite(value)) return "-";
  return String(Math.round(value * 1000) / 1000).replace(".", ",");
}

function monitoringItemIdentity(item) {
  var key = String(item && item.referenceKey || "");
  var parts = key.split(":");
  if ((parts[0] === "input" || parts[0] === "output") && parts[1]) {
    return parts[1] + (parts[2] && parts[2] !== "-" ? " - " + parts[2] : "");
  }
  if (parts[0] === "health") return "Sante - " + (item.label || parts[1]);
  if (parts[0] === "mvr") return "MVR - " + (item.label || parts[1]);
  if (parts[0] === "screen") return "Ecran - " + (item.label || parts[1]);
  if (parts[0] === "receiving") return "RC - " + (item.label || parts.slice(1).join("."));
  if (parts[0] === "usb") return "USB - " + (item.label || parts[1]);
  if (parts[0] === "fan") return "Fan - " + (item.label || parts[1]);
  if (parts[0] === "power") return "PSU - " + (item.label || parts[1]);
  if (parts[0] === "controller") return "Controleur";
  return item && (item.name || item.label) || "Element";
}

function interfaceIcon(fields) {
  var type = (fieldValue(fields && fields.type) + " " + fieldValue(fields && fields.rawType)).toLowerCase();
  if (type.indexOf("hdmi") !== -1 || /(^|\s)(4|5)(\s|$)/.test(type)) return "hdmi";
  if (type.indexOf("sdi") !== -1 || type.indexOf("bnc") !== -1 || /(^|\s)6(\s|$)/.test(type)) return "bnc";
  if (type.indexOf("displayport") !== -1 || /(^|\s)(dp|8)(\s|$)/.test(type)) return "dp";
  if (type.indexOf("dvi") !== -1 || /(^|\s)7(\s|$)/.test(type)) return "dvi";
  if (type.indexOf("ethernet") !== -1 || type.indexOf("rj45") !== -1 || /(^|\s)2(\s|$)/.test(type)) return "rj45";
  return "";
}

function statusIcon(icon, state, label) {
  var files = {
    bnc: "BNC-white.png",
    dp: "DP-White.png",
    dvi: "DVI-White.png",
    fan: "Fan-White.png",
    hdmi: "HDMI-White.png",
    psu: "PSU-White.png",
    rj45: "RJ45-white.png",
    temperature: "Temperature-White.png",
    usb: "USB-White.png"
  };
  if (!files[icon]) return "";
  return '<img class="state-icon state-' + escapeHtml(state) + '" src="/images/' + files[icon] + '" alt="" aria-hidden="true" />';
}
