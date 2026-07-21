const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROLES = ["user", "editor", "administrator"];
const COOKIE_NAME = "tav_session";

class AuthService {
  constructor(options) {
    const settings = options || {};
    this.filePath = path.resolve(settings.filePath);
    this.sessions = new Map();
    this.sessionTtlMs = Number(settings.sessionTtlMs) || 12 * 60 * 60 * 1000;
    this.initialPassword = String(settings.initialPassword || "administrator");
    this.ensureStore();
  }

  ensureStore() {
    if (fs.existsSync(this.filePath)) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.save([{ id: crypto.randomUUID(), login: "administrator", role: "administrator", password: hashPassword(this.initialPassword) }]);
  }

  load() {
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  }

  save(users) {
    const temporary = this.filePath + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(users, null, 2) + "\n", "utf8");
    fs.renameSync(temporary, this.filePath);
  }

  login(login, password) {
    const normalized = normalizeLogin(login);
    const user = this.load().find((entry) => entry.login.toLowerCase() === normalized.toLowerCase());
    if (!user || !verifyPassword(String(password || ""), user.password)) return null;
    const token = crypto.randomBytes(32).toString("base64url");
    this.sessions.set(token, { userId: user.id, expiresAt: Date.now() + this.sessionTtlMs });
    return { token, user: sanitizeUser(user) };
  }

  authenticateRequest(request) {
    const token = parseCookies(request.headers.cookie || "")[COOKIE_NAME];
    const session = token && this.sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      if (token) this.sessions.delete(token);
      return null;
    }
    const user = this.load().find((entry) => entry.id === session.userId);
    if (!user) { this.sessions.delete(token); return null; }
    session.expiresAt = Date.now() + this.sessionTtlMs;
    return sanitizeUser(user);
  }

  logout(request) {
    const token = parseCookies(request.headers.cookie || "")[COOKIE_NAME];
    if (token) this.sessions.delete(token);
  }

  listUsers() { return this.load().map(sanitizeUser); }

  createUser(data) {
    const users = this.load();
    const login = normalizeLogin(data.login);
    const role = normalizeRole(data.role);
    validatePassword(data.password);
    if (users.some((user) => user.login.toLowerCase() === login.toLowerCase())) throw httpError(409, "Login already exists");
    const user = { id: crypto.randomUUID(), login, role, password: hashPassword(String(data.password)) };
    users.push(user); this.save(users); return sanitizeUser(user);
  }

  updateUser(id, data, actor) {
    const users = this.load();
    const user = users.find((entry) => entry.id === id);
    if (!user) throw httpError(404, "User not found");
    if (data.login !== undefined) {
      const login = normalizeLogin(data.login);
      if (users.some((entry) => entry.id !== id && entry.login.toLowerCase() === login.toLowerCase())) throw httpError(409, "Login already exists");
      user.login = login;
    }
    if (data.role !== undefined) {
      const role = normalizeRole(data.role);
      if (actor.id === id && role !== "administrator") throw httpError(400, "You cannot remove your own administrator role");
      user.role = role;
    }
    if (data.password) { validatePassword(data.password); user.password = hashPassword(String(data.password)); }
    this.save(users); return sanitizeUser(user);
  }

  deleteUser(id, actor) {
    if (actor.id === id) throw httpError(400, "You cannot delete your own account");
    const users = this.load();
    const user = users.find((entry) => entry.id === id);
    if (!user) throw httpError(404, "User not found");
    if (user.role === "administrator" && users.filter((entry) => entry.role === "administrator").length === 1) throw httpError(400, "The last administrator cannot be deleted");
    this.save(users.filter((entry) => entry.id !== id));
    for (const [token, session] of this.sessions) if (session.userId === id) this.sessions.delete(token);
  }

  changePassword(userId, currentPassword, newPassword) {
    const users = this.load();
    const user = users.find((entry) => entry.id === userId);
    if (!user || !verifyPassword(String(currentPassword || ""), user.password)) throw httpError(400, "Current password is incorrect");
    validatePassword(newPassword);
    user.password = hashPassword(String(newPassword)); this.save(users);
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return "scrypt$" + salt.toString("base64") + "$" + crypto.scryptSync(password, salt, 64).toString("base64");
}
function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const expected = Buffer.from(parts[2], "base64");
  const actual = crypto.scryptSync(password, Buffer.from(parts[1], "base64"), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function normalizeLogin(value) {
  const login = String(value || "").trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(login)) throw httpError(400, "Login must contain 3 to 40 letters, numbers, dots, dashes or underscores");
  return login;
}
function normalizeRole(value) {
  const role = String(value || "").toLowerCase();
  if (!ROLES.includes(role)) throw httpError(400, "Invalid role");
  return role;
}
function validatePassword(value) { if (String(value || "").length < 8) throw httpError(400, "Password must contain at least 8 characters"); }
function sanitizeUser(user) { return { id: user.id, login: user.login, role: user.role }; }
function parseCookies(header) { return String(header).split(";").reduce((all, item) => { const index = item.indexOf("="); if (index > 0) all[item.slice(0, index).trim()] = decodeURIComponent(item.slice(index + 1).trim()); return all; }, {}); }
function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
function sessionCookie(token, maxAgeSeconds) { return COOKIE_NAME + "=" + encodeURIComponent(token) + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + maxAgeSeconds; }
function clearSessionCookie() { return COOKIE_NAME + "=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"; }

module.exports = { AuthService, ROLES, sessionCookie, clearSessionCookie };
