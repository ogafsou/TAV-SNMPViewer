function openAddDialog() {
  editingMachineId = "";
  dialogTitle.textContent = "Ajouter une machine";
  machineForm.reset();
  machineForm.elements.type.value = "novastar-h";
  machineForm.host.value = "192.168.1.10";
  machineForm.readCommunity.value = "public";
  machineForm.writeCommunity.value = "private";
  machineForm.readCommunity.placeholder = "";
  machineForm.writeCommunity.placeholder = "";
  machineForm.timeout.value = "2000";
  machineForm.retries.value = "1";
  machineForm.apiBaseUrl.value = "";
  machineForm.apiProtocol.value = "openapi";
  machineForm.apiUsername.value = "admin";
  machineForm.apiPassword.value = "admin";
  machineForm.apiPassword.placeholder = "";
  machineForm.apiDeviceId.value = "0";
  machineForm.apiProjectId.value = "";
  machineForm.apiSecretKey.value = "";
  machineForm.apiSecretKey.placeholder = "";
  machineForm.apiEncryption.checked = false;
  machineForm.recvCardsPerPort.value = "1";
  machineForm.includePoe.checked = false;
  machineForm.kiloviewBitrateThresholdMbps.value = "1";
  machineForm.snmpPort.value = "161";
  setAccessMethod("snmp");
  updateMachineFormFields();
  dialogBackdrop.hidden = false;
  machineForm.name.focus();
}

function openEditDialog(machine) {
  editingMachineId = machine.id;
  dialogTitle.textContent = "Modifier une machine";
  machineForm.reset();
  machineForm.elements.type.value = normalizeMachineType(machine.type);
  machineForm.name.value = machine.name || "";
  machineForm.host.value = machine.host || "";
  setAccessMethod(machine.accessMethod || "snmp");
  machineForm.readCommunity.value = "";
  machineForm.writeCommunity.value = "";
  machineForm.readCommunity.placeholder = machine.readCommunityConfigured ? "Configuree - laisser vide pour conserver" : "public";
  machineForm.writeCommunity.placeholder = machine.writeCommunityConfigured ? "Configuree - laisser vide pour conserver" : "private";
  machineForm.timeout.value = machine.timeout || "2000";
  machineForm.retries.value = machine.retries || "1";
  machineForm.apiProtocol.value = machine.apiProtocol || (machine.apiProjectId ? "openapi" : "legacy");
  machineForm.apiBaseUrl.value = machine.apiBaseUrl || "";
  machineForm.apiUsername.value = machine.apiUsername || "admin";
  machineForm.apiPassword.value = "";
  machineForm.apiPassword.placeholder = machine.apiPasswordConfigured ? "Configure - laisser vide pour conserver" : "";
  machineForm.apiDeviceId.value = machine.apiDeviceId || "0";
  machineForm.apiProjectId.value = machine.apiProjectId || "";
  machineForm.apiSecretKey.value = "";
  machineForm.apiSecretKey.placeholder = machine.apiSecretKeyConfigured ? "Configuree - laisser vide pour conserver" : "";
  machineForm.apiEncryption.checked = machine.apiEncryption === true;
  machineForm.maxInputSlots.value = machine.maxInputSlots || machine.maxOutputSlots || "";
  machineForm.maxScreens.value = machine.maxScreens || "";
  machineForm.recvCardsPerPort.value = machine.recvCardsPerPort || "1";
  machineForm.includeReceivingCards.checked = !!machine.includeReceivingCards;
  machineForm.includePoe.checked = machine.includePoe === true;
  machineForm.kiloviewBitrateThresholdMbps.value = machine.kiloviewBitrateThresholdMbps === undefined ? "1" : String(machine.kiloviewBitrateThresholdMbps);
  machineForm.snmpPort.value = machine.snmpPort || "161";
  updateMachineFormFields();
  dialogBackdrop.hidden = false;
  machineForm.name.focus();
}

function closeDialog() {
  dialogBackdrop.hidden = true;
  editingMachineId = "";
}

