var monitoringMaps = [];
var selectedMapId = localStorage.getItem("tavSelectedMapId") || "";
var editedMapId = "";
var contextMapId = "";
var mapCount = document.getElementById("mapCount");
var mapList = document.getElementById("mapList");
var mapListHint = document.getElementById("mapListHint");
var selectedMapName = document.getElementById("selectedMapName");
var addMapButton = document.getElementById("addMapButton");
var mapContextMenu = document.getElementById("mapContextMenu");
var editMapButton = document.getElementById("editMapButton");
var deleteMapButton = document.getElementById("deleteMapButton");
var mapDialog = document.getElementById("mapDialog");
var mapDialogTitle = document.getElementById("mapDialogTitle");
var mapForm = document.getElementById("mapForm");
var cancelMapButton = document.getElementById("cancelMapButton");
var mapEditMode = document.getElementById("mapEditMode");
var loadMapBackgroundButton = document.getElementById("loadMapBackgroundButton");
var mapBackgroundFile = document.getElementById("mapBackgroundFile");
var mapBackgroundImage = document.getElementById("mapBackgroundImage");
var mapZonePlaceholder = document.getElementById("mapZonePlaceholder");
var mapZone = document.getElementById("mapZone");
var mapContent = document.getElementById("mapContent");
var segmentContextMenu = document.getElementById("segmentContextMenu");
var editSegmentCasesButton = document.getElementById("editSegmentCasesButton");
var copySegmentButton = document.getElementById("copySegmentButton");
var deleteSegmentButton = document.getElementById("deleteSegmentButton");
var novastarOutputMenu = document.getElementById("novastarOutputMenu");
var segmentEditActions = document.getElementById("segmentEditActions");
var selectedSegmentId = "";
var selectedCaseIndex = -1;
var segmentGesture = null;
var mapPanGesture = null;
var lastNovastarAssignment = null;
var mapZoom = 1;
var mapPanX = 0;
var mapPanY = 0;

function applyMapTransform() {
  mapContent.style.transform = "translate(" + mapPanX + "px, " + mapPanY + "px) scale(" + mapZoom + ")";
}

function resetMapTransform() {
  mapZoom = 1;
  mapPanX = 0;
  mapPanY = 0;
  applyMapTransform();
}

function fitMapBackground() {
  if (mapBackgroundImage.hidden || !mapBackgroundImage.naturalWidth || !mapBackgroundImage.naturalHeight) return;
  var availableWidth = mapZone.clientWidth;
  var availableHeight = mapZone.clientHeight;
  var scale = Math.min(availableWidth / mapBackgroundImage.naturalWidth, availableHeight / mapBackgroundImage.naturalHeight);
  mapBackgroundImage.style.width = Math.floor(mapBackgroundImage.naturalWidth * scale) + "px";
  mapBackgroundImage.style.height = Math.floor(mapBackgroundImage.naturalHeight * scale) + "px";
}

function selectedMap() { return monitoringMaps.find(function(item) { return item.id === selectedMapId; }); }

function segmentThicknessPx(segment) {
  var axisLength = segment.orientation === "horizontal" ? mapZone.clientWidth : mapZone.clientHeight;
  return Math.max(1, segment.length * axisLength / Math.max(1, segment.cases));
}

