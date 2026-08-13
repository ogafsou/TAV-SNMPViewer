var mapMonitoringMaps = [];
var mapMonitoringGrid = document.getElementById("mapMonitoringGrid");
var mapMonitoringEmpty = document.getElementById("mapMonitoringEmpty");
var mapMonitoringCount = document.getElementById("mapMonitoringCount");
var mapMonitoringDialog = document.getElementById("mapMonitoringDialog");
var mapMonitoringDialogTitle = document.getElementById("mapMonitoringDialogTitle");
var mapMonitoringDialogStage = document.getElementById("mapMonitoringDialogStage");
var closeMapMonitoringDialog = document.getElementById("closeMapMonitoringDialog");
var configureMapMonitoringDialog = document.getElementById("configureMapMonitoringDialog");
var resetMapMonitoringViewButton = document.getElementById("resetMapMonitoringViewButton");
var mapReferenceContextMenu = document.getElementById("mapReferenceContextMenu");
var setMapReferenceMenuItem = document.getElementById("setMapReferenceMenuItem");
var mapReferencePreviewId = "";
var mapReferenceContextId = "";
var mapMonitoringDialogZoom = 1;
var mapMonitoringDialogPanX = 0;
var mapMonitoringDialogPanY = 0;
var mapMonitoringDialogPanGesture = null;

function mapMonitoringViewIsInitial() {
  return Math.abs(mapMonitoringDialogZoom - 1) < 0.001 &&
    Math.abs(mapMonitoringDialogPanX) < 0.5 && Math.abs(mapMonitoringDialogPanY) < 0.5;
}

function applyMapMonitoringDialogTransform() {
  var canvas = mapMonitoringDialogStage && mapMonitoringDialogStage.querySelector(".map-monitoring-canvas");
  if (canvas) {
    canvas.style.transform = "translate(" + mapMonitoringDialogPanX + "px, " + mapMonitoringDialogPanY + "px) scale(" + mapMonitoringDialogZoom + ")";
  }
  if (resetMapMonitoringViewButton) resetMapMonitoringViewButton.hidden = mapMonitoringViewIsInitial();
}

function resetMapMonitoringDialogTransform() {
  mapMonitoringDialogZoom = 1;
  mapMonitoringDialogPanX = 0;
  mapMonitoringDialogPanY = 0;
  mapMonitoringDialogPanGesture = null;
  if (mapMonitoringDialogStage) mapMonitoringDialogStage.classList.remove("panning");
  applyMapMonitoringDialogTransform();
}

function mapMonitoringDialogMaximumZoom() {
  var canvas = mapMonitoringDialogStage && mapMonitoringDialogStage.querySelector(".map-monitoring-canvas");
  var image = canvas && canvas.querySelector("img");
  if (!canvas || !image || !image.naturalWidth || !canvas.clientWidth) return 1;
  return Math.max(1, Math.min(image.naturalWidth / canvas.clientWidth, image.naturalHeight / canvas.clientHeight));
}

function zoomMapMonitoringDialogAt(nextZoom, cursorX, cursorY) {
  var canvas = mapMonitoringDialogStage && mapMonitoringDialogStage.querySelector(".map-monitoring-canvas");
  if (!canvas) return;
  var baseX = (mapMonitoringDialogStage.clientWidth - canvas.offsetWidth) / 2;
  var baseY = (mapMonitoringDialogStage.clientHeight - canvas.offsetHeight) / 2;
  var localX = cursorX - baseX;
  var localY = cursorY - baseY;
  var contentX = (localX - mapMonitoringDialogPanX) / mapMonitoringDialogZoom;
  var contentY = (localY - mapMonitoringDialogPanY) / mapMonitoringDialogZoom;
  mapMonitoringDialogPanX = localX - contentX * nextZoom;
  mapMonitoringDialogPanY = localY - contentY * nextZoom;
  mapMonitoringDialogZoom = nextZoom;
  applyMapMonitoringDialogTransform();
}

function mapMonitoringAssignmentIsOk(assignment, referenceOutputs) {
  if (referenceOutputs) {
    var reference = referenceOutputs.find(function(output) {
      return mapMonitoringOutputKey(output) === mapMonitoringOutputKey(assignment);
    });
    return !!reference && reference.ok === true;
  }
  var state = monitoringState[assignment.machineId];
  if (!state || state.connected !== true) return false;
  var card = (state.outputTables || []).find(function(item) {
    return String(item.label) === String(assignment.cardId);
  });
  if (!card) return false;
  var output = (card.ports || []).find(function(item) {
    return String(item.label) === String(assignment.outputId);
  });
  return !!output && (output.state === "ok" || output.ok === true);
}

