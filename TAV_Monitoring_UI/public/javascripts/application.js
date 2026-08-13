var LEGACY_STORAGE_KEY = "novastarMachines";
var AUTOREFRESH_S = Number(document.body.dataset.restRefreshS || 0) || 0;
var BACKEND_URL = document.body.dataset.backendUrl || (window.location.origin + "/api");
var REFERENCE_MODE_ENABLED = false;
var BACKEND_CONFIG_LOADED = false;
var PING_MONITORING_REFERENCE = null;
var BACKEND_MONITOR_INTERVAL_S = 0;
var machines = [];
var selectedMachineId = localStorage.getItem("novastarSelectedMachineId") || "";
var contextMachineId = "";
var editingMachineId = "";
var monitoringState = {};
var monitoringRecords = {};
var machineTypeFilters = {
  "novastar-h": true,
  "kiloview": true,
  "netgear-m4300": true,
  "other": true
};
var activeTabId = document.getElementById("monitoringTab").classList.contains("active") ? "monitoringTab" : "configurationTab";
var monitoringRefreshInProgress = false;
var targetedMonitoringRefreshes = {};
var autoRefreshTimer = null;
var monitoringMinimized = localStorage.getItem("tavMonitoringMinimized") === "true";
var minimizedMonitoringCards = loadMinimizedMonitoringCards();
var monitoringCardOrder = loadMonitoringCardOrder();
var draggedMonitoringCardId = "";

function loadMinimizedMonitoringCards() {
  try {
    return JSON.parse(localStorage.getItem("tavMinimizedMonitoringCards") || "[]").reduce(function(result, id) {
      result[String(id)] = true;
      return result;
    }, {});
  } catch (_) {
    return {};
  }
}

function saveMinimizedMonitoringCards() {
  localStorage.setItem("tavMinimizedMonitoringCards", JSON.stringify(Object.keys(minimizedMonitoringCards)));
}

function loadMonitoringCardOrder() {
  try {
    var value = JSON.parse(localStorage.getItem("tavMonitoringCardOrder") || "[]");
    return Array.isArray(value) ? value.map(String) : [];
  } catch (_) {
    return [];
  }
}

function saveMonitoringCardOrder() {
  localStorage.setItem("tavMonitoringCardOrder", JSON.stringify(monitoringCardOrder));
}

var machineList = document.getElementById("machineList");
var machineCount = document.getElementById("machineCount");
var machineTypeFiltersNode = document.getElementById("machineTypeFilters");
var monitorIntervalForm = document.getElementById("monitorIntervalForm");
var monitorIntervalSeconds = document.getElementById("monitorIntervalSeconds");
var selectedMachineName = document.getElementById("selectedMachineName");
var selectedMachineType = document.getElementById("selectedMachineType");
var selectedMachineDetails = document.getElementById("selectedMachineDetails");
var selectedMachineHint = document.getElementById("selectedMachineHint");
var scanButton = document.getElementById("scanButton");
var statusNode = document.getElementById("connectionStatus");
var dialogBackdrop = document.getElementById("dialogBackdrop");
var machineForm = document.getElementById("machineForm");
var dialogTitle = document.getElementById("dialogTitle");
var contextMenu = document.getElementById("machineContextMenu");
var editMachineButton = document.getElementById("editMachine");
var deleteMachineButton = document.getElementById("deleteMachine");
var monitoringCards = document.getElementById("monitoringCards");
var refreshMonitoringButton = document.getElementById("refreshMonitoring");
var autoRefreshHint = document.getElementById("autoRefreshHint");
var monitoringReferenceMode = document.getElementById("monitoringReferenceMode");
var referenceContextMenu = document.getElementById("referenceContextMenu");
var setReferenceMenuItem = document.getElementById("setReferenceMenuItem");
var monitoringViewToggleButton = document.getElementById("toggleMonitoringView");
var monitoringCardDialog = document.getElementById("monitoringCardDialog");
var monitoringCardDialogContent = document.getElementById("monitoringCardDialogContent");

