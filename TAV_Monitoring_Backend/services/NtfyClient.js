const http = require("http");
const https = require("https");

class NtfyClient {
  constructor(config, options) {
    this.config = config || {};
    // L'injection de fetch reste disponible pour les tests. En production,
    // http(s).request avec agent:false evite de reutiliser une socket bloquee.
    this.fetch = options && options.fetch;
  }

  isConfigured() {
    return this.config.enabled === true
      && this.config.provider === "ntfy"
      && /^https?:\/\//i.test(this.config.server_url || "")
      && /^[A-Za-z0-9_-]{1,64}$/.test(this.config.topic || "");
  }

  async send(message) {
    if (!this.isConfigured()) throw new Error("ntfy alerts are not configured");
    const headers = { "content-type": "application/json" };
    if (this.config.token) headers.authorization = `Bearer ${this.config.token}`;
    const payload = {
      topic: this.config.topic,
      title: String(message.title || "TAV Monitoring"),
      message: String(message.message || ""),
      priority: Number(message.priority) || 3,
      tags: Array.isArray(message.tags) ? message.tags : []
    };
    const click = message.click || this.config.frontend_url;
    if (click) payload.click = click;

    const body = JSON.stringify(payload);
    return this.fetch ? this.sendWithFetch(headers, body) : this.sendWithHttp(headers, body);
  }

  async sendWithFetch(headers, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs());
    if (timeout.unref) timeout.unref();
    try {
      const response = await this.fetch(this.endpoint(), {
        method: "POST", headers, body, signal: controller.signal
      });
      const responseBody = await response.text();
      if (!response.ok) throw new Error(`ntfy HTTP ${response.status}: ${responseBody.slice(0, 300)}`);
      return responseBody ? JSON.parse(responseBody) : { ok: true };
    } catch (error) {
      if (error && error.name === "AbortError") throw new Error("ntfy request timeout");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  sendWithHttp(headers, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.endpoint());
      const transport = url.protocol === "https:" ? https : http;
      const request = transport.request(url, {
        method: "POST",
        headers: { ...headers, "content-length": Buffer.byteLength(body) },
        agent: false
      }, (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { responseBody += chunk; });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`ntfy HTTP ${response.statusCode}: ${responseBody.slice(0, 300)}`));
            return;
          }
          try { resolve(responseBody ? JSON.parse(responseBody) : { ok: true }); }
          catch (error) { reject(new Error(`ntfy invalid response: ${error.message}`)); }
        });
      });
      request.setTimeout(this.timeoutMs(), () => request.destroy(new Error("ntfy request timeout")));
      request.on("error", reject);
      request.end(body);
    });
  }

  endpoint() {
    return `${String(this.config.server_url).replace(/\/$/, "")}/`;
  }

  timeoutMs() {
    return Number(this.config.request_timeout_ms) || 5000;
  }
}

module.exports = NtfyClient;
