export default {
  async fetch(req, env, ctx) {
    try {
      const url = new URL(req.url);
      let path = url.pathname;

      const rawParts = path.split("/").filter(Boolean);
      const user = rawParts[0];
      let filename = rawParts.slice(1).join("/");

      if (!user) return new Response("Missing user", { status: 400 });

      if (!filename) {
        if (!path.endsWith("/")) {
          url.pathname = `/${user}/`;
          return Response.redirect(url.toString(), 301);
        }
        filename = "index.html";
      }

      if (path.endsWith("/")) {
        filename = filename ? `${filename}index.html` : "index.html";
      }

      const lastPart = filename.split("/").pop();
      if (lastPart && !lastPart.includes(".")) {
        filename = filename + ".html";
      }

      const PREFIX = `${user}/`;
      const ext = filename.split(".").pop().toLowerCase();

      async function loadFile(name, type = "text") {
        const key = PREFIX + name;
        const data = await env.FILES.get(
          key,
          type === "arrayBuffer" ? "arrayBuffer" : "text"
        );
        if (data === null) throw new Error("Missing " + key);
        return data;
      }

      function rewriteFetches(code) {
        if (!code) return code;
        return code.replace(/fetch\(["']([^"']+)["']\)/g, (m, p) => {
          if (/^(https?:)?\/\//.test(p) || p.startsWith("/")) return m;
          return `fetch("/${user}/${p}")`;
        });
      }

      function fixCSSUrls(css) {
        if (!css) return css;
        return css.replace(/url\(["']?([^"')]+)["']?\)/g, (m, p) => {
          if (/^(https?:)?\/\//.test(p) || p.startsWith("/")) return m;
          return `url("/${user}/${p}")`;
        });
      }

      async function processHTML(raw) {
        raw = raw ?? "";

        const head = raw.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] || "";
        const body = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || raw;

        let finalHead = head
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi, "");

        for (const m of head.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
          finalHead += `<style>${fixCSSUrls(m[1] || "")}</style>`;
        }

        for (const l of head.matchAll(
          /<link[^>]+rel=["']stylesheet["'][^>]*>/gi
        )) {
          const href = l[0].match(/href=["']([^"']+)["']/i)?.[1];
          if (!href) continue;

          if (/^(https?:)?\/\//.test(href)) {
            finalHead += l[0];
          } else {
            try {
              const css = await loadFile(href);
              finalHead += `<style>${fixCSSUrls(css || "")}</style>`;
            } catch {}
          }
        }

        let finalScripts = "";
        const scriptRegex = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
        const allScripts = [...head.matchAll(scriptRegex), ...body.matchAll(scriptRegex)];

        for (const m of allScripts) {
          const attrs = m[1] || "";
          const inline = m[2] || "";
          const src = attrs.match(/src=["']([^"']+)["']/i)?.[1];
          const type = attrs.match(/type=["']([^"']+)["']/i)?.[1];

          if (!src) {
            finalScripts += `<script${type ? ` type="${type}"` : ""}>${rewriteFetches(inline) || ""}</script>`;
            continue;
          }

          if (/^(https?:)?\/\//.test(src)) {
            finalScripts += `<script src="${src}"${type ? ` type="${type}"` : ""}></script>`;
            continue;
          }

          try {
            const js = await loadFile(src);
            finalScripts += `<script${type ? ` type="${type}"` : ""}>${rewriteFetches(js || "")}</script>`;
          } catch {}
        }

        const cleanBody = body.replace(/<script[\s\S]*?<\/script>/gi, "");

        return `<!DOCTYPE html>
<html>
<head>
${finalHead}
</head>
<body>
${cleanBody}
${finalScripts}
</body>
</html>`;
      }

      // -----------------------------
      // .CASHING JSON FALLBACK
      // -----------------------------
      async function getCashingFallback(statusCode) {
        try {
          const raw = await loadFile(".cashing");
          const obj = JSON.parse(raw);
          return obj[statusCode] || null;
        } catch {
          return null;
        }
      }

      async function serveFallback(status) {
        const fallbackFile = await getCashingFallback(status);
        if (fallbackFile) {
          try {
            const ext = fallbackFile.split(".").pop().toLowerCase();
            const data = await loadFile(fallbackFile, ext === "html" ? "text" : "arrayBuffer");

            const mime = {
              html: "text/html; charset=utf-8",
              js: "text/javascript",
              css: "text/css",
              json: "application/json",
              png: "image/png",
              jpg: "image/jpeg",
              jpeg: "image/jpeg",
              svg: "image/svg+xml",
              mp4: "video/mp4",
            }[ext] || "application/octet-stream";

            const body = ext === "html" ? await processHTML(data) : data;
            return new Response(body, { status, headers: { "Content-Type": mime } });
          } catch {}
        }

        return new Response(status === 404 ? "Not Found" : "Internal Server Error", { status });
      }

      // -----------------------------
      // FILE SERVE LOGIC
      // -----------------------------
      if (!["html", "htm"].includes(ext)) {
        try {
          const bin = await loadFile(filename, "arrayBuffer");
          return new Response(bin, {
            headers: { "Content-Type": "application/octet-stream" },
          });
        } catch {
          return await serveFallback(404);
        }
      }

      try {
        const raw = await loadFile(filename);
        const html = await processHTML(raw);
        return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      } catch {
        return await serveFallback(404);
      }

    } catch (e) {
      // On Worker crash → try 500 fallback
      return await serveFallback(500) || new Response("Worker crash:\n" + (e?.stack || e?.message || e), { status: 500 });
    }
  },
};