function renderMapSegments() {
  mapZone.querySelectorAll(".map-segment").forEach(function(node) { node.remove(); });
  var map = selectedMap();
  (map && map.segments || []).forEach(function(segment) {
    var node = document.createElement("div");
    node.className = "map-segment " + segment.orientation;
    node.dataset.segmentId = segment.id;
    node.style.left = (segment.x * 100) + "%";
    node.style.top = (segment.y * 100) + "%";
    node.style.setProperty("--segment-thickness", segmentThicknessPx(segment) + "px");
    if (segment.orientation === "horizontal") node.style.width = (segment.length * 100) + "%";
    else node.style.height = (segment.length * 100) + "%";
    for (var index = 0; index < segment.cases; index += 1) {
      var cell = document.createElement("i");
      var assignment = segment.assignments && segment.assignments[index];
      cell.dataset.caseIndex = String(index);
      if (assignment) {
        cell.textContent = outputAssignmentLabel(assignment);
        var assignedMachine = machines.find(function(machine) { return String(machine.id) === String(assignment.machineId); });
        if (assignedMachine && /^#[0-9a-f]{6}$/i.test(assignedMachine.color || "")) cell.style.color = assignedMachine.color;
        cell.title = [assignment.machineName || assignment.machineId, assignment.cardId, assignment.outputId].join(" - ");
        cell.classList.add("assigned");
      }
      node.appendChild(cell);
    }
    mapContent.appendChild(node);
  });
  mapZone.classList.toggle("editing", mapEditMode.checked && !!map);
}

function outputAssignmentLabel(assignment) {
  var cardNumber = String(assignment.cardId || "").replace(/^O[-_.\s]*/i, "");
  return cardNumber + "." + String(assignment.outputId || "");
}

function promptCases(currentValue) {
  var answer = window.prompt("Combien de cases ?", String(currentValue || 1));
  if (answer === null) return null;
  var value = Number(answer);
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    setStatus("Le nombre de cases doit etre compris entre 1 et 500", "error");
    return null;
  }
  return value;
}

async function saveMapSegments(map) {
  var response = await fetch("/api/maps/" + encodeURIComponent(map.id) + "/segments", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ segments: map.segments || [] })
  });
  var result = await response.json();
  if (!response.ok) throw new Error(result.error || "Sauvegarde des segments impossible");
  var backgroundVersion = map.backgroundVersion;
  result.map.backgroundVersion = backgroundVersion;
  monitoringMaps = monitoringMaps.map(function(item) { return item.id === map.id ? result.map : item; });
  renderMapSegments();
}

function mapPoint(event) {
  var rect = mapZone.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left - mapPanX) / mapZoom / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top - mapPanY) / mapZoom / rect.height))
  };
}

function segmentById(id) { var map = selectedMap(); return map && (map.segments || []).find(function(segment) { return segment.id === id; }); }

mapZone.addEventListener("pointerdown", function(event) {
  if (event.button === 2 && !event.target.closest(".map-segment")) {
    mapPanGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originalPanX: mapPanX,
      originalPanY: mapPanY
    };
    mapZone.classList.add("panning");
    mapZone.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  if (!mapEditMode.checked || event.button !== 0) return;
  if (event.target.closest(".map-segment i")) return;
  var segmentNode = event.target.closest(".map-segment");
  if (segmentNode) {
    var rect = segmentNode.getBoundingClientRect();
    var tolerance = 8;
    var onEdge = event.clientX - rect.left <= tolerance || rect.right - event.clientX <= tolerance ||
      event.clientY - rect.top <= tolerance || rect.bottom - event.clientY <= tolerance;
    if (!onEdge) return;
    var segment = segmentById(segmentNode.dataset.segmentId);
    if (!segment) return;
    segmentGesture = { type: "move", segment: segment, start: mapPoint(event), originalX: segment.x, originalY: segment.y };
  } else {
    var start = mapPoint(event);
    segmentGesture = { type: "draw", start: start, current: start, draft: null };
  }
  mapZone.setPointerCapture(event.pointerId);
  event.preventDefault();
});

