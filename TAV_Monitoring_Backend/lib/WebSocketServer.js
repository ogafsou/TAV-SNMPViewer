const crypto = require("crypto");

class WebSocketServer {
  constructor(options) {
    this.path = options.path || "/ws";
    this.snapshot = options.snapshot;
    this.clients = new Set();
  }

  attach(server) {
    server.on("upgrade", (request, socket, head) => this.handleUpgrade(request, socket, head));
    return this;
  }

  handleUpgrade(request, socket, head) {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname !== this.path || String(request.headers.upgrade || "").toLowerCase() !== "websocket") {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const key = request.headers["sec-websocket-key"];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Accept: " + accept,
      "\r\n"
    ].join("\r\n"));
    const client = { socket, buffer: Buffer.alloc(0) };
    this.clients.add(client);
    socket.on("data", (chunk) => this.handleData(client, chunk));
    socket.on("close", () => this.clients.delete(client));
    socket.on("error", () => this.clients.delete(client));
    if (head && head.length) this.handleData(client, head);
    this.send(client, { type: "monitoring.snapshot", ...this.snapshot() });
  }

  handleData(client, chunk) {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    while (client.buffer.length >= 2) {
      const second = client.buffer[1];
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (client.buffer.length < 4) return;
        length = client.buffer.readUInt16BE(2); offset = 4;
      } else if (length === 127) {
        if (client.buffer.length < 10) return;
        length = Number(client.buffer.readBigUInt64BE(2)); offset = 10;
      }
      const masked = (second & 0x80) !== 0;
      if (masked) offset += 4;
      if (client.buffer.length < offset + length) return;
      const opcode = client.buffer[0] & 0x0f;
      const mask = masked ? client.buffer.subarray(offset - 4, offset) : null;
      const payload = Buffer.from(client.buffer.subarray(offset, offset + length));
      if (mask) for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      client.buffer = client.buffer.subarray(offset + length);
      if (opcode === 0x8) { client.socket.end(encodeFrame(Buffer.alloc(0), 0x8)); return; }
      if (opcode === 0x9) client.socket.write(encodeFrame(payload, 0xA));
    }
  }

  send(client, message) {
    if (!client || client.socket.destroyed) return;
    client.socket.write(encodeFrame(Buffer.from(JSON.stringify(message), "utf8"), 0x1));
  }

  broadcast(message) {
    this.clients.forEach((client) => this.send(client, message));
  }

  close() {
    this.clients.forEach((client) => client.socket.destroy());
    this.clients.clear();
  }
}

function encodeFrame(payload, opcode) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length <= 0xffff) {
    header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

module.exports = { WebSocketServer, encodeFrame };