function mapMonitoringOutputKey(output) {
  return [output.machineId, output.cardId, output.outputId].map(String).join("|");
}

function mapMonitoringCurrentOutputs(map) {
  var outputs = [];
  (map.segments || []).forEach(function(segment) {
    (segment.assignments || []).forEach(function(assignment) {
      if (!assignment) return;
      outputs.push({
        machineId: String(assignment.machineId),
        cardId: String(assignment.cardId),
        outputId: String(assignment.outputId),
        ok: mapMonitoringAssignmentIsOk(assignment)
      });
    });
  });
  return outputs.sort(function(left, right) {
    return mapMonitoringOutputKey(left).localeCompare(mapMonitoringOutputKey(right));
  });
}

function mapMonitoringOutputsMatch(current, expected) {
  var reference = (expected || []).slice().sort(function(left, right) {
    return mapMonitoringOutputKey(left).localeCompare(mapMonitoringOutputKey(right));
  });
  return current.length === reference.length && current.every(function(output, index) {
    return mapMonitoringOutputKey(output) === mapMonitoringOutputKey(reference[index]) &&
      output.ok === (reference[index].ok === true);
  });
}

function mapMonitoringStatus(map) {
  var outputs = mapMonitoringCurrentOutputs(map);
  if (!outputs.length) return { state: "neutral", label: "Sans affectation", title: "Aucune sortie affectée" };
  if (!REFERENCE_MODE_ENABLED) {
    var errors = outputs.filter(function(output) { return !output.ok; }).length;
    return errors
      ? { state: "warning", label: errors + " sortie" + (errors > 1 ? "s" : "") + " en erreur", title: "Mode référence désactivé" }
      : { state: "ok", label: "Toutes les sorties sont OK", title: "Mode référence désactivé" };
  }
  if (!map.monitoringReference) {
    return { state: "neutral", label: "Référence non définie", title: "Cliquer sur Set Reference pour mémoriser cet état" };
  }
  var same = mapMonitoringOutputsMatch(outputs, map.monitoringReference.outputs);
  var date = map.monitoringReference.setAt ? formatDate(map.monitoringReference.setAt) : "date inconnue";
  return {
    state: same ? "ok" : "warning",
    label: same ? "Conforme à la référence" : "Différence avec la référence",
    title: "Référence du " + date + " - Clic droit pour la modifier"
  };
}

function createMapMonitoringStage(map, large, referenceOutputs) {
  var stage = document.createElement("div");
  stage.className = "map-monitoring-stage" + (large ? " map-monitoring-stage-large" : "");
  var canvas = document.createElement("div");
  canvas.className = "map-monitoring-canvas";
  stage.appendChild(canvas);
  if (map.backgroundUrl) {
    var image = document.createElement("img");
    image.src = map.backgroundUrl;
    image.alt = "";
    image.addEventListener("load", function() {
      fitMapMonitoringCanvas(stage, image.naturalWidth, image.naturalHeight);
    });
    canvas.appendChild(image);
  } else {
    var placeholder = document.createElement("span");
    placeholder.className = "map-monitoring-placeholder";
    placeholder.textContent = "Aucun background";
    canvas.appendChild(placeholder);
  }
  (map.segments || []).forEach(function(segment) {
    var node = document.createElement("div");
    node.className = "map-monitoring-segment " + segment.orientation;
    node.style.left = (segment.x * 100) + "%";
    node.style.top = (segment.y * 100) + "%";
    node.dataset.length = String(segment.length || 0);
    node.dataset.cases = String(segment.cases || 1);
    if (segment.orientation === "horizontal") node.style.width = (segment.length * 100) + "%";
    else node.style.height = (segment.length * 100) + "%";
    for (var index = 0; index < segment.cases; index += 1) {
      var cell = document.createElement("i");
      var assignment = segment.assignments && segment.assignments[index];
      cell.className = assignment
        ? "assigned " + (mapMonitoringAssignmentIsOk(assignment, referenceOutputs) ? "output-ok" : "output-not-ok")
        : "output-unassigned";
      if (assignment) {
        var assignedMachine = machines.find(function(machine) {
          return String(machine.id) === String(assignment.machineId);
        });
        if (assignedMachine && /^#[0-9a-f]{6}$/i.test(assignedMachine.color || "")) {
          cell.style.setProperty("--assigned-novastar-color", assignedMachine.color);
        }
        cell.dataset.machineId = String(assignment.machineId);
        cell.dataset.cardId = String(assignment.cardId);
        cell.dataset.outputId = String(assignment.outputId);
        cell.title = [assignment.machineName || assignment.machineId, assignment.cardId, assignment.outputId].join(" - ");
      }
      node.appendChild(cell);
    }
    canvas.appendChild(node);
  });
  window.requestAnimationFrame(function() {
    fitMapMonitoringCanvas(stage);
    sizeMapMonitoringSegments(stage);
  });
  return stage;
}

