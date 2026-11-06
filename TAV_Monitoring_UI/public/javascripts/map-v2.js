// V2 reuses map geometry and monitoring snapshots, with independent directed ranges.
var mapV2Role = "main";
var mapV2Pending = null;
var mapV2Saving = false;
var mapV2RotationTarget = "";
var mapV2EditorView = null;

function mapV2SetEditorFullscreen(fullscreen) {
  var editor = mapZone.closest(".map-view-zone");
  if (!editor || editor.classList.contains("map-editor-fullscreen") === fullscreen) return;
  if (fullscreen) mapV2EditorView = { zoom: mapZoom, x: mapPanX, y: mapPanY };
  editor.classList.toggle("map-editor-fullscreen", fullscreen);
  document.body.classList.toggle("map-editor-fullscreen-open", fullscreen);
  var maximize = document.getElementById("maximizeMapEditorButton");
  var close = document.getElementById("closeMapEditorFullscreenButton");
  maximize.hidden = fullscreen;
  maximize.setAttribute("aria-expanded", String(fullscreen));
  close.hidden = !fullscreen;
  // The same editor DOM stays mounted: pending wiring and form state survive.
  if (fullscreen) {
    fitMapBackground(false);
    resetMapTransform();
  } else if (mapV2EditorView) {
    mapZoom = mapV2EditorView.zoom;
    mapPanX = mapV2EditorView.x;
    mapPanY = mapV2EditorView.y;
    mapV2EditorView = null;
    applyMapTransform();
  }
  renderMapSegments();
  (fullscreen ? close : maximize).focus();
}

function mapV2InitializeEditorFullscreen() {
  var maximize = document.getElementById("maximizeMapEditorButton");
  if (!maximize || maximize.dataset.fullscreenInitialized) return;
  maximize.dataset.fullscreenInitialized = "true";
  maximize.addEventListener("click", function() { mapV2SetEditorFullscreen(true); });
  document.getElementById("closeMapEditorFullscreenButton").addEventListener("click", function() { mapV2SetEditorFullscreen(false); });
}

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
      var number = Number(cell.dataset.moduleNumber) || index + 1;
      var endpoint = cell.dataset.mainEndpoint === "true";
      if (label) label.style.visibility = endpoint || index === 0 || index === cells.length - 1 || number % step === 0 ? "visible" : "hidden";
    });
  });
}

function mapV2ApplyDirection(node, segment) {
  if (segment.rows && segment.columns) {
    node.classList.add("module-grid");
    var dimensions = mapV2GridDimensions(segment);
    node.dataset.gridRows = dimensions.rows;
    node.dataset.gridColumns = dimensions.columns;
    node.dataset.cellAspectRatio = mapV2CellAspectRatio(segment);
    node.dataset.gridReversed = segment.reversed ? "1" : "0";
    node.style.gridTemplateColumns = "repeat(" + dimensions.columns + ", minmax(0, 1fr))";
    node.style.gridTemplateRows = "repeat(" + dimensions.rows + ", minmax(0, 1fr))";
    return;
  }
  node.style.flexDirection = segment.orientation === "vertical"
    ? (segment.reversed ? "column-reverse" : "column")
    : (segment.reversed ? "row-reverse" : "row");
}

