import { createRouteHandler } from '@fal-ai/server-proxy/nextjs'

import {
  DEMO_COOKIE,
  isDemoUnlocked,
  readCookieFromHeader,
} from '@/lib/demo-auth'

const DIRECTOR_ENDPOINT = 'minimax/h3-max/director'

/**
 * Browser-facing proxy for the realtime video provider. `FAL_KEY` stays on the
 * server; requests are only forwarded when the demo cookie is valid and the
 * target is the director endpoint.
 */
export const { GET, POST, PUT } = createRouteHandler({
  allowUnauthorizedRequests: false,
  isAuthenticated: async (behavior) =>
    isDemoUnlocked(
      readCookieFromHeader(behavior.getHeader('cookie'), DEMO_COOKIE),
    ),
  allowedEndpoints: [DIRECTOR_ENDPOINT, `${DIRECTOR_ENDPOINT}/**`],
})
