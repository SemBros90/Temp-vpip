import { transform } from "sucrase";
import type { CoderFile, TerminalEntry } from "./types";

/* --------------------------------------------------------------- paths */

export function normalizePath(path: string) {
  return path
    .trim()
    .replace(/^[./]+/, "")
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "");
}

export function fileName(path: string) {
  return path.split("/").pop() ?? path;
}

export function folderOf(path: string) {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

export function languageOf(path: string) {
  const ext = fileName(path).split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    css: "css",
    html: "html",
    sql: "sql",
    md: "markdown",
    py: "python",
    sh: "bash",
    yml: "yaml",
    yaml: "yaml",
    env: "ini",
  };
  return map[ext] ?? "text";
}

/** Folder placeholders are stored as a file named `.folder` inside the folder. */
export const FOLDER_KEEP = ".folder";

export interface TreeNode {
  name: string;
  path: string;
  kind: "folder" | "file";
  children: TreeNode[];
  file?: CoderFile | undefined;
}

export function buildTree(files: CoderFile[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", kind: "folder", children: [] };
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = file.path.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");
      if (isLast && part === FOLDER_KEEP) return;
      const found = node.children.find((c) => c.name === part && c.path === path);
      let next: TreeNode;
      if (found) {
        next = found;
      } else {
        next = {
          name: part,
          path,
          kind: isLast ? "file" : "folder",
          children: [],
          file: isLast ? file : undefined,
        };
        node.children.push(next);
      }
      node = next;
    });
    // pure folder placeholder: make sure the folder itself exists
    if (fileName(file.path) === FOLDER_KEEP) {
      const dir = folderOf(file.path);
      if (dir) ensureFolder(root, dir);
    }
  }
  sortTree(root);
  return root.children;
}

function ensureFolder(root: TreeNode, dir: string) {
  let node = root;
  dir.split("/").forEach((part, i, arr) => {
    const path = arr.slice(0, i + 1).join("/");
    const found = node.children.find((c) => c.path === path);
    let next: TreeNode;
    if (found) {
      next = found;
    } else {
      next = { name: part, path, kind: "folder", children: [] };
      node.children.push(next);
    }
    node = next;
  });
}

function sortTree(node: TreeNode) {
  node.children.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1,
  );
  node.children.forEach(sortTree);
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

export function searchFiles(files: CoderFile[], query: string, limit = 80): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const f of files) {
    if (fileName(f.path) === FOLDER_KEEP) continue;
    if (f.path.toLowerCase().includes(q)) hits.push({ path: f.path, line: 0, text: f.path });
    f.content.split("\n").forEach((line, i) => {
      if (line.toLowerCase().includes(q) && hits.length < limit) {
        hits.push({ path: f.path, line: i + 1, text: line.trim().slice(0, 160) });
      }
    });
    if (hits.length >= limit) break;
  }
  return hits.slice(0, limit);
}

/* ------------------------------------------- AI output → proposed files */

export interface ProposedFile {
  path: string;
  content: string;
  language: string;
}

/**
 * Parses fenced blocks whose info string carries a path, e.g.
 * ```tsx path=src/routes/index.tsx
 * ```ts src/lib/thing.ts
 * ```sql path="db/schema.sql"
 */
export function parseProposedFiles(markdown: string): ProposedFile[] {
  const out: ProposedFile[] = [];
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    const info = (m[1] ?? "").trim();
    const body = m[2] ?? "";
    if (!info) continue;
    const pathMatch =
      info.match(/(?:path|file|filename)\s*[=:]\s*"?([^\s"]+)"?/i) ??
      info.match(/\s([\w./@-]+\.[a-z0-9]+)\s*$/i);
    const raw = pathMatch?.[1];
    if (!raw) continue;
    const path = normalizePath(raw);
    if (!path || !path.includes(".")) continue;
    out.push({ path, content: body.replace(/\n$/, ""), language: languageOf(path) });
  }
  return out;
}

