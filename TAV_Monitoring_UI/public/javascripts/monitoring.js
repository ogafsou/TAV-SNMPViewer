async function refreshMonitoring(manual) {
  if (!machines.length) {
    setStatus("Aucune machine", "error");
    return;
  }

  if (monitoringRefreshInProgress) {
    return;
  }

  monitoringRefreshInProgress = true;
  refreshMonitoringButton.disabled = true;
  setStatus(manual ? "Monitoring" : "Auto refresh", "busy");

  var refreshSucceeded = false;
  try {
    machines.forEach(function(machine) {
      monitoringState[machine.id] = buildTransientMonitoringState(machine, "pending", "Scan", "Scan en cours");
    });
    renderMonitoringCards();
    var response = await fetch("/api/monitoring/scan", { method: "POST" });
    var snapshot = await response.json();
    if (!response.ok) throw new Error(snapshot.error || "Erreur de scan");
    applyMonitoringSnapshot(snapshot);
    setBackendConnectionStatus(true);
    refreshSucceeded = true;
  } catch (error) {
    setStatus(error.message || "Erreur de scan", "error");
  } finally {
    refreshMonitoringButton.disabled = false;
    monitoringRefreshInProgress = false;
    if (refreshSucceeded) setStatus("Monitoring OK", "ok");
    updateAutoRefreshHint();
  }
}

async function refreshMonitoringCard(cardId) {
  if (!cardId || targetedMonitoringRefreshes[cardId]) return;
  var machineIds = cardId === "__ping__"
    ? machines.filter(function(machine) { return machine.type === "other"; }).map(function(machine) { return machine.id; })
    : [cardId];
  if (!machineIds.length) return;

  targetedMonitoringRefreshes[cardId] = true;
  renderMonitoringCards();
  if (monitoringCardDialog.open && monitoringCardDialog.dataset.machineId === cardId) renderMonitoringCardDialog(cardId, false);
  setStatus(cardId === "__ping__" ? "Ping en cours" : "Scan en cours", "busy");

  try {
    var records = await Promise.all(machineIds.map(async function(machineId) {
      var response = await fetch("/api/machines/" + encodeURIComponent(machineId) + "/scan", { method: "POST" });
      var record = await response.json();
      if (!response.ok) throw new Error(record.error || "Erreur de scan");
      setBackendConnectionStatus(true);
      return record;
    }));
    records.forEach(applyMonitoringRecord);
    setStatus(cardId === "__ping__" ? "Ping terminé" : "Scan terminé", "ok");
  } catch (error) {
    setStatus(error.message || "Erreur de scan", "error");
  } finally {
    delete targetedMonitoringRefreshes[cardId];
    renderMonitoringCards();
    if (monitoringCardDialog.open && monitoringCardDialog.dataset.machineId === cardId) renderMonitoringCardDialog(cardId, false);
  }
}

function activateTab(tabId) {
  activeTabId = tabId;
  document.querySelectorAll(".tab").forEach(function(tabButton) {
    tabButton.classList.toggle("active", tabButton.dataset.tab === tabId);
  });

  document.querySelectorAll(".tab-panel").forEach(function(panel) {
    var active = panel.id === tabId;
    panel.classList.toggle("active", active);
    if (active) {
      panel.removeAttribute("hidden");
    } else {
      panel.setAttribute("hidden", "");
    }
  });

  if (tabId === "monitoringTab") {
    renderMonitoringCards();
    updateAutoRefreshHint();
  } else if (tabId === "configurationTab") {
    resetMachineTypeFilters();
    renderSelectedMachine();
    renderSelectedMachineScanResults();
  }
}

function setupRestRefresh() {
  updateAutoRefreshHint();

  if (AUTOREFRESH_S <= 0) {
    return;
  }

  autoRefreshTimer = window.setInterval(function() {
    syncMonitoringSnapshot();
  }, AUTOREFRESH_S * 1000);
}

function updateAutoRefreshHint() {
  if (!autoRefreshHint) {
    return;
  }

  var refreshText = AUTOREFRESH_S > 0
    ? "Synchronisation REST: " + AUTOREFRESH_S + " s"
    : "Synchronisation REST: desactivee";
  var scanText = BACKEND_MONITOR_INTERVAL_S > 0
    ? " - Scan backend: " + BACKEND_MONITOR_INTERVAL_S + " s"
    : " - Scan backend automatique desactive";
  autoRefreshHint.textContent = refreshText + scanText + (REFERENCE_MODE_ENABLED ? " - Comparaison a la reference" : " - Evaluation des statuts");
}


async function initializeApplication() {
  await loadBackendConfig();
  machines = await loadMachines();
  renderMachines();
  renderSelectedMachine();
  renderMonitoringCards();
  await syncMonitoringSnapshot();
  if (typeof initializeMonitoringMaps === "function") await initializeMonitoringMaps();
}

