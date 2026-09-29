/** Preview-only bridge for hosts that route /api to a separate backend port.
 * The application remains the original all-in-one TanStack Start server.
 */
import http from "node:http";
import https from "node:https";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing preview configuration: ${name}`);
  return value;
};
const upstream = new URL(required("PREVIEW_APP_UPSTREAM"));
const port = Number(required("PREVIEW_API_PORT"));
const host = required("PREVIEW_BIND_HOST");
if (!["http:", "https:"].includes(upstream.protocol) || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Invalid preview upstream or port configuration");
}

const server = http.createServer((request, response) => {
  if (!request.url?.startsWith("/api/")) {
    response.writeHead(404).end("Not found");
    return;
  }
  // Assign pathname/search separately; never allow a client URL to choose a host.
  const target = new URL(upstream);
  const incoming = new URL(request.url, upstream);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  const transport = target.protocol === "https:" ? https : http;
  const forwarded = transport.request(target, {
    method: request.method,
    headers: request.headers,
  }, (result) => {
    response.writeHead(result.statusCode ?? 502, result.headers);
    result.on("error", () => response.destroy());
    result.pipe(response);
  });
  forwarded.on("error", () => {
    if (response.headersSent) response.destroy();
    else response.writeHead(502, { "Content-Type": "application/json" })
      .end(JSON.stringify({ error: "The application is restarting. Please try again shortly." }));
  });
  request.on("aborted", () => forwarded.destroy());
  request.on("error", () => forwarded.destroy());
  response.on("close", () => { if (!response.writableFinished) forwarded.destroy(); });
  request.pipe(forwarded);
});
server.listen(port, host, () => console.info("Preview API bridge ready"));
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close();
    server.closeIdleConnections();
  });
}