function fitMapMonitoringCanvas(stage, naturalWidth, naturalHeight) {
  var canvas = stage && stage.querySelector(".map-monitoring-canvas");
  if (!canvas || !stage.clientWidth || !stage.clientHeight) return;
  var image = canvas.querySelector("img");
  var width = naturalWidth || (image && image.naturalWidth);
  var height = naturalHeight || (image && image.naturalHeight);
  var availableWidth = Math.max(1, stage.clientWidth - 16);
  var availableHeight = Math.max(1, stage.clientHeight - 16);
  if (!width || !height) {
    canvas.style.width = availableWidth + "px";
    canvas.style.height = availableHeight + "px";
  } else {
    var scale = Math.min(availableWidth / width, availableHeight / height);
    canvas.style.width = Math.floor(width * scale) + "px";
    canvas.style.height = Math.floor(height * scale) + "px";
  }
  sizeMapMonitoringSegments(stage);
  if (stage === mapMonitoringDialogStage) {
    var maximumZoom = mapMonitoringDialogMaximumZoom();
    if (mapMonitoringDialogZoom > maximumZoom) {
      zoomMapMonitoringDialogAt(maximumZoom, stage.clientWidth / 2, stage.clientHeight / 2);
    } else {
      applyMapMonitoringDialogTransform();
    }
  }
}

function sizeMapMonitoringSegments(stage) {
  var canvas = stage && stage.querySelector(".map-monitoring-canvas");
  if (!canvas || !canvas.clientWidth || !canvas.clientHeight) return;
  stage.querySelectorAll(".map-monitoring-segment").forEach(function(segment) {
    var length = Number(segment.dataset.length) || 0;
    var cases = Math.max(1, Number(segment.dataset.cases) || 1);
    var axis = segment.classList.contains("horizontal") ? canvas.clientWidth : canvas.clientHeight;
    segment.style.setProperty("--monitoring-segment-thickness", Math.max(1, length * axis / cases) + "px");
  });
}

function renderMapMonitoringCards() {
  if (!mapMonitoringGrid) return;
  mapMonitoringGrid.innerHTML = "";
  mapMonitoringCount.textContent = mapMonitoringMaps.length + " map" + (mapMonitoringMaps.length > 1 ? "s" : "");
  mapMonitoringEmpty.hidden = mapMonitoringMaps.length !== 0;
  mapMonitoringMaps.forEach(function(map) {
    var status = mapMonitoringStatus(map);
    var previewingReference = mapReferencePreviewId === map.id && !!map.monitoringReference;
    var card = document.createElement("article");
    card.tabIndex = 0;
    card.className = "map-monitoring-card " + (previewingReference ? "ok reference-preview" : status.state);
    card.dataset.mapId = map.id;
    var heading = document.createElement("span");
    heading.className = "map-monitoring-card-head";
    var name = document.createElement("strong");
    name.textContent = map.name;
    var state = document.createElement("span");
    state.className = "map-monitoring-card-status";
    state.textContent = previewingReference ? "État de référence" : status.label;
    state.title = status.title;
    var actions = document.createElement("span");
    actions.className = "map-monitoring-card-actions";
    if (REFERENCE_MODE_ENABLED) {
      var referenceButton = document.createElement("button");
      referenceButton.type = "button";
      referenceButton.className = "reference-button map-reference-button";
      referenceButton.dataset.mapReference = map.id;
      referenceButton.textContent = map.monitoringReference ? "Reference" : "Set Reference";
      referenceButton.title = status.title;
      actions.appendChild(referenceButton);
    }
    heading.appendChild(name);
    heading.appendChild(state);
    heading.appendChild(actions);
    card.appendChild(heading);
    card.appendChild(createMapMonitoringStage(map, false, previewingReference ? map.monitoringReference.outputs : null));
    mapMonitoringGrid.appendChild(card);
  });
}

