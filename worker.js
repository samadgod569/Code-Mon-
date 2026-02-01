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

    try {
      const url = new URL(req.url);
      const parts = url.pathname.split("/").filter(Boolean);
      const user = parts.shift();
      if (!user) return new Response("Missing user", { status: 400 });

      let filename = parts.join("/") || "index.html";
      if (url.pathname.endsWith("/")) filename += "/index.html";
      if (!filename.split("/").pop().includes(".")) filename += ".html";

      const PREFIX = `${user}/`;
      const BASEDIR = filename.split("/").slice(0, -1).join("/");

      async function loadFile(name, type = "text") {
        const v = await env.FILES.get(PREFIX + name, type === "arrayBuffer" ? "arrayBuffer" : "text");
        if (v === null) throw new Error("Missing " + name);
        return v;
      }

      function resolvePath(base, rel) {
        if (rel.startsWith("/")) return rel.slice(1);
        const stack = base ? base.split("/") : [];
        for (const p of rel.split("/")) {
          if (!p || p === ".") continue;
          if (p === "..") stack.pop();
          else stack.push(p);
        }
        return stack.join("/");
      }

      async function getCacheRule(ext) {
        try {
          const rules = JSON.parse(await loadFile(".cache.json"));
          return rules[ext] || rules.default || "no-cache";
        } catch {
          return ["js","css","png","jpg","jpeg","svg","mp4"].includes(ext) ? "1y" : "no-cache";
        }
      }

      function cacheControl(rule) {
        if (rule === "1y") return "public, max-age=31536000, immutable";
        if (rule.endsWith("s")) return `public, max-age=${rule}`;
        return "no-cache";
      }

      async function makeETag(data) {
        const buf = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
        const hash = await crypto.subtle.digest("SHA-1", buf);
        return `"${[...new Uint8Array(hash)].map(b => b.toString(16).padStart(2,"0")).join("")}"`;
      }

      function rewriteFetch(code) {
        return code.replace(/fetch\(["']([^"']+)["']\)/g, (m, p) => {
          if (/^(https?:)?\/\//.test(p)) return m; // external
          return `fetch("/${user}/${resolvePath(BASEDIR, p)}")`; // local
        });
      }

      function fixCSS(css) {
        return css.replace(/url\(["']?([^"')]+)["']?\)/g, (m, p) => {
          if (/^(https?:)?\/\//.test(p)) return m;
          return `url("/${user}/${resolvePath(BASEDIR, p)}")`;
        });
      }

      async function processHTML(raw) {
        const head = raw.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] || "";
        const body = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || raw;

        let css = "";
        let js = "";

        for (const m of head.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) css += `<style>${fixCSS(m[1])}</style>`;

        for (const l of head.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)) {
          const href = l[0].match(/href=["']([^"']+)["']/i)?.[1];
          if (!href) continue;
          css += /^(https?:)?\/\//.test(href) ? l[0] : `<style>${fixCSS(await loadFile(resolvePath(BASEDIR, href)))}</style>`;
        }

        const scripts = [...raw.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
        for (const s of scripts) {
          const typeModule = /type=["']module["']/i.test(s[1]);
          const src = s[1].match(/src=["']([^"']+)["']/i)?.[1];
          if (!src) {
            // Inline script
            js += typeModule 
              ? `<script type="module">${s[2]}</script>` 
              : `<script>${rewriteFetch(s[2])}</script>`;
          } else if (/^(https?:)?\/\//.test(src)) {
            // External CDN
            js += `<script${typeModule ? ' type="module"' : ''} src="${src}"></script>`;
          } else {
            // Local script
            const code = await loadFile(resolvePath(BASEDIR, src));
            js += typeModule
              ? `<script type="module">${code}</script>`
              : `<script>${rewriteFetch(code)}</script>`;
          }
        }

        return `<!DOCTYPE html><html><head>${head}${css}</head><body>${body.replace(/<script[\s\S]*?<\/script>/gi,"")}${js}</body></html>`;
      }

      async function serve(name, status = 200) {
        const ext = name.split(".").pop().toLowerCase();
        const cache = cacheControl(await getCacheRule(ext));
        const html = ["html","htm"].includes(ext);
        const data = html
          ? await processHTML(await loadFile(name))
          : await loadFile(name, "arrayBuffer");

        const etag = await makeETag(data);
        if (req.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });

        const mime = {
          html:"text/html; charset=utf-8",
          js:"text/javascript",
          css:"text/css",
          json:"application/json",
          png:"image/png",
          jpg:"image/jpeg",
          jpeg:"image/jpeg",
          svg:"image/svg+xml",
          mp4:"video/mp4"
        }[ext] || "application/octet-stream";

        return new Response(data, {
          status,
          headers: { ...cors, ...securityHeaders, "Content-Type": mime, "Cache-Control": cache, "ETag": etag }
        });
      }

      async function fallback(code) {
        let map = {};
        try { map = JSON.parse(await loadFile(".cashing")); } catch {}
        if (code === 404 && map[404]) return await serve(map[404], 404);
        if (map[code]) return await serve(map[code], code);
        if (code !== 500 && map[500]) return await serve(map[500], 500);
        return new Response(code === 404 ? "Not Found" : "Server Error", { status: code });
      }

      return await serve(filename);
    } catch {
      return await fallback(404);
    }
  }
};