mapZone.addEventListener("pointermove", function(event) {
  if (mapPanGesture && event.pointerId === mapPanGesture.pointerId) {
    mapPanX = mapPanGesture.originalPanX + event.clientX - mapPanGesture.startX;
    mapPanY = mapPanGesture.originalPanY + event.clientY - mapPanGesture.startY;
    applyMapTransform();
    event.preventDefault();
    return;
  }
  if (!segmentGesture) return;
  var point = mapPoint(event);
  if (segmentGesture.type === "move") {
    var segment = segmentGesture.segment;
    var thickness = segmentThicknessPx(segment);
    var halfX = segment.orientation === "vertical" ? thickness / (2 * mapZone.clientWidth) : 0;
    var halfY = segment.orientation === "horizontal" ? thickness / (2 * mapZone.clientHeight) : 0;
    segment.x = Math.min(1 - (segment.orientation === "horizontal" ? segment.length : halfX), Math.max(halfX, segmentGesture.originalX + point.x - segmentGesture.start.x));
    segment.y = Math.min(1 - (segment.orientation === "vertical" ? segment.length : halfY), Math.max(halfY, segmentGesture.originalY + point.y - segmentGesture.start.y));
    renderMapSegments();
  } else {
    segmentGesture.current = point;
    if (!segmentGesture.draft) {
      segmentGesture.draft = document.createElement("div"); segmentGesture.draft.className = "map-segment draft horizontal"; mapContent.appendChild(segmentGesture.draft);
    }
    var dx = point.x - segmentGesture.start.x; var dy = point.y - segmentGesture.start.y;
    var horizontal = Math.abs(dx) >= Math.abs(dy); var draft = segmentGesture.draft;
    draft.className = "map-segment draft " + (horizontal ? "horizontal" : "vertical");
    draft.style.left = ((horizontal ? Math.min(segmentGesture.start.x, point.x) : segmentGesture.start.x) * 100) + "%";
    draft.style.top = ((horizontal ? segmentGesture.start.y : Math.min(segmentGesture.start.y, point.y)) * 100) + "%";
    draft.style.width = horizontal ? (Math.abs(dx) * 100) + "%" : "";
    draft.style.height = horizontal ? "" : (Math.abs(dy) * 100) + "%";
  }
});

mapZone.addEventListener("pointerup", async function(event) {
  if (mapPanGesture && event.pointerId === mapPanGesture.pointerId) {
    mapPanGesture = null;
    mapZone.classList.remove("panning");
    return;
  }
  if (!segmentGesture) return;
  var gesture = segmentGesture; segmentGesture = null;
  try {
    var map = selectedMap();
    if (gesture.type === "move") {
      await saveMapSegments(map); setStatus("Segment deplace", "ok"); return;
    }
    if (gesture.draft) gesture.draft.remove();
    var dx = gesture.current.x - gesture.start.x; var dy = gesture.current.y - gesture.start.y;
    var horizontal = Math.abs(dx) >= Math.abs(dy); var length = horizontal ? Math.abs(dx) : Math.abs(dy);
    if (length < 0.01) return;
    var cases = promptCases(1); if (cases === null) return;
    map.segments = map.segments || [];
    var newSegment = { id: Date.now() + "-" + Math.random().toString(16).slice(2), orientation: horizontal ? "horizontal" : "vertical",
      x: horizontal ? Math.min(gesture.start.x, gesture.current.x) : gesture.start.x,
      y: horizontal ? gesture.start.y : Math.min(gesture.start.y, gesture.current.y), length: length, cases: cases };
    var newThickness = segmentThicknessPx(newSegment);
    var halfX = newThickness / (2 * mapZone.clientWidth); var halfY = newThickness / (2 * mapZone.clientHeight);
    if (horizontal) newSegment.y = Math.min(1 - halfY, Math.max(halfY, newSegment.y));
    else newSegment.x = Math.min(1 - halfX, Math.max(halfX, newSegment.x));
    map.segments.push(newSegment);
    await saveMapSegments(map); setStatus("Segment ajoute", "ok");
  } catch (error) { renderMapSegments(); setStatus(error.message, "error"); }
});
mapZone.addEventListener("pointercancel", function() {
  if (segmentGesture && segmentGesture.draft) segmentGesture.draft.remove();
  segmentGesture = null;
  mapPanGesture = null;
  mapZone.classList.remove("panning");
});

