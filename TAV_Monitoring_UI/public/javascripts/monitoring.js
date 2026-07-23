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
  await initializeMonitoringMaps();
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
    monitoringReferenceMode.checked = REFERENCE_MODE_ENABLED;
    updateAutoRefreshHint();
  } catch (error) {
    setStatus("Backend indisponible", "error");
  }
}

async function loadMachines() {
  try {
    var response = await fetch("/api/machines");
    var parsed = await response.json();

    if (!response.ok) {
      throw new Error(parsed.error || "Impossible de charger les machines");
    }

    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    setStatus("Chargement impossible", "error");
    return [];
  }
}

async function syncMonitoringSnapshot() {
  try {
    var response = await fetch("/api/monitoring");
    var snapshot = await response.json();
    if (!response.ok) throw new Error(snapshot.error || "Monitoring indisponible");
    applyMonitoringSnapshot(snapshot);
  } catch (error) {
    setStatus("Synchronisation impossible", "error");
  }
}

function applyMonitoringSnapshot(snapshot) {
  (snapshot.machines || []).forEach(applyMonitoringRecord);
  renderMonitoringCards();
}

function applyMonitoringRecord(record) {
  if (!record || !record.machineId) return;
  var previous = monitoringRecords[record.machineId];
  if (previous && Number(previous.revision) > Number(record.revision)) return;
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
  socket.addEventListener("open", function() { setStatus("Temps reel connecte", "ok"); });
  socket.addEventListener("close", function() {
    setStatus("Temps reel deconnecte", "error");
    window.setTimeout(setupWebSocket, 3000);
  });
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
    if (selectedMachineId === message.machineId && record.raw) renderMonitor(record.raw);
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
