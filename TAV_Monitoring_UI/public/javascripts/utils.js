function summaryTile(label, value) {
  return '<div class="metric"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
}

function fieldTile(label, field) {
  var value = fieldValue(field) || "-";
  var className = field && field.ok === false ? "field bad" : "field";
  if (field && field.state === "notApplicable") {
    className += " muted";
  }
  var title = field && field.error ? ' title="' + escapeHtml(field.oid + " - " + field.error) + '"' : "";

  return '<div class="' + className + '"' + title + '><span>' + escapeHtml(label) + '</span>' +
    '<div class="field-value">' + valueHtml(value) + '</div></div>';
}

function fieldValue(field) {
  if (!field) {
    return "";
  }

  if (field.ok === false && field.error) {
    return "Erreur";
  }

  return String(field.value || "");
}

function cell(value, className) {
  return '<td class="' + (className || "") + '">' + valueHtml(value === "" || value === null || value === undefined ? "-" : value) + '</td>';
}

function valueHtml(value) {
  var text = String(value === null || value === undefined ? "" : value);
  var json = tryParseJson(text);

  if (!json) {
    return escapeHtml(text).replace(/\n/g, "<br />");
  }

  return '<details class="json-collapse">' +
    '<summary>+ JSON</summary>' +
    '<pre>' + escapeHtml(JSON.stringify(json, null, 2)) + '</pre>' +
  '</details>';
}

function tryParseJson(value) {
  var text = String(value || "").trim();

  if (!text || ["{", "["].indexOf(text.charAt(0)) === -1) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function plural(count, label) {
  return count + " " + label + (count > 1 ? "s" : "");
}

function formatDate(value) {
  return new Date(value).toLocaleString("fr-FR");
}

function setStatus(text, state) {
  statusNode.textContent = text;
  statusNode.className = "status-pill " + (state || "");
}

function normalizeAccessMethod(value) {
  var method = String(value || "snmp").toLowerCase();
  return method === "api" || method === "snmp+api" ? method : "snmp";
}

function normalizeMachineType(value) {
  var type = String(value || "novastar-h").toLowerCase();
  return ["novastar-h", "kiloview", "netgear-m4300", "other"].indexOf(type) !== -1 ? type : "novastar-h";
}

function machineTypeLabel(value) {
  var type = normalizeMachineType(value);
  if (type === "kiloview") return "Kiloview";
  if (type === "netgear-m4300") return "NETGEAR M4300";
  if (type === "other") return "Ping";
  return "NovaStar H";
}

function accessMethodLabel(value) {
  var method = normalizeAccessMethod(value);
  return method === "snmp+api" ? "SNMP + API" : method.toUpperCase();
}

function apiProtocolValue(machine) {
  return machine && (machine.apiProtocol === "openapi" || (!machine.apiProtocol && machine.apiProjectId)) ? "openapi" : "legacy";
}

function apiProtocolLabel(machine) {
  return apiProtocolValue(machine) === "openapi" ? "OpenAPI" : "API Web legacy";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