function mapV2RotatedGeometry(segment, clockwise, width, height) {
  var horizontal = segment.orientation === "horizontal";
  if (segment.rows && segment.columns) {
    var gridPixels = segment.length * (horizontal ? width : height);
    var cx = segment.x * width + (horizontal ? gridPixels / 2 : 0);
    var cy = segment.y * height + (horizontal ? 0 : gridPixels / 2);
    return { orientation: horizontal ? "vertical" : "horizontal", length: gridPixels / (horizontal ? height : width),
      x: (cx - (horizontal ? 0 : gridPixels / 2)) / width,
      y: (cy - (horizontal ? gridPixels / 2 : 0)) / height,
      gridRotation: ((segment.gridRotation || 0) + (clockwise !== (segment.gridTransposed === true) ? 1 : 3)) % 4, reversed: segment.reversed === true };
  }
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
    return range.role === role && mapV2RangeModules(range).includes(index);
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
    " / Sortie " + assignment.outputId + " · " + mapV2ModuleNumber(segment, range.start) + " → " + mapV2ModuleNumber(segment, range.end);
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

function mapV2ModuleNumber(segment, index) {
  var main = mapV2RangeAt(segment, index, "main");
  return main ? mapV2RangeModules(main).indexOf(index) + 1 : index + 1;
}

function mapV2CreateCell(segment, index, editing) {
  var cell = document.createElement("i");
  cell.className = "module-led";
  cell.dataset.caseIndex = String(index);
  var main = mapV2RangeAt(segment, index, "main");
  var number = mapV2ModuleNumber(segment, index);
  cell.dataset.moduleNumber = String(number);
  cell.dataset.mainEndpoint = String(!!main && (index === main.start || index === main.end));
  if (segment.rows && segment.columns) {
    var position = mapV2CellPosition(segment, index);
    cell.style.gridRow = position.row + 1;
    cell.style.gridColumn = position.column + 1;
  }
  ["main", "backup"].forEach(function(role) {
    var range = mapV2RangeAt(segment, index, role);
    var pending = editing && mapV2Pending && mapV2Pending.segmentId === segment.id && mapV2Pending.role === role &&
      (mapV2Pending.previewModules || mapV2RangeModules(mapV2Pending)).includes(index);
    var assignment = pending ? mapV2Pending.assignment : range && range.assignment;
    var triangle = document.createElement("button");
    triangle.type = "button";
    triangle.dataset.role = role;
    triangle.className = "module-triangle " + role + (pending ? " pending" : assignment ? " " + mapV2OutputState(assignment) : " unassigned");
    if (role === "backup" && !pending && assignment && mapV2OutputState(assignment) === "ok") {
      cell.className += " backup-active";
    }
    var title = "Module " + number + " · " + (role === "main" ? "Main" : "Backup");
    if (assignment) {
      title += " · " + (assignment.machineName || assignment.machineId) + " · Carte " + assignment.cardId + " / Sortie " + assignment.outputId;
      title += " · " + mapV2ModuleNumber(segment, pending ? mapV2Pending.start : range.start) + " → " + mapV2ModuleNumber(segment, pending ? mapV2Pending.end : range.end);
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
  label.textContent = String(number);
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
    node.style.setProperty("--segment-thickness", mapV2Thickness(segment, mapContent.clientWidth, mapContent.clientHeight) + "px");
    node.style[segment.orientation === "horizontal" ? "width" : "height"] = (segment.length * 100) + "%";
    for (var index = 0; index < segment.cases; index++) node.appendChild(mapV2CreateCell(segment, index, true));
    mapV2DrawPaths(node, segment);
    mapContent.appendChild(node);
  });
  mapZone.classList.toggle("editing", mapEditMode.checked && !!map);
  var maximize = document.getElementById("maximizeMapEditorButton");
  if (maximize) maximize.disabled = !map;
  mapV2UpdateNumbers(mapContent);
  var coverage = document.getElementById("moduleWiringCoverage");
  var selected = segmentById(selectedSegmentId);
  if (coverage) coverage.textContent = selected ? ["main", "backup"].map(function(role) {
    var count = new Set((selected.moduleRanges || []).filter(function(range) { return range.role === role; }).flatMap(mapV2RangeModules)).size;
    return (role === "main" ? "Main" : "Backup") + " : " + count + "/" + selected.cases + (count === selected.cases ? " (complet)" : " (incomplet)");
  }).join(" | ") : "";
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
  mapV2UpdateFinish();
  var hint = document.getElementById("moduleRangeHint");
  if (hint) hint.textContent = "Haut : Main · Bas : Backup. Cliquez sur un triangle et choisissez une sortie, puis sur le module d’arrivée. Échap annule. Ctrl + glisser : déplacer le bloc ; Ctrl + molette : rotation de 90°.";
}

function mapV2StartRange(assignment) {
  if (mapV2Saving || !mapEditMode.checked || selectedCaseIndex < 0) return;
  mapV2Pending = { mapId: selectedMapId, segmentId: selectedSegmentId, role: mapV2Role,
    start: selectedCaseIndex, end: selectedCaseIndex, assignment: Object.assign({}, assignment) };
  var segment = segmentById(selectedSegmentId);
  var main = mapV2Role === "backup" && mapV2RangeAt(segment, selectedCaseIndex, "main");
  if (main && main.end === selectedCaseIndex) {
    var modules = mapV2RangeModules(main).slice().reverse();
    segmentContextMenu.hidden = true;
    Object.assign(mapV2Pending, { start: modules[0], end: modules[modules.length - 1], modules: modules, automaticBackup: true });
    return mapV2FinishRange().finally(function() {
      if (mapV2Pending && mapV2Pending.automaticBackup) {
        mapV2CancelRange();
        renderMapSegments();
      }
    });
  }
  if (segment.wiringMode === "mouse" && mapV2RangeAt(segment, selectedCaseIndex, mapV2Role)) { mapV2CancelRange(); setStatus("Ce module est déjà câblé pour ce rôle", "error"); return; }
  if (segment.wiringMode === "mouse") {
    mapV2Pending.modules = [selectedCaseIndex];
    mapV2Pending.corners = [{ index: selectedCaseIndex, length: 1 }];
  }
  mapV2UpdateFinish();
  segmentContextMenu.hidden = true;
  document.getElementById("moduleRangeHint").textContent = (mapV2Role === "main" ? "Main" : "Backup") +
    " · Départ : module " + (selectedCaseIndex + 1) + ". Cliquez sur le triangle de même type du module d’arrivée dans ce bloc. Échap annule.";
  if (segment.wiringMode === "mouse") document.getElementById("moduleRangeHint").textContent = "Cliquez sur les angles puis sur l’arrivée (diagonales autorisées). Recliquez sur un angle pour annuler cet angle et la suite du parcours. Terminer le parcours pour enregistrer. Échap annule.";
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
  if (segment.wiringMode === "mouse") {
    var cornerIndex = mapV2Pending.corners.findIndex(function(corner) { return corner.index === selectedCaseIndex; });
    if (cornerIndex > 0) {
      var previousCorner = mapV2Pending.corners[cornerIndex - 1];
      mapV2Pending.modules = mapV2Pending.modules.slice(0, previousCorner.length);
      mapV2Pending.end = previousCorner.index;
      mapV2Pending.corners = mapV2Pending.corners.slice(0, cornerIndex);
      delete mapV2Pending.previewModules;
      delete mapV2Pending.previewIndex;
      renderMapSegments();
      setStatus("Angle annul\u00e9. Reprenez le parcours depuis le module " + (previousCorner.index + 1), "ok");
      return;
    }
    try {
      var added = mapV2LineModules(segment, mapV2Pending.end, selectedCaseIndex).slice(1);
      if (!added.length || added.some(function(index) { return mapV2Pending.modules.includes(index) || mapV2RangeAt(segment, index, mapV2Role); })) throw new Error("Un module ne peut être parcouru qu’une fois par rôle.");
      delete mapV2Pending.previewModules;
      delete mapV2Pending.previewIndex;
      mapV2Pending.modules = mapV2Pending.modules.concat(added);
      mapV2Pending.end = selectedCaseIndex;
      mapV2Pending.corners.push({ index: selectedCaseIndex, length: mapV2Pending.modules.length });
      renderMapSegments();
    } catch (error) { setStatus(error.message, "error"); }
    return;
  }
  mapV2Pending.end = selectedCaseIndex;
  await mapV2FinishRange();
}

async function mapV2FinishRange() {
  if (!mapV2Pending || mapV2Saving) return;
  var pending = mapV2Pending;
  var segment = segmentById(pending.segmentId);
  var map = selectedMap();
  var previous = JSON.parse(JSON.stringify(map.segments));
  var conflict = !pending.automaticBackup && mapV2RangeModules(pending).some(function(index) { return !!mapV2RangeAt(segment, index, pending.role); });
  if (conflict) { setStatus("Cette plage chevauche une plage existante : effacez d’abord son affectation", "error"); return; }
  segment.moduleRanges = segment.moduleRanges || [];
  if (pending.automaticBackup) {
    var replaced = new Set(mapV2RangeModules(pending));
    segment.moduleRanges = segment.moduleRanges.flatMap(function(range) {
      if (range.role !== "backup") return [range];
      var modules = mapV2RangeModules(range);
      if (!modules.some(function(index) { return replaced.has(index); })) return [range];
      var remaining = [], run = [];
      modules.concat(null).forEach(function(index) {
        if (index !== null && !replaced.has(index)) { run.push(index); return; }
        if (run.length) remaining.push(Object.assign({}, range, { start: run[0], end: run[run.length - 1], modules: run }));
        run = [];
      });
      return remaining;
    });
  }
  segment.moduleRanges.push({ role: pending.role, start: pending.start, end: pending.end, assignment: pending.assignment, ...(pending.modules ? { modules: pending.modules.slice() } : {}) });
  mapV2Saving = true;
  renderMapSegments();
  try {
    await saveMapSegments(map);
    mapV2CancelRange();
    setStatus("Plage " + mapV2ModuleNumber(segment, pending.start) + " → " + mapV2ModuleNumber(segment, pending.end) + " enregistrée", "ok");
  } catch (error) {
    map.segments = previous;
    setStatus(error.message, "error");
  } finally { mapV2Saving = false; renderMapSegments(); }
}

function mapV2ChooseBackup(main) {
  var dialog = document.getElementById("moduleBackupDialog");
  if (!dialog || !dialog.showModal) return;
  var form = document.getElementById("moduleBackupForm");
  var select = form.elements.output;
  var outputs = novastarOutputs().flatMap(function(device) {
    return device.cards.flatMap(function(card) { return card.outputs; });
  });
  select.replaceChildren(new Option(outputs.length ? "Choisir une sortie" : "Aucune sortie NovaStar disponible", ""));
  outputs.forEach(function(output, index) {
    select.add(new Option(output.machineName + " / Carte " + output.cardId + " / Sortie " + output.outputId, String(index)));
  });
  var modules = mapV2RangeModules(main).slice().reverse();
  var submit = form.querySelector('[type="submit"]');
  var error = document.getElementById("moduleBackupError");
  submit.disabled = !outputs.length;
  error.textContent = "";
  form.onsubmit = async function(event) {
    event.preventDefault();
    if (mapV2Saving || select.value === "") return;
    mapV2Pending = { mapId: main.mapId, segmentId: main.segmentId, role: "backup",
      start: modules[0], end: modules[modules.length - 1], modules: modules,
      assignment: outputs[Number(select.value)], automaticBackup: true };
    submit.disabled = true;
    await mapV2FinishRange();
    submit.disabled = false;
    if (!mapV2Pending) dialog.close();
    else error.textContent = "Le Backup n'a pas pu être enregistré. Réessayez.";
  };
  dialog.oncancel = function(event) { if (mapV2Saving) event.preventDefault(); };
  dialog.onclose = function() { mapV2CancelRange(); renderMapSegments(); };
  dialog.showModal();
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
  var transpose = document.getElementById("transposeSegmentButton");
  transpose.disabled = !segment || !segment.rows;
  transpose.onclick = mapV2Transpose;
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
  if (mapV2Pending.modules) {
    if (mapV2Pending.previewIndex === index) return;
    mapV2Pending.previewIndex = index;
    var segment = segmentById(mapV2Pending.segmentId);
    var added = mapV2LineModules(segment, mapV2Pending.end, index).slice(1);
    var valid = !added.some(function(item) { return mapV2Pending.modules.includes(item) || mapV2RangeAt(segment, item, mapV2Pending.role); });
    mapV2Pending.previewModules = valid ? mapV2Pending.modules.concat(added) : mapV2Pending.modules;
    renderMapSegments();
  } else if (index !== mapV2Pending.end) { mapV2Pending.end = index; renderMapSegments(); }
});
document.addEventListener("keydown", function(event) {
  if (event.key === "Escape" && mapZone.closest(".map-editor-fullscreen") && !event.target.closest("dialog[open]")) {
    event.preventDefault();
    mapV2SetEditorFullscreen(false);
    return;
  }
  if (event.key === "Escape" && !mapV2Saving) { mapV2CancelRange(); segmentContextMenu.hidden = true; renderMapSegments(); }
});

function mapV2RangeModules(range) {
  return range.modules || Array.from({ length: Math.abs(range.end - range.start) + 1 }, function(_, i) { return range.start + i * (range.end >= range.start ? 1 : -1); });
}
function mapV2CellPosition(segment, index) {
  var columns = segment.columns || segment.cases;
  if (segment.reversed) index = segment.cases - 1 - index;
  var row = Math.floor(index / columns), column = index % columns;
  var position;
  switch (segment.gridRotation || 0) {
    case 1: position = { row: column, column: segment.rows - 1 - row }; break;
    case 2: position = { row: segment.rows - 1 - row, column: columns - 1 - column }; break;
    case 3: position = { row: columns - 1 - column, column: row }; break;
    default: position = { row: row, column: column };
  }
  return segment.gridTransposed ? { row: position.column, column: position.row } : position;
}
function mapV2LineModules(segment, start, end) {
  var base = Object.assign({}, segment, { gridRotation: 0, gridTransposed: false });
  var a = mapV2CellPosition(base, start), b = mapV2CellPosition(base, end);
  var dx = b.column - a.column, dy = b.row - a.row;
  if (dx && dy) return [start, end];
  var steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (!steps) return [start];
  return Array.from({ length: steps + 1 }, function(_, i) {
    var index = (a.row + dy * i / steps) * segment.columns + a.column + dx * i / steps;
    return segment.reversed ? segment.cases - 1 - index : index;
  });
}
function mapV2Thickness(segment, width, height) {
  var horizontal = segment.orientation === "horizontal";
  var dimensions = mapV2GridDimensions(segment);
  var along = horizontal ? (dimensions.columns || segment.cases) : (dimensions.rows || segment.cases);
  var across = horizontal ? (dimensions.rows || 1) : (dimensions.columns || 1);
  var aspect = mapV2CellAspectRatio(segment);
  return Math.max(1, segment.length * (horizontal ? width : height) / along * across * (horizontal ? 1 / aspect : aspect));
}
function mapV2UpdateFinish() {
  var button = document.getElementById("finishModulePathButton");
  if (button) { button.hidden = !(mapV2Pending && mapV2Pending.modules); button.onclick = mapV2FinishRange; }
}
function mapV2PromptGrid(segment) {
  return new Promise(function(resolve) {
    var dialog = document.getElementById("moduleGridDialog"), form = document.getElementById("moduleGridForm");
    form.elements.rows.value = segment.rows || 1;
    form.elements.columns.value = segment.columns || segment.cases || 1;
    [form.elements.rows, form.elements.columns].forEach(function(input) {
      input.onfocus = function() { input.select(); };
      input.onclick = function() { input.select(); };
    });
    form.elements.wiringMode.value = segment.wiringMode || "numbering";
    dialog.returnValue = "";
    form.onsubmit = function(event) {
      event.preventDefault();
      var rows = Number(form.elements.rows.value), columns = Number(form.elements.columns.value);
      if (rows * columns > 500) { document.getElementById("moduleGridError").textContent = "La grille est limitée à 500 modules."; return; }
      dialog.close("save");
    };
    document.getElementById("moduleGridError").textContent = "";
    document.getElementById("cancelModuleGridButton").onclick = function() { dialog.close(); };
    dialog.onclose = function() { resolve(dialog.returnValue === "save" ? { rows: Number(form.elements.rows.value), columns: Number(form.elements.columns.value), cases: Number(form.elements.rows.value) * Number(form.elements.columns.value), wiringMode: form.elements.wiringMode.value } : null); };
    dialog.showModal();
  });
}

function mapV2GridDimensions(segment) {
  return mapV2AxesSwapped(segment) ? { rows: segment.columns, columns: segment.rows } : { rows: segment.rows, columns: segment.columns };
}
function mapV2DrawPaths(node, segment) {
  if (!segment.rows) return;
  var dimensions = mapV2GridDimensions(segment);
  var ranges = (segment.moduleRanges || []).slice();
  if (mapV2Pending && mapV2Pending.segmentId === segment.id) ranges.push(mapV2Pending);
  var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "module-wiring-path");
  svg.setAttribute("viewBox", "0 0 " + dimensions.columns * 100 + " " + dimensions.rows * 100);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  ranges.forEach(function(range) {
    var line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    var offset = range.role === "main" ? 38 : 62;
    line.setAttribute("points", (range.previewModules || mapV2RangeModules(range)).map(function(index) {
      var point = mapV2CellPosition(segment, index);
      return (point.column * 100 + offset) + "," + (point.row * 100 + offset);
    }).join(" "));
    line.setAttribute("class", range.role);
    svg.appendChild(line);
  });
  node.appendChild(svg);
}

