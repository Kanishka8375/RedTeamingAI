import PDFDocument from 'pdfkit';
import { db } from '../db/connection.js';
import type { AgentStat, LoggedEvent, PolicyRule, StatsResult } from '../types/index.js';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 40;
const HEADER_HEIGHT = 42;
const HEADER_COLOR = '#0a1628';
const ACCENT_COLOR = '#00e5ff';
const ROW_ALT = '#f8fafc';

interface PolicyRow {
  name: string;
  action: string;
  severity: string;
  hitCount: number;
}

function withCommas(value: number): string {
  return value.toLocaleString('en-US');
}

function currency(value: number): string {
  return `$${value.toFixed(4)}`;
}

function riskColor(score: number): string {
  if (score >= 80) return '#ef4444';
  if (score >= 60) return '#f59e0b';
  if (score >= 30) return '#eab308';
  return '#10b981';
}

function addHeader(doc: PDFKit.PDFDocument, pageNumber: number): void {
  doc.save();
  doc.rect(0, 0, PAGE_WIDTH, HEADER_HEIGHT).fill(HEADER_COLOR);
  doc.fillColor(ACCENT_COLOR).fontSize(11).font('Helvetica-Bold').text('RedTeamingAI Transparency & Security Report', MARGIN_X, 14);
  doc.fillColor('#9ca3af').fontSize(10).font('Helvetica').text(`Page ${pageNumber}`, PAGE_WIDTH - 90, 14, { width: 50, align: 'right' });
  doc.restore();
}

function addTitle(doc: PDFKit.PDFDocument, title: string, y: number): number {
  doc.fillColor(ACCENT_COLOR).font('Helvetica-Bold').fontSize(18).text(title, MARGIN_X, y);
  doc.moveTo(MARGIN_X, y + 25).lineTo(PAGE_WIDTH - MARGIN_X, y + 25).lineWidth(1).strokeColor(ACCENT_COLOR).stroke();
  return y + 36;
}

function drawKpiCard(doc: PDFKit.PDFDocument, x: number, y: number, width: number, label: string, value: string): void {
  doc.roundedRect(x, y, width, 62, 6).lineWidth(1).strokeColor(ACCENT_COLOR).fillAndStroke('#ffffff', ACCENT_COLOR);
  doc.fillColor('#64748b').font('Helvetica').fontSize(10).text(label, x + 10, y + 10);
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(16).text(value, x + 10, y + 28);
}

function drawRiskBadge(doc: PDFKit.PDFDocument, x: number, y: number, risk: number): void {
  doc.save();
  doc.circle(x, y, 10).fillColor(riskColor(risk)).fill();
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8).text(String(risk), x - 7, y - 3, { width: 14, align: 'center' });
  doc.restore();
}

function drawTableHeader(doc: PDFKit.PDFDocument, y: number, columns: Array<{ label: string; x: number }>): number {
  doc.rect(MARGIN_X, y, PAGE_WIDTH - MARGIN_X * 2, 24).fill(HEADER_COLOR);
  doc.fillColor(ACCENT_COLOR).font('Helvetica-Bold').fontSize(10);
  for (const column of columns) {
    doc.text(column.label, column.x, y + 7);
  }
  return y + 24;
}

function drawAlternatingRow(doc: PDFKit.PDFDocument, y: number, rowIndex: number): void {
  if (rowIndex % 2 === 1) {
    doc.rect(MARGIN_X, y, PAGE_WIDTH - MARGIN_X * 2, 22).fill(ROW_ALT);
  }
}

function getCustomerName(customerId: string): string {
  const row = db.prepare('SELECT name FROM customers WHERE id = ?').get(customerId) as { name?: string } | undefined;
  return row?.name ?? `Customer ${customerId.slice(0, 8)}`;
}

