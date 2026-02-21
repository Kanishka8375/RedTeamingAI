What I checked first
I reviewed the runtime scripts, ports, env vars, server wiring, dashboard hooks, and billing/webhook behavior with:

nl -ba package.json | sed -n '1,140p'

nl -ba .env.example | sed -n '1,120p'

nl -ba src/index.ts | sed -n '1,120p'

nl -ba src/proxy/server.ts | sed -n '1,180p'

nl -ba src/api/server.ts | sed -n '1,180p'

nl -ba src/api/billing.ts | sed -n '1,360p'

nl -ba dashboard/src/hooks/useWebSocket.ts | sed -n '1,120p'

nl -ba dashboard/src/hooks/useEvents.ts | sed -n '1,120p'

nl -ba dashboard/src/hooks/useStats.ts | sed -n '1,120p'

(Those confirm the expected commands/ports and where realtime traffic flows.)

1) Start everything locally
A. Create env
cp .env.example .env
Fill at least:

OPENAI_API_KEY and/or ANTHROPIC_API_KEY

STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET if billing tests are included.

B. Install + verify
npm install
npm run build
npm test
Scripts are already defined for build/test/dev/dashboard dev.

C. Run backend (proxy + API)
npm run dev
This starts:

Proxy on PORT (default 3000)

API on API_PORT (default 4000).

D. Run dashboard
npm run dev:dashboard
Dashboard expects API at http://localhost:4000 and WS at ws://localhost:4000/ws?key=....

2) Real-time flow test (end-to-end)
A. Health checks
curl -s http://localhost:3000/health
curl -s http://localhost:4000/api/health
Proxy exposes /health; API exposes /api/health.

B. Send live proxy traffic
Use your customer key in X-RedTeamingAI-Key and optional X-Agent-ID:

curl -i http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-RedTeamingAI-Key: <customer_api_key>" \
  -H "X-Agent-ID: agent-realtime-1" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}'
This should trigger interception and event logging, then appear in dashboard feed + websocket.

C. Validate response headers
You should see:

X-RedTeamingAI-Event-ID

X-RedTeamingAI-Risk-Score
from interceptor flow.

D. Confirm dashboard updates live
Open dashboard in browser; it subscribes via WS and updates EventFeed in real time from lastEvent.

3) API behavior checks (manual)
Use same API key against API server:

curl -s "http://localhost:4000/api/events?limit=20" -H "X-RedTeamingAI-Key: <key>"
curl -s "http://localhost:4000/api/stats?period=24h" -H "X-RedTeamingAI-Key: <key>"
curl -s "http://localhost:4000/api/policies" -H "X-RedTeamingAI-Key: <key>"
Routes are mounted under /api and auth is required for these modules.

4) WebSocket realtime test (without dashboard)
Use wscat (or browser dev console):

wscat -c "ws://localhost:4000/ws?key=<customer_api_key>"
Then send proxy calls from step 2 and verify type: "event" payloads arrive. broadcastEvent is the push mechanism. 

5) Billing flow test (Stripe)
A. Checkout URL
curl -s -X POST http://localhost:4000/api/billing/create-checkout \
  -H "Content-Type: application/json" \
  -H "X-RedTeamingAI-Key: <key>" \
  -d '{"plan":"pro"}'
Should return { "url": ... }.

B. Portal URL
curl -s "http://localhost:4000/api/billing/portal" \
  -H "X-RedTeamingAI-Key: <key>"
Returns { "url": ... } if Stripe customer exists.

C. Webhook realtime testing
Use Stripe CLI forwarding:

stripe listen --forward-to localhost:4000/api/billing/webhook
Then trigger test events (customer.subscription.updated, invoice.payment_failed, etc.). Webhook is configured for signature validation and event handling. 

6) Plan-limit enforcement test
Generate events until near limit; middleware sets warning at 80% and returns 429 at limit:

warning header: X-RedTeamingAI-Limit-Warning: true

429 body includes currentPlan, limit, upgradeUrl: '/billing'.
