import { v4 as uuidv4 } from 'uuid';
import { db } from './connection.js';
import type { EventFilters, LoggedEvent, PaginatedResult, SecurityDecision, StatsResult } from '../types/index.js';

const mapEvent = (row: Record<string, unknown>): LoggedEvent => ({
  id: String(row.id),
  timestamp: String(row.timestamp),
  customerId: String(row.customer_id),
  agentId: row.agent_id ? String(row.agent_id) : null,
  model: String(row.model),
  promptTokens: Number(row.prompt_tokens),
  completionTokens: Number(row.completion_tokens),
  costUsd: Number(row.cost_usd),
  latencyMs: Number(row.latency_ms),
  toolCallsRequested: JSON.parse(String(row.tool_calls_requested)) as string[],
  toolCallsInResponse: JSON.parse(String(row.tool_calls_in_response)) as string[],
  requestHash: String(row.request_hash),
  responsePreview: String(row.response_preview),
  riskScore: Number(row.risk_score),
  blocked: Number(row.blocked) === 1,
  anomalyFlags: JSON.parse(String(row.anomaly_flags)) as string[],
  rawRequest: String(row.raw_request),
  rawResponse: String(row.raw_response)
});

export function insertEvent(event: Omit<LoggedEvent, 'id'>): LoggedEvent {
  const fullEvent: LoggedEvent = { ...event, id: uuidv4() };
  db.prepare(`INSERT INTO events(id,timestamp,customer_id,agent_id,model,prompt_tokens,completion_tokens,cost_usd,latency_ms,tool_calls_requested,tool_calls_in_response,request_hash,response_preview,risk_score,blocked,anomaly_flags,raw_request,raw_response)
    VALUES(@id,@timestamp,@customer_id,@agent_id,@model,@prompt_tokens,@completion_tokens,@cost_usd,@latency_ms,@tool_calls_requested,@tool_calls_in_response,@request_hash,@response_preview,@risk_score,@blocked,@anomaly_flags,@raw_request,@raw_response)`).run({
    id: fullEvent.id,
    timestamp: fullEvent.timestamp,
    customer_id: fullEvent.customerId,
    agent_id: fullEvent.agentId,
    model: fullEvent.model,
    prompt_tokens: fullEvent.promptTokens,
    completion_tokens: fullEvent.completionTokens,
    cost_usd: fullEvent.costUsd,
    latency_ms: fullEvent.latencyMs,
    tool_calls_requested: JSON.stringify(fullEvent.toolCallsRequested),
    tool_calls_in_response: JSON.stringify(fullEvent.toolCallsInResponse),
    request_hash: fullEvent.requestHash,
    response_preview: fullEvent.responsePreview,
    risk_score: fullEvent.riskScore,
    blocked: fullEvent.blocked ? 1 : 0,
    anomaly_flags: JSON.stringify(fullEvent.anomalyFlags),
    raw_request: fullEvent.rawRequest,
    raw_response: fullEvent.rawResponse
  });
  return fullEvent;
}

export function getEvents(customerId: string, filters: EventFilters): PaginatedResult<LoggedEvent> {
  const where: string[] = ['customer_id = ?'];
  const params: Array<string | number> = [customerId];
  if (filters.startDate) { where.push('timestamp >= ?'); params.push(filters.startDate); }
  if (filters.endDate) { where.push('timestamp <= ?'); params.push(filters.endDate); }
  if (typeof filters.minRisk === 'number') { where.push('risk_score >= ?'); params.push(filters.minRisk); }
  if (typeof filters.blocked === 'boolean') { where.push('blocked = ?'); params.push(filters.blocked ? 1 : 0); }
  if (filters.agentId) { where.push('agent_id = ?'); params.push(filters.agentId); }
  const whereSql = where.join(' AND ');
  const rows = db.prepare(`SELECT * FROM events WHERE ${whereSql} ORDER BY timestamp DESC LIMIT ? OFFSET ?`).all(...params, filters.limit, filters.offset) as Record<string, unknown>[];
  const total = (db.prepare(`SELECT COUNT(*) as count FROM events WHERE ${whereSql}`).get(...params) as { count: number }).count;
  const items = rows.map(mapEvent);
  return { items, total, hasMore: filters.offset + items.length < total, limit: filters.limit, offset: filters.offset };
}

