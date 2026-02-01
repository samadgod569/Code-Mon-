export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
      "Access-Control-Allow-Headers": "*"
    };
    const securityHeaders = {
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Accept-Ranges": "bytes"
    };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    const loadFile = async (name, type = "text") => {
      const v = await env.FILES.get(name, type === "arrayBuffer" ? "arrayBuffer" : "text");
      if (v === null) throw new Error("Missing " + name);
      return v;
    };

    const resolvePath = (base, rel) => {
      if (rel.startsWith("/")) return rel.slice(1);
      const stack = base ? base.split("/") : [];
      for (const p of rel.split("/")) {
        if (!p || p === ".") continue;
        if (p === "..") stack.pop();
        else stack.push(p);
      }
      return stack.join("/");
    };

    const cacheControl = (rule) => {
      if (rule === "1y") return "public, max-age=31536000, immutable";
      if (rule.endsWith("s")) return `public, max-age=${rule}`;
      return "no-cache";
    };

    const getCacheRule = async (ext, PREFIX) => {
      try {
        const rules = JSON.parse(await loadFile(PREFIX + ".cache.json"));
        return rules[ext] || rules.default || "no-cache";
      } catch { return ["js","css","png","jpg","jpeg","svg","mp4"].includes(ext) ? "1y" : "no-cache"; }
    };

    const makeETag = async (data) => {
      const buf = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
      const hash = await crypto.subtle.digest("SHA-1", buf);
      return `"${[...new Uint8Array(hash)].map(b => b.toString(16).padStart(2,"0")).join("")}"`;
    };

    const rewriteFetch = (code, user, BASEDIR) => {
      return code.replace(/fetch\(["']([^"']+)["']\)/g, (m, p) => {
        if (/^(https?:)?\/\//.test(p)) return m;
        return `fetch("/${user}/${resolvePath(BASEDIR, p)}")`;
      });
    };

    const fixCSS = (css, user, BASEDIR) => {
      return css.replace(/url\(["']?([^"')]+)["']?\)/g, (m, p) => {
        if (/^(https?:)?\/\//.test(p)) return m;
        return `url("/${user}/${resolvePath(BASEDIR, p)}")`;
      });
    };

    const processHTML = async (raw, user, BASEDIR, PREFIX) => {
      const head = raw.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] || "";
      const body = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || raw;
      let css = "", js = "";

      for (const m of head.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) css += `<style>${fixCSS(m[1], user, BASEDIR)}</style>`;
      for (const l of head.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)) {
        const href = l[0].match(/href=["']([^"']+)["']/i)?.[1]; if (!href) continue;
        try { 
          const content = /^(https?:)?\/\//.test(href) ? null : await loadFile(PREFIX + resolvePath(BASEDIR, href));
          css += content ? `<style>${fixCSS(content, user, BASEDIR)}</style>` : l[0]; 
        } catch {} 
      }

      for (const s of [...raw.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]) {
        const src = s[1].match(/src=["']([^"']+)["']/i)?.[1];
        try {
          if (!src) js += `<script>${rewriteFetch(s[2], user, BASEDIR)}</script>`;
          else if (/^(https?:)?\/\//.test(src)) js += `<script src="${src}"></script>`;
          else js += `<script>${rewriteFetch(await loadFile(PREFIX + resolvePath(BASEDIR, src)), user, BASEDIR)}</script>`;
        } catch {}
      }

      return `<!DOCTYPE html><html><head>${head}${css}</head><body>${body.replace(/<script[\s\S]*?<\/script>/gi,"")}${js}</body></html>`;
    };

    const serve = async (name, user, status = 200) => {
      const PREFIX = `${user}/`;
      const BASEDIR = name.split("/").slice(0, -1).join("/");
      const ext = name.split(".").pop().toLowerCase();
      const cache = cacheControl(await getCacheRule(ext, PREFIX));
      const html = ["html","htm"].includes(ext);
      const data = html ? await processHTML(await loadFile(PREFIX + name), user, BASEDIR, PREFIX) : await loadFile(PREFIX + name, "arrayBuffer");
      const etag = await makeETag(data);
      if (req.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });

      const mime = {html:"text/html; charset=utf-8",js:"text/javascript",css:"text/css",json:"application/json",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",svg:"image/svg+xml",mp4:"video/mp4"}[ext] || "application/octet-stream";

      return new Response(data, { status, headers: { ...cors, ...securityHeaders, "Content-Type": mime, "Cache-Control": cache, "ETag": etag } });
    };

    const fallback = async (code, user) => {
      let map = {};
      try { map = JSON.parse(await loadFile(`${user}/.cashing`)); } catch {}
      if (map[code]) {
        try { return await serve(map[code], user, code); } catch {}
      }
      if (code !== 500 && map[500]) {
        try { return await serve(map[500], user, 500); } catch {}
      }
      return new Response(code === 404 ? "Not Found" : "Server Error", { status: code });
    };

    try {
      const url = new URL(req.url);
      const parts = url.pathname.split("/").filter(Boolean);
      const user = parts.shift();
      let filename = parts.join("/") || "index.html";
      if (url.pathname.endsWith("/")) filename += "/index.html";
      if (!filename.split("/").pop().includes(".")) filename += ".html";
      return await serve(filename, user);
    } catch {
      const url = new URL(req.url);
      const user = url.pathname.split("/").filter(Boolean)[0] || "";
      return await fallback(500, user);
    }
  }
};
