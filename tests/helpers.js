const crypto = require("crypto");
const net = require("net");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function readWebSocketMessage(port, path) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    const key = crypto.randomBytes(16).toString("base64");
    let buffer = Buffer.alloc(0);
    let upgraded = false;
    const timer = setTimeout(() => finish(new Error("WebSocket timeout")), 3000);

    function finish(error, value) {
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error); else resolve(value);
    }

    socket.on("connect", () => socket.write([
      "GET " + (path || "/ws") + " HTTP/1.1",
      "Host: 127.0.0.1:" + port,
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Key: " + key,
      "Sec-WebSocket-Version: 13",
      "\r\n"
    ].join("\r\n")));
    socket.on("error", finish);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const marker = buffer.indexOf("\r\n\r\n");
        if (marker < 0) return;
        const headers = buffer.subarray(0, marker).toString("utf8");
        if (!headers.startsWith("HTTP/1.1 101")) return finish(new Error("WebSocket upgrade failed: " + headers));
        buffer = buffer.subarray(marker + 4);
        upgraded = true;
      }
      const decoded = decodeServerFrame(buffer);
      if (decoded) finish(null, JSON.parse(decoded.payload.toString("utf8")));
    });
  });
}

function decodeServerFrame(buffer) {
  if (buffer.length < 2) return null;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) { if (buffer.length < 4) return null; length = buffer.readUInt16BE(2); offset = 4; }
  else if (length === 127) { if (buffer.length < 10) return null; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
  if (buffer.length < offset + length) return null;
  return { payload: buffer.subarray(offset, offset + length), consumed: offset + length };
}

module.exports = { listen, close, readWebSocketMessage };