mapZone.addEventListener("click", async function(event) {
  var cell = event.target.closest(".map-segment i");
  if (!cell || mapEditMode.checked && segmentGesture) return;
  event.stopPropagation();
  var node = cell.closest(".map-segment");
  selectedSegmentId = node.dataset.segmentId;
  selectedCaseIndex = Number(cell.dataset.caseIndex);
  if (!lastNovastarAssignment) {
    openSegmentMenu(event.clientX, event.clientY, false);
    return;
  }
  var next = nextNovastarOutput(lastNovastarAssignment);
  if (!next) {
    lastNovastarAssignment = null;
    openSegmentMenu(event.clientX, event.clientY, false);
    setStatus("Aucune sortie suivante disponible : choisissez une sortie", "error");
    return;
  }
  await assignSelectedCase(next);
});

mapZone.addEventListener("wheel", function(event) {
  if (!selectedMap()) return;
  event.preventDefault();
  var rect = mapZone.getBoundingClientRect();
  var cursorX = event.clientX - rect.left;
  var cursorY = event.clientY - rect.top;
  var contentX = (cursorX - mapPanX) / mapZoom;
  var contentY = (cursorY - mapPanY) / mapZoom;
  var factor = Math.exp(-event.deltaY * 0.0015);
  var nextZoom = Math.min(8, Math.max(0.5, mapZoom * factor));
  if (nextZoom === mapZoom) return;
  mapPanX = cursorX - contentX * nextZoom;
  mapPanY = cursorY - contentY * nextZoom;
  mapZoom = nextZoom;
  applyMapTransform();
}, { passive: false });

mapZone.addEventListener("contextmenu", function(event) {
  var cell = event.target.closest(".map-segment i");
  var node = event.target.closest(".map-segment");
  if (!node) {
    event.preventDefault();
    return;
  }
  if (!cell && !mapEditMode.checked) return;
  event.preventDefault();
  selectedSegmentId = node.dataset.segmentId;
  selectedCaseIndex = cell ? Number(cell.dataset.caseIndex) : -1;
  openSegmentMenu(event.clientX, event.clientY, true);
});

function openSegmentMenu(x, y, showEditActions) {
  renderNovastarOutputMenu();
  segmentEditActions.hidden = !showEditActions;
  segmentContextMenu.style.left = Math.min(x, window.innerWidth - 240) + "px";
  segmentContextMenu.style.top = Math.min(y, window.innerHeight - 220) + "px";
  segmentContextMenu.hidden = false;
  requestAnimationFrame(function() {
    var rect = segmentContextMenu.getBoundingClientRect();
    segmentContextMenu.style.left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)) + "px";
    segmentContextMenu.style.top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)) + "px";
  });
}

function novastarOutputs() {
  return machines.filter(function(machine) { return machine.type === "novastar-h"; }).map(function(machine) {
    var state = monitoringState[machine.id] || {};
    var cards = (state.outputTables || []).map(function(card) {
      return {
        id: String(card.label),
        outputs: (card.ports || []).filter(function(port) { return String(port.label) !== "-"; }).map(function(port) {
          return { machineId: String(machine.id), machineName: machine.name || String(machine.id), cardId: String(card.label), outputId: String(port.label) };
        })
      };
    }).filter(function(card) { return card.outputs.length; });
    return { id: String(machine.id), name: machine.name || String(machine.id), cards: cards };
  });
}

function renderNovastarOutputMenu() {
  var devices = novastarOutputs();
  var assignedKeys = assignedOutputKeys();
  novastarOutputMenu.innerHTML = "";
  if (!devices.length) {
    novastarOutputMenu.innerHTML = '<span class="menu-empty">Aucune sortie NovaStar disponible</span>';
    return;
  }
  devices.forEach(function(device) {
    var machineItem = nestedMenuItem(device.name);
    if (!device.cards.length) {
      var unavailable = document.createElement("span");
      unavailable.className = "menu-empty";
      unavailable.textContent = "Cartes et sorties indisponibles";
      machineItem.menu.appendChild(unavailable);
    }
    device.cards.forEach(function(card) {
      var cardItem = nestedMenuItem("Carte " + card.id);
      card.outputs.forEach(function(output) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "output-menu-button";
        var label = document.createElement("span");
        label.textContent = "Sortie " + output.outputId;
        var marker = document.createElement("span");
        marker.className = "output-assigned-marker";
        marker.textContent = assignedKeys.has(assignmentKey(output)) ? "*" : "";
        button.appendChild(label);
        button.appendChild(marker);
        button.addEventListener("click", function() { assignSelectedCase(output); });
        cardItem.menu.appendChild(button);
      });
      machineItem.menu.appendChild(cardItem.item);
    });
    novastarOutputMenu.appendChild(machineItem.item);
  });
}

