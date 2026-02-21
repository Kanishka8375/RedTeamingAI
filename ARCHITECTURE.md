# RedTeamingAI Architecture Reasoning

<!--
PHASE 0 REASONING

1) ARCHITECTURE DECISION
Decision: Express.js over raw Node.js HTTP.
Why:
- Streaming support: Express can still expose raw req/res streams for chunk piping, so we keep low-level control where needed.
- Middleware chain: Core requirement includes auth, rate limits, policy enforcement, observability, and graceful fallback. Express middleware is the most maintainable fit.
- TypeScript compatibility: Express has mature type definitions and ecosystem middleware typings, reducing implementation risk.
- Latency overhead: Express adds tiny overhead relative to upstream model latency; security engines remain synchronous/in-memory to keep added latency minimal.
Conclusion: Use Express for proxy/API surfaces and direct stream handling in forwarder.

2) SECURITY EXECUTION DESIGN (<10ms target)
Execution strategy: hybrid parallel + short-circuit semantics.
- Parse tools once (shared input).
- Run anomaly + injection concurrently (Promise.resolve wrappers around synchronous work).
- Evaluate policy after parse (and alongside cache read if needed), but final block decision supports short-circuit at decision layer.
Decision tree:
A. If anomaly has hard-block flag -> blocked immediately regardless of others.
B. Else if injection confidence >= 80 -> blocked.
C. Else if policy action BLOCK -> blocked.
D. Else allow and possibly alert by risk/action.
Score still computed from all engines to keep analytics complete.
Rationale: preserves deterministic blocking with low total compute and complete telemetry.

3) SQLITE SCHEMA + INDEXING
Tables:
- customers
- events
- policies
- attack_patterns
- blocked_agents
- alert_settings
- billing_history
- alerts_log (supporting alerts subsystem)

Index plan + rationale:
- customers(api_key) UNIQUE: fastest auth lookup.
- customers(plan): billing/segmentation queries.
- events(customer_id, timestamp DESC): dashboard feed.
- events(customer_id, risk_score DESC): top risky events.
- events(customer_id, blocked, timestamp DESC): blocked feed / incident page.
- events(customer_id, agent_id, timestamp DESC): agent drill-down.
- events(customer_id, model): cost-by-model aggregation.
- policies(customer_id, enabled): policy evaluation load path.
- blocked_agents(customer_id, agent_id) UNIQUE: O(log n) block check.
- alert_settings(customer_id) UNIQUE: per-customer settings fetch.
- billing_history(customer_id, created_at DESC): billing timeline.
- alerts_log(customer_id, created_at DESC): alert audit queries.

4) RISK SCORE NORMALIZATION
Input scales differ; normalize each to 0-100 first:
- anomaly_norm = clamp(anomaly.score, 0, 100)
- injection_norm = clamp(scan.score or confidence, 0, 100)
- policy_norm = clamp(policy.score, 0, 100)
Weighted blend:
combined = round(0.35*anomaly_norm + 0.45*injection_norm + 0.20*policy_norm)
final = clamp(combined, 0, 100)
Return integer.
Notes:
- Policy score derived from violation severities/action multipliers.
- If any engine uses raw domain-specific units, map via deterministic min/max clamp before blend.

5) TEN EDGE CASES + HANDLING
1. Streaming response completes while event later classified blocked:
   - Do not break in-flight stream; mark event blocked post hoc, emit alert, and optionally auto-block agent for future requests.
2. Customer API key sent in body, not header:
   - Accept fallback from JSON body key field while preferring header.
3. Malformed JSON payload/tool args:
   - Preserve raw body; best-effort parse with safe fallback to empty tool list.
4. Upstream 429/5xx:
   - Forward exact status/body; still log event and compute security result.
5. DB write failure under load:
   - Fail open for proxy path; enqueue in-memory retry and log error (no proxy outage).
6. Unknown model pricing:
   - Use default model pricing (gpt-4o) and tag event with fallback note.
7. Oversized request body:
   - Enforce request limit; return 413 with structured error.
8. WebSocket clients leak/disconnect silently:
   - Heartbeat ping/pong with timeout-driven cleanup.
9. Policy vm condition infinite loop:
   - vm timeout=10ms and treat exception as non-violation.
10. Monthly plan limit race condition on concurrent requests:
   - Atomic check + insert transaction where possible; soft-limit header at 80%, hard 429 at limit.
-->

## Implementation Note
The system is implemented with fail-open proxy behavior (for platform resilience), while still enforcing hard blocks when security decision is available in time.
