(function () {
  "use strict";

  var body = document.body;
  if (!body || body.dataset.browserLogsEnabled !== "true") return;
  var endpoint = "/api/ui-logs";
  var interval = positiveNumber(body.dataset.browserLogBatchMs, 5000);
  var queue = [];
  var sending = false;
  var originals = {};

  ["debug", "info", "warn", "error"].forEach(function (consoleLevel) {
    if (typeof console[consoleLevel] !== "function") return;
    originals[consoleLevel] = console[consoleLevel].bind(console);
    console[consoleLevel] = function () {
      originals[consoleLevel].apply(console, arguments);
      enqueue(consoleLevel === "warn" ? "warning" : consoleLevel, moduleFromStack(new Error().stack), serialize(arguments));
    };
  });

  window.addEventListener("error", function (event) {
    enqueue("error", moduleFromPath(event.filename), event.message || "Browser error");
  });
  window.addEventListener("unhandledrejection", function (event) {
    enqueue("error", "promise", "Unhandled promise rejection: " + valueToText(event.reason));
  });
  document.addEventListener("click", logUserClick);
  window.setInterval(flush, interval);
  window.addEventListener("pagehide", function () { flush(true); });

  function enqueue(level, module, message, metadata) {
    queue.push({
      timestamp: new Date().toISOString(),
      level: level,
      module: String(module || "browser").slice(0, 64),
      message: String(message || "").slice(0, 4000),
      page: location.pathname,
      metadata: metadata || undefined
    });
    if (queue.length > 200) queue.splice(0, queue.length - 200);
    if (level === "error") flush();
  }

  function logUserClick(event) {
    var control = event.target && event.target.closest &&
      event.target.closest("button, a, input[type=checkbox], input[type=radio], [role=button]");
    if (!control || control.disabled) return;
    var action = describeAction(control);
    var targetId = action.targetId || control.dataset.monitoringMinimize ||
      control.dataset.monitoringMaximize || control.dataset.monitoringRefresh || control.dataset.machineId || "";
    enqueue("info", "UserInteraction", action.message, {
      action: action.action,
      controlId: String(control.id || "").slice(0, 80),
      targetId: String(targetId || "").slice(0, 80),
      targetName: String(action.targetName || machineName(targetId) || "").slice(0, 160),
      label: controlLabel(control).slice(0, 160),
      checked: control.matches("input[type=checkbox], input[type=radio]") ? control.checked : undefined,
      destination: control.tagName === "A" ? String(control.getAttribute("href") || "").slice(0, 256) : undefined
    });
  }

  function describeAction(control) {
    var id = control.id || "";
    var routes = {
      openConfiguration: ["switch-page", "User switched to Configuration"],
      openMonitoring: ["switch-page", "User switched to Monitoring"],
      mapMonitoringLink: ["switch-page", "User switched to Monitoring Map"],
      openMapConfiguration: ["switch-page", "User switched to Map Configuration"],
      openMapMonitoring: ["switch-page", "User switched to Monitoring Map"]
    };
    if (routes[id]) return { action: routes[id][0], message: routes[id][1] };
    if (id === "refreshMonitoring") return { action: "refresh-all", message: "User clicked Refresh all" };
    if (id === "toggleMonitoringView") {
      return { action: "toggle-all-cards", message: "User clicked " + controlLabel(control) };
    }
    if (control.dataset.monitoringMinimize) {
      return cardAction("minimize-card", "User minimized monitoring card", control.dataset.monitoringMinimize);
    }
    if (control.dataset.monitoringMaximize) {
      return cardAction("maximize-card", "User maximized monitoring card", control.dataset.monitoringMaximize);
    }
    if (control.dataset.monitoringRefresh) {
      return cardAction("refresh-card", "User refreshed monitoring card", control.dataset.monitoringRefresh);
    }
    if (control.classList.contains("tab")) {
      return { action: "switch-page", message: "User switched to " + controlLabel(control) };
    }
    var label = controlLabel(control);
    return { action: "click", message: "User clicked " + (label || id || control.tagName.toLowerCase()) };
  }

  function cardAction(action, message, targetId) {
    var name = machineName(targetId);
    return { action: action, message: message + (name ? " " + name : " " + targetId), targetId: targetId, targetName: name };
  }

  function machineName(machineId) {
    if (machineId === "__ping__") return "Ping";
    var list = window.machines;
    if (!Array.isArray(list)) return "";
    var machine = list.find(function (item) { return String(item.id) === String(machineId); });
    return machine ? String(machine.name || machine.host || "") : "";
  }

  function controlLabel(control) {
    return String(control.getAttribute("aria-label") || control.title || control.textContent || "")
      .replace(/\s+/g, " ").trim();
  }

  function flush(useBeacon) {
    if (sending || !queue.length) return;
    var events = queue.splice(0, 50);
    var payload = JSON.stringify({ events: events });
    if (useBeacon && navigator.sendBeacon) {
      if (!navigator.sendBeacon(endpoint, new Blob([payload], { type: "application/json" }))) queue.unshift.apply(queue, events);
      return;
    }
    sending = true;
    fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: payload })
      .then(function (response) { if (!response.ok) queue.unshift.apply(queue, events); })
      .catch(function () { queue.unshift.apply(queue, events); })
      .finally(function () { sending = false; });
  }

  function serialize(values) {
    return Array.prototype.map.call(values, valueToText).join(" ");
  }

  function valueToText(value) {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === "string") return value;
    try {
      var seen = [];
      return JSON.stringify(value, function (key, item) {
        if (/^key$/i.test(key) || /password|community|secret|token|authorization|cookie|api.?key|private.?key/i.test(key)) return "[redacted]";
        if (item && typeof item === "object") {
          if (seen.indexOf(item) !== -1) return "[circular]";
          seen.push(item);
        }
        return item;
      });
    } catch (_) { return String(value); }
  }

  function moduleFromStack(stack) {
    var match = String(stack || "").match(/\/javascripts\/([^/?#:]+\.js)/);
    return match ? match[1] : "browser";
  }

  function moduleFromPath(path) {
    var match = String(path || "").match(/\/([^/?#:]+\.js)(?:[?#:]|$)/);
    return match ? match[1] : "browser";
  }

  function positiveNumber(value, fallback) {
    var number = Number(value);
    return isFinite(number) && number > 0 ? number : fallback;
  }
}());