document.getElementById("openAddDialog").addEventListener("click", openAddDialog);
machineTypeFiltersNode.addEventListener("click", function(event) {
  var button = event.target.closest("[data-machine-type]");
  if (!button) return;
  var type = button.dataset.machineType;
  machineTypeFilters[type] = !machineTypeFilters[type];
  button.setAttribute("aria-pressed", String(machineTypeFilters[type]));
  renderMachines();
  renderSelectedMachine();
  renderSelectedMachineScanResults();
});
document.getElementById("closeAddDialog").addEventListener("click", closeDialog);
document.getElementById("cancelAddDialog").addEventListener("click", closeDialog);
monitorIntervalForm.addEventListener("submit", async function(event) {
  event.preventDefault();
  var seconds = Number(monitorIntervalSeconds.value);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86400) {
    setStatus("Intervalle invalide", "error");
    return;
  }
  var submitButton = monitorIntervalForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    var response = await fetch("/api/config/monitor-interval", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seconds: seconds })
    });
    var result = await response.json();
    if (!response.ok) throw new Error(result.error || "Sauvegarde impossible");
    BACKEND_MONITOR_INTERVAL_S = result.monitor_interval_s;
    monitorIntervalSeconds.value = String(BACKEND_MONITOR_INTERVAL_S);
    updateAutoRefreshHint();
    setStatus("Intervalle enregistre", "ok");
  } catch (error) {
    setStatus(error.message || "Sauvegarde impossible", "error");
  } finally {
    submitButton.disabled = false;
  }
});
monitoringViewToggleButton.addEventListener("click", function() {
  if (monitoringMinimized) {
    monitoringMinimized = false;
    minimizedMonitoringCards = {};
    saveMinimizedMonitoringCards();
  } else {
    monitoringMinimized = true;
  }
  localStorage.setItem("tavMonitoringMinimized", String(monitoringMinimized));
  if (monitoringCardDialog.open) monitoringCardDialog.close();
  renderMonitoringCards();
});
document.getElementById("closeMonitoringCardDialog").addEventListener("click", function() { monitoringCardDialog.close(); });
monitoringCardDialog.addEventListener("close", function() { delete monitoringCardDialog.dataset.machineId; });
monitoringCardDialog.addEventListener("click", function(event) { if (event.target === monitoringCardDialog) monitoringCardDialog.close(); });
monitoringCardDialogContent.addEventListener("pointerdown", function(event) {
  var button = event.target.closest(".reference-button");
  if (button && button.hasAttribute("data-ping-reference") && event.button === 0 && PING_MONITORING_REFERENCE) {
    referencePreviewMachineId = "__ping__";
    renderMonitoringCardDialog("__ping__", true);
    return;
  }
  var machine = button && getMachineById(button.dataset.machineId);
  if (!button || event.button !== 0 || !machine || !machine.monitoringReference) return;
  referencePreviewMachineId = machine.id;
  renderMonitoringCardDialog(machine.id, true);
});
monitoringCardDialogContent.addEventListener("click", function(event) {
  var refreshButton = event.target.closest("[data-monitoring-refresh]");
  if (refreshButton) {
    refreshMonitoringCard(refreshButton.dataset.monitoringRefresh);
    return;
  }
  var button = event.target.closest(".reference-button");
  if (button && button.hasAttribute("data-ping-reference") && !PING_MONITORING_REFERENCE) {
    setPingReference();
    return;
  }
  var machine = button && getMachineById(button.dataset.machineId);
  if (!button || !machine || machine.monitoringReference) return;
  setMachineReference(machine.id);
});
monitoringCardDialogContent.addEventListener("contextmenu", function(event) {
  var button = event.target.closest(".reference-button");
  if (button && button.hasAttribute("data-ping-reference")) {
    event.preventDefault();
    if (!window.confirm("Remplacer la reference Ping par la liste des machines qui repondent actuellement ?")) return;
    setPingReference();
    return;
  }
  var machine = button && getMachineById(button.dataset.machineId);
  if (!button || !machine) return;
  event.preventDefault();
  if (!window.confirm("Remplacer la reference de " + machine.name + " par le dernier etat scanne ?")) return;
  setMachineReference(machine.id);
});
machineForm.elements.type.addEventListener("change", updateMachineFormFields);
machineForm.host.addEventListener("input", function() {
  if (getSelectedAccessMethod() !== "snmp") machineForm.apiBaseUrl.value = "";
});
machineForm.apiProtocol.addEventListener("change", function() {
  machineForm.apiBaseUrl.value = "";
  updateMachineFormFields();
});
document.querySelectorAll('input[name="accessMethod"]').forEach(function(accessInput) {
  accessInput.addEventListener("change", updateAccessModeFields);
});
dialogBackdrop.addEventListener("click", function(event) {
  if (event.target === dialogBackdrop) {
    closeDialog();
  }
});