function getStatsSnapshot(customerId: string, startDate: string, endDate: string): StatsResult {
  const totals = db.prepare(
    `SELECT COUNT(*) as totalCalls,
            COALESCE(SUM(cost_usd), 0) as totalCostUsd,
            SUM(CASE WHEN blocked = 1 THEN 1 ELSE 0 END) as blockedCount,
            COALESCE(AVG(risk_score), 0) as avgRiskScore
       FROM events
      WHERE customer_id = ? AND timestamp BETWEEN ? AND ?`
  ).get(customerId, startDate, endDate) as Record<string, number>;

  const topAgents = db.prepare(
    `SELECT COALESCE(agent_id, 'unknown') as agentId,
            COUNT(*) as calls,
            SUM(CASE WHEN blocked = 1 THEN 1 ELSE 0 END) as blocked,
            COALESCE(SUM(cost_usd),0) as costUsd
       FROM events
      WHERE customer_id = ? AND timestamp BETWEEN ? AND ?
      GROUP BY agent_id
      ORDER BY calls DESC
      LIMIT 5`
  ).all(customerId, startDate, endDate) as AgentStat[];

  return {
    totalCalls: Number(totals.totalCalls ?? 0),
    totalCostUsd: Number(totals.totalCostUsd ?? 0),
    blockedCount: Number(totals.blockedCount ?? 0),
    avgRiskScore: Number(totals.avgRiskScore ?? 0),
    topAgents,
    costByModel: [],
    riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
    callsOverTime: []
  };
}

function getHighRiskEvents(customerId: string, startDate: string, endDate: string): LoggedEvent[] {
  const rows = db.prepare(
    `SELECT * FROM events
      WHERE customer_id = ? AND timestamp BETWEEN ? AND ? AND risk_score > 60
      ORDER BY risk_score DESC, timestamp DESC
      LIMIT 50`
  ).all(customerId, startDate, endDate) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
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
  }));
}

function getActivePolicies(customerId: string): PolicyRow[] {
  return db
    .prepare('SELECT name, action, severity, hit_count as hitCount FROM policies WHERE customer_id = ? AND enabled = 1 ORDER BY severity DESC, hit_count DESC')
    .all(customerId) as PolicyRow[];
}

function getBlockedEvents(customerId: string, startDate: string, endDate: string): LoggedEvent[] {
  const rows = db.prepare(
    `SELECT * FROM events
      WHERE customer_id = ? AND timestamp BETWEEN ? AND ? AND blocked = 1
      ORDER BY timestamp DESC
      LIMIT 100`
  ).all(customerId, startDate, endDate) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
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
  }));
}

function drawCoverPage(doc: PDFKit.PDFDocument, customerName: string, startDate: string, endDate: string): void {
  addHeader(doc, 1);
  let y = addTitle(doc, 'EU AI Act Article 12 Transparency Report', 70);
  doc.fillColor('#111827').font('Helvetica').fontSize(12);
  doc.text(`Customer: ${customerName}`, MARGIN_X, y + 8);
  doc.text(`Reporting period: ${startDate} to ${endDate}`, MARGIN_X, y + 28);
  doc.text(`Generated at: ${new Date().toISOString()}`, MARGIN_X, y + 48);

  doc.save();
  doc.rotate(-25, { origin: [300, 420] });
  doc.fillColor('#ef4444').font('Helvetica-Bold').fontSize(54).opacity(0.15).text('CONFIDENTIAL', 130, 370);
  doc.restore();
}

function drawExecutiveSummary(doc: PDFKit.PDFDocument, stats: StatsResult, blockedEvents: LoggedEvent[]): void {
  addHeader(doc, 2);
  let y = addTitle(doc, 'Executive Summary', 70);

  const cardWidth = (PAGE_WIDTH - MARGIN_X * 2 - 24) / 2;
  drawKpiCard(doc, MARGIN_X, y + 6, cardWidth, 'Total Calls', withCommas(stats.totalCalls));
  drawKpiCard(doc, MARGIN_X + cardWidth + 24, y + 6, cardWidth, 'Total Cost', currency(stats.totalCostUsd));
  drawKpiCard(doc, MARGIN_X, y + 76, cardWidth, 'Blocked Calls', withCommas(stats.blockedCount));
  drawKpiCard(doc, MARGIN_X + cardWidth + 24, y + 76, cardWidth, 'Average Risk', `${stats.avgRiskScore.toFixed(1)} / 100`);

  const complianceScore = Math.max(0, Math.round(100 - stats.avgRiskScore - (blockedEvents.length > 0 ? 5 : 0)));
  y += 160;
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11).text(`Compliance Score: ${complianceScore}/100`, MARGIN_X, y);
  doc.roundedRect(MARGIN_X, y + 20, PAGE_WIDTH - MARGIN_X * 2, 14, 7).fill('#e2e8f0');
  doc.roundedRect(MARGIN_X, y + 20, ((PAGE_WIDTH - MARGIN_X * 2) * complianceScore) / 100, 14, 7).fill(complianceScore > 80 ? '#10b981' : complianceScore > 60 ? '#f59e0b' : '#ef4444');

  const narrative = `During this period, ${withCommas(stats.totalCalls)} AI interactions were inspected. ` +
    `${withCommas(stats.blockedCount)} were blocked by policy controls, while average risk remained at ${stats.avgRiskScore.toFixed(1)}. ` +
    `The system maintained transparent logging and real-time protection aligned with Article 12 traceability requirements.`;
  doc.fillColor('#334155').font('Helvetica').fontSize(11).text(narrative, MARGIN_X, y + 52, { width: PAGE_WIDTH - MARGIN_X * 2, lineGap: 4 });
}

