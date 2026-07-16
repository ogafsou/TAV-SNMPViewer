const configForm = document.getElementById("configForm");
const portsNode = document.getElementById("ports");
let state;
let saveTimer;

async function load() {
  state = await request("/simulator/api/state");
  Object.keys(state.config).forEach((key) => { if (configForm.elements[key]) configForm.elements[key].value = state.config[key]; });
  document.getElementById("snmpConnection").textContent = `Port SNMP : ${state.connection.port} · communauté : ${state.connection.community}`;
  renderPorts();
}

function renderPorts() {
  portsNode.innerHTML = state.ports.map((port) => `
    <article class="port-card ${port.linkUp ? "up" : "down"}" data-index="${port.index}">
      <div class="port-title"><strong>${escapeHtml(port.name)}</strong><span>${port.linkUp ? "Lien actif" : "Lien inactif"}</span><button class="delete" type="button">×</button></div>
      <div class="port-grid">
        <label>Nom<input name="name" value="${escapeHtml(port.name)}"></label>
        <label>Description<input name="description" value="${escapeHtml(port.description)}"></label>
        <label>Média<select name="media"><option value="copper" ${port.media === "copper" ? "selected" : ""}>Cuivre</option><option value="fiber" ${port.media === "fiber" ? "selected" : ""}>Optique</option></select></label>
        <label>Débit (Mb/s)<input name="speedMbps" type="number" min="0" value="${port.speedMbps}"></label>
      </div>
      <div class="toggles">
        ${toggle("adminUp", "Administratif On", port.adminUp)}${toggle("linkUp", "Lien On", port.linkUp)}
        ${toggle("poeSupported", "PoE disponible", port.poeSupported)}${toggle("poeEnabled", "PoE activé", port.poeEnabled)}${toggle("poeDelivering", "PoE délivré", port.poeDelivering)}
      </div>
    </article>`).join("");
}

function toggle(name, label, checked) { return `<label class="toggle"><input name="${name}" type="checkbox" ${checked ? "checked" : ""}><span>${label}</span></label>`; }

configForm.addEventListener("input", () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => { state = await request("/simulator/api/config", "PUT", Object.fromEntries(new FormData(configForm))); }, 250);
});

portsNode.addEventListener("change", async (event) => {
  const card = event.target.closest(".port-card");
  if (!card) return;
  const index = Number(card.dataset.index);
  const data = {};
  card.querySelectorAll("input,select").forEach((input) => { data[input.name] = input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value; });
  state = await request(`/simulator/api/ports/${index}`, "PUT", data); renderPorts();
});

portsNode.addEventListener("click", async (event) => {
  const card = event.target.closest(".port-card");
  if (!card || !event.target.classList.contains("delete")) return;
  state = await request(`/simulator/api/ports/${card.dataset.index}`, "DELETE"); renderPorts();
});

document.getElementById("addPort").addEventListener("click", async () => {
  state = await request("/simulator/api/ports", "POST", { name: "Nouveau port", speedMbps: 1000, adminUp: true }); renderPorts();
});
document.getElementById("reset").addEventListener("click", async () => { state = await request("/simulator/api/reset", "POST"); await load(); });

async function request(url, method = "GET", data) {
  const response = await fetch(url, { method, headers: data ? { "content-type": "application/json" } : {}, body: data ? JSON.stringify(data) : undefined });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || "Erreur simulateur"); return value;
}
function escapeHtml(value) { return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
load().catch((error) => { document.getElementById("snmpBadge").textContent = error.message; document.getElementById("snmpBadge").classList.add("error"); });
