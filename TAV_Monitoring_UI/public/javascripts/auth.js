var CURRENT_USER = null;

async function initializeAuthentication() {
  var response = await fetch("/api/auth/me");
  if (response.status === 401) { window.location.replace("/login"); return false; }
  var result = await response.json();
  if (!response.ok || !result.user) { window.location.replace("/login"); return false; }
  CURRENT_USER = result.user;
  document.body.classList.add("role-" + CURRENT_USER.role);
  var path = window.location.pathname;
  if (CURRENT_USER.role === "user" && path === "/configuration") { window.location.replace("/monitoring"); return false; }
  if (CURRENT_USER.role !== "administrator" && path === "/users") { window.location.replace("/monitoring"); return false; }

  document.getElementById("currentUserName").textContent = CURRENT_USER.login + " (" + CURRENT_USER.role + ")";
  document.querySelector('a[href="/configuration"]').hidden = CURRENT_USER.role === "user";
  document.getElementById("manageUsersLink").hidden = CURRENT_USER.role !== "administrator";
  setupUserMenu();
  if (path === "/users") await loadUsers();
  return true;
}

function setupUserMenu() {
  var button = document.getElementById("userMenuButton");
  var menu = document.getElementById("userMenu");
  button.addEventListener("click", function(event) {
    event.preventDefault(); event.stopPropagation();
    menu.hidden = !menu.hidden;
    button.setAttribute("aria-expanded", String(!menu.hidden));
  });
  document.addEventListener("click", function(event) {
    if (!menu.hidden && !menu.contains(event.target)) { menu.hidden = true; button.setAttribute("aria-expanded", "false"); }
  });
  document.getElementById("logoutButton").addEventListener("click", async function() { await fetch("/api/auth/logout", { method: "POST" }); window.location.replace("/login"); });
  var dialog = document.getElementById("passwordDialog");
  document.getElementById("changePasswordButton").addEventListener("click", function(event) { event.preventDefault(); menu.hidden = true; dialog.showModal(); });
  document.getElementById("cancelPasswordButton").addEventListener("click", function() { dialog.close(); });
  document.getElementById("passwordForm").addEventListener("submit", changeOwnPassword);
  var createForm = document.getElementById("createUserForm");
  if (createForm) createForm.addEventListener("submit", createUser);
}

async function changeOwnPassword(event) {
  event.preventDefault();
  var form = event.currentTarget;
  var errorNode = document.getElementById("passwordError");
  try {
    await authenticatedJson("/api/auth/password", { method: "PUT", body: JSON.stringify({ currentPassword: form.currentPassword.value, newPassword: form.newPassword.value }) });
    form.reset(); document.getElementById("passwordDialog").close();
  } catch (error) { errorNode.textContent = error.message; errorNode.hidden = false; }
}

async function loadUsers() {
  try {
    var result = await authenticatedJson("/api/users");
    renderUsers(result.users || []);
  } catch (error) { showUsersError(error.message); }
}

function renderUsers(users) {
  var body = document.getElementById("usersTableBody");
  body.textContent = "";
  users.forEach(function(user) {
    var row = document.createElement("tr");
    var loginCell = document.createElement("td"); loginCell.textContent = user.login;
    var roleCell = document.createElement("td");
    var role = document.createElement("select");
    ["user", "editor", "administrator"].forEach(function(value) { var option = document.createElement("option"); option.value = value; option.textContent = value; option.selected = user.role === value; role.appendChild(option); });
    roleCell.appendChild(role);
    var passwordCell = document.createElement("td"); var password = document.createElement("input"); password.type = "password"; password.placeholder = "Inchangé"; password.minLength = 8; passwordCell.appendChild(password);
    var actions = document.createElement("td"); actions.className = "user-row-actions";
    var save = document.createElement("button"); save.type = "button"; save.textContent = "Enregistrer";
    save.addEventListener("click", async function() { try { var patch = { role: role.value }; if (password.value) patch.password = password.value; await authenticatedJson("/api/users/" + encodeURIComponent(user.id), { method: "PATCH", body: JSON.stringify(patch) }); password.value = ""; await loadUsers(); } catch (error) { showUsersError(error.message); } });
    var remove = document.createElement("button"); remove.type = "button"; remove.className = "secondary-button"; remove.textContent = "Supprimer"; remove.disabled = user.id === CURRENT_USER.id;
    remove.addEventListener("click", async function() { if (!window.confirm("Supprimer " + user.login + " ?")) return; try { await authenticatedJson("/api/users/" + encodeURIComponent(user.id), { method: "DELETE" }); await loadUsers(); } catch (error) { showUsersError(error.message); } });
    actions.appendChild(save); actions.appendChild(remove);
    row.appendChild(loginCell); row.appendChild(roleCell); row.appendChild(passwordCell); row.appendChild(actions); body.appendChild(row);
  });
}

async function createUser(event) {
  event.preventDefault(); var form = event.currentTarget;
  try {
    await authenticatedJson("/api/users", { method: "POST", body: JSON.stringify({ login: form.login.value, password: form.password.value, role: form.role.value }) });
    form.reset(); await loadUsers();
  } catch (error) { showUsersError(error.message); }
}

async function authenticatedJson(url, options) {
  var settings = options || {}; settings.headers = Object.assign({ "Content-Type": "application/json" }, settings.headers || {});
  var response = await fetch(url, settings);
  if (response.status === 401) { window.location.replace("/login"); throw new Error("Session expirée"); }
  var result = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(result.error || "Opération impossible");
  return result;
}

function showUsersError(message) { var node = document.getElementById("usersError"); node.textContent = message; node.hidden = false; }
