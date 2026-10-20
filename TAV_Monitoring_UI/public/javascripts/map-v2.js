// V2 reuses map geometry and monitoring snapshots, with independent directed ranges.
var mapV2Role = "main";
var mapV2Pending = null;
var mapV2Saving = false;
var mapV2RotationTarget = "";

function mapV2NumberStep(modulePixels) {
  // Keep intermediate zoom levels sparse; show every number on large modules.
  if (modulePixels >= 22) return 1;
  if (modulePixels >= 4.4) return 5;
  return 10;
}

function mapV2UpdateNumbers(container) {
  if (!container) return;
  container.querySelectorAll(".map-segment, .map-monitoring-segment").forEach(function(block) {
    var cells = block.querySelectorAll(".module-led");
    if (!cells.length) return;
    var rect = cells[0].getBoundingClientRect();
    var pixels = block.classList.contains("vertical") ? rect.height : rect.width;
    var step = mapV2NumberStep(pixels);
    cells.forEach(function(cell) {
      var index = Number(cell.dataset.caseIndex);
      var label = cell.querySelector(".module-number");
      if (label) label.style.visibility = index === 0 || index === cells.length - 1 || (index + 1) % step === 0 ? "visible" : "hidden";
    });
  });
}

function mapV2ApplyDirection(node, segment) {
  node.style.flexDirection = segment.orientation === "vertical"
    ? (segment.reversed ? "column-reverse" : "column")
    : (segment.reversed ? "row-reverse" : "row");
}

function mapV2RotatedGeometry(segment, clockwise, width, height) {
  var horizontal = segment.orientation === "horizontal";
  var pixels = segment.length * (horizontal ? width : height);
  var centerX = segment.x + (horizontal ? segment.length / 2 : 0);
  var centerY = segment.y + (horizontal ? 0 : segment.length / 2);
  var length = pixels / (horizontal ? height : width);
  var x = centerX - (horizontal ? 0 : length / 2);
  var y = centerY - (horizontal ? length / 2 : 0);
  if (!(width > 0 && height > 0)) throw new Error("La map n’est pas encore prête pour la rotation.");
  return { orientation: horizontal ? "vertical" : "horizontal", length: length, x: x, y: y,
    reversed: (segment.reversed === true) !== (clockwise ? !horizontal : horizontal) };
}

async function mapV2Rotate(event) {
  if (mapV2Saving || segmentGesture || !event.deltaY) return;
  var node = event.target.closest(".map-segment");
  if (node) mapV2RotationTarget = node.dataset.segmentId;
  var segment = segmentById(mapV2RotationTarget);
  var map = selectedMap();
  if (!segment || !map) return;
  var previous = Object.assign({}, segment);
  try {
    var geometry = mapV2RotatedGeometry(segment, event.deltaY > 0, mapContent.clientWidth, mapContent.clientHeight);
    mapV2CancelRange();
    Object.assign(segment, geometry);
    mapV2Saving = true;
    renderMapSegments();
    await saveMapSegments(map);
    setStatus("Bloc tourné de 90°", "ok");
  } catch (error) {
    Object.assign(segment, previous);
    setStatus(error.message, "error");
    var hint = document.getElementById("moduleRangeHint");
    if (hint) hint.textContent = error.message;
  } finally { mapV2Saving = false; renderMapSegments(); }
}

function mapV2Ranges(map) {
  return (map && map.segments || []).reduce(function(all, segment) {
    return all.concat(segment.moduleRanges || []);
  }, []);
}

function mapV2RangeAt(segment, index, role) {
  return (segment.moduleRanges || []).find(function(range) {
    return range.role === role && index >= Math.min(range.start, range.end) && index <= Math.max(range.start, range.end);
  });
}

function mapV2CurrentOutputs(map) {
  var outputs = new Map();
  mapV2Ranges(map).forEach(function(range) {
    var assignment = range.assignment;
    outputs.set(assignmentKey(assignment), Object.assign({}, assignment, { ok: mapMonitoringAssignmentIsOk(assignment) }));
  });
  return Array.from(outputs.values()).sort(function(a, b) { return mapMonitoringOutputKey(a).localeCompare(mapMonitoringOutputKey(b)); });
}

