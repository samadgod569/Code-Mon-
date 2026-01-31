export default {
  async fetch(req, env) {
    try {
      const url = new URL(req.url);
      const parts = url.pathname.split("/").filter(Boolean);
      const user = parts[0];
      if (!user) return new Response("Missing user", { status: 400 });

      const PREFIX = `${user}/`; // e.g., "C69P2W/"

      // -----------------------------
      // Load .cashing from KV
      // -----------------------------
      const key = PREFIX + ".cashing";
      const data = await env.FILES.get(key, "text");

      if (!data) {
        return new Response(`.cashing not found at key: ${key}`, { status: 404 });
      }

      // -----------------------------
      // Return the raw content
      // -----------------------------
      return new Response(data, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    } catch (e) {
      return new Response("Error fetching .cashing:\n" + e, { status: 500 });
    }
  }
};
