const labels = { api:"Disponibilité API", system:"Système", network:"Réseau", encoder:"Encodeur NDI", video:"Signal vidéo", audio:"Signal audio", source:"Source NDI", output:"Sortie vidéo" };
let state;

async function load() {
  state = await request("/simulator/api/state");
  fillForm(); renderComponents();
}
function fillForm() {
  const form = document.getElementById("configForm");
  Array.from(form.elements).forEach((input) => { if (input.name && state.config[input.name] !== undefined) input.value = state.config[input.name]; });
}
function renderComponents() {
  document.getElementById("apiBadge").textContent = state.components.api === "error" ? "API indisponible" : "API prête";
  document.getElementById("apiBadge").classList.toggle("error", state.components.api === "error");
  document.getElementById("components").innerHTML = Object.entries(state.components).map(([id,status]) => `<article class="component"><h3>${labels[id] || id}</h3><div class="states">${["ok","warning","error"].map(value => `<button data-id="${id}" data-status="${value}" class="${status===value?"active":""}">${value === "ok" ? "OK" : value === "warning" ? "Warning" : "Erreur"}</button>`).join("")}</div></article>`).join("");
}
document.getElementById("configForm").addEventListener("change", async (event) => {
  const input = event.target; let value = input.value;
  if (input.type === "number") value = Number(value);
  state = await request("/simulator/api/config", { method:"PUT", body:JSON.stringify({ [input.name]: value }) });
  fillForm(); renderComponents();
});
document.getElementById("components").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-id]"); if (!button) return;
  state = await request("/simulator/api/component", { method:"PATCH", body:JSON.stringify({ id:button.dataset.id, status:button.dataset.status }) }); renderComponents();
});
document.getElementById("reset").addEventListener("click", async () => { if (!confirm("Réinitialiser le simulateur ?")) return; state = await request("/simulator/api/reset", { method:"POST" }); fillForm(); renderComponents(); });
async function request(url, options={}) { const response = await fetch(url, { headers:{"content-type":"application/json"}, ...options }); const data = await response.json(); if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`); return data; }
load().catch((error) => alert(error.message));
