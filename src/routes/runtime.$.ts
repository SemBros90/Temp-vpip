import { createFileRoute } from "@tanstack/react-router";

/**
 * Secure preview relay: /runtime/<rowId>-<slug>/...  →  sandbox dev server.
 * - The sandbox's own address is private (E2B traffic token) and never sent to the browser.
 * - Page loads require the signed preview cookie of an owner/authorized user.
 * - Sub-resources require the unguessable per-sandbox slug (they come from the
 *   isolated preview frame, which cannot carry cookies).
 */

const STORAGE_SHIM = `<script>(function(){function mk(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}["localStorage","sessionStorage"].forEach(function(n){try{window[n].getItem("__vpip")}catch(e){try{Object.defineProperty(window,n,{value:mk(),configurable:true})}catch(_){}}});try{void document.cookie}catch(e){try{Object.defineProperty(document,"cookie",{get:function(){return""},set:function(){},configurable:true})}catch(_){}}})();</script>`;

const DROP_REQ = new Set(["host", "cookie", "authorization", "origin", "referer", "cf-connecting-ip", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "content-length"]);
const DROP_RES = new Set(["content-encoding", "content-length", "transfer-encoding", "set-cookie", "access-control-allow-origin", "access-control-allow-credentials", "x-frame-options", "connection"]);

function cookieValue(header: string | null, name: string) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function page(status: number, title: string, body: string) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font:14px system-ui;background:#0b0d10;color:#c9d1d9;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}div{max-width:520px;padding:24px;text-align:center}h1{font-size:16px;color:#fff}</style></head><body><div><h1>${title}</h1><p>${body}</p></div></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

async function relay(request: Request, splat: string) {
  const rt = await import("@/lib/vpip/runtime/runtime.server");
  const first = splat.split("/")[0] ?? "";
  const dash = first.lastIndexOf("-");
  if (dash < 1) return page(404, "Preview not found", "This preview address is not valid.");
  const rowId = first.slice(0, dash);
  const slug = first.slice(dash + 1);

  const target = await rt.previewTarget(rowId, slug);
  if (!target) {
    return page(404, "Preview not available", "This runtime was destroyed or the address is wrong. Launch the runtime again from VPIP Coder.");
  }

  const dest = request.headers.get("sec-fetch-dest");
  const isDocument = dest === "document" || dest === "iframe" || dest === "frame";
  if (isDocument) {
    const userId = await rt.verifyPreviewToken(rowId, cookieValue(request.headers.get("cookie"), `vpip_rt_${rowId}`));
    if (!userId) {
      return page(403, "Preview access denied", "Open this preview from VPIP Coder.");
    }
    if (target.status === "paused") {
      return page(409, "Sandbox paused", "The sandbox was paused after 10 minutes idle. Press Resume in VPIP Coder.");
    }
    void rt.touchActive(rowId);
  }

  const url = new URL(request.url);
  const upstream = `https://${target.port}-${target.sandboxId}.${target.domain}${url.pathname}${url.search}`;
  const headers = new Headers();
  request.headers.forEach((v, k) => {
    if (!DROP_REQ.has(k.toLowerCase()) && !k.toLowerCase().startsWith("cf-")) headers.set(k, v);
  });
  headers.delete("accept-encoding");
  if (target.trafficToken) headers.set("e2b-traffic-access-token", target.trafficToken);

  const isWs = request.headers.get("upgrade")?.toLowerCase() === "websocket";
  let res: Response;
  try {
    res = await fetch(upstream, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? null : (await request.arrayBuffer()) as BodyInit,
      redirect: "manual",
    });
  } catch (e) {
    if (isWs) return new Response("Live-update socket unavailable through this relay.", { status: 502 });
    return page(502, "Runtime not reachable", `The dev server did not answer: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status === 101) return res;
  if (res.status === 502 && isDocument) {
    return page(502, "Runtime not running", "The sandbox is up but the dev server is not answering. Check Runtime status and logs in VPIP Coder.");
  }

  const out = new Headers();
  res.headers.forEach((v, k) => {
    if (!DROP_RES.has(k.toLowerCase())) out.set(k, v);
  });
  out.set("access-control-allow-origin", "*");
  out.set("cache-control", out.get("cache-control") ?? "no-store");
  const loc = out.get("location");
  if (loc && loc.includes(`${target.sandboxId}.`)) {
    const l = new URL(loc);
    out.set("location", `${l.pathname}${l.search}`);
  }

  const type = res.headers.get("content-type") ?? "";
  if (isDocument && type.includes("text/html")) {
    const html = await res.text();
    // The app's router must see its own root ("/"), not the private relay prefix.
    // Assets keep working because Vite serves them with the prefixed base.
    const prefix = `/runtime/${first}`;
    const rootShim = `<script>(function(){try{var p=${JSON.stringify(prefix)};var l=location.pathname;if(l.indexOf(p)===0){var r=l.slice(p.length)||"/";if(r.charAt(0)!=="/")r="/"+r;history.replaceState(history.state,"",r+location.search+location.hash);}}catch(e){}})();</script>`;
    const shims = `${STORAGE_SHIM}${rootShim}`;
    const injected = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${shims}`) : `${shims}${html}`;
    return new Response(injected, { status: res.status, headers: out });
  }
  return new Response(request.method === "HEAD" ? null : res.body, { status: res.status, headers: out });
}

const handler = async ({ request, params }: { request: Request; params: { _splat?: string } }) =>
  relay(request, params._splat ?? "");

export const Route = createFileRoute("/runtime/$")({
  server: {
    handlers: {
      GET: handler,
      HEAD: handler,
      POST: handler,
      PUT: handler,
      PATCH: handler,
      DELETE: handler,
      OPTIONS: handler,
    },
  },
});