function drawAiSystemsRegister(doc: PDFKit.PDFDocument, topAgents: AgentStat[]): void {
  addHeader(doc, 3);
  let y = addTitle(doc, 'AI Systems Register', 70);
  y = drawTableHeader(doc, y + 8, [
    { label: 'Agent ID', x: MARGIN_X + 10 },
    { label: 'Calls', x: MARGIN_X + 250 },
    { label: 'Blocked', x: MARGIN_X + 330 },
    { label: 'Cost (USD)', x: MARGIN_X + 420 }
  ]);

  doc.font('Helvetica').fontSize(10).fillColor('#0f172a');
  topAgents.slice(0, 18).forEach((agent, index) => {
    drawAlternatingRow(doc, y + index * 22, index);
    const rowY = y + index * 22 + 6;
    doc.text(agent.agentId, MARGIN_X + 10, rowY, { width: 220, ellipsis: true });
    doc.text(withCommas(agent.calls), MARGIN_X + 250, rowY);
    doc.text(withCommas(agent.blocked), MARGIN_X + 330, rowY);
    doc.text(currency(agent.costUsd), MARGIN_X + 420, rowY);
  });
}

function drawHighRiskLog(doc: PDFKit.PDFDocument, highRiskEvents: LoggedEvent[]): void {
  addHeader(doc, 4);
  let y = addTitle(doc, 'High-Risk Events Log (Risk > 60)', 70);
  y = drawTableHeader(doc, y + 8, [
    { label: 'Time', x: MARGIN_X + 10 },
    { label: 'Agent', x: MARGIN_X + 160 },
    { label: 'Model', x: MARGIN_X + 260 },
    { label: 'Risk', x: MARGIN_X + 390 },
    { label: 'Blocked', x: MARGIN_X + 450 }
  ]);

  doc.font('Helvetica').fontSize(9).fillColor('#0f172a');
  highRiskEvents.slice(0, 20).forEach((event, index) => {
    drawAlternatingRow(doc, y + index * 22, index);
    const rowY = y + index * 22 + 6;
    doc.text(event.timestamp.slice(0, 19), MARGIN_X + 10, rowY);
    doc.text(event.agentId ?? 'unknown', MARGIN_X + 160, rowY, { width: 95, ellipsis: true });
    doc.text(event.model, MARGIN_X + 260, rowY, { width: 120, ellipsis: true });
    drawRiskBadge(doc, MARGIN_X + 402, rowY + 4, event.riskScore);
    doc.text(event.blocked ? 'YES' : 'NO', MARGIN_X + 454, rowY, { width: 40, align: 'center' });
  });
}

function drawPolicySummary(doc: PDFKit.PDFDocument, policies: PolicyRow[]): void {
  addHeader(doc, 5);
  let y = addTitle(doc, 'Security Policy Summary', 70);
  y = drawTableHeader(doc, y + 8, [
    { label: 'Policy', x: MARGIN_X + 10 },
    { label: 'Action', x: MARGIN_X + 290 },
    { label: 'Severity', x: MARGIN_X + 360 },
    { label: 'Hits', x: MARGIN_X + 460 }
  ]);

  doc.font('Helvetica').fontSize(10).fillColor('#0f172a');
  policies.slice(0, 22).forEach((policy, index) => {
    drawAlternatingRow(doc, y + index * 22, index);
    const rowY = y + index * 22 + 6;
    doc.text(policy.name, MARGIN_X + 10, rowY, { width: 265, ellipsis: true });
    doc.text(policy.action, MARGIN_X + 292, rowY);
    doc.text(policy.severity, MARGIN_X + 362, rowY);
    doc.text(withCommas(policy.hitCount), MARGIN_X + 462, rowY);
  });
}

