import { createFileRoute } from "@tanstack/react-router";

/**
 * Git smart-HTTP relay. Browsers cannot talk to git hosts directly (CORS), so
 * push/pull traffic for GitLab, Bitbucket and any https git remote passes
 * through here. Only git protocol endpoints over https are forwarded.
 */
const ALLOWED = /\/(info\/refs|git-upload-pack|git-receive-pack)$/;
const FORWARD = ["authorization", "content-type", "accept", "git-protocol", "user-agent"];

async function relay(request: Request, splat: string) {
  const incoming = new URL(request.url);
  const target = new URL(`https://${splat}${incoming.search}`);
  if (!ALLOWED.test(target.pathname)) {
    return new Response("Only git protocol endpoints are allowed", { status: 400 });
  }
  const host = target.hostname;
  if (host === "localhost" || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) {
    return new Response("Private addresses are not allowed", { status: 400 });
  }
  const headers = new Headers();
  for (const h of FORWARD) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has("user-agent")) headers.set("user-agent", "git/vpip");
  const res = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === "POST" ? await request.arrayBuffer() : null,
    redirect: "follow",
  });
  const out = new Headers();
  const ct = res.headers.get("content-type");
  if (ct) out.set("content-type", ct);
  const wa = res.headers.get("www-authenticate");
  if (wa) out.set("x-www-authenticate", wa);
  return new Response(res.body, { status: res.status, headers: out });
}

export const Route = createFileRoute("/api/git-proxy/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => relay(request, params._splat ?? ""),
      POST: ({ request, params }) => relay(request, params._splat ?? ""),
    },
  },
});