/* --------------------------------------------------------- live preview */

const PREVIEW_BRIDGE = `<script>
(function(){
  var post=function(kind,text){try{parent.postMessage({__vpipPreview:true,kind:kind,text:String(text)},'*')}catch(e){}};
  var showError=function(value){
    var text=value&&value.stack?value.stack:(value&&value.message?value.message:String(value));
    post('error',text);
    var render=function(){
      var root=document.getElementById('root')||document.getElementById('app')||document.body;
      if(!root)return;
      root.innerHTML='';
      var panel=document.createElement('div');
      panel.setAttribute('role','alert');
      panel.style.cssText='box-sizing:border-box;min-height:100vh;padding:24px;background:#fff7f7;color:#7f1d1d;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere';
      var title=document.createElement('strong');
      title.textContent='Preview runtime error';
      var detail=document.createElement('div');
      detail.style.marginTop='12px';
      detail.textContent=text;
      panel.appendChild(title); panel.appendChild(detail); root.appendChild(panel);
    };
    if(document.body)render();else window.addEventListener('DOMContentLoaded',render,{once:true});
  };
  ['log','warn','error','info'].forEach(function(k){
    var orig=console[k];
    console[k]=function(){post(k==='error'?'error':'log',Array.prototype.map.call(arguments,function(a){
      try{return typeof a==='string'?a:JSON.stringify(a)}catch(e){return String(a)}}).join(' '));
      orig.apply(console,arguments)};
  });
  window.addEventListener('error',function(e){showError(e.error||e.message+' ('+(e.filename||'')+':'+e.lineno+')')});
  window.addEventListener('unhandledrejection',function(e){showError(e.reason||'Unhandled promise rejection')});
  window.__vpipShowError=showError;

  /* The preview frame is sandboxed, so it has an opaque origin: touching
     localStorage/sessionStorage or history throws SecurityError and kills the
     app before it renders. Provide in-memory equivalents instead. */
  function memoryStorage(){
    var data={};
    return {
      getItem:function(k){return Object.prototype.hasOwnProperty.call(data,String(k))?data[String(k)]:null},
      setItem:function(k,v){data[String(k)]=String(v)},
      removeItem:function(k){delete data[String(k)]},
      clear:function(){data={}},
      key:function(i){return Object.keys(data)[i]===undefined?null:Object.keys(data)[i]},
      get length(){return Object.keys(data).length}
    };
  }
  ['localStorage','sessionStorage'].forEach(function(name){
    var ok=false;
    try{ var s=window[name]; s.setItem('__vpip__','1'); s.removeItem('__vpip__'); ok=true; }catch(e){}
    if(!ok){
      try{ Object.defineProperty(window,name,{configurable:true,get:(function(store){return function(){return store}})(memoryStorage())}); }catch(e){}
    }
  });
  ['pushState','replaceState'].forEach(function(m){
    var orig=window.history[m];
    window.history[m]=function(){
      try{ return orig.apply(window.history, arguments); }
      catch(e){ return undefined; }
    };
  });
  try{ if(!window.indexedDB){ /* nothing to do */ } }catch(e){}

  /* The preview frame has no URL of its own, so every link resolves against
     the VPIP page behind it: "#about" or "/about" would navigate the frame to
     VPIP itself (which then shows "Loading project data…"). Handle in-site
     links inside the frame instead of letting the browser navigate. */
  var navigate=function(url){
    try{ window.history.pushState({},'',url); }catch(e){}
    try{ window.dispatchEvent(new PopStateEvent('popstate',{state:null})); }catch(e){
      try{ var ev=document.createEvent('Event'); ev.initEvent('popstate',true,true); window.dispatchEvent(ev); }catch(e2){}
    }
    try{ window.dispatchEvent(new Event('vpip:navigate')); }catch(e){}
  };
  window.__vpipNavigate=navigate;

  var scrollToId=function(id){
    if(!id)return false;
    var node=null;
    try{ node=document.getElementById(id)||document.querySelector('[name="'+id+'"]'); }catch(e){}
    if(!node)return false;
    try{ node.scrollIntoView({behavior:'smooth',block:'start'}); }catch(e){ try{ node.scrollIntoView(); }catch(e2){} }
    return true;
  };

  document.addEventListener('click',function(e){
    if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
    var el=e.target;
    while(el&&el.nodeName!=='A')el=el.parentNode;
    if(!el||!el.getAttribute)return;
    var href=el.getAttribute('href');
    if(!href||el.hasAttribute('download'))return;
    var target=el.getAttribute('target');
    if(target&&target!=='_self')return;
    if(/^(https?:)?\\/\\//i.test(href)||/^(mailto|tel|data|blob):/i.test(href))return;
    /* In-page anchors: scroll inside the frame, never navigate it. */
    if(href.charAt(0)==='#'){
      e.preventDefault();
      scrollToId(href.slice(1));
      return;
    }
    e.preventDefault();
    var hash=href.indexOf('#')>-1?href.slice(href.indexOf('#')+1):'';
    var path=href.split('#')[0];
    if(path){
      navigate(path.charAt(0)==='/'?path:'/'+path.replace(/^\\.\\//,''));
      try{ window.scrollTo(0,0); }catch(e){}
    }
    if(hash)setTimeout(function(){scrollToId(hash)},0);
  },true);


  document.addEventListener('submit',function(e){
    var form=e.target;
    if(!form||!form.getAttribute)return;
    var action=form.getAttribute('action');
    if(action&&/^(https?:)?\\/\\//i.test(action))return;
    e.preventDefault();
  },true);


  post('log','preview loaded');
})();
</script>`;