machineList.addEventListener("change", function() {
  selectedMachineId = machineList.value;
  localStorage.setItem("novastarSelectedMachineId", selectedMachineId);
  renderSelectedMachine();
  renderSelectedMachineScanResults();
});

machineList.addEventListener("contextmenu", function(event) {
  event.preventDefault();

  if (!machines.length) {
    return;
  }

  if (event.target && event.target.value) {
    selectedMachineId = event.target.value;
    machineList.value = selectedMachineId;
    localStorage.setItem("novastarSelectedMachineId", selectedMachineId);
    renderSelectedMachine();
    renderSelectedMachineScanResults();
  }

  contextMachineId = selectedMachineId;
  openContextMenu(event.clientX, event.clientY);
});

document.addEventListener("click", function(event) {
  if (!contextMenu.hidden && !contextMenu.contains(event.target)) {
    closeContextMenu();
  }
});

editMachineButton.addEventListener("click", function() {
  var machine = getMachineById(contextMachineId);
  closeContextMenu();

  if (machine) {
    openEditDialog(machine);
  }
});

deleteMachineButton.addEventListener("click", function() {
  var machine = getMachineById(contextMachineId);
  closeContextMenu();

  if (machine) {
    deleteMachine(machine.id);
  }
});

machineForm.addEventListener("submit", async function(event) {
  event.preventDefault();

  var formData = new FormData(machineForm);
  var editedMachine = editingMachineId ? getMachineById(editingMachineId) : null;
  var machine = {
    id: editingMachineId || String(Date.now()),
    type: normalizeMachineType(formData.get("type")),
    name: String(formData.get("name") || "").trim(),
    host: String(formData.get("host") || "").trim(),
    color: String(formData.get("color") || "#32c99a"),
    accessMethod: normalizeAccessMethod(formData.get("accessMethod")),
    readCommunity: String(formData.get("readCommunity") || "public").trim() || "public",
    writeCommunity: String(formData.get("writeCommunity") || "public").trim() || "public",
    timeout: String(formData.get("timeout") || "2000"),
    retries: String(formData.get("retries") || "1"),
    apiProtocol: String(formData.get("apiProtocol") || "openapi"),
    apiBaseUrl: String(formData.get("apiBaseUrl") || "").trim(),
    apiUsername: String(formData.get("apiUsername") || "admin").trim() || "admin",
    apiPassword: String(formData.get("apiPassword") || ""),
    apiProjectId: String(formData.get("apiProjectId") || "").trim(),
    apiSecretKey: String(formData.get("apiSecretKey") || ""),
    apiEncryption: machineForm.apiEncryption.checked,
    apiDeviceId: String(formData.get("apiDeviceId") || "0"),
    maxOutputSlots: String(formData.get("maxOutputSlots") || ""),
    maxScreens: String(formData.get("maxScreens") || ""),
    maxInputSlots: String(formData.get("maxInputSlots") || ""),
    recvCardsPerPort: String(formData.get("recvCardsPerPort") || "1"),
    includeReceivingCards: machineForm.includeReceivingCards.checked,
    includePoe: machineForm.includePoe.checked,
    kiloviewBitrateThresholdMbps: String(formData.get("kiloviewBitrateThresholdMbps") || "1"),
    snmpPort: String(formData.get("snmpPort") || "161")
  };

  if (machine.type === "kiloview") {
    delete machine.accessMethod;
    delete machine.readCommunity;
    delete machine.writeCommunity;
    delete machine.apiBaseUrl;
    delete machine.apiProtocol;
    delete machine.apiProjectId;
    delete machine.apiSecretKey;
    delete machine.apiEncryption;
    delete machine.apiDeviceId;
    delete machine.retries;
    delete machine.maxOutputSlots;
    delete machine.maxScreens;
    delete machine.maxInputSlots;
    delete machine.recvCardsPerPort;
    delete machine.includeReceivingCards;
  } else if (machine.type === "netgear-m4300") {
    delete machine.color;
    machine.accessMethod = "snmp";
    ["writeCommunity", "apiProtocol", "apiBaseUrl", "apiUsername", "apiPassword", "apiProjectId",
      "apiSecretKey", "apiEncryption", "apiDeviceId", "maxOutputSlots", "maxScreens", "maxInputSlots",
      "recvCardsPerPort", "includeReceivingCards", "kiloviewBitrateThresholdMbps"].forEach(function(key) { delete machine[key]; });
  } else if (machine.type === "other") {
    machine = { id: machine.id, type: machine.type, name: machine.name, host: machine.host, timeout: machine.timeout };
  }

  if (machine.type === "novastar-h") delete machine.kiloviewBitrateThresholdMbps;

  if (editedMachine && editedMachine.monitoringReference) {
    machine.monitoringReference = editedMachine.monitoringReference;
  }

  if (editedMachine) {
    if (!String(formData.get("readCommunity") || "").trim()) delete machine.readCommunity;
    if (!String(formData.get("writeCommunity") || "").trim()) delete machine.writeCommunity;
    if (!String(formData.get("apiPassword") || "")) delete machine.apiPassword;
    if (!String(formData.get("apiSecretKey") || "")) delete machine.apiSecretKey;
    delete machine.monitoringReference;
  }

  if (!machine.name || !machine.host) {
    setStatus("Configuration incomplete", "error");
    return;
  }

  var wasEditing = !!editingMachineId;
  try {
    var endpoint = wasEditing ? "/api/machines/" + encodeURIComponent(editingMachineId) : "/api/machines";
    var response = await fetch(endpoint, {
      method: wasEditing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(machine)
    });
    var result = await response.json();
    if (!response.ok) throw new Error(result.error || "Impossible de sauvegarder la machine");
    if (wasEditing) {
      machines = machines.map(function(existingMachine) { return existingMachine.id === result.machine.id ? result.machine : existingMachine; });
    } else {
      machines.push(result.machine);
    }
    selectedMachineId = result.machine.id;
    if (result.monitoring) applyMonitoringRecord(result.monitoring);
    localStorage.setItem("novastarSelectedMachineId", selectedMachineId);
    renderMachines();
    renderSelectedMachine();
    renderMonitoringCards();
    resetScanResults();
    closeDialog();
    setStatus(wasEditing ? "Machine modifiee et enregistree" : "Machine ajoutee et enregistree", "ok");
  } catch (error) {
    setStatus(error.message || "Sauvegarde impossible", "error");
  }
});