function nestedMenuItem(label) {
  var item = document.createElement("div");
  item.className = "nested-menu-item";
  var button = document.createElement("button");
  button.type = "button";
  button.className = "nested-menu-trigger";
  button.textContent = label;
  button.setAttribute("aria-haspopup", "true");
  var arrow = document.createElement("span");
  arrow.textContent = "›";
  button.appendChild(arrow);
  var menu = document.createElement("div");
  menu.className = "context-menu nested-menu-panel";
  item.appendChild(button);
  item.appendChild(menu);
  item.addEventListener("pointerenter", function() {
    positionNestedMenu(button, menu);
  });
  return { item: item, menu: menu };
}

function positionNestedMenu(trigger, menu) {
  menu.style.visibility = "hidden";
  menu.style.display = "grid";
  var triggerRect = trigger.getBoundingClientRect();
  var menuRect = menu.getBoundingClientRect();
  var gap = 2;
  var left = triggerRect.right - gap;
  if (left + menuRect.width > window.innerWidth - 4) left = triggerRect.left - menuRect.width + gap;
  left = Math.max(4, Math.min(left, window.innerWidth - menuRect.width - 4));
  var top = Math.max(4, Math.min(triggerRect.top - 4, window.innerHeight - menuRect.height - 4));
  menu.style.left = left + "px";
  menu.style.top = top + "px";
  menu.style.display = "";
  menu.style.visibility = "";
}

function flattenedOutputs(machineId) {
  var device = novastarOutputs().find(function(item) { return item.id === String(machineId); });
  return device ? device.cards.reduce(function(items, card) { return items.concat(card.outputs); }, []) : [];
}

function nextNovastarOutput(current) {
  var outputs = flattenedOutputs(current.machineId);
  var index = outputs.findIndex(function(output) {
    return output.cardId === String(current.cardId) && output.outputId === String(current.outputId);
  });
  return index >= 0 && index + 1 < outputs.length ? outputs[index + 1] : null;
}

function assignmentKey(assignment) {
  return [assignment.machineId, assignment.cardId, assignment.outputId].map(String).join("\u001f");
}

function assignedOutputKeys() {
  var map = selectedMap();
  var keys = new Set();
  (map && map.segments || []).forEach(function(segment) {
    (segment.assignments || []).forEach(function(assignment) {
      if (assignment) keys.add(assignmentKey(assignment));
    });
  });
  return keys;
}

