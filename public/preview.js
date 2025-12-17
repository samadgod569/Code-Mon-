let raw = localStorage.getItem("codeMonGenerated");
if (!raw) {
    document.body.innerHTML = "<h2>No preview data found.</h2>";
    throw new Error("No data in localStorage");
}

// Fix relative paths for img/ and CSS
raw = raw.replace(/(src|href)="img\//g, '$1="./img/');

// -------------------------------
// EXTRACT BODY CONTENT
// -------------------------------
const bodyMatch = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
const bodyContent = bodyMatch ? bodyMatch[1] : raw;
document.body.innerHTML = bodyContent; // set once

// -------------------------------
// EXTRACT AND INJECT HEAD STYLES
// -------------------------------
const headContentMatch = raw.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
const headContent = headContentMatch ? headContentMatch[1] : "";

// Inject <style> from head
[...headContent.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].forEach(match => {
    const style = document.createElement("style");
    style.textContent = match[1];
    document.head.appendChild(style);
});

// Inject <link> from head
[...headContent.matchAll(/<link[^>]+href="([^"]+)"[^>]*>/gi)].forEach(match => {
    const linkEl = document.createElement("link");
    linkEl.rel = "stylesheet";
    linkEl.href = match[1];
    document.head.appendChild(linkEl);
});

// -------------------------------
// EXECUTE INLINE SCRIPTS
// -------------------------------
[...bodyContent.matchAll(/<script(?![^>]+src)[^>]*>([\s\S]*?)<\/script>/gi)].forEach(match => {
    const script = document.createElement("script");
    script.textContent = match[1];
    document.body.appendChild(script);
});

// -------------------------------
// LOAD EXTERNAL SCRIPT SRC (only from head)
// -------------------------------
[...headContent.matchAll(/<script[^>]+src="([^"]+)"[^>]*><\/script>/gi)].forEach(match => {
    const script = document.createElement("script");
    script.src = match[1];
    script.defer = true;
    document.head.appendChild(script);
});
