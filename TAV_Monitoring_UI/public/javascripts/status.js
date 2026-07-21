(function () {
  "use strict";
  const token = window.location.hash.slice(1);
  // Le fragment contient le jeton et n'est jamais transmis dans l'URL HTTP.
  history.replaceState(null, "", window.location.pathname);
  if (!token) return showError("Ce lien de statut est incomplet.");

  fetch("/api/public/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "omit",
    cache: "no-store",
    body: JSON.stringify({ token })
  }).then(async function (response) {
    const body = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(body.error || "Impossible de charger le statut.");
    render(body);
  }).catch(function (error) { showError(error.message); });

  function render(status) {
    document.getElementById("statusSummary").className = "summary state-" + safeState(status.state);
    document.getElementById("statusLabel").textContent = status.label;
    document.getElementById("updatedAt").textContent = "Actualisé le " + formatDate(status.generatedAt);
    document.getElementById("okCount").textContent = status.counts.ok;
    document.getElementById("warningCount").textContent = status.counts.warning;
    document.getElementById("errorCount").textContent = status.counts.error;
    document.getElementById("counts").hidden = false;
    const list = document.getElementById("machines");
    list.replaceChildren();
    status.machines.forEach(function (machine) {
      const row = document.createElement("article");
      row.className = "machine state-" + safeState(machine.state);
      const body = document.createElement("div");
      body.className = "machine-body";
      const name = document.createElement("strong");
      const detail = document.createElement("span");
      const badge = document.createElement("span");
      name.textContent = machine.name;
      detail.textContent = machine.issues ? machine.issues + " anomalie(s) détectée(s)" : "Aucune anomalie détectée";
      badge.className = "badge";
      badge.textContent = machine.label;
      body.append(name, detail);
      if (machine.anomalies && machine.anomalies.length) {
        const anomalies = document.createElement("ul");
        anomalies.className = "anomaly-list";
        machine.anomalies.forEach(function (anomaly) {
          const item = document.createElement("li");
          item.className = "state-" + safeState(anomaly.state);
          const label = document.createElement("span");
          const comparison = document.createElement("span");
          const expected = document.createElement("small");
          const status = document.createElement("strong");
          label.textContent = anomaly.label;
          expected.textContent = "Référence : " + anomaly.expected;
          status.textContent = "Actuel : " + anomaly.status;
          comparison.className = "anomaly-comparison";
          comparison.append(expected, status);
          item.append(label, comparison);
          anomalies.append(item);
        });
        if (machine.hiddenIssues) {
          const more = document.createElement("li");
          more.className = "more-anomalies";
          more.textContent = "+ " + machine.hiddenIssues + " autre(s) anomalie(s)";
          anomalies.append(more);
        }
        body.append(anomalies);
      }
      row.append(body, badge);
      list.append(row);
    });
    if (!status.machines.length) list.textContent = "Aucun résultat de monitoring disponible.";
  }

  function showError(message) {
    document.getElementById("statusSummary").hidden = true;
    const error = document.getElementById("statusError");
    error.textContent = message + " Demandez une nouvelle notification si le lien a expiré.";
    error.hidden = false;
    document.getElementById("updatedAt").textContent = "Statut indisponible";
  }

  function safeState(value) { return ["ok", "warning", "error", "unknown"].includes(value) ? value : "unknown"; }
  function formatDate(value) { return new Date(value).toLocaleString("fr-FR"); }
})();
