import { randomBytes } from "node:crypto";
export class RefreshError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Local workstation API only. No remote bind, CORS, browser-provided paths or commands.
export function runtimeHttp(controller) {
  const token = randomBytes(32).toString("hex");
  const reply = (res, status, data) => {
    if (res.destroyed) return;
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff" }); res.end(JSON.stringify(data));
  };
  return async (req, res) => {
    if (!req.url?.startsWith("/api/runtime/")) return false;
    const host = req.headers.host;
    const allowed = [`127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`];
    if (!allowed.includes(host) || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress) ||
      (req.headers.origin && req.headers.origin !== `http://${host}`) || req.headers["sec-fetch-site"] === "cross-site") {
      reply(res, 403, { message: "Same-origin localhost access required." }); return true;
    }
    try {
      if (req.url === "/api/runtime/targets" && req.method === "GET") {
        reply(res, 200, { ...await controller.describe(), token }); return true;
      }
      if (req.url !== "/api/runtime/refresh") { reply(res, 404, { message: "Not found." }); return true; }
      if (req.method !== "POST") { reply(res, 405, { message: "POST required; no collection was started." }); return true; }
      if (req.headers.origin !== `http://${host}` || req.headers["x-archi-runtime-token"] !== token ||
        req.headers["content-type"]?.split(";")[0] !== "application/json") {
        reply(res, 403, { message: "Same-origin JSON request and runtime token required." }); return true;
      }
      let raw = "", size = 0;
      const bodyTimer = setTimeout(() => req.destroy(), 5000);
      try {
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 4096) throw new RefreshError(413, "Request exceeds size limit.");
          raw += chunk.toString("utf8");
        }
      } finally { clearTimeout(bodyTimer); }
      let input;
      try { input = JSON.parse(raw); } catch { throw new RefreshError(400, "Invalid JSON request."); }
      const abort = new AbortController(), disconnect = () => { if (!res.writableEnded) abort.abort(); };
      res.once("close", disconnect);
      const deadline = setTimeout(() => abort.abort(), 125000);
      try { reply(res, 200, await controller.refresh(input, { signal: abort.signal })); }
      finally { clearTimeout(deadline); res.off("close", disconnect); }
    } catch (e) { reply(res, e instanceof RefreshError ? e.status : 500,
      { message: e instanceof RefreshError ? e.message : "Runtime request failed; no automatic retry." }); }
    return true;
  };
}