function openMapMonitoring(mapId) {
  var map = mapMonitoringMaps.find(function(item) { return String(item.id) === String(mapId); });
  if (!map) return;
  mapMonitoringDialogTitle.textContent = map.name;
  if (configureMapMonitoringDialog) {
    configureMapMonitoringDialog.href = "/monitoring-maps?mapId=" + encodeURIComponent(map.id);
  }
  mapMonitoringDialogStage.replaceWith(createMapMonitoringStage(map, true, null));
  mapMonitoringDialogStage = mapMonitoringDialog.querySelector(".map-monitoring-stage");
  mapMonitoringDialogStage.id = "mapMonitoringDialogStage";
  resetMapMonitoringDialogTransform();
  mapMonitoringDialog.showModal();
  window.requestAnimationFrame(function() { sizeMapMonitoringSegments(mapMonitoringDialogStage); });
}

async function setMapMonitoringReference(mapId) {
  var map = mapMonitoringMaps.find(function(item) { return String(item.id) === String(mapId); });
  if (!map || !REFERENCE_MODE_ENABLED) return;
  var response = await fetch("/api/maps/" + encodeURIComponent(map.id) + "/reference", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outputs: mapMonitoringCurrentOutputs(map) })
  });
  var result = await response.json();
  if (!response.ok) {
    setStatus(result.error || "Enregistrement de la référence impossible", "error");
    return;
  }
  mapMonitoringMaps = mapMonitoringMaps.map(function(item) { return item.id === map.id ? result.map : item; });
  mapReferencePreviewId = "";
  renderMapMonitoringCards();
  setStatus("Référence de la map enregistrée", "ok");
}

async function initializeMapMonitoring() {
  if (!mapMonitoringGrid) return;
  var response = await fetch("/api/maps");
  var result = await response.json();
  if (!response.ok) {
    setStatus(result.error || "Chargement des maps impossible", "error");
    return;
  }
  mapMonitoringMaps = Array.isArray(result) ? result : [];
  renderMapMonitoringCards();
}