const MODULE_RE = /\.(tsx|ts|jsx|js|mjs)$/;

/**
 * Build tooling that belongs to a real Node toolchain, not to the in-browser
 * preview. These files import packages like "vite" that the preview can never
 * supply, so they are excluded from compilation, execution and validation.
 */
export const TOOLING_RE =
  /(^|\/)(vite|vitest|tailwind|postcss|rollup|webpack|next|astro|svelte|eslint|prettier|jest|babel|drizzle|playwright|cypress|tsup|craco)\.config\.[cm]?[jt]sx?$/i;

export function isToolingFile(path: string) {
  return TOOLING_RE.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(path);
}

function isModule(path: string) {
  return MODULE_RE.test(path) && !path.endsWith(".d.ts") && !isToolingFile(path);
}

/** Repairs a common generated-code mismatch where an object-returning hook is
 * consumed as a React-style tuple. The source file remains untouched; preview
 * execution gets the contract its own hook declares. */
function normalizeGeneratedHookContracts(content: string) {
  return content
    .replace(
      /const\s*\[\s*notes\s*,\s*setNotes\s*,\s*saveState\s*\]\s*=\s*useLocalStorage/g,
      "const { value: notes, setValue: setNotes, saveState } = useLocalStorage",
    )
    .replace(/query\.trim\(\)/g, "(typeof query === 'string' ? query : '').trim()");
}

/** Compiles the session's TS/TSX/JS modules to a browser-runnable registry. */
function compileModules(files: CoderFile[]): { code: Record<string, string>; errors: string[] } {
  const code: Record<string, string> = {};
  const errors: string[] = [];
  for (const f of files) {
    if (!isModule(f.path)) continue;
    const ts = /\.tsx?$/.test(f.path);
    try {
      const src = normalizeGeneratedHookContracts(f.content)
        .replace(/\bimport\.meta\.env\b/g, "window.__vpipEnv")
        .replace(/\bprocess\.env\b/g, "window.__vpipEnv");
      const out = transform(src, {
        transforms: [...(ts ? (["typescript"] as const) : []), "jsx", "imports"],
        jsxRuntime: "automatic",
        filePath: f.path,
        production: true,
      }).code;
      code[f.path] = out;
    } catch (e) {
      errors.push(`${f.path}: ${(e as Error).message}`);
    }
  }
  return { code, errors };
}