scanButton.addEventListener("click", async function() {
  var machine = getSelectedMachine();

  if (!machine) {
    setStatus("Aucune machine", "error");
    return;
  }

  setStatus("Scan en cours", "busy");
  scanButton.disabled = true;
  monitoringState[machine.id] = buildTransientMonitoringState(machine, "pending", "Scan", "Scan en cours");
  renderMonitoringCards();

  try {
    var response = await fetch("/api/machines/" + encodeURIComponent(machine.id) + "/scan", { method: "POST" });
    var record = await response.json();

    if (!response.ok) {
      throw new Error(record.error || "Erreur de scan");
    }

    setBackendConnectionStatus(true);
    applyMonitoringRecord(record);
    if (machine.type === "other") {
      if (!record.view || !record.view.connected) resetScanResults();
      renderPingSummary(record.raw || { type: "other", host: machine.host }, record);
      renderMonitoringCards();
      setStatus(record.view && record.view.connected ? "Connecte" : "Erreur", record.view && record.view.connected ? "ok" : "error");
      return;
    }
    if (!record.view || !record.view.connected) throw new Error(record.raw && record.raw.error || "Equipement non connecte");
    renderMonitor(record.raw, record);
    renderMonitoringCards();
    setStatus("Connecte", "ok");
  } catch (error) {
    setStatus("Erreur", "error");
    renderError(error.message);
    monitoringState[machine.id] = buildTransientMonitoringState(machine, "offline", "Offline", error.message || "Equipement non connecte.");
    renderMonitoringCards();
  } finally {
    scanButton.disabled = !getSelectedMachine();
  }
});

