const SCHEMA_VERSION = 1;

function canonicalizeIo(data, sourceName) {
  const source = String(sourceName || data.source || "unknown");
  data.source = source;
  const observedAt = data.timestamp || new Date().toISOString();
  const entities = [];
  const observations = [];

  for (const slot of slotsOf(data.inputSlots)) {
    const position = slotPosition(slot.slotId, slot.rawSlotId);
    const slotId = `input:I-${position}`;
    add(entities, observations, slotId, "input-slot", `I-${position}`, null, slot.fields, source, observedAt);
    for (const input of slot.inputSources || []) {
      const sourceId = numberOrText(input.sourceId);
      add(entities, observations, `${slotId}:${sourceId}`, "input", String(sourceId), slotId, input.fields, source, observedAt);
    }
  }

  for (const slot of slotsOf(data.outputSlots)) {
    const position = slotPosition(slot.slotId, slot.rawSlotId);
    const slotId = `output:O-${position}`;
    add(entities, observations, slotId, "output-slot", `O-${position}`, null, slot.fields, source, observedAt);
    for (const port of slot.outputPorts || []) {
      const portId = numberOrText(port.portId);
      add(entities, observations, `${slotId}:${portId}`, "output", String(portId), slotId,
        port.fields || { status: field(port.status) }, source, observedAt);
    }
  }

  for (const screen of screensOf(data.screens)) {
    const screenId = numberOrText(screen.screenId);
    add(entities, observations, `screen:${screenId}`, "screen", String(screenId), null, screen.fields, source, observedAt);
  }

  for (const card of data.receivingCards || []) {
    const position = slotPosition(card.outputSlotId);
    const portId = numberOrText(card.netPortId);
    const cardId = numberOrText(card.recvCardId);
    const parentId = `output:O-${position}:${portId}`;
    add(entities, observations, `${parentId}:receiving:${cardId}`, "receiving-card", String(cardId), parentId,
      card.fields, source, observedAt);
  }

  delete data.inputSlots;
  delete data.outputSlots;
  delete data.screens;
  delete data.receivingCards;
  data.inventory = { schemaVersion: SCHEMA_VERSION, entities: unique(entities) };
  data.observations = { schemaVersion: SCHEMA_VERSION, collectedAt: observedAt, items: observations };
  data.resolvedState = resolveIo(data.inventory, data.observations);
  data.divergences = buildDivergenceReport(data.inventory, data.observations, data.resolvedState, [source]);
  return data;
}

function combineIo(target, sources, policy) {
  const sourceList = (sources || []).filter(Boolean);
  const api = sourceList.find((item) => item.source === "api");
  const snmp = sourceList.find((item) => item.source === "snmp");
  const rules = reconciliationPolicy(policy);
  target.inventory = {
    schemaVersion: SCHEMA_VERSION,
    // L'API décrit prioritairement l'inventaire, sans masquer un élément vu uniquement en SNMP.
    entities: reconcileInventory(api, snmp, rules.inventory_strategy)
  };
  target.observations = {
    schemaVersion: SCHEMA_VERSION,
    collectedAt: target.timestamp || new Date().toISOString(),
    items: sourceList.flatMap((item) => item.observations && item.observations.items || [])
  };
  target.resolvedState = resolveIo(target.inventory, target.observations, rules);
  target.divergences = buildDivergenceReport(
    target.inventory,
    target.observations,
    target.resolvedState,
    ["snmp", "api"]
  );
  return target;
}