function renderMachines() {
  machineCount.textContent = String(machines.length);
  machineList.innerHTML = machines.map(function(machine) {
    var source = accessMethodLabel(machine.accessMethod);
    var type = machineTypeLabel(machine.type);
    return '<option value="' + escapeHtml(machine.id) + '">' +
      escapeHtml(machine.name + " - " + type + (normalizeMachineType(machine.type) === "novastar-h" ? " - " + source : "") + " - " + machine.host) +
    "</option>";
  }).join("");

  if (machines.length && !machines.some(function(machine) { return machine.id === selectedMachineId; })) {
    selectedMachineId = machines[0].id;
    localStorage.setItem("novastarSelectedMachineId", selectedMachineId);
  }

  machineList.value = selectedMachineId;
}

async function deleteMachine(machineId) {
  var previousMachines = machines.slice();
  var previousSelectedMachineId = selectedMachineId;

  machines = machines.filter(function(machine) {
    return machine.id !== machineId;
  });

  if (selectedMachineId === machineId) {
    selectedMachineId = machines.length ? machines[0].id : "";
    localStorage.setItem("novastarSelectedMachineId", selectedMachineId);
    resetScanResults();
  }

  try {
    var response = await fetch("/api/machines/" + encodeURIComponent(machineId), { method: "DELETE" });
    if (!response.ok) {
      var result = await response.json();
      throw new Error(result.error || "Suppression impossible");
    }
    renderMachines();
    renderSelectedMachine();
    delete monitoringRecords[machineId];
    delete monitoringState[machineId];
    renderMonitoringCards();
    setStatus("Machine supprimee", "ok");
  } catch (error) {
    machines = previousMachines;
    selectedMachineId = previousSelectedMachineId;
    renderMachines();
    renderSelectedMachine();
    setStatus(error.message || "Suppression impossible", "error");
  }
}

function renderSelectedMachine() {
  var machine = getSelectedMachine();

  if (!machine) {
    selectedMachineName.textContent = "Aucune machine";
    selectedMachineDetails.textContent = "Selectionnez un equipement H dans la liste.";
    selectedMachineHint.textContent = "Ajoutez une machine pour commencer.";
    scanButton.disabled = true;
    return;
  }

  selectedMachineName.textContent = machine.name;
  var type = normalizeMachineType(machine.type);
  if (type === "kiloview") {
    selectedMachineDetails.textContent = "Kiloview | " + machine.host + " | user: " + (machine.apiUsername || "-");
  } else if (type === "netgear-m4300") {
    selectedMachineDetails.textContent = "NETGEAR M4300 | " + machine.host + ":" + (machine.snmpPort || 161) + " | SNMP v2c" + (machine.includePoe ? " | PoE" : "");
  } else if (type === "other") {
    selectedMachineDetails.textContent = "Ping | " + machine.host + " | verification par ping";
  } else if (normalizeAccessMethod(machine.accessMethod) === "api") {
    selectedMachineDetails.textContent = machine.host +
      " | API: " + apiProtocolLabel(machine) +
      (apiProtocolValue(machine) === "openapi" ? " | pId: " + (machine.apiProjectId || "-") : " | user: " + (machine.apiUsername || "admin"));
  } else if (normalizeAccessMethod(machine.accessMethod) === "snmp+api") {
    selectedMachineDetails.textContent = machine.host +
      " | SNMP + " + apiProtocolLabel(machine) + " (priorite SNMP)";
  } else {
    selectedMachineDetails.textContent = machine.host +
      " | lecture: " + machine.readCommunity +
      " | ecriture: " + machine.writeCommunity;
  }
  selectedMachineHint.textContent = "Selection: " + machine.name;
  scanButton.disabled = false;
}

function getSelectedMachine() {
  return getMachineById(selectedMachineId);
}

function getMachineById(machineId) {
  return machines.find(function(machine) {
    return machine.id === machineId;
  });
}

function openContextMenu(x, y) {
  contextMenu.hidden = false;

  var menuWidth = contextMenu.offsetWidth;
  var menuHeight = contextMenu.offsetHeight;
  var left = Math.min(x, window.innerWidth - menuWidth - 8);
  var top = Math.min(y, window.innerHeight - menuHeight - 8);

  contextMenu.style.left = Math.max(8, left) + "px";
  contextMenu.style.top = Math.max(8, top) + "px";
}

