const form = document.querySelector("#configForm");
const components = document.querySelector("#components");
const toast = document.querySelector("#toast");
let current;

load();

async function load() {
  current = await request("/simulator/api/state");
  render();
}

function render() {
  document.querySelector("#apiUrl").textContent = current.apiBaseUrl;
  const c = current.config;
  for (const [key, value] of Object.entries(c)) {
    if (form.elements[key] && key !== "inputTypes") form.elements[key].value = value;
  }
  form.elements.inputTypes.value = c.inputTypes.join(", ");
  form.elements.resolution.value = `${c.width} × ${c.height}`;

  const groups = [
    ["system", "Système"], ["input-card", "Cartes Input"], ["input", "Entrées"],
    ["output-card", "Cartes Output"], ["output", "Sorties"], ["fan", "Ventilateurs"], ["power", "Alimentations"]
  ];
  components.innerHTML = groups.map(([id, label]) => {
    const items = current.components.filter((item) => item.group === id);
    if (!items.length) return "";
    return `<section class="group"><h3>${label}</h3><div class="component-grid">${items.map(componentButton).join("")}</div></section>`;
  }).join("");
}

function componentButton(item) {
  return `<button class="component ${item.status}" data-id="${escapeHtml(item.id)}" data-status="${item.status}"><strong>${escapeHtml(item.label)}</strong><small>${item.status}</small></button>`;
}

components.addEventListener("click", async (event) => {
  const button = event.target.closest(".component");
  if (!button) return;
  const order = ["ok", "warning", "error"];
  const status = order[(order.indexOf(button.dataset.status) + 1) % order.length];
  current = await request("/simulator/api/component", { method: "PATCH", body: { id: button.dataset.id, status } });
  render(); showToast(`${button.querySelector("strong").textContent} : ${status}`);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const resolution = form.elements.resolution.value.split(/[x×]/i).map((v) => Number(v.trim()));
  const body = Object.fromEntries(new FormData(form).entries());
  body.inputTypes = body.inputTypes.split(",").map((v) => v.trim().toUpperCase()).filter(Boolean);
  body.width = resolution[0]; body.height = resolution[1]; delete body.resolution;
  current = await request("/simulator/api/config", { method: "PUT", body });
  render(); showToast("Configuration appliquée");
});

document.querySelector("#reset").addEventListener("click", async () => {
  current = await request("/simulator/api/reset", { method: "POST", body: {} });
  render(); showToast("Profil H9 restauré");
});

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json" }, body: options.body ? JSON.stringify(options.body) : undefined });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
function showToast(message) { toast.textContent = message; toast.classList.add("show"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("show"), 1800); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" })[c]); }
