import nodemailer from 'nodemailer';
import type { LoggedEvent, SecurityDecision, StatsResult } from '../types/index.js';

const APP_BASE_URL = 'https://app.redteamingai.io';

const transporter = nodemailer.createTransport({ jsonTransport: true });

export type EmailTemplateType = 'critical_alert' | 'high_alert' | 'daily_digest';

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

function baseLayout(title: string, content: string): string {
  return `
  <div style="font-family:Arial,sans-serif;background:#f1f5f9;padding:24px;">
    <div style="max-width:700px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
      <div style="background:#0a1628;color:#00e5ff;padding:14px 18px;font-weight:700;">${title}</div>
      <div style="padding:18px;color:#0f172a;font-size:14px;line-height:1.45;">${content}</div>
    </div>
  </div>`;
}

function eventLinks(eventId: string, alertId: string): string {
  const eventUrl = `${APP_BASE_URL}/events/${eventId}`;
  const ackUrl = `${APP_BASE_URL}/api/alerts/${alertId}/acknowledge`;
  return `<p><a href="${eventUrl}" style="color:#0284c7">Open event</a> · <a href="${ackUrl}" style="color:#16a34a">Acknowledge alert</a></p>`;
}

export function renderCriticalAlertTemplate(alertId: string, event: LoggedEvent, decision: SecurityDecision): string {
  const content = `
    <h2 style="margin:0 0 10px;color:#ef4444;">Critical Alert Triggered</h2>
    <p><b>Risk score:</b> ${decision.riskScore} · <b>Blocked:</b> ${decision.blocked ? 'YES' : 'NO'}</p>
    <p><b>Agent:</b> ${event.agentId ?? 'unknown'} · <b>Model:</b> ${event.model}</p>
    <p><b>Flags:</b> ${decision.flags.join(', ') || 'none'}</p>
    ${eventLinks(event.id, alertId)}
  `;
  return baseLayout('RedTeamingAI Critical Alert', content);
}

export function renderHighAlertTemplate(alertId: string, events: LoggedEvent[], maxRisk: number): string {
  const rows = events
    .map(
      (event) => `<tr>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${event.timestamp.slice(0, 19)}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${event.agentId ?? 'unknown'}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${event.model}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${event.riskScore}</td>
    </tr>`
    )
    .join('');

  const content = `
    <h2 style="margin:0 0 10px;color:#f59e0b;">High Severity Alert Batch</h2>
    <p>Batch contains <b>${events.length}</b> events. Highest risk score: <b>${maxRisk}</b>.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">${rows}</table>
    ${events[0] ? eventLinks(events[0].id, alertId) : ''}
  `;

  return baseLayout('RedTeamingAI High Alert', content);
}

export function renderDailyDigestTemplate(alertId: string, stats: StatsResult, wowDeltaPercent: number): string {
  const content = `
    <h2 style="margin:0 0 10px;color:#10b981;">Daily Security Digest</h2>
    <p><b>Total calls:</b> ${stats.totalCalls}</p>
    <p><b>Blocked:</b> ${stats.blockedCount}</p>
    <p><b>Total spend:</b> $${stats.totalCostUsd.toFixed(4)}</p>
    <p><b>Avg risk:</b> ${stats.avgRiskScore.toFixed(1)}</p>
    <p><b>Week-over-week delta:</b> ${wowDeltaPercent.toFixed(1)}%</p>
    <p><a href="${APP_BASE_URL}/api/alerts/${alertId}/acknowledge" style="color:#16a34a">Acknowledge digest</a></p>
  `;
  return baseLayout('RedTeamingAI Daily Digest', content);
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  await transporter.sendMail({
    from: 'alerts@redteamingai.io',
    to: payload.to,
    subject: payload.subject,
    html: payload.html
  });
}