function buildDivergenceReport(inventory, observations, resolvedState, expectedSources) {
  const generatedAt = observations.collectedAt || new Date().toISOString();
  const sources = uniqueValues((expectedSources || []).map(String));
  const items = [];

  for (const entity of inventory.entities || []) {
    const bySource = Object.fromEntries(sources.map((source) => [
      source,
      (observations.items || []).find((item) => item.entityId === entity.id && item.source === source)
    ]));
    const missingSources = sources.filter((source) => !bySource[source]);
    if (missingSources.length && missingSources.length < sources.length) {
      items.push(divergenceItem(entity, null, "missing-observation", bySource, resolvedState, generatedAt));
      continue;
    }
    if (missingSources.length) continue;

    const fieldNames = uniqueValues(sources.flatMap((source) => Object.keys(bySource[source].fields || {})));
    for (const fieldName of fieldNames) {
      const missingFieldSources = sources.filter((source) => !hasOwn(bySource[source].fields, fieldName));
      if (missingFieldSources.length) {
        items.push(divergenceItem(entity, fieldName, "missing-field", bySource, resolvedState, generatedAt));
        continue;
      }
      const comparison = compareFields(entity.kind, fieldName, sources.map((source) => bySource[source].fields[fieldName]));
      if (!comparison.equal) {
        items.push(divergenceItem(entity, fieldName, comparison.reason, bySource, resolvedState, generatedAt));
      }
    }
  }

  const affected = uniqueValues(items.map((item) => item.entityId));
  affected.forEach((entityId) => {
    if (resolvedState[entityId]) resolvedState[entityId].agreement = false;
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    sources,
    summary: {
      total: items.length,
      affectedEntities: affected.length,
      missingObservations: countReason(items, "missing-observation"),
      missingFields: countReason(items, "missing-field"),
      stateMismatches: countReason(items, "state-mismatch"),
      valueMismatches: countReason(items, "value-mismatch")
    },
    items
  };
}

function divergenceItem(entity, fieldName, reason, bySource, resolvedState, detectedAt) {
  const observations = {};
  Object.entries(bySource).forEach(([source, observation]) => {
    const fieldValue = observation && fieldName !== null ? observation.fields && observation.fields[fieldName] : undefined;
    observations[source] = {
      present: !!observation && (fieldName === null || fieldValue !== undefined),
      observedAt: observation && observation.observedAt || null,
      value: fieldValue === undefined ? null : rawFieldValue(fieldValue),
      state: fieldValue === undefined ? "unknown" : normalizedFieldState(fieldValue, entity.kind)
    };
  });
  const resolved = resolvedState[entity.id] || {};
  const selectedField = fieldName !== null && resolved.fields && resolved.fields[fieldName];
  return {
    entityId: entity.id,
    kind: entity.kind,
    label: entity.label,
    field: fieldName,
    reason,
    detectedAt,
    observations,
    selected: {
      source: resolved.source || "none",
      state: fieldName === null ? resolved.state || "unknown" : normalizedFieldState(selectedField, entity.kind),
      value: selectedField === undefined ? null : rawFieldValue(selectedField)
    }
  };
}

function compareFields(kind, fieldName, fields) {
  if (semanticField(fieldName)) {
    const states = fields.map((fieldValue) => normalizedFieldState(fieldValue, kind));
    const knownStates = states.filter((state) => state !== "unknown");
    if (knownStates.length === states.length) {
      return knownStates.every((state) => state === knownStates[0])
        ? { equal: true }
        : { equal: false, reason: "state-mismatch" };
    }
  }
  const values = fields.map((item) => stableValue(rawFieldValue(item)));
  return values.every((value) => value === values[0])
    ? { equal: true }
    : { equal: false, reason: "value-mismatch" };
}

function resolveIo(inventory, observations, policy) {
  const rules = reconciliationPolicy(policy);
  const resolved = {};
  for (const entity of inventory.entities || []) {
    const candidates = (observations.items || []).filter((item) => item.entityId === entity.id);
    const usable = candidates.filter((item) => usableFields(item.fields));
    const snmp = usable.find((item) => item.source === "snmp");
    const api = usable.find((item) => item.source === "api");
    const result = reconcileObservation(entity, snmp, api, rules);
    const chosen = result.observation;
    const states = usable.map((item) => normalizedState(item.fields, entity.kind));
    resolved[entity.id] = {
      state: result.state,
      source: chosen ? chosen.source : "none",
      agreement: states.length < 2 || states.every((state) => state === states[0]),
      fields: chosen ? chosen.fields : {},
      observations: candidates.map((item) => item.source),
      reason: result.reason,
      confidence: result.confidence
    };
  }
  return resolved;
}

function reconcileInventory(api, snmp, strategy) {
  const apiEntities = api && api.inventory && api.inventory.entities || [];
  const snmpEntities = snmp && snmp.inventory && snmp.inventory.entities || [];
  if (strategy === "api-only") return unique(apiEntities);
  if (strategy === "snmp-only") return unique(snmpEntities);
  if (strategy === "intersection") {
    const snmpIds = new Set(snmpEntities.map((item) => item.id));
    return unique(apiEntities.filter((item) => snmpIds.has(item.id)));
  }
  return strategy === "union-snmp-first"
    ? unique(snmpEntities.concat(apiEntities))
    : unique(apiEntities.concat(snmpEntities));
}

function reconcileObservation(entity, snmp, api, rules) {
  const available = [snmp, api].filter(Boolean);
  if (!available.length) return decision(null, rules.missing_state, "no-valid-observation", "low");
  if (available.length === 1) {
    const only = available[0];
    const allowed = rules.single_source_strategy === "use-available" ||
      (rules.single_source_strategy === "snmp-required" && only.source === "snmp") ||
      (rules.single_source_strategy === "api-required" && only.source === "api");
    return allowed
      ? decision(only, normalizedState(only.fields, entity.kind), only.source + "-only", "medium")
      : decision(null, rules.missing_state, "required-source-missing", "low");
  }
  const snmpState = normalizedState(snmp.fields, entity.kind);
  const apiState = normalizedState(api.fields, entity.kind);
  if (snmpState === apiState) {
    const preferred = operationalKind(entity.kind) ? snmp : api;
    return decision(preferred, snmpState, "sources-agree", "high");
  }
  if (rules.operational_strategy === "unknown-on-conflict") return decision(null, "unknown", "conflict-marked-unknown", "low");
  if (rules.operational_strategy === "snmp-first") return decision(snmp, snmpState, "snmp-preferred", "low");
  if (rules.operational_strategy === "api-first") return decision(api, apiState, "api-preferred", "low");
  const worst = rules.operational_strategy === "worst-valid-state";
  const chosen = chooseBySeverity(entity.kind, snmp, api, worst);
  return decision(chosen, normalizedState(chosen.fields, entity.kind), worst ? "worst-state-on-conflict" : "best-state-on-conflict", "low");
}

function chooseBySeverity(kind, snmp, api, worst) {
  const rank = { error: 4, warning: 3, unknown: 2, inactive: 1, ok: 0 };
  const snmpRank = rank[normalizedState(snmp.fields, kind)] ?? rank.unknown;
  const apiRank = rank[normalizedState(api.fields, kind)] ?? rank.unknown;
  if (snmpRank === apiRank) return snmp;
  return worst ? (snmpRank > apiRank ? snmp : api) : (snmpRank < apiRank ? snmp : api);
}

function decision(observation, state, reason, confidence) { return { observation, state, reason, confidence }; }
function reconciliationPolicy(value) {
  return Object.assign({
    inventory_strategy: "union-api-first",
    operational_strategy: "worst-valid-state",
    single_source_strategy: "use-available",
    missing_state: "unknown"
  }, value || {});
}

function selectIo(data) {
  const entities = data.inventory && data.inventory.entities || [];
  const resolved = data.resolvedState || {};
  const byKind = (kind) => entities.filter((entity) => entity.kind === kind);
  const children = (parentId, kind) => entities.filter((entity) => entity.parentId === parentId && entity.kind === kind);
  const item = (entity) => ({
    id: entity.id,
    label: entity.label,
    parentId: entity.parentId,
    fields: resolved[entity.id] && resolved[entity.id].fields || {},
    state: resolved[entity.id] && resolved[entity.id].state || "unknown",
    source: resolved[entity.id] && resolved[entity.id].source || "none",
    agreement: resolved[entity.id] && resolved[entity.id].agreement !== false
  });
  return {
    inputSlots: byKind("input-slot").map((entity) => Object.assign(item(entity), {
      inputs: children(entity.id, "input").map(item)
    })),
    outputSlots: byKind("output-slot").map((entity) => Object.assign(item(entity), {
      outputs: children(entity.id, "output").map(item)
    })),
    screens: byKind("screen").map(item),
    receivingCards: byKind("receiving-card").map(item)
  };
}

function add(entities, observations, id, kind, label, parentId, fields, source, observedAt) {
  entities.push({ id, kind, label, parentId: parentId || null });
  observations.push({ entityId: id, source, observedAt, fields: fields || {} });
}

function normalizedState(fields, kind) {
  const candidate = fields && (fields.status || fields.workingStatus || fields.netPortLinkStatus);
  if (!candidate || candidate.ok === false) return "unknown";
  const value = candidate.value !== undefined ? candidate.value : candidate;
  const numeric = Number(value);
  if (["input", "output"].includes(kind) && Number.isFinite(numeric)) {
    if (numeric === 0) return "inactive";
    if (kind === "output") return numeric === 1 || numeric === 3 ? "ok" : "warning";
    return "ok";
  }
  if (value === 1 || /^(1|ok|normal|online|connected|up|true)$/i.test(String(value))) return "ok";
  if (value === 0 || /^(0|error|abnormal|offline|disconnected|down|false)$/i.test(String(value))) return "error";
  return "unknown";
}

function normalizedFieldState(fieldValue, kind) {
  if (fieldValue === undefined || fieldValue === null || fieldValue.ok === false) return "unknown";
  const value = rawFieldValue(fieldValue);
  const numeric = Number(value);
  if (["input", "output"].includes(kind) && Number.isFinite(numeric)) {
    if (numeric === 0) return "inactive";
    if (kind === "output") return numeric === 1 || numeric === 3 ? "ok" : "warning";
    return "ok";
  }
  if (value === 1 || /^(1|ok|normal|online|connected|up|true|active|present)$/i.test(String(value).trim())) return "ok";
  if (value === 0 || /^(0|error|abnormal|offline|disconnected|down|false|inactive|absent)$/i.test(String(value).trim())) return "error";
  return "unknown";
}

function usableFields(fields) {
  return fields && Object.values(fields).some((value) => value && value.ok !== false && value.state !== "notApplicable");
}

function operationalKind(kind) { return ["input", "output", "screen", "receiving-card"].includes(kind); }
function semanticField(fieldName) { return /(status|signal|link)$/i.test(String(fieldName)); }
function unique(items) { return Array.from(new Map(items.map((item) => [item.id, item])).values()); }
function uniqueValues(items) { return Array.from(new Set(items)); }
function countReason(items, reason) { return items.filter((item) => item.reason === reason).length; }
function hasOwn(value, key) { return !!value && Object.prototype.hasOwnProperty.call(value, key); }
function rawFieldValue(value) { return value && typeof value === "object" && "value" in value ? value.value : value; }
function stableValue(value) {
  if (value && typeof value === "object") return JSON.stringify(sortObject(value));
  return JSON.stringify(value);
}
function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => { result[key] = sortObject(value[key]); return result; }, {});
}
function slotsOf(value) { return value && Array.isArray(value.slots) ? value.slots : []; }
function screensOf(value) { return value && Array.isArray(value.screens) ? value.screens : []; }
function slotPosition(value, rawValue) {
  if (rawValue !== undefined && rawValue !== null && rawValue !== "") return Number(rawValue) + 1;
  const match = String(value === undefined ? "" : value).match(/(\d+)$/);
  return match ? Number(match[1]) : String(value);
}
function numberOrText(value) { return Number.isFinite(Number(value)) ? Number(value) : String(value); }
function field(value) { return { ok: true, value }; }

module.exports = { SCHEMA_VERSION, canonicalizeIo, combineIo, resolveIo, buildDivergenceReport, selectIo, slotPosition };
