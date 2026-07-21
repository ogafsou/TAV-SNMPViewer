document.getElementById("loginForm").addEventListener("submit", async function(event) {
  event.preventDefault();
  var form = event.currentTarget;
  var errorNode = document.getElementById("loginError");
  errorNode.hidden = true;
  try {
    var response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: form.login.value, password: form.password.value }) });
    var result = await response.json();
    if (!response.ok) throw new Error(result.error || "Connexion impossible");
    window.location.replace("/monitoring");
  } catch (error) { errorNode.textContent = error.message; errorNode.hidden = false; }
});