async function loadBackendConfig() {
  try {
    var response = await fetch("/api/config");
    var backendConfig = await response.json();
    if (!response.ok) throw new Error(backendConfig.error || "Configuration backend indisponible");
    REFERENCE_MODE_ENABLED = backendConfig.monitoring_reference_mode === true;
    PING_MONITORING_REFERENCE = backendConfig.ping_monitoring_reference || null;
    BACKEND_MONITOR_INTERVAL_S = Number(backendConfig.monitor_interval_s) || 0;
    monitorIntervalSeconds.value = String(BACKEND_MONITOR_INTERVAL_S || 30);
    if (monitoringReferenceMode) monitoringReferenceMode.checked = REFERENCE_MODE_ENABLED;
    BACKEND_CONFIG_LOADED = true;
    setBackendConnectionStatus(true);
    updateAutoRefreshHint();
    return true;
  } catch (error) {
    BACKEND_CONFIG_LOADED = false;
    setBackendConnectionStatus(false);
    setStatus("Backend indisponible", "error");
    return false;
  }
}

async function loadMachines() {
  try {
    var response = await fetch("/api/machines");
    var parsed = await response.json();

    if (!response.ok) {
      throw new Error(parsed.error || "Impossible de charger les machines");
    }

    setBackendConnectionStatus(true);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    setBackendConnectionStatus(false);
    setStatus("Chargement impossible", "error");
    return [];
  }
}

async function syncMonitoringSnapshot() {
  try {
    if (!BACKEND_CONFIG_LOADED) await loadBackendConfig();
    var response = await fetch("/api/monitoring");
    var snapshot = await response.json();
    if (!response.ok) throw new Error(snapshot.error || "Monitoring indisponible");
    applyMonitoringSnapshot(snapshot);
    setBackendConnectionStatus(true);
  } catch (error) {
    setBackendConnectionStatus(false);
    setStatus("Synchronisation impossible", "error");
  }
}

function applyMonitoringSnapshot(snapshot) {
  (snapshot.machines || []).forEach(applyMonitoringRecord);
  renderSelectedMachineScanResults();
  renderMonitoringCards();
}

function applyMonitoringRecord(record) {
  if (!record || !record.machineId) return;
  var previous = monitoringRecords[record.machineId];
  if (previous && Number(previous.revision) > Number(record.revision)) return;
  if (record.view && record.view.connected === true && record.raw && !record.raw.error) {
    record.lastSuccessfulRaw = record.raw;
  } else {
    record.lastSuccessfulRaw = previous && (previous.lastSuccessfulRaw ||
      (previous.view && previous.view.connected === true ? previous.raw : null)) || null;
  }
  monitoringRecords[record.machineId] = record;
  monitoringState[record.machineId] = record.view || buildMonitoringState(record.raw || {});
}

function setupWebSocket() {
  var protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  var socket = new WebSocket(protocol + "//" + window.location.host + "/ws");
  socket.addEventListener("message", function(event) {
    try {
      var message = JSON.parse(event.data);
      handleWebSocketMessage(message);
    } catch (error) { setStatus("Message WebSocket invalide", "error"); }
  });
  socket.addEventListener("open", function() { setBackendConnectionStatus(true); });
  socket.addEventListener("close", function() {
    verifyBackendConnection();
    window.setTimeout(setupWebSocket, 3000);
  });
}

async function verifyBackendConnection() {
  try {
    var response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) throw new Error("Backend indisponible");
    setBackendConnectionStatus(true);
    return true;
  } catch (_) {
    setBackendConnectionStatus(false);
    return false;
  }
}

function handleWebSocketMessage(message) {
  if (message.type === "monitoring.snapshot") {
    applyMonitoringSnapshot(message);
    return;
  }
  if (message.type === "monitoring.initialized" || message.type === "monitoring.changed") {
    applyMonitoringRecord(message.monitoring);
    renderMonitoringCards();
    return;
  }
  if (message.type === "telemetry.patch") {
    var record = monitoringRecords[message.machineId];
    if (!record || Number(record.revision) > Number(message.revision)) return;
    Object.keys(message.changes || {}).forEach(function(path) { setObjectPath(record.raw, path, message.changes[path]); });
    record.revision = message.revision;
    record.timestamp = message.timestamp;
    if (monitoringState[message.machineId] && message.message) monitoringState[message.machineId].message = message.message;
    if (selectedMachineId === message.machineId && record.raw) renderMonitor(record.raw, record);
    renderMonitoringCards();
    return;
  }
  if (message.type === "machine.deleted") {
    delete monitoringRecords[message.machineId];
    delete monitoringState[message.machineId];
    renderMonitoringCards();
  }
}

function setObjectPath(target, path, value) {
  var keys = String(path).split(".");
  var node = target;
  keys.forEach(function(key, index) {
    if (index === keys.length - 1) {
      if (value === null) delete node[key]; else node[key] = value;
    } else {
      if (!node[key] || typeof node[key] !== "object") node[key] = /^\d+$/.test(keys[index + 1]) ? [] : {};
      node = node[key];
    }
  });
}