async function assignSelectedCase(assignment) {
  var segment = segmentById(selectedSegmentId);
  var map = selectedMap();
  if (!segment || !map || selectedCaseIndex < 0 || selectedCaseIndex >= segment.cases) return;
  var key = assignmentKey(assignment);
  (map.segments || []).forEach(function(item) {
    if (!Array.isArray(item.assignments)) return;
    item.assignments = item.assignments.map(function(existing) {
      return existing && assignmentKey(existing) === key ? null : existing;
    });
  });
  segment.assignments = Array.isArray(segment.assignments) ? segment.assignments : [];
  while (segment.assignments.length < segment.cases) segment.assignments.push(null);
  segment.assignments[selectedCaseIndex] = Object.assign({}, assignment);
  lastNovastarAssignment = Object.assign({}, assignment);
  segmentContextMenu.hidden = true;
  try {
    await saveMapSegments(map);
    setStatus("Sortie " + assignment.outputId + " assignee", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

mapBackgroundImage.addEventListener("load", fitMapBackground);
window.addEventListener("resize", function() { fitMapBackground(); renderMapSegments(); });

async function initializeMonitoringMaps() {
  if (!CURRENT_USER || CURRENT_USER.role !== "administrator" || CURRENT_USER.login.toLowerCase() !== "olivier") return;
  var response = await fetch("/api/maps");
  var result = await response.json();
  if (!response.ok) { setStatus(result.error || "Chargement des maps impossible", "error"); return; }
  monitoringMaps = result;
  renderMapList();
  renderSelectedMap();
}

function renderMapList() {
  mapCount.textContent = String(monitoringMaps.length);
  mapList.innerHTML = monitoringMaps.map(function(map) { return '<option value="' + escapeHtml(map.id) + '">' + escapeHtml(map.name) + '</option>'; }).join("");
  if (!monitoringMaps.some(function(map) { return map.id === selectedMapId; })) selectedMapId = monitoringMaps.length ? monitoringMaps[0].id : "";
  mapList.value = selectedMapId;
  localStorage.setItem("tavSelectedMapId", selectedMapId);
}

function renderSelectedMap() {
  var map = monitoringMaps.find(function(item) { return item.id === selectedMapId; });
  selectedMapName.textContent = map ? map.name : "Aucune map";
  mapListHint.textContent = map ? "Selection : " + map.name : "Ajoutez une map pour commencer.";
  mapEditMode.disabled = !map;
  loadMapBackgroundButton.hidden = !map || !mapEditMode.checked;
  if (map && map.backgroundUrl) {
    mapBackgroundImage.src = map.backgroundUrl + "?v=" + encodeURIComponent(map.backgroundVersion || "stored");
    mapBackgroundImage.hidden = false;
    mapZonePlaceholder.hidden = true;
    if (mapBackgroundImage.complete) fitMapBackground();
  } else {
    mapBackgroundImage.removeAttribute("src");
    mapBackgroundImage.style.width = "";
    mapBackgroundImage.style.height = "";
    mapBackgroundImage.hidden = true;
    mapZonePlaceholder.hidden = false;
  }
  renderMapSegments();
}

function openMapDialog(map) {
  editedMapId = map ? map.id : "";
  mapDialogTitle.textContent = map ? "Modifier une map" : "Ajouter une map";
  mapForm.name.value = map ? map.name : "";
  mapDialog.showModal();
  mapForm.name.focus();
}

addMapButton.addEventListener("click", function() { openMapDialog(null); });
cancelMapButton.addEventListener("click", function() { mapDialog.close(); });
mapEditMode.addEventListener("change", function() { loadMapBackgroundButton.hidden = !mapEditMode.checked || !selectedMapId; renderMapSegments(); });
loadMapBackgroundButton.addEventListener("click", function() { mapBackgroundFile.click(); });
mapBackgroundFile.addEventListener("change", async function() {
  var file = mapBackgroundFile.files && mapBackgroundFile.files[0];
  if (!file || !selectedMapId) return;
  loadMapBackgroundButton.disabled = true;
  try {
    var response = await fetch("/api/maps/" + encodeURIComponent(selectedMapId) + "/background", {
      method: "PUT", headers: { "Content-Type": file.type }, body: file
    });
    var result = await response.json();
    if (!response.ok) throw new Error(result.error || "Chargement impossible");
    result.map.backgroundVersion = Date.now();
    monitoringMaps = monitoringMaps.map(function(map) { return map.id === selectedMapId ? result.map : map; });
    renderSelectedMap(); setStatus("Background enregistre", "ok");
  } catch (error) { setStatus(error.message || "Chargement impossible", "error"); }
  finally { loadMapBackgroundButton.disabled = false; mapBackgroundFile.value = ""; }
});
mapList.addEventListener("change", function() {
  selectedMapId = mapList.value;
  localStorage.setItem("tavSelectedMapId", selectedMapId);
  resetMapTransform();
  renderSelectedMap();
});
mapList.addEventListener("contextmenu", function(event) {
  var option = event.target.closest("option");
  if (!option) return;
  event.preventDefault(); contextMapId = option.value; selectedMapId = option.value; resetMapTransform(); renderMapList(); renderSelectedMap();
  mapContextMenu.style.left = Math.min(event.clientX, window.innerWidth - 150) + "px";
  mapContextMenu.style.top = Math.min(event.clientY, window.innerHeight - 100) + "px";
  mapContextMenu.hidden = false;
});
editMapButton.addEventListener("click", function() { mapContextMenu.hidden = true; openMapDialog(monitoringMaps.find(function(map) { return map.id === contextMapId; })); });
deleteMapButton.addEventListener("click", async function() {
  var map = monitoringMaps.find(function(item) { return item.id === contextMapId; }); mapContextMenu.hidden = true;
  if (!map || !window.confirm("Supprimer la map " + map.name + " ?")) return;
  var response = await fetch("/api/maps/" + encodeURIComponent(map.id), { method: "DELETE" });
  if (!response.ok) { var error = await response.json(); setStatus(error.error || "Suppression impossible", "error"); return; }
  monitoringMaps = monitoringMaps.filter(function(item) { return item.id !== map.id; }); resetMapTransform(); renderMapList(); renderSelectedMap(); setStatus("Map supprimee", "ok");
});
mapForm.addEventListener("submit", async function(event) {
  event.preventDefault();
  var url = editedMapId ? "/api/maps/" + encodeURIComponent(editedMapId) : "/api/maps";
  var response = await fetch(url, { method: editedMapId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: mapForm.name.value }) });
  var result = await response.json();
  if (!response.ok) { setStatus(result.error || "Enregistrement impossible", "error"); return; }
  if (editedMapId) monitoringMaps = monitoringMaps.map(function(map) { return map.id === editedMapId ? result.map : map; });
  else { monitoringMaps.push(result.map); selectedMapId = result.map.id; resetMapTransform(); }
  mapDialog.close(); renderMapList(); renderSelectedMap(); setStatus("Map enregistree", "ok");
});
document.addEventListener("click", function(event) { if (!mapContextMenu.hidden && !mapContextMenu.contains(event.target)) mapContextMenu.hidden = true; });
document.addEventListener("click", function(event) { if (!segmentContextMenu.hidden && !segmentContextMenu.contains(event.target)) segmentContextMenu.hidden = true; });

editSegmentCasesButton.addEventListener("click", async function() {
  segmentContextMenu.hidden = true; var segment = segmentById(selectedSegmentId); var map = selectedMap(); if (!segment || !map) return;
  var cases = promptCases(segment.cases); if (cases === null) return; segment.cases = cases;
  try { await saveMapSegments(map); setStatus("Nombre de cases modifie", "ok"); } catch (error) { setStatus(error.message, "error"); }
});
deleteSegmentButton.addEventListener("click", async function() {
  segmentContextMenu.hidden = true; var map = selectedMap(); if (!map) return;
  map.segments = (map.segments || []).filter(function(segment) { return segment.id !== selectedSegmentId; });
  try { await saveMapSegments(map); setStatus("Segment supprime", "ok"); } catch (error) { setStatus(error.message, "error"); }
});
copySegmentButton.addEventListener("click", async function() {
  segmentContextMenu.hidden = true; var source = segmentById(selectedSegmentId); var map = selectedMap(); if (!source || !map) return;
  var copy = Object.assign({}, source, { id: Date.now() + "-" + Math.random().toString(16).slice(2) });
  var thickness = segmentThicknessPx(copy);
  if (copy.orientation === "horizontal") copy.y = Math.min(1 - thickness / (2 * mapZone.clientHeight), copy.y + thickness / mapZone.clientHeight);
  else copy.x = Math.min(1 - thickness / (2 * mapZone.clientWidth), copy.x + thickness / mapZone.clientWidth);
  map.segments.push(copy);
  try { await saveMapSegments(map); setStatus("Segment copie", "ok"); } catch (error) { setStatus(error.message, "error"); }
});