export function updateSecurityResult(id: string, decision: SecurityDecision): void {
  const trx = db.transaction(() => {
    db.prepare('UPDATE events SET risk_score = ?, blocked = ?, anomaly_flags = ? WHERE id = ?')
      .run(decision.riskScore, decision.blocked ? 1 : 0, JSON.stringify(decision.flags), id);
  });
  trx();
}

export function getStats(customerId: string, period: '24h' | '7d' | '30d'): StatsResult {
  const periodClause = period === '24h' ? "-1 day" : period === '7d' ? "-7 day" : "-30 day";
  const summary = db.prepare(`SELECT COUNT(*) as totalCalls, COALESCE(SUM(cost_usd),0) as totalCostUsd,
    COALESCE(SUM(CASE WHEN blocked=1 THEN 1 ELSE 0 END),0) as blockedCount,
    COALESCE(AVG(risk_score),0) as avgRiskScore
    FROM events WHERE customer_id = ? AND timestamp >= datetime('now', ?)`).get(customerId, periodClause) as Record<string, number>;
  const topAgents = db.prepare(`SELECT COALESCE(agent_id,'unknown') as agentId, COUNT(*) as calls,
      SUM(CASE WHEN blocked=1 THEN 1 ELSE 0 END) as blocked,
      COALESCE(SUM(cost_usd),0) as costUsd
      FROM events WHERE customer_id = ? AND timestamp >= datetime('now', ?)
      GROUP BY agent_id ORDER BY calls DESC LIMIT 10`).all(customerId, periodClause) as Array<Record<string, number | string>>;
  const costByModel = db.prepare(`SELECT model, COALESCE(SUM(cost_usd),0) as costUsd, COUNT(*) as calls
      FROM events WHERE customer_id = ? AND timestamp >= datetime('now', ?)
      GROUP BY model ORDER BY costUsd DESC`).all(customerId, periodClause) as Array<Record<string, number | string>>;
  const risk = db.prepare(`SELECT
    SUM(CASE WHEN risk_score < 30 THEN 1 ELSE 0 END) as low,
    SUM(CASE WHEN risk_score BETWEEN 30 AND 59 THEN 1 ELSE 0 END) as medium,
    SUM(CASE WHEN risk_score BETWEEN 60 AND 79 THEN 1 ELSE 0 END) as high,
    SUM(CASE WHEN risk_score >= 80 THEN 1 ELSE 0 END) as critical
    FROM events WHERE customer_id = ? AND timestamp >= datetime('now', ?)`).get(customerId, periodClause) as Record<string, number>;
  const callsOverTime = db.prepare(`SELECT strftime('%Y-%m-%d %H:00:00', timestamp) as bucket,
      COUNT(*) as calls,
      SUM(CASE WHEN blocked=1 THEN 1 ELSE 0 END) as blocked,
      COALESCE(SUM(cost_usd),0) as costUsd
      FROM events WHERE customer_id = ? AND timestamp >= datetime('now', ?)
      GROUP BY bucket ORDER BY bucket ASC`).all(customerId, periodClause) as Array<Record<string, number | string>>;
  return {
    totalCalls: Number(summary.totalCalls ?? 0),
    totalCostUsd: Number(summary.totalCostUsd ?? 0),
    blockedCount: Number(summary.blockedCount ?? 0),
    avgRiskScore: Number(summary.avgRiskScore ?? 0),
    topAgents: topAgents.map((r) => ({ agentId: String(r.agentId), calls: Number(r.calls), blocked: Number(r.blocked), costUsd: Number(r.costUsd) })),
    costByModel: costByModel.map((r) => ({ model: String(r.model), costUsd: Number(r.costUsd), calls: Number(r.calls) })),
    riskDistribution: { low: Number(risk.low ?? 0), medium: Number(risk.medium ?? 0), high: Number(risk.high ?? 0), critical: Number(risk.critical ?? 0) },
    callsOverTime: callsOverTime.map((r) => ({ bucket: String(r.bucket), calls: Number(r.calls), blocked: Number(r.blocked), costUsd: Number(r.costUsd) }))
  };
}

export function getTopRiskyEvents(customerId: string, limit: number): LoggedEvent[] {
  const rows = db.prepare('SELECT * FROM events WHERE customer_id = ? ORDER BY risk_score DESC LIMIT ?').all(customerId, limit) as Record<string, unknown>[];
  return rows.map(mapEvent);
}
