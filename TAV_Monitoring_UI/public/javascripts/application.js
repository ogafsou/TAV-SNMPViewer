var LEGACY_STORAGE_KEY = "novastarMachines";
var AUTOREFRESH_S = Number(document.body.dataset.restRefreshS || 0) || 0;
var REFERENCE_MODE_ENABLED = false;
var BACKEND_MONITOR_INTERVAL_S = 0;
var machines = [];
var selectedMachineId = localStorage.getItem("novastarSelectedMachineId") || "";
var contextMachineId = "";
var editingMachineId = "";
var monitoringState = {};
var monitoringRecords = {};
var activeTabId = "configurationTab";
var monitoringRefreshInProgress = false;
var autoRefreshTimer = null;

var machineList = document.getElementById("machineList");
var machineCount = document.getElementById("machineCount");
var selectedMachineName = document.getElementById("selectedMachineName");
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

document.querySelectorAll(".tab").forEach(function(tabButton) {
  tabButton.addEventListener("click", function() {
    activateTab(tabButton.dataset.tab);
  });
});

document.getElementById("openAddDialog").addEventListener("click", openAddDialog);
document.getElementById("closeAddDialog").addEventListener("click", closeDialog);
document.getElementById("cancelAddDialog").addEventListener("click", closeDialog);
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
  resetScanResults();
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
    resetScanResults();
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
    accessMethod: normalizeAccessMethod(formData.get("accessMethod")),
    readCommunity: String(formData.get("readCommunity") || "public").trim() || "public",
    writeCommunity: String(formData.get("writeCommunity") || "private").trim() || "private",
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
    machine.accessMethod = "snmp";
    ["writeCommunity", "apiProtocol", "apiBaseUrl", "apiUsername", "apiPassword", "apiProjectId",
      "apiSecretKey", "apiEncryption", "apiDeviceId", "maxOutputSlots", "maxScreens", "maxInputSlots",
      "recvCardsPerPort", "includeReceivingCards"].forEach(function(key) { delete machine[key]; });
  } else if (machine.type === "other") {
    machine = { id: machine.id, type: machine.type, name: machine.name, host: machine.host, timeout: machine.timeout };
  }

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
    setStatus(wasEditing ? "Machine modifiee" : "Machine ajoutee", "ok");
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

    applyMonitoringRecord(record);
    if (!record.view || !record.view.connected) throw new Error(record.raw && record.raw.error || "Equipement non connecte");
    renderMonitor(record.raw);
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

monitoringReferenceMode.addEventListener("change", async function() {
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
  var machine = button && getMachineById(button.dataset.machineId);
  if (!button || event.button !== 0 || !machine || !machine.monitoringReference) return;
  referencePreviewMachineId = machine.id;
  renderMonitoringCards();
});

document.addEventListener("pointerup", function() {
  if (!referencePreviewMachineId) return;
  referencePreviewMachineId = "";
  renderMonitoringCards();
});

document.addEventListener("pointermove", function(event) {
  if (!referencePreviewMachineId) return;
  var hoveredButton = document.elementFromPoint(event.clientX, event.clientY);
  hoveredButton = hoveredButton && hoveredButton.closest(".reference-button");
  if (hoveredButton && hoveredButton.dataset.machineId === referencePreviewMachineId) return;
  referencePreviewMachineId = "";
  renderMonitoringCards();
});

monitoringCards.addEventListener("contextmenu", function(event) {
  var button = event.target.closest(".reference-button");
  if (!button) return;
  event.preventDefault();
  referenceContextMachineId = button.dataset.machineId;
  referenceContextMenu.style.left = Math.min(event.clientX, window.innerWidth - 170) + "px";
  referenceContextMenu.style.top = Math.min(event.clientY, window.innerHeight - 60) + "px";
  referenceContextMenu.hidden = false;
});

setReferenceMenuItem.addEventListener("click", function() {
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

initializeApplication();
setupRestRefresh();
setupWebSocket();
