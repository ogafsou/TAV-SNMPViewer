const fs = require("fs");
const path = require("path");

class MapStore {
  constructor(filePath) { this.filePath = filePath; }

  load() {
    if (!fs.existsSync(this.filePath)) { this.save([]); return []; }
    const value = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    return Array.isArray(value) ? value.map(normalizeMap) : [];
  }

  save(maps) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const normalized = maps.map(normalizeMap);
    const temporaryPath = this.filePath + "." + process.pid + ".tmp";
    fs.writeFileSync(temporaryPath, JSON.stringify(normalized, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporaryPath, this.filePath);
    return normalized;
  }

  create(input) {
    const maps = this.load();
    const map = normalizeMap({ id: String(Date.now()) + "-" + Math.random().toString(16).slice(2), name: input && input.name });
    validateMap(map);
    maps.push(map); this.save(maps); return map;
  }

  update(id, patch) {
    const maps = this.load();
    const index = maps.findIndex((map) => map.id === String(id));
    if (index < 0) throw notFound();
    maps[index] = normalizeMap(Object.assign({}, maps[index], { name: patch && patch.name }));
    validateMap(maps[index]); this.save(maps); return maps[index];
  }

  remove(id) {
    const maps = this.load();
    const index = maps.findIndex((map) => map.id === String(id));
    if (index < 0) throw notFound();
    const removed = maps.splice(index, 1)[0]; this.save(maps);
    const background = this.backgroundPath(removed);
    if (background && fs.existsSync(background)) fs.unlinkSync(background);
    return removed;
  }

  setBackground(id, buffer, mimeType) {
    const maps = this.load();
    const index = maps.findIndex((map) => map.id === String(id));
    if (index < 0) throw notFound();
    const extension = extensionForMimeType(mimeType);
    if (!extension) { const error = new Error("Format d'image non supporte"); error.status = 415; throw error; }
    const previousPath = this.backgroundPath(maps[index]);
    maps[index].backgroundMimeType = mimeType;
    maps[index].backgroundExtension = extension;
    const target = this.backgroundPath(maps[index]);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buffer, { mode: 0o600 });
    if (previousPath && previousPath !== target && fs.existsSync(previousPath)) fs.unlinkSync(previousPath);
    this.save(maps);
    return normalizeMap(maps[index]);
  }

  setSegments(id, segments) {
    const maps = this.load();
    const index = maps.findIndex((map) => map.id === String(id));
    if (index < 0) throw notFound();
    maps[index].segments = normalizeSegments(segments);
    this.save(maps);
    return normalizeMap(maps[index]);
  }

  backgroundPath(map) {
    if (!map || !map.backgroundExtension) return "";
    return path.join(this.filePath + ".assets", map.id + "." + map.backgroundExtension);
  }

  find(id) { return this.load().find((map) => map.id === String(id)) || null; }
}

function normalizeMap(value) {
  const map = { id: String(value.id || ""), name: String(value.name || "").trim(), segments: normalizeSegments(value.segments) };
  if (extensionForMimeType(value.backgroundMimeType) === value.backgroundExtension) {
    map.backgroundMimeType = value.backgroundMimeType;
    map.backgroundExtension = value.backgroundExtension;
    map.backgroundUrl = "/api/maps/" + encodeURIComponent(map.id) + "/background";
  }
  return map;
}
function normalizeSegments(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).map((segment) => {
    const cases = Math.round(clampNumber(segment.cases, 1, 500));
    return {
      id: String(segment.id || "").slice(0, 100),
      orientation: segment.orientation === "vertical" ? "vertical" : "horizontal",
      x: clampNumber(segment.x, 0, 1),
      y: clampNumber(segment.y, 0, 1),
      length: clampNumber(segment.length, 0.005, 1),
      cases,
      assignments: normalizeAssignments(segment.assignments, cases)
    };
  }).filter((segment) => segment.id);
}
function normalizeAssignments(value, cases) {
  const assignments = Array.isArray(value) ? value : [];
  return Array.from({ length: cases }, (_, index) => normalizeAssignment(assignments[index]));
}
function normalizeAssignment(value) {
  if (!value || typeof value !== "object") return null;
  const machineId = String(value.machineId || "").slice(0, 100);
  const machineName = String(value.machineName || "").trim().slice(0, 100);
  const cardId = String(value.cardId || "").slice(0, 50);
  const outputId = String(value.outputId || "").slice(0, 50);
  if (!machineId || !cardId || !outputId) return null;
  return { machineId, machineName, cardId, outputId };
}
function clampNumber(value, min, max) { const number = Number(value); return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min; }
function extensionForMimeType(value) { return ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" })[String(value || "").toLowerCase()] || ""; }
function validateMap(map) { if (!map.name) { const error = new Error("Le nom de la map est obligatoire"); error.status = 400; throw error; } }
function notFound() { const error = new Error("Map introuvable"); error.status = 404; return error; }

module.exports = { MapStore };