function mapV2CreateStartArrow(segment, range, pending) {
  var arrow = document.createElement("span");
  arrow.className = "module-start-arrow " + range.role + " " + segment.orientation;
  var assignment = range.assignment;
  var title = (range.role === "main" ? "Main" : "Backup") + " · " +
    (assignment.machineName || assignment.machineId) + " · Carte " + assignment.cardId +
    " / Sortie " + assignment.outputId + " · " + (range.start + 1) + " → " + (range.end + 1);
  if (pending) title += " · Choisir le module d’arrivée";
  arrow.title = title;
  arrow.setAttribute("role", "img");
  arrow.setAttribute("aria-label", title);
  arrow.dataset.role = range.role;
  arrow.dataset.machineId = assignment.machineId;
  arrow.dataset.cardId = assignment.cardId;
  arrow.dataset.outputId = assignment.outputId;
  var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 12 16");
  svg.setAttribute("aria-hidden", "true");
  var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M4 0h4v9h4l-6 7-6-7h4z");
  svg.appendChild(path);
  arrow.appendChild(svg);
  var label = document.createElement("span");
  label.className = "module-start-label";
  var card = String(assignment.cardId || "");
  if (!/^O/i.test(card)) card = "O" + card;
  label.textContent = (assignment.machineName || assignment.machineId) + " - " + card + " - " + assignment.outputId;
  arrow.appendChild(label);
  return arrow;
}

function mapV2HoverOutput(event) {
  var target = event.target.closest(".module-triangle, .module-start-arrow");
  var cell = target && target.closest(".module-led");
  var block = cell && cell.closest(".map-segment, .map-monitoring-segment");
  var outputs = cell ? Array.from(cell.querySelectorAll(".module-triangle[data-machine-id]")) : [];
  document.querySelectorAll(".module-start-arrow").forEach(function(arrow) {
    var matches = block && arrow.closest(".map-segment, .map-monitoring-segment") === block &&
      outputs.some(function(output) {
        return arrow.dataset.machineId === output.dataset.machineId &&
          arrow.dataset.cardId === output.dataset.cardId &&
          arrow.dataset.outputId === output.dataset.outputId;
      });
    arrow.classList.toggle("output-hovered", !!matches);
  });
}

document.addEventListener("pointerover", mapV2HoverOutput);
document.addEventListener("pointerout", function(event) {
  mapV2HoverOutput({ target: event.relatedTarget && event.relatedTarget.closest ? event.relatedTarget : { closest: function() { return null; } } });
});

function mapV2OutputState(assignment) {
  var state = monitoringState[assignment.machineId];
  if (!state || state.connected !== true) return "error";
  var card = (state.outputTables || []).find(function(item) {
    return String(item.label) === String(assignment.cardId);
  });
  var output = card && (card.ports || []).find(function(item) {
    return String(item.label) === String(assignment.outputId);
  });
  if (!output) return "error";
  if (output.state === "warning") return "backup-state";
  if (output.state) return output.state === "ok" ? "ok" : "error";
  return output.ok === true ? "ok" : "error";
}

function mapV2CreateCell(segment, index, editing) {
  var cell = document.createElement("i");
  cell.className = "module-led";
  cell.dataset.caseIndex = String(index);
  ["main", "backup"].forEach(function(role) {
    var range = mapV2RangeAt(segment, index, role);
    var pending = editing && mapV2Pending && mapV2Pending.segmentId === segment.id && mapV2Pending.role === role &&
      index >= Math.min(mapV2Pending.start, mapV2Pending.end) && index <= Math.max(mapV2Pending.start, mapV2Pending.end);
    var assignment = pending ? mapV2Pending.assignment : range && range.assignment;
    var triangle = document.createElement("button");
    triangle.type = "button";
    triangle.dataset.role = role;
    triangle.className = "module-triangle " + role + (pending ? " pending" : assignment ? " " + mapV2OutputState(assignment) : " unassigned");
    var title = "Module " + (index + 1) + " · " + (role === "main" ? "Main" : "Backup");
    if (assignment) {
      title += " · " + (assignment.machineName || assignment.machineId) + " · Carte " + assignment.cardId + " / Sortie " + assignment.outputId;
      title += " · " + ((pending ? mapV2Pending.start : range.start) + 1) + " → " + ((pending ? mapV2Pending.end : range.end) + 1);
      if (pending) title += " · Choisir le module d’arrivée";
      triangle.dataset.machineId = assignment.machineId;
      triangle.dataset.cardId = assignment.cardId;
      triangle.dataset.outputId = assignment.outputId;
      if (!pending && mapMonitoringHasMicroInterruption(assignment)) triangle.classList.add("micro-interruption");
    }
    triangle.title = title;
    triangle.setAttribute("aria-label", title);
    triangle.disabled = mapV2Saving;
    cell.appendChild(triangle);
    var activeRange = pending ? mapV2Pending : range;
    if (activeRange && index === activeRange.start) {
      cell.appendChild(mapV2CreateStartArrow(segment, activeRange, pending));
    }
  });
  var label = document.createElement("span");
  label.className = "module-number";
  label.textContent = String(index + 1);
  cell.appendChild(label);
  return cell;
}

