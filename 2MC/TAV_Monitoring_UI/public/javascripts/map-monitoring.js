var mapMonitoringMaps = [];
var mapMonitoringGrid = document.getElementById("mapMonitoringGrid");
var mapMonitoringEmpty = document.getElementById("mapMonitoringEmpty");
var mapMonitoringCount = document.getElementById("mapMonitoringCount");
var mapMonitoringDialog = document.getElementById("mapMonitoringDialog");
var mapMonitoringDialogTitle = document.getElementById("mapMonitoringDialogTitle");
var mapMonitoringDialogStage = document.getElementById("mapMonitoringDialogStage");
var closeMapMonitoringDialog = document.getElementById("closeMapMonitoringDialog");

function mapMonitoringAssignmentIsOk(assignment) {
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

function mapMonitoringStatus(map) {
  var assigned = [];
  (map.segments || []).forEach(function(segment) {
    (segment.assignments || []).forEach(function(assignment) {
      if (assignment) assigned.push(assignment);
    });
  });
  if (!assigned.length) return { state: "neutral", label: "Sans affectation" };
  var errors = assigned.filter(function(assignment) { return !mapMonitoringAssignmentIsOk(assignment); }).length;
  return errors ? { state: "error", label: errors + " sortie" + (errors > 1 ? "s" : "") + " en erreur" } : { state: "ok", label: "Toutes les sorties sont OK" };
}

function createMapMonitoringStage(map, large) {
  var stage = document.createElement("div");
  stage.className = "map-monitoring-stage" + (large ? " map-monitoring-stage-large" : "");
  if (map.backgroundUrl) {
    var image = document.createElement("img");
    image.src = map.backgroundUrl;
    image.alt = "";
    stage.appendChild(image);
  } else {
    var placeholder = document.createElement("span");
    placeholder.className = "map-monitoring-placeholder";
    placeholder.textContent = "Aucun background";
    stage.appendChild(placeholder);
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
        ? (mapMonitoringAssignmentIsOk(assignment) ? "output-ok" : "output-not-ok")
        : "output-unassigned";
      if (assignment) {
        cell.title = [assignment.machineName || assignment.machineId, assignment.cardId, assignment.outputId].join(" - ");
      }
      node.appendChild(cell);
    }
    stage.appendChild(node);
  });
  window.requestAnimationFrame(function() { sizeMapMonitoringSegments(stage); });
  return stage;
}

function sizeMapMonitoringSegments(stage) {
  if (!stage || !stage.clientWidth || !stage.clientHeight) return;
  stage.querySelectorAll(".map-monitoring-segment").forEach(function(segment) {
    var length = Number(segment.dataset.length) || 0;
    var cases = Math.max(1, Number(segment.dataset.cases) || 1);
    var axis = segment.classList.contains("horizontal") ? stage.clientWidth : stage.clientHeight;
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
    var card = document.createElement("button");
    card.type = "button";
    card.className = "map-monitoring-card " + status.state;
    card.dataset.mapId = map.id;
    var heading = document.createElement("span");
    heading.className = "map-monitoring-card-head";
    var name = document.createElement("strong");
    name.textContent = map.name;
    var state = document.createElement("span");
    state.className = "map-monitoring-card-status";
    state.textContent = status.label;
    heading.appendChild(name);
    heading.appendChild(state);
    card.appendChild(heading);
    card.appendChild(createMapMonitoringStage(map, false));
    mapMonitoringGrid.appendChild(card);
  });
}

function openMapMonitoring(mapId) {
  var map = mapMonitoringMaps.find(function(item) { return String(item.id) === String(mapId); });
  if (!map) return;
  mapMonitoringDialogTitle.textContent = map.name;
  mapMonitoringDialogStage.replaceWith(createMapMonitoringStage(map, true));
  mapMonitoringDialogStage = mapMonitoringDialog.querySelector(".map-monitoring-stage");
  mapMonitoringDialogStage.id = "mapMonitoringDialogStage";
  mapMonitoringDialog.showModal();
  window.requestAnimationFrame(function() { sizeMapMonitoringSegments(mapMonitoringDialogStage); });
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
    var card = event.target.closest(".map-monitoring-card");
    if (card) openMapMonitoring(card.dataset.mapId);
  });
  closeMapMonitoringDialog.addEventListener("click", function() { mapMonitoringDialog.close(); });
  mapMonitoringDialog.addEventListener("click", function(event) {
    if (event.target === mapMonitoringDialog) mapMonitoringDialog.close();
  });
  window.addEventListener("resize", function() {
    document.querySelectorAll(".map-monitoring-stage").forEach(sizeMapMonitoringSegments);
  });
}