/** Resolves a spec (as written in an import or a script src) to a session module. */
function resolveModulePath(paths: string[], spec: string): string | undefined {
  const base = normalizePath(spec.split("?")[0] ?? "");
  const tries = [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}.jsx`,
    `${base}.js`,
    `${base}/index.tsx`,
    `${base}/index.ts`,
    `${base}/index.jsx`,
    `${base}/index.js`,
  ];
  return tries.find((t) => paths.includes(t));
}

/** Picks the module that should run first. */
function pickEntryModule(
  files: CoderFile[],
  entryPath?: string,
  htmlScriptSrcs: string[] = [],
): string | undefined {
  const paths = files.filter((f) => isModule(f.path)).map((f) => f.path);
  if (entryPath && paths.includes(entryPath)) return entryPath;
  for (const src of htmlScriptSrcs) {
    const hit = resolveModulePath(paths, src);
    if (hit) return hit;
  }
  const preferred = [
    "src/main.tsx",
    "src/main.ts",
    "src/index.tsx",
    "src/index.ts",
    "src/App.tsx",
    "src/app.tsx",
    "main.tsx",
    "index.tsx",
    "App.tsx",
    "index.ts",
    "index.js",
  ];
  for (const p of preferred) if (paths.includes(p)) return p;
  return paths.find((p) => /(main|index|app)\.[jt]sx?$/i.test(p));
}


const jsonScript = (value: unknown) =>
  JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028|\u2029/g, "");

export interface PreviewBuildOptions {
  aliases?: Array<{ alias: string; target: string }> | undefined;
  packages?: Record<string, string> | undefined;
  env?: Record<string, string> | undefined;
}

const PREVIEW_BUILTIN = new Set(["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"]);

/** Bare package specs required by the compiled modules that are not session files. */
function collectBareSpecs(code: Record<string, string>): string[] {
  const out = new Set<string>();
  const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const c of Object.values(code)) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(c))) {
      const spec = m[1]!;
      if (/^[./]/.test(spec) || /\.(css|scss|sass|less)$/.test(spec) || PREVIEW_BUILTIN.has(spec)) continue;
      out.add(spec);
    }
  }
  return [...out];
}

function esmUrl(spec: string, packages: Record<string, string>) {
  const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!;
  const sub = spec.slice(name.length);
  const raw = packages[name] ?? "";
  const ver = /^[\^~]?\d/.test(raw) ? raw.replace(/^[\^~]/, "") : "";
  return `https://esm.sh/${name}${ver ? `@${ver}` : ""}${sub}?deps=react@19.2.0,react-dom@19.2.0`;
}