function mapV2RenderEditor() {
  mapZone.querySelectorAll(".map-segment").forEach(function(node) { node.remove(); });
  var map = selectedMap();
  mapNovastarFilters.hidden = true;
  mapWarningsFilter.hidden = true;
  (map && map.segments || []).forEach(function(segment) {
    var node = document.createElement("div");
    node.className = "map-segment " + segment.orientation;
    mapV2ApplyDirection(node, segment);
    node.dataset.segmentId = segment.id;
    node.style.left = (segment.x * 100) + "%";
    node.style.top = (segment.y * 100) + "%";
    node.style.setProperty("--segment-thickness", segmentThicknessPx(segment) + "px");
    node.style[segment.orientation === "horizontal" ? "width" : "height"] = (segment.length * 100) + "%";
    for (var index = 0; index < segment.cases; index++) node.appendChild(mapV2CreateCell(segment, index, true));
    mapContent.appendChild(node);
  });
  mapZone.classList.toggle("editing", mapEditMode.checked && !!map);
  mapV2UpdateNumbers(mapContent);
}

function mapV2SelectRole(event, cell) {
  var triangle = event.target.closest("[data-role]");
  if (triangle) mapV2Role = triangle.dataset.role;
  else if (cell) {
    var rect = cell.getBoundingClientRect();
    mapV2Role = (event.clientX - rect.left) / rect.width + (event.clientY - rect.top) / rect.height <= 1 ? "main" : "backup";
  }
}

function mapV2CancelRange() {
  mapV2Pending = null;
  var hint = document.getElementById("moduleRangeHint");
  if (hint) hint.textContent = "Haut : Main · Bas : Backup. Cliquez sur un triangle et choisissez une sortie, puis sur le module d’arrivée. Échap annule. Ctrl + glisser : déplacer le bloc ; Ctrl + molette : rotation de 90°.";
}

function mapV2StartRange(assignment) {
  if (mapV2Saving || !mapEditMode.checked || selectedCaseIndex < 0) return;
  mapV2Pending = { mapId: selectedMapId, segmentId: selectedSegmentId, role: mapV2Role,
    start: selectedCaseIndex, end: selectedCaseIndex, assignment: Object.assign({}, assignment) };
  segmentContextMenu.hidden = true;
  document.getElementById("moduleRangeHint").textContent = (mapV2Role === "main" ? "Main" : "Backup") +
    " · Départ : module " + (selectedCaseIndex + 1) + ". Cliquez sur le triangle de même type du module d’arrivée dans ce bloc. Échap annule.";
  renderMapSegments();
}

