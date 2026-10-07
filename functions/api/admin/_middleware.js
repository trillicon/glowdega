import { requireAdmin } from '../../_lib/access.js';

// Writes must come from the admin page itself: a custom header can't be sent cross-site without CORS.
function sameOriginWrites(context) {
  const { request } = context;
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.headers.get('x-glowdega-admin') !== '1') {
    return Response.json({ error: 'missing admin header' }, { status: 403 });
  }
  return context.next();
}

export const onRequest = [requireAdmin, sameOriginWrites];