function drawBlockedAudit(doc: PDFKit.PDFDocument, blockedEvents: LoggedEvent[]): void {
  addHeader(doc, 6);
  let y = addTitle(doc, 'Blocked Events Audit Trail', 70);

  blockedEvents.slice(0, 9).forEach((event, index) => {
    const cardY = y + index * 72;
    doc.roundedRect(MARGIN_X, cardY, PAGE_WIDTH - MARGIN_X * 2, 62, 5).lineWidth(0.6).strokeColor('#cbd5e1').fillAndStroke(index % 2 === 0 ? '#ffffff' : ROW_ALT, '#cbd5e1');
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(10).text(`${event.timestamp.slice(0, 19)}  •  ${event.agentId ?? 'unknown'}  •  ${event.model}`, MARGIN_X + 10, cardY + 8);
    doc.fillColor('#475569').font('Helvetica').fontSize(9).text(`Event ID: ${event.id}`, MARGIN_X + 10, cardY + 26, { width: 350, ellipsis: true });
    doc.text(`Flags: ${event.anomalyFlags.slice(0, 4).join(', ') || 'n/a'}`, MARGIN_X + 10, cardY + 40, { width: 370, ellipsis: true });
    drawRiskBadge(doc, PAGE_WIDTH - 80, cardY + 30, event.riskScore);
  });
}

function drawRecommendations(doc: PDFKit.PDFDocument, stats: StatsResult, blockedEvents: LoggedEvent[], policies: PolicyRow[]): void {
  addHeader(doc, 7);
  let y = addTitle(doc, 'Recommendations', 70);

  const recommendations: string[] = [];
  if (stats.avgRiskScore > 55) {
    recommendations.push('Lower average risk by tightening BLOCK rules for high-risk tool combinations and enabling stricter prompt filtering.');
  }
  if (blockedEvents.length > 20) {
    recommendations.push('Investigate repeated blocked activity clusters and preemptively quarantine high-noise agent IDs.');
  }
  if (policies.length < 10) {
    recommendations.push('Expand policy baseline to include explicit exfiltration and privilege-escalation constraints per model family.');
  }
  if (recommendations.length === 0) {
    recommendations.push('Current controls are stable. Continue monthly policy tuning and quarterly red-team simulation drills.');
  }

  recommendations.forEach((recommendation, index) => {
    const itemY = y + index * 88;
    doc.roundedRect(MARGIN_X, itemY, PAGE_WIDTH - MARGIN_X * 2, 74, 8).lineWidth(1).strokeColor(ACCENT_COLOR).fillAndStroke('#ffffff', ACCENT_COLOR);
    doc.fillColor(ACCENT_COLOR).font('Helvetica-Bold').fontSize(11).text(`Recommendation ${index + 1}`, MARGIN_X + 12, itemY + 10);
    doc.fillColor('#1f2937').font('Helvetica').fontSize(10).text(recommendation, MARGIN_X + 12, itemY + 30, {
      width: PAGE_WIDTH - MARGIN_X * 2 - 24,
      lineGap: 3
    });
  });
}

export async function generateComplianceReport(customerId: string, startDate: string, endDate: string): Promise<Buffer> {
  const customerName = getCustomerName(customerId);
  const stats = getStatsSnapshot(customerId, startDate, endDate);
  const highRiskEvents = getHighRiskEvents(customerId, startDate, endDate);
  const policies = getActivePolicies(customerId);
  const blockedEvents = getBlockedEvents(customerId, startDate, endDate);

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN_X });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawCoverPage(doc, customerName, startDate, endDate);
    doc.addPage();
    drawExecutiveSummary(doc, stats, blockedEvents);
    doc.addPage();
    drawAiSystemsRegister(doc, stats.topAgents);
    doc.addPage();
    drawHighRiskLog(doc, highRiskEvents);
    doc.addPage();
    drawPolicySummary(doc, policies);
    doc.addPage();
    drawBlockedAudit(doc, blockedEvents);
    doc.addPage();
    drawRecommendations(doc, stats, blockedEvents, policies);

    doc.end();
  });
}
