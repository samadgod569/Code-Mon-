export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);

    const user = parts[0];
    const filename = parts[1];

    if (!user || !filename) {
      return new Response("<h2>Missing user or filename.</h2>", {
        headers: { "Content-Type": "text/html" }
      });
    }

    const KEY_PREFIX = `${user}/`;

    async function loadFile(name) {
      const data = await env.FILES.get(KEY_PREFIX + name);
      if (!data) throw new Error("Failed to load " + name);
      return data;
    }

    let raw;
    try {
      raw = await loadFile(filename);
    } catch {
      return new Response("<h2>File not found.</h2>", { status: 404 });
    }

    // --------------------------------
    // EXTRACT HEAD & BODY
    // --------------------------------
    const headMatch = raw.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    const bodyMatch = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);

    const headContent = headMatch ? headMatch[1] : "";
    const bodyContent = bodyMatch ? bodyMatch[1] : raw;

    // --------------------------------
    // REWRITE fetch()
    // --------------------------------
    function rewriteFetches(code) {
      return code.replace(
        /fetch\(\s*["']([^"']+)["']\s*\)/g,
        (m, p) => {
          if (/^(https?:)?\/\//i.test(p) || p.startsWith("/")) return m;
          return `fetch("/${user}/${p}")`;
        }
      );
    }

    // --------------------------------
    // PROCESS HEAD
    // --------------------------------
    let finalHead = "";

    const tempHead = new DOMParser().parseFromString(
      `<head>${headContent}</head>`,
      "text/html"
    ).head;

    for (const node of tempHead.children) {
      const tag = node.tagName.toLowerCase();

      if (tag === "script" || tag === "style") continue;

      finalHead += node.outerHTML;
    }

    for (const style of tempHead.querySelectorAll("style")) {
      finalHead += `<style>${style.textContent}</style>`;
    }

    for (const link of tempHead.querySelectorAll('link[rel="stylesheet"]')) {
      const href = link.getAttribute("href");

      if (/^(https?:)?\/\//i.test(href)) {
        finalHead += link.outerHTML;
      } else {
        try {
          const css = await loadFile(href);
          finalHead += `<style>${css}</style>`;
        } catch {}
      }
    }

    // --------------------------------
    // HANDLE SCRIPTS
    // --------------------------------
    const scriptHolder = new DOMParser().parseFromString(
      `<div>${headContent}${bodyContent}</div>`,
      "text/html"
    );

    let finalScripts = "";

    const scripts = [...scriptHolder.querySelectorAll("script")];

    for (const old of scripts) {
      const src = old.getAttribute("src");
      const type = old.getAttribute("type") || "text/javascript";
      const inline = old.textContent || "";

      if (!src) {
        finalScripts += `<script${type==="module"?' type="module"':""}>${rewriteFetches(inline)}</script>`;
        continue;
      }

      if (/^(https?:)?\/\//i.test(src)) {
        finalScripts += `<script src="${src}"${type==="module"?' type="module"':""}></script>`;
        continue;
      }

      try {
        const js = await loadFile(src);
        const isModule = type === "module" || /\b(import|export)\b/.test(js);

        if (isModule) {
          const encoded = btoa(unescape(encodeURIComponent(rewriteFetches(js))));
          finalScripts += `
<script type="module">
import(URL.createObjectURL(new Blob([decodeURIComponent(escape(atob("${encoded}")))],{type:"text/javascript"})));
</script>`;
        } else {
          finalScripts += `<script>${rewriteFetches(js)}</script>`;
        }
      } catch {}
    }

    // --------------------------------
    // FINAL HTML
    // --------------------------------
    const finalHTML = `
<!DOCTYPE html>
<html>
<head>
${finalHead}
</head>
<body>
${bodyContent}
${finalScripts}
</body>
</html>`;

    return new Response(finalHTML, {
      headers: {
        "Content-Type": "text/html; charset=utf-8"
      }
    });
  }
};
