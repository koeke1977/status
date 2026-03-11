const API_UPSTREAM = 'https://status-api.datuur.be';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Proxy /api/* requests to the upstream API server.
    // This avoids cross-origin (CORS) issues by keeping the browser
    // on the same origin while forwarding requests server-side.
    if (url.pathname.startsWith('/api/')) {
      const upstreamUrl = new URL(url.pathname + url.search, API_UPSTREAM);
      try {
        return await fetch(upstreamUrl.toString(), {
          method:   request.method,
          headers:  request.headers,
          body:     ['GET', 'HEAD', 'OPTIONS'].includes(request.method) ? undefined : request.body,
          redirect: 'follow',
        });
      } catch {
        return new Response(JSON.stringify({ ok: false, error: 'Upstream API unreachable' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Fall back to serving static assets for all other requests.
    return env.ASSETS.fetch(request);
  },
};