function closeContextMenu() {
  contextMenu.hidden = true;
  contextMachineId = "";
}

function setAccessMethod(value) {
  var method = normalizeAccessMethod(value);
  document.querySelectorAll('input[name="accessMethod"]').forEach(function(accessInput) {
    accessInput.checked = accessInput.value === method;
  });
}

function getSelectedAccessMethod() {
  var selected = machineForm.querySelector('input[name="accessMethod"]:checked');
  return normalizeAccessMethod(selected && selected.value);
}

function updateAccessModeFields() {
  updateMachineFormFields();
}

function updateMachineFormFields() {
  var type = normalizeMachineType(machineForm.elements.type.value);
  var method = getSelectedAccessMethod();
  var isNovaStar = type === "novastar-h";
  var isKiloview = type === "kiloview";
  var isNetgear = type === "netgear-m4300";
  var isSnmpDevice = isNovaStar || isNetgear;
  var apiEnabled = isNovaStar && method !== "snmp";
  var apiProtocol = machineForm.apiProtocol.value === "legacy" ? "legacy" : "openapi";

  document.querySelectorAll(".novastar-only").forEach(function(node) {
    node.hidden = !isNovaStar;
  });
  document.querySelectorAll(".snmp-field").forEach(function(node) {
    node.hidden = !isSnmpDevice || (isNovaStar && method === "api") || (node.classList.contains("novastar-only") && !isNovaStar);
  });
  document.querySelectorAll(".snmp-device-settings").forEach(function(node) { node.hidden = !isSnmpDevice; });
  document.querySelectorAll(".netgear-only").forEach(function(node) { node.hidden = !isNetgear; });
  document.querySelectorAll(".kiloview-only").forEach(function(node) { node.hidden = !isKiloview; });
  document.querySelectorAll(".api-field").forEach(function(node) {
    node.hidden = isNovaStar ? method === "snmp" : !isKiloview;
  });
  document.querySelectorAll(".novastar-api-protocol").forEach(function(node) { node.hidden = !apiEnabled; });
  document.querySelectorAll(".legacy-api-field").forEach(function(node) { node.hidden = !(isKiloview || (apiEnabled && apiProtocol === "legacy")); });
  document.querySelectorAll(".openapi-api-field").forEach(function(node) { node.hidden = !(apiEnabled && apiProtocol === "openapi"); });

  var credentialsRow = machineForm.querySelector(".credentials-row");
  credentialsRow.classList.toggle("reserve-space", isNovaStar);

  machineForm.apiBaseUrl.placeholder = apiProtocol === "openapi"
    ? "Automatique: http://IP:8000/open/api"
    : "Automatique: http://IP";
}

function resetScanResults() {
  document.getElementById("summaryGrid").innerHTML = '<div class="notice neutral">Lancez un scan pour lire la machine selectionnee.</div>';
  document.getElementById("lastScan").textContent = "Aucun scan";
  document.getElementById("slotCount").textContent = "0 slot";
  document.getElementById("screenCount").textContent = "0 ecran";
  document.getElementById("portCount").textContent = "0 port";
  document.getElementById("cardCount").textContent = "Optionnel";
  document.getElementById("controllerGrid").innerHTML = "";
  ["systemHealthSection", "mvrSection", "mvrVideoSection", "usbSection", "fansSection", "powerSection"].forEach(function(id) {
    document.getElementById(id).hidden = true;
  });
  document.getElementById("slotsTable").innerHTML = '<tr><td colspan="6" class="empty">Lancez un scan pour lire les slots d\'entree.</td></tr>';
  document.getElementById("screensTable").innerHTML = '<tr><td colspan="6" class="empty">Lancez un scan pour lire les ecrans.</td></tr>';
  document.getElementById("portsTable").innerHTML = '<tr><td colspan="6" class="empty">Aucun port de sortie retourne.</td></tr>';
  document.getElementById("cardsTable").innerHTML = '<tr><td colspan="8" class="empty">Activez la lecture receiving cards dans la configuration machine.</td></tr>';
}
