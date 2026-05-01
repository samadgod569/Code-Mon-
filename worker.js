export default {
  async fetch(request) {
    try {
      const response = await fetch("http://45.13.236.245:25909");
      const body = await response.text();

      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    } catch (err) {
      return new Response("Error: " + err.message, { status: 500 });
    }
  },
};