// Rectangle coordinates are normalized to the background, independent of zoom/pan.
function mapV2SelectionRect(start, end) {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}
function mapV2GridFromRectangle(rect, grid, width, height) {
  return Object.assign({}, grid, { orientation: "horizontal", reversed: false,
    x: rect.x, y: rect.y + rect.height / 2, length: rect.width,
    cellAspectRatio: rect.width * width * grid.rows / (rect.height * height * grid.columns) });
}
function mapV2CellAspectRatio(segment) {
  var aspect = Number(segment.cellAspectRatio) || 1;
  return mapV2AxesSwapped(segment) ? 1 / aspect : aspect;
}


function mapV2AxesSwapped(segment) {
  return Boolean((segment.gridRotation || 0) % 2) !== Boolean(segment.gridTransposed);
}

async function mapV2Transpose() {
  var segment = segmentById(selectedSegmentId);
  var map = selectedMap();
  if (!mapEditMode.checked || mapV2Saving || !segment || !segment.rows || !map) return;
  var width = mapContent.clientWidth, height = mapContent.clientHeight;
  if (!(width > 0 && height > 0)) return;
  var previous = Object.assign({}, segment);
  var geometry = Object.assign({}, segment, { gridTransposed: !segment.gridTransposed });
  var dimensions = mapV2GridDimensions(segment);
  var ratio = segment.orientation === "horizontal"
    ? dimensions.columns / dimensions.rows
    : dimensions.rows / dimensions.columns;
  var aspect = mapV2CellAspectRatio(segment) * ratio * ratio;
  geometry.cellAspectRatio = mapV2AxesSwapped(geometry) ? 1 / aspect : aspect;
  segmentContextMenu.hidden = true;
  mapV2CancelRange();
  mapV2Saving = true;
  try {
    Object.assign(segment, geometry);
    await saveMapSegments(map);
    setStatus("Lignes et colonnes inversées", "ok");
  } catch (error) {
    Object.assign(segment, previous, {
      gridTransposed: previous.gridTransposed,
      cellAspectRatio: previous.cellAspectRatio
    });
    setStatus(error.message, "error");
  } finally {
    mapV2Saving = false;
    renderMapSegments();
  }
}
