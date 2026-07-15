const http = require("http");
const https = require("https");

function restProxy(targetUrl) {
  const target = new URL(targetUrl);
  const transport = target.protocol === "https:" ? https : http;
  return function proxy(req, res) {
    const request = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      method: req.method,
      path: joinPath(target.pathname, req.originalUrl),
      headers: Object.assign({}, req.headers, { host: target.host })
    }, (backendResponse) => {
      res.statusCode = backendResponse.statusCode;
      Object.keys(backendResponse.headers).forEach((key) => {
        if (backendResponse.headers[key] !== undefined) res.setHeader(key, backendResponse.headers[key]);
      });
      backendResponse.pipe(res);
    });
    request.on("error", (error) => {
      if (!res.headersSent) res.status(502).json({ error: "Backend unavailable: " + error.message });
      else res.end();
    });
    req.pipe(request);
  };
}

function attachWebSocketProxy(server, targetUrl, localPath) {
  const target = new URL(targetUrl);
  const transport = target.protocol === "wss:" ? https : http;
  server.on("upgrade", (request, clientSocket, head) => {
    if (new URL(request.url, "http://localhost").pathname !== (localPath || "/ws")) return;
    const proxyRequest = transport.request({
      protocol: target.protocol === "wss:" ? "https:" : "http:",
      hostname: target.hostname,
      port: target.port || (target.protocol === "wss:" ? 443 : 80),
      path: target.pathname || "/ws",
      method: "GET",
      headers: Object.assign({}, request.headers, { host: target.host })
    });
    proxyRequest.on("upgrade", (response, backendSocket, backendHead) => {
      const lines = ["HTTP/1.1 101 Switching Protocols"];
      Object.keys(response.headers).forEach((key) => lines.push(key + ": " + response.headers[key]));
      clientSocket.write(lines.join("\r\n") + "\r\n\r\n");
      if (head && head.length) backendSocket.write(head);
      if (backendHead && backendHead.length) clientSocket.write(backendHead);
      backendSocket.pipe(clientSocket).pipe(backendSocket);
    });
    proxyRequest.on("response", () => clientSocket.destroy());
    proxyRequest.on("error", () => clientSocket.destroy());
    proxyRequest.end();
  });
}

function joinPath(base, requestPath) {
  return (base === "/" ? "" : base.replace(/\/$/, "")) + requestPath;
}

module.exports = { restProxy, attachWebSocketProxy };