function runtimeScript(
  code: Record<string, string>,
  entry: string | undefined,
  errors: string[],
  opts: PreviewBuildOptions = {},
) {
  const aliases = [...(opts.aliases ?? [])].sort((a, b) => b.alias.length - a.alias.length);
  const bare = collectBareSpecs(code).filter(
    (spec) => !aliases.some((a) => spec === a.alias || spec.startsWith(`${a.alias}/`)),
  );
  const extUrls = Object.fromEntries(bare.map((s) => [s, esmUrl(s, opts.packages ?? {})]));
  return `<script>
window.__vpipEnv = Object.assign({ MODE: 'development', DEV: true, PROD: false, NODE_ENV: 'development', BASE_URL: '/' }, JSON.parse(${jsonScript(JSON.stringify(opts.env ?? {}))}));
window.__vpipAliases = JSON.parse(${jsonScript(JSON.stringify(aliases))});
window.__vpipExtUrls = JSON.parse(${jsonScript(JSON.stringify(extUrls))});
window.__vpipSources = JSON.parse(${jsonScript(JSON.stringify(code))});
window.__vpipEntry = ${jsonScript(entry ?? null)};
window.__vpipCompileErrors = JSON.parse(${jsonScript(JSON.stringify(errors))});
(function(){
  var sources = window.__vpipSources, cache = {}, externals = {};
  window.__vpipExternals = externals;
  function join(from, spec){
    var base = from.split('/'); base.pop();
    spec.split('/').forEach(function(part){
      if (part === '.' || part === '') return;
      if (part === '..') base.pop(); else base.push(part);
    });
    return base.join('/');
  }
  function resolve(from, spec){
    var base = null, al = window.__vpipAliases || [];
    if (spec.charAt(0) === '.') base = join(from, spec);
    else {
      for (var a=0;a<al.length;a++) if (spec === al[a].alias || spec.indexOf(al[a].alias + '/') === 0) { base = al[a].target + spec.slice(al[a].alias.length); break; }
      if (base === null) base = spec.replace(/^@\\//,'src/').replace(/^\\//,'');
    }
    var tries = [base, base+'.tsx', base+'.ts', base+'.jsx', base+'.js', base+'/index.tsx', base+'/index.ts', base+'/index.jsx', base+'/index.js'];
    for (var i=0;i<tries.length;i++) if (sources[tries[i]]) return tries[i];
    var wanted = base.split('/').pop(), hits = [], p;
    for (p in sources) if (sources.hasOwnProperty(p)) {
      var name = p.split('/').pop();
      if (name === wanted || name.replace(/\\.[cm]?[jt]sx?$/,'') === wanted) hits.push(p);
    }
    if (hits.length === 1) return hits[0];
    return null;
  }
  function req(from, spec){
    if (/\\.css$/.test(spec)) return {};
    var path = resolve(from, spec);
    if (!path) {
      if (externals[spec]) return externals[spec];
      if (window.__vpipExtUrls && window.__vpipExtUrls[spec]) throw new Error('Package "'+spec+'" could not be loaded from the package CDN (imported by '+from+').');
      if (/\\.(png|jpe?g|gif|webp|svg|ico|avif|woff2?|ttf|mp4|mp3)$/.test(spec)) return { default: spec, __esModule: true };
      throw new Error('Cannot resolve "'+spec+'" from '+from+' — file not found in the repository.');
    }
    if (cache[path]) return cache[path].exports;
    var mod = { exports: {} };
    cache[path] = mod;
    var fn = new Function('require','module','exports', sources[path]);
    fn(function(s){ return req(path, s); }, mod, mod.exports);
    return mod.exports;
  }
  function findComponent(entry){
    var order = [], p;
    if (entry) {
      try {
        var entryExports = req(entry, './'+entry.split('/').pop());
        var entryComponent = entryExports && (entryExports.default || entryExports.App);
        if (typeof entryComponent === 'function') return { path: entry, comp: entryComponent };
        var entryName = entry.split('/').pop().toLowerCase();
        if (entryName.indexOf('main.') === 0 || entryName.indexOf('index.') === 0) return { path: entry, started: true };
      } catch (e) { console.error(entry+': '+(e && e.message ? e.message : String(e))); }
      order.push(entry);
    }
    for (p in sources) if (sources.hasOwnProperty(p) && order.indexOf(p) < 0) order.push(p);
    var summary = [];
    for (var i=0;i<order.length;i++){
      var path = order[i], exp;
      try { exp = req(path, './'+path.split('/').pop()); }
      catch (e) { console.error(path+': '+(e && e.message ? e.message : String(e))); continue; }
      var comp = exp && (exp.default || exp.App);
      if (typeof comp === 'function') return { path: path, comp: comp };
      summary.push(path + (exp ? ' → ' + Object.keys(exp).join(', ') : ''));
    }
    return { summary: summary };
  }
  window.__vpipStart = function(){
    (window.__vpipCompileErrors || []).forEach(function(e){ console.error('compile: '+e); });
    var hasSources = Object.keys(sources).length > 0;
    if (!hasSources) return;
    var root = document.getElementById('root') || document.getElementById('app');
    if (root && root.childNodes.length) return;
    var found = findComponent(window.__vpipEntry);
    var React = externals['react'], client = externals['react-dom/client'];
    if (found.started) return;
    if (root && found.comp && React && client) {
      try { client.createRoot(root).render(React.createElement(found.comp)); }
      catch (e) { window.__vpipShowError(e); }
      return;
    }
    if (root) {
      root.innerHTML = '<div style="font:13px ui-monospace,monospace;padding:16px;color:#334;line-height:1.6">'
        + '<strong>No UI entry in this session.</strong><br>'
        + 'These modules ran successfully:<br>'
        + (found.summary || []).map(function(s){ return '• ' + s; }).join('<br>')
        + '<br><br>Ask the coder for an entry (src/main.tsx with a default-exported component mounted into #root) to see a visual preview.</div>';
    }
  };

})();
</script>
<script type="module">
  try {
    const [React, client, jsx, jsxDev, dom] = await Promise.all([
      import('https://esm.sh/react@19.2.0'),
      import('https://esm.sh/react-dom@19.2.0/client'),
      import('https://esm.sh/react@19.2.0/jsx-runtime'),
      import('https://esm.sh/react@19.2.0/jsx-dev-runtime'),
      import('https://esm.sh/react-dom@19.2.0'),
    ]);
    const ext = window.__vpipExternals;
    ext['react'] = React.default ? Object.assign({}, React, React.default) : React;
    ext['react-dom'] = dom;
    ext['react-dom/client'] = client;
    ext['react/jsx-runtime'] = jsx;
    ext['react/jsx-dev-runtime'] = jsxDev;
  } catch (e) {
    window.__vpipShowError('Could not load React for the preview: ' + (e && e.message ? e.message : e));
  }
  const urls = window.__vpipExtUrls || {};
  await Promise.all(Object.keys(urls).map(async (spec) => {
    try {
      const m = await import(urls[spec]);
      window.__vpipExternals[spec] = m.default && typeof m.default === 'object' && !('default' in m.default) ? Object.assign({}, m.default, m, { __esModule: true }) : Object.assign({ __esModule: true }, m);
    } catch (e) {
      console.error('missing dependency: ' + spec + ' — ' + (e && e.message ? e.message : e));
    }
  }));
  window.__vpipStart();
</script>`;
}