async function mapV2Click(event) {
  if (event.ctrlKey || segmentGesture) return;
  var cell = event.target.closest(".map-segment i");
  if (!cell || mapV2Saving) return;
  event.stopPropagation();
  mapV2SelectRole(event, cell);
  selectedSegmentId = cell.closest(".map-segment").dataset.segmentId;
  selectedCaseIndex = Number(cell.dataset.caseIndex);
  var segment = segmentById(selectedSegmentId);
  if (!mapEditMode.checked) {
    var range = mapV2RangeAt(segment, selectedCaseIndex, mapV2Role);
    if (range) openMapAssignmentMonitoring(range.assignment);
    return;
  }
  if (!mapV2Pending) { openSegmentMenu(event.clientX, event.clientY, false); return; }
  if (mapV2Pending.segmentId !== selectedSegmentId || mapV2Pending.role !== mapV2Role) {
    setStatus("Choisissez le même triangle dans le bloc de départ, ou Échap pour annuler", "error"); return;
  }
  var pending = Object.assign({}, mapV2Pending, { end: selectedCaseIndex });
  var map = selectedMap();
  var previous = JSON.parse(JSON.stringify(map.segments));
  var first = Math.min(pending.start, pending.end), last = Math.max(pending.start, pending.end);
  // A single output can feed several independent ranges. Each half of a module
  // still belongs to one range, so existing ranges must be cleared before overlap.
  var conflict = (segment.moduleRanges || []).some(function(range) {
    return range.role === pending.role &&
      Math.max(first, Math.min(range.start, range.end)) <= Math.min(last, Math.max(range.start, range.end));
  });
  if (conflict) { setStatus("Cette plage chevauche une plage existante : effacez d’abord son affectation", "error"); return; }
  segment.moduleRanges = segment.moduleRanges || [];
  segment.moduleRanges.push({ role: pending.role, start: pending.start, end: pending.end, assignment: pending.assignment });
  mapV2Saving = true;
  renderMapSegments();
  try {
    await saveMapSegments(map);
    mapV2CancelRange();
    setStatus("Plage " + (pending.start + 1) + " → " + (pending.end + 1) + " enregistrée", "ok");
  } catch (error) {
    map.segments = previous;
    setStatus(error.message, "error");
  } finally { mapV2Saving = false; renderMapSegments(); }
}

function mapV2OpenMenu(x, y, showEditActions) {
  if (mapV2Saving) return;
  renderNovastarOutputMenu();
  var segment = segmentById(selectedSegmentId);
  var range = segment && mapV2RangeAt(segment, selectedCaseIndex, mapV2Role);
  novastarOutputMenu.hidden = selectedCaseIndex < 0;
  segmentClearAction.hidden = !showEditActions;
  clearSegmentCaseButton.textContent = "Effacer la plage " + (mapV2Role === "main" ? "Main" : "Backup");
  clearSegmentCaseButton.disabled = !range;
  clearSegmentBlockButton.textContent = "Effacer les affectations du bloc";
  clearSegmentBlockButton.disabled = !segment || !(segment.moduleRanges || []).length;
  clearSegmentNovastarButton.hidden = !range;
  clearSegmentNovastarButton.textContent = "Effacer ce NovaStar";
  segmentEditActions.hidden = !showEditActions;
  segmentContextMenu.hidden = false;
  requestAnimationFrame(function() {
    var rect = segmentContextMenu.getBoundingClientRect();
    segmentContextMenu.style.left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)) + "px";
    segmentContextMenu.style.top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)) + "px";
  });
}

async function mapV2Clear(kind) {
  if (mapV2Saving) return;
  var map = selectedMap(), segment = segmentById(selectedSegmentId);
  if (!map || !segment) return;
  var range = mapV2RangeAt(segment, selectedCaseIndex, mapV2Role);
  var previous = JSON.parse(JSON.stringify(map.segments));
  if (kind === "case") segment.moduleRanges = (segment.moduleRanges || []).filter(function(item) { return item !== range; });
  if (kind === "block") segment.moduleRanges = [];
  if (kind === "machine" && range) map.segments.forEach(function(item) {
    item.moduleRanges = (item.moduleRanges || []).filter(function(candidate) { return candidate.assignment.machineId !== range.assignment.machineId; });
  });
  segmentContextMenu.hidden = true;
  mapV2CancelRange();
  mapV2Saving = true;
  try { await saveMapSegments(map); setStatus("Affectations effacées", "ok"); }
  catch (error) { map.segments = previous; setStatus(error.message, "error"); }
  finally { mapV2Saving = false; renderMapSegments(); }
}

mapZone.addEventListener("pointermove", function(event) {
  if (!mapV2Pending || mapV2Saving) return;
  var cell = event.target.closest(".map-segment i");
  if (!cell || cell.closest(".map-segment").dataset.segmentId !== mapV2Pending.segmentId) return;
  var index = Number(cell.dataset.caseIndex);
  if (index !== mapV2Pending.end) { mapV2Pending.end = index; renderMapSegments(); }
});
document.addEventListener("keydown", function(event) {
  if (event.key === "Escape" && !mapV2Saving) { mapV2CancelRange(); segmentContextMenu.hidden = true; renderMapSegments(); }
});
