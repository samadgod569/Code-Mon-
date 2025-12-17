(async function () {
    const params = new URLSearchParams(window.location.search);
    const user = params.get("user");
    const filename = params.get("filename");

    if (!user || !filename) {
        document.body.innerHTML = "<h2>Missing user or filename.</h2>";
        throw new Error("Missing query params");
    }

    const API_BASE = "https://code-mon.codemon.workers.dev/api/load";

    async function loadFile(name) {
        const res = await fetch(`${API_BASE}?user=${user}&filename=${name}`);
        if (!res.ok) throw new Error("Failed to load " + name);
        return await res.text();
    }

    // -------------------------------
    // LOAD MAIN HTML
    // -------------------------------
    let raw = await loadFile(filename);

    // Fix img paths
    raw = raw.replace(/(src|href)="img\//g, '$1="./img/');

    // -------------------------------
    // EXTRACT BODY
    // -------------------------------
    const bodyMatch = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : raw;
    document.body.innerHTML = bodyContent;

    // -------------------------------
    // EXTRACT HEAD
    // -------------------------------
    const headMatch = raw.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    const headContent = headMatch ? headMatch[1] : "";

    // -------------------------------
    // INLINE <style>
    // -------------------------------
    [...headContent.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].forEach(m => {
        const style = document.createElement("style");
        style.textContent = m[1];
        document.head.appendChild(style);
    });

    // -------------------------------
    // <link rel="stylesheet"> → FETCH VIA API
    // -------------------------------
    for (const m of headContent.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi)) {
        const href = m[1];

        // Only treat as filename (no http, no //)
        if (!/^(https?:)?\/\//i.test(href)) {
            try {
                const css = await loadFile(href);
                const style = document.createElement("style");
                style.textContent = css;
                document.head.appendChild(style);
            } catch (e) {
                console.error("Failed to load CSS:", href);
            }
        }
    }

    // -------------------------------
    // REWRITE fetch("file") CALLS
    // -------------------------------
    function rewriteFetches(code) {
        return code.replace(
            /fetch\(\s*["']([^"']+)["']\s*\)/g,
            (match, path) => {
                // If it's a URL or absolute path → leave it
                if (
                    path.startsWith("http://") ||
                    path.startsWith("https://") ||
                    path.startsWith("//") ||
                    path.startsWith("/")
                ) {
                    return match;
                }

                // Otherwise rewrite
                return `fetch("${API_BASE}?user=${user}&filename=${path}")`;
            }
        );
    }

    // -------------------------------
    // INLINE <script>
    // -------------------------------
    [...bodyContent.matchAll(/<script(?![^>]+src)[^>]*>([\s\S]*?)<\/script>/gi)].forEach(m => {
        const script = document.createElement("script");
        script.textContent = rewriteFetches(m[1]);
        document.body.appendChild(script);
    });

    // -------------------------------
    // EXTERNAL <script src> (HEAD ONLY)
    // -------------------------------
    [...headContent.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*><\/script>/gi)].forEach(m => {
        const src = m[1];
        const script = document.createElement("script");

        if (/^(https?:)?\/\//i.test(src)) {
            script.src = src;
        } else {
            script.src = `${API_BASE}?user=${user}&filename=${src}`;
        }

        script.defer = true;
        document.head.appendChild(script);
    });

})();