refreshMonitoringButton.addEventListener("click", function() {
  refreshMonitoring(true);
});

if (monitoringReferenceMode) monitoringReferenceMode.addEventListener("change", async function() {
  var requestedMode = monitoringReferenceMode.checked;
  monitoringReferenceMode.disabled = true;

  try {
    var response = await fetch("/api/config/monitoring-reference-mode", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: requestedMode })
    });
    var result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Impossible de sauvegarder le mode de monitoring");
    }

    REFERENCE_MODE_ENABLED = result.enabled === true;
    monitoringReferenceMode.checked = REFERENCE_MODE_ENABLED;
    renderMonitoringCards();
    updateAutoRefreshHint();
    setStatus(REFERENCE_MODE_ENABLED ? "Mode reference active" : "Mode actuel actif", "ok");
  } catch (error) {
    monitoringReferenceMode.checked = REFERENCE_MODE_ENABLED;
    setStatus("Sauvegarde impossible", "error");
  } finally {
    monitoringReferenceMode.disabled = false;
  }
});

monitoringCards.addEventListener("pointerdown", function(event) {
  var button = event.target.closest(".reference-button");
  if (button && button.hasAttribute("data-ping-reference") && event.button === 0 && PING_MONITORING_REFERENCE) {
    referencePreviewMachineId = "__ping__";
    renderMonitoringCards();
    return;
  }
  var machine = button && getMachineById(button.dataset.machineId);
  if (!button || event.button !== 0 || !machine || !machine.monitoringReference) return;
  referencePreviewMachineId = machine.id;
  renderMonitoringCards();
});

monitoringCards.addEventListener("dragstart", function(event) {
  var handle = event.target.closest(".monitoring-drag-handle");
  var card = handle && handle.closest("[data-monitoring-card-id]");
  if (!handle || !card) {
    event.preventDefault();
    return;
  }
  draggedMonitoringCardId = card.dataset.monitoringCardId;
  card.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedMonitoringCardId);
});