const SHELL = (head: string, body: string) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#fff;color:#111}</style>
${head}</head><body><div id="root"></div>${body}</body></html>`;

/**
 * Assembles the virtual files into a single previewable document.
 * Works with a plain .html entry AND with TS/TSX/React sources, which are
 * compiled in the browser and mounted into #root.
 */
export function buildPreviewDoc(
  files: CoderFile[],
  entryPath?: string,
  opts: PreviewBuildOptions = {},
): string | null {
  const real = files.filter((f) => fileName(f.path) !== FOLDER_KEEP);
  if (!real.length) return null;
  const css = real
    .filter((f) => f.path.endsWith(".css"))
    .map((f) => f.content)
    .join("\n");
  const styleTag = css ? `\n<style>\n${css}\n</style>` : "";

  const html =
    real.find((f) => f.path === entryPath && f.path.endsWith(".html")) ??
    real.find((f) => f.path.endsWith("index.html")) ??
    real.find((f) => f.path.endsWith(".html"));

  const { code, errors } = compileModules(real);
  const hasModules = Object.keys(code).length > 0;
  if (!html && !hasModules) return null;

  const scriptSrcs: string[] = [];
  if (html) {
    const re = /<script[^>]*\ssrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html.content))) if (m[1]) scriptSrcs.push(m[1]);
  }

  const entry = hasModules ? pickEntryModule(real, entryPath, scriptSrcs) : undefined;
  const scripts = hasModules ? runtimeScript(code, entry, errors, opts) : "";

  if (!html) return SHELL(`${PREVIEW_BRIDGE}${styleTag}`, scripts);

  // Local script/stylesheet references cannot be fetched inside the preview frame;
  // their contents are inlined above instead.
  let doc = html.content
    .replace(/<script[^>]*\ssrc=["'](?!https?:)[^"']+["'][^>]*>\s*<\/script>/gi, "")
    .replace(/<link[^>]*rel=["']stylesheet["'][^>]*href=["'](?!https?:)[^"']+["'][^>]*>/gi, "");
  // The bridge must run before any of the document's own scripts, so it is
  // injected right after <head> rather than at the end of it.
  doc = doc.includes("<head")
    ? doc.replace(/<head[^>]*>/i, (m) => `${m}\n${PREVIEW_BRIDGE}`)
    : `${PREVIEW_BRIDGE}\n${doc}`;
  doc = doc.includes("</head>")
    ? doc.replace("</head>", `${styleTag}\n</head>`)
    : `${doc}\n${styleTag}`;

  if (scripts) {
    doc = doc.includes("</body>")
      ? doc.replace("</body>", `${scripts}\n</body>`)
      : `${doc}\n${scripts}`;
  }

  if (!/id=["']root["']|id=["']app["']/.test(doc) && scripts) {
    doc = doc.includes("<body")
      ? doc.replace(/<body[^>]*>/, (m) => `${m}\n<div id="root"></div>`)
      : `<div id="root"></div>${doc}`;
  }
  return doc;
}

/* ------------------------------------------------------------- terminal */

export interface TerminalResult {
  entries: Omit<TerminalEntry, "id" | "createdAt">[];
  /** package.json dependency mutations the command implies */
  packages?: { add: string[]; remove: string[] };
  buildOk?: boolean;
}

const HELP = `Session terminal — operates on this build session's files.
  help                     this text
  ls [path]                list a folder
  tree                     whole file tree
  cat <path>               print a file
  search <text>            search file contents
  wc                       file and line counts
  npm install <pkg…>       record a dependency in package.json
  npm remove <pkg…>        remove a dependency from package.json
  npm run build | build    validate the session files
  npm run dev | dev        start the live preview
  clear                    clear this stream`;

/** Runs a command against the session file tree. Nothing leaves the browser. */
export function runTerminalCommand(cmd: string, files: CoderFile[]): TerminalResult {
  const line = cmd.trim();
  const [head, ...rest] = line.split(/\s+/);
  const real = files.filter((f) => fileName(f.path) !== FOLDER_KEEP);
  const entry = (output: string, exitCode = 0, stream: TerminalEntry["stream"] = "terminal") => ({
    stream,
    command: line,
    output,
    exitCode,
  });

  const isNpm = head === "npm" || head === "bun" || head === "pnpm" || head === "yarn";
  const args = isNpm ? rest : [head ?? "", ...rest];
  const verb = (isNpm ? rest[0] : head) ?? "";

  if (!line) return { entries: [] };
  if (head === "help") return { entries: [entry(HELP)] };
  if (head === "clear") return { entries: [] };

  if (head === "ls") {
    const dir = normalizePath(rest[0] ?? "");
    const names = new Set<string>();
    for (const f of real) {
      if (dir && !f.path.startsWith(`${dir}/`)) continue;
      const tail = dir ? f.path.slice(dir.length + 1) : f.path;
      const part = tail.split("/")[0];
      if (part) names.add(tail.includes("/") ? `${part}/` : part);
    }
    return {
      entries: [entry(names.size ? [...names].sort().join("\n") : "(empty)", names.size ? 0 : 1)],
    };
  }

  if (head === "tree") {
    return {
      entries: [
        entry(real.length ? real.map((f) => f.path).sort().join("\n") : "(no files yet)"),
      ],
    };
  }

  if (head === "cat") {
    const path = normalizePath(rest.join(" "));
    const f = real.find((x) => x.path === path);
    return { entries: [entry(f ? f.content : `cat: ${path}: no such file`, f ? 0 : 1)] };
  }

  if (head === "search") {
    const hits = searchFiles(real, rest.join(" "));
    return {
      entries: [
        entry(
          hits.length
            ? hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join("\n")
            : "no matches",
          hits.length ? 0 : 1,
        ),
      ],
    };
  }

  if (head === "wc") {
    const lines = real.reduce((n, f) => n + f.content.split("\n").length, 0);
    return { entries: [entry(`${real.length} files, ${lines} lines`)] };
  }

  if (isNpm && (verb === "install" || verb === "add" || verb === "i")) {
    const pkgs = args.slice(1).filter((a) => a && !a.startsWith("-"));
    if (!pkgs.length) return { entries: [entry("nothing to install", 1)] };
    return {
      entries: [entry(`+ ${pkgs.join("\n+ ")}\nrecorded in package.json`)],
      packages: { add: pkgs, remove: [] },
    };
  }

  if (isNpm && (verb === "remove" || verb === "uninstall" || verb === "rm")) {
    const pkgs = args.slice(1).filter((a) => a && !a.startsWith("-"));
    if (!pkgs.length) return { entries: [entry("nothing to remove", 1)] };
    return {
      entries: [entry(`- ${pkgs.join("\n- ")}\nremoved from package.json`)],
      packages: { add: [], remove: pkgs },
    };
  }

  if (verb === "build" || (isNpm && rest.join(" ") === "run build")) {
    const problems = validateFiles(real);
    return {
      entries: [
        entry(
          `build ${problems.length ? "failed" : "passed"} — ${real.length} files checked`,
          problems.length ? 1 : 0,
          "build",
        ),
        ...(problems.length
          ? [{ stream: "error" as const, command: line, output: problems.join("\n"), exitCode: 1 }]
          : []),
      ],
      buildOk: problems.length === 0,
    };
  }

  if (verb === "dev" || (isNpm && rest.join(" ") === "run dev")) {
    const has = real.some((f) => f.path.endsWith(".html"));
    return {
      entries: [
        entry(
          has
            ? "dev server ready — the Live Preview panel renders the session files"
            : "no .html entry file in this session; add one to preview",
          has ? 0 : 1,
          "build",
        ),
      ],
    };
  }

  return { entries: [entry(`${head}: command not found — try "help"`, 127)] };
}

/** Lightweight validation used by the build command and the error log. */
export function validateFiles(files: CoderFile[]): string[] {
  const problems: string[] = [];
  for (const f of files) {
    if (fileName(f.path) === FOLDER_KEEP) continue;
    if (!f.content.trim()) problems.push(`${f.path}: file is empty`);
    if (f.path.endsWith(".json")) {
      try {
        JSON.parse(f.content);
      } catch (e) {
        problems.push(`${f.path}: invalid JSON — ${(e as Error).message}`);
      }
    }
    const pairs: [string, string][] = [
      ["{", "}"],
      ["(", ")"],
      ["[", "]"],
    ];
    if (/\.(ts|tsx|js|jsx|css)$/.test(f.path)) {
      for (const [open, close] of pairs) {
        const a = f.content.split(open).length - 1;
        const b = f.content.split(close).length - 1;
        if (a !== b) problems.push(`${f.path}: unbalanced ${open}${close} (${a}/${b})`);
      }
    }
  }
  return problems;
}

export function diffLines(a: string, b: string) {
  const left = a.split("\n");
  const right = b.split("\n");
  const max = Math.max(left.length, right.length);
  const rows: {
    kind: "same" | "added" | "removed" | "changed";
    left?: string | undefined;
    right?: string | undefined;
  }[] = [];
  for (let i = 0; i < max; i++) {
    const l = left[i];
    const r = right[i];
    if (l === r) rows.push({ kind: "same", left: l, right: r });
    else if (l === undefined) rows.push({ kind: "added", right: r });
    else if (r === undefined) rows.push({ kind: "removed", left: l });
    else rows.push({ kind: "changed", left: l, right: r });
  }
  return rows;
}