if (mapMonitoringGrid) {
  mapMonitoringGrid.addEventListener("click", function(event) {
    var referenceButton = event.target.closest(".map-reference-button");
    if (referenceButton) {
      event.stopPropagation();
      var map = mapMonitoringMaps.find(function(item) { return item.id === referenceButton.dataset.mapReference; });
      if (map && !map.monitoringReference) setMapMonitoringReference(map.id);
      return;
    }
    var card = event.target.closest(".map-monitoring-card");
    if (card) openMapMonitoring(card.dataset.mapId);
  });
  mapMonitoringGrid.addEventListener("keydown", function(event) {
    var card = event.target.closest(".map-monitoring-card");
    if (card && event.target === card && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      openMapMonitoring(card.dataset.mapId);
    }
  });
  mapMonitoringGrid.addEventListener("pointerdown", function(event) {
    var button = event.target.closest(".map-reference-button");
    var map = button && mapMonitoringMaps.find(function(item) { return item.id === button.dataset.mapReference; });
    if (!button || event.button !== 0 || !map || !map.monitoringReference) return;
    event.stopPropagation();
    mapReferencePreviewId = map.id;
    renderMapMonitoringCards();
  });
  mapMonitoringGrid.addEventListener("contextmenu", function(event) {
    var button = event.target.closest(".map-reference-button");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    mapReferenceContextId = button.dataset.mapReference;
    mapReferenceContextMenu.style.left = Math.min(event.clientX, window.innerWidth - 170) + "px";
    mapReferenceContextMenu.style.top = Math.min(event.clientY, window.innerHeight - 60) + "px";
    mapReferenceContextMenu.hidden = false;
  });
  document.addEventListener("pointerup", function() {
    if (!mapReferencePreviewId) return;
    mapReferencePreviewId = "";
    renderMapMonitoringCards();
  });
  document.addEventListener("pointermove", function(event) {
    if (!mapReferencePreviewId) return;
    var hovered = document.elementFromPoint(event.clientX, event.clientY);
    hovered = hovered && hovered.closest(".map-reference-button");
    if (hovered && hovered.dataset.mapReference === mapReferencePreviewId) return;
    mapReferencePreviewId = "";
    renderMapMonitoringCards();
  });
  setMapReferenceMenuItem.addEventListener("click", function() {
    var map = mapMonitoringMaps.find(function(item) { return item.id === mapReferenceContextId; });
    mapReferenceContextMenu.hidden = true;
    if (!map) return;
    if (!window.confirm("Remplacer la référence de " + map.name + " par l’état actuel de ses sorties ?")) return;
    setMapMonitoringReference(map.id);
  });
  document.addEventListener("click", function(event) {
    if (!mapReferenceContextMenu.hidden && !mapReferenceContextMenu.contains(event.target)) {
      mapReferenceContextMenu.hidden = true;
    }
  });
  closeMapMonitoringDialog.addEventListener("click", function() { mapMonitoringDialog.close(); });
  if (resetMapMonitoringViewButton) {
    resetMapMonitoringViewButton.addEventListener("click", resetMapMonitoringDialogTransform);
  }
  mapMonitoringDialog.addEventListener("pointerdown", function(event) {
    var stage = event.target.closest(".map-monitoring-stage-large");
    if (!stage || event.target.closest(".map-monitoring-segment")) return;
    if (event.button !== 0 && event.button !== 2) return;
    mapMonitoringDialogPanGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originalPanX: mapMonitoringDialogPanX,
      originalPanY: mapMonitoringDialogPanY
    };
    stage.classList.add("panning");
    stage.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  mapMonitoringDialog.addEventListener("pointermove", function(event) {
    if (!mapMonitoringDialogPanGesture || event.pointerId !== mapMonitoringDialogPanGesture.pointerId) return;
    mapMonitoringDialogPanX = mapMonitoringDialogPanGesture.originalPanX + event.clientX - mapMonitoringDialogPanGesture.startX;
    mapMonitoringDialogPanY = mapMonitoringDialogPanGesture.originalPanY + event.clientY - mapMonitoringDialogPanGesture.startY;
    applyMapMonitoringDialogTransform();
    event.preventDefault();
  });
  function finishMapMonitoringPan(event) {
    if (!mapMonitoringDialogPanGesture || event.pointerId !== mapMonitoringDialogPanGesture.pointerId) return;
    mapMonitoringDialogPanGesture = null;
    if (mapMonitoringDialogStage) mapMonitoringDialogStage.classList.remove("panning");
  }
  mapMonitoringDialog.addEventListener("pointerup", finishMapMonitoringPan);
  mapMonitoringDialog.addEventListener("pointercancel", finishMapMonitoringPan);
  mapMonitoringDialog.addEventListener("wheel", function(event) {
    var stage = event.target.closest(".map-monitoring-stage-large");
    if (!stage) return;
    event.preventDefault();
    var rect = stage.getBoundingClientRect();
    var factor = Math.exp(-event.deltaY * 0.0015);
    var nextZoom = Math.min(mapMonitoringDialogMaximumZoom(), Math.max(1, mapMonitoringDialogZoom * factor));
    if (Math.abs(nextZoom - mapMonitoringDialogZoom) < 0.001) return;
    zoomMapMonitoringDialogAt(nextZoom, event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });
  mapMonitoringDialog.addEventListener("contextmenu", function(event) {
    if (event.target.closest(".map-monitoring-stage-large") && !event.target.closest(".map-monitoring-segment")) event.preventDefault();
  });
  mapMonitoringDialog.addEventListener("click", function(event) {
    var outputCell = event.target.closest(".map-monitoring-stage-large .map-monitoring-segment i[data-machine-id]");
    if (outputCell) {
      event.stopPropagation();
      if (typeof openMapAssignmentMonitoring === "function") {
        openMapAssignmentMonitoring({
          machineId: outputCell.dataset.machineId,
          cardId: outputCell.dataset.cardId,
          outputId: outputCell.dataset.outputId
        });
      }
      return;
    }
    if (event.target === mapMonitoringDialog) mapMonitoringDialog.close();
  });
  window.addEventListener("resize", function() {
    document.querySelectorAll(".map-monitoring-stage").forEach(function(stage) {
      fitMapMonitoringCanvas(stage);
    });
  });
}