monitoringCards.addEventListener("dragover", function(event) {
  var target = event.target.closest("[data-monitoring-card-id]");
  if (!draggedMonitoringCardId || !target || target.dataset.monitoringCardId === draggedMonitoringCardId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  monitoringCards.querySelectorAll(".drag-target").forEach(function(card) { card.classList.remove("drag-target"); });
  target.classList.add("drag-target");
});

monitoringCards.addEventListener("drop", function(event) {
  var target = event.target.closest("[data-monitoring-card-id]");
  if (!draggedMonitoringCardId || !target || target.dataset.monitoringCardId === draggedMonitoringCardId) return;
  event.preventDefault();
  var targetId = target.dataset.monitoringCardId;
  var currentIds = monitoringCardKeys();
  var fromIndex = currentIds.indexOf(draggedMonitoringCardId);
  var targetIndex = currentIds.indexOf(targetId);
  if (fromIndex === -1 || targetIndex === -1) return;
  var bounds = target.getBoundingClientRect();
  var insertAfter = event.clientY > bounds.top + bounds.height / 2 ||
    (Math.abs(event.clientY - (bounds.top + bounds.height / 2)) < bounds.height / 4 && event.clientX > bounds.left + bounds.width / 2);
  currentIds.splice(fromIndex, 1);
  targetIndex = currentIds.indexOf(targetId) + (insertAfter ? 1 : 0);
  currentIds.splice(targetIndex, 0, draggedMonitoringCardId);
  monitoringCardOrder = currentIds;
  saveMonitoringCardOrder();
  renderMonitoringCards();
});

monitoringCards.addEventListener("dragend", function() {
  draggedMonitoringCardId = "";
  monitoringCards.querySelectorAll(".dragging, .drag-target").forEach(function(card) {
    card.classList.remove("dragging", "drag-target");
  });
});

monitoringCards.addEventListener("click", function(event) {
  var cardRefreshButton = event.target.closest("[data-monitoring-refresh]");
  if (cardRefreshButton) {
    refreshMonitoringCard(cardRefreshButton.dataset.monitoringRefresh);
    return;
  }
  var minimizeButton = event.target.closest("[data-monitoring-minimize]");
  if (minimizeButton) {
    minimizedMonitoringCards[minimizeButton.dataset.monitoringMinimize] = true;
    saveMinimizedMonitoringCards();
    renderMonitoringCards();
    return;
  }
  var maximizeButton = event.target.closest("[data-monitoring-maximize]");
  if (maximizeButton) {
    if (monitoringMinimized) {
      machines.filter(function(machine) { return machine.type !== "other"; }).forEach(function(machine) {
        minimizedMonitoringCards[machine.id] = true;
      });
      if (machines.some(function(machine) { return machine.type === "other"; })) minimizedMonitoringCards.__ping__ = true;
      monitoringMinimized = false;
      localStorage.setItem("tavMonitoringMinimized", "false");
    }
    delete minimizedMonitoringCards[maximizeButton.dataset.monitoringMaximize];
    saveMinimizedMonitoringCards();
    renderMonitoringCards();
    return;
  }
  var miniCard = event.target.closest(".monitoring-mini-card");
  if (miniCard) { openMonitoringCardDialog(miniCard.dataset.machineId); return; }
  var pingReferenceButton = event.target.closest("[data-ping-reference]");
  if (pingReferenceButton && !PING_MONITORING_REFERENCE) {
    setPingReference();
    return;
  }
  var button = event.target.closest(".reference-button");
  var machine = button && getMachineById(button.dataset.machineId);
  if (!button || !machine || machine.monitoringReference) return;
  setMachineReference(machine.id);
});

document.addEventListener("pointerup", function() {
  if (!referencePreviewMachineId) return;
  var previewedMachineId = referencePreviewMachineId;
  referencePreviewMachineId = "";
  renderMonitoringCards();
  if (monitoringCardDialog.open && monitoringCardDialog.dataset.machineId === previewedMachineId) renderMonitoringCardDialog(previewedMachineId, false);
});

document.addEventListener("pointermove", function(event) {
  if (!referencePreviewMachineId) return;
  var hoveredButton = document.elementFromPoint(event.clientX, event.clientY);
  hoveredButton = hoveredButton && hoveredButton.closest(".reference-button");
  if (hoveredButton && hoveredButton.dataset.machineId === referencePreviewMachineId) return;
  var previewedMachineId = referencePreviewMachineId;
  referencePreviewMachineId = "";
  renderMonitoringCards();
  if (monitoringCardDialog.open && monitoringCardDialog.dataset.machineId === previewedMachineId) renderMonitoringCardDialog(previewedMachineId, false);
});

monitoringCards.addEventListener("contextmenu", function(event) {
  var pingReferenceButton = event.target.closest("[data-ping-reference]");
  if (pingReferenceButton) {
    event.preventDefault();
    referenceContextMachineId = "__ping__";
    referenceContextMenu.style.left = Math.min(event.clientX, window.innerWidth - 170) + "px";
    referenceContextMenu.style.top = Math.min(event.clientY, window.innerHeight - 60) + "px";
    referenceContextMenu.hidden = false;
    return;
  }
  var button = event.target.closest(".reference-button");
  if (!button) return;
  event.preventDefault();
  referenceContextMachineId = button.dataset.machineId;
  referenceContextMenu.style.left = Math.min(event.clientX, window.innerWidth - 170) + "px";
  referenceContextMenu.style.top = Math.min(event.clientY, window.innerHeight - 60) + "px";
  referenceContextMenu.hidden = false;
});

setReferenceMenuItem.addEventListener("click", function() {
  if (referenceContextMachineId === "__ping__") {
    referenceContextMenu.hidden = true;
    if (!window.confirm("Remplacer la reference Ping par la liste des machines qui repondent actuellement ?")) return;
    setPingReference();
    return;
  }
  var machine = getMachineById(referenceContextMachineId);
  referenceContextMenu.hidden = true;
  if (!machine) return;
  if (!window.confirm("Remplacer la reference de " + machine.name + " par le dernier etat scanne ?")) return;
  setMachineReference(machine.id);
});

document.addEventListener("click", function(event) {
  if (!referenceContextMenu.hidden && !referenceContextMenu.contains(event.target)) {
    referenceContextMenu.hidden = true;
  }
});

initializeAuthentication().then(function(authenticated) {
  if (!authenticated) return;
  initializeApplication();
  setupRestRefresh();
  setupWebSocket();
}).catch(function() { window.location.replace("/login"); });
