import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { getStats } from '../db/events.js';
import type { AlertSettings, LoggedEvent, SecurityDecision } from '../types/index.js';
import {
  renderCriticalAlertTemplate,
  renderDailyDigestTemplate,
  renderHighAlertTemplate,
  sendEmail
} from './email.js';
import { sendSlackMessage } from './slack.js';

const HIGH_BATCH_WINDOW_MS = 5 * 60 * 1000;
const DIGEST_SCHEDULE_MS = 60 * 60 * 1000;

type AlertSeverity = 'CRITICAL' | 'HIGH';

interface HighBatchItem {
  event: LoggedEvent;
  decision: SecurityDecision;
}

interface HighBatchState {
  timer: NodeJS.Timeout;
  items: HighBatchItem[];
}

function loadAlertSettings(customerId: string): AlertSettings | null {
  const row = db.prepare('SELECT * FROM alert_settings WHERE customer_id = ?').get(customerId) as Record<string, unknown> | undefined;
  if (!row) {
    return null;
  }

  return {
    customerId,
    emailEnabled: Number(row.email_enabled) === 1,
    slackEnabled: Number(row.slack_enabled) === 1,
    dailyDigestEnabled: Number(row.daily_digest_enabled) === 1,
    emailTo: typeof row.email_to === 'string' ? row.email_to : null,
    slackWebhookUrl: typeof row.slack_webhook_url === 'string' ? row.slack_webhook_url : null,
    timezone: typeof row.timezone === 'string' ? row.timezone : 'UTC',
    digestHour: Number(row.digest_hour ?? 8)
  };
}

function isNewAgent(customerId: string, agentId: string | null): boolean {
  if (!agentId) {
    return false;
  }

  const row = db.prepare('SELECT COUNT(*) as count FROM events WHERE customer_id = ? AND agent_id = ?').get(customerId, agentId) as { count: number };
  return row.count <= 1;
}

function shouldSendCritical(event: LoggedEvent, decision: SecurityDecision): boolean {
  return (
    decision.blocked ||
    decision.riskScore > 85 ||
    decision.injection.injectionDetected ||
    isNewAgent(event.customerId, event.agentId)
  );
}

function shouldBatchHigh(event: LoggedEvent, decision: SecurityDecision): boolean {
  const budgetThreshold = event.costUsd >= 0.3;
  const policyAlert = decision.policy.action === 'ALERT';
  return (decision.riskScore >= 60 && decision.riskScore <= 85) || budgetThreshold || policyAlert;
}

function logAlertAttempt(customerId: string, eventId: string | null, channel: 'email' | 'slack', severity: AlertSeverity | 'DIGEST', status: 'sent' | 'failed', message: string): void {
  db.prepare(
    'INSERT INTO alerts_log(id, customer_id, event_id, channel, severity, status, message, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(uuidv4(), customerId, eventId, channel, severity, status, message, new Date().toISOString());
}

async function dispatchChannels(
  settings: AlertSettings,
  customerId: string,
  eventId: string | null,
  severity: AlertSeverity | 'DIGEST',
  emailPayload: { subject: string; html: string },
  slackPayload: { severity: 'critical' | 'high' | 'digest'; title: string; body: string; event?: LoggedEvent }
): Promise<void> {
  const tasks: Array<Promise<void>> = [];
  const channels: Array<'email' | 'slack'> = [];

  if (settings.emailEnabled && settings.emailTo) {
    tasks.push(sendEmail({ to: settings.emailTo, subject: emailPayload.subject, html: emailPayload.html }));
    channels.push('email');
  }

  if (settings.slackEnabled && settings.slackWebhookUrl) {
    tasks.push(sendSlackMessage(settings.slackWebhookUrl, slackPayload));
    channels.push('slack');
  }

  const results = await Promise.allSettled(tasks);
  results.forEach((result, index) => {
    const channel = channels[index];
    if (!channel) {
      return;
    }

    if (result.status === 'fulfilled') {
      logAlertAttempt(customerId, eventId, channel, severity, 'sent', `${severity} alert sent`);
      return;
    }

    logAlertAttempt(customerId, eventId, channel, severity, 'failed', result.reason instanceof Error ? result.reason.message : 'unknown send failure');
  });
}

class AlertManager {
  private readonly highBatches = new Map<string, HighBatchState>();

  async sendAlert(event: LoggedEvent, decision: SecurityDecision): Promise<void> {
    const settings = loadAlertSettings(event.customerId);
    if (!settings) {
      return;
    }

    if (shouldSendCritical(event, decision)) {
      const alertId = uuidv4();
      await dispatchChannels(
        settings,
        event.customerId,
        event.id,
        'CRITICAL',
        {
          subject: `[CRITICAL] RedTeamingAI event ${event.id}`,
          html: renderCriticalAlertTemplate(alertId, event, decision)
        },
        {
          severity: 'critical',
          title: 'Critical AI Security Alert',
          body: `Event ${event.id} risk=${decision.riskScore} blocked=${decision.blocked ? 'yes' : 'no'}`,
          event
        }
      );
      return;
    }

    if (!shouldBatchHigh(event, decision)) {
      return;
    }

    const existing = this.highBatches.get(event.customerId);
    if (existing) {
      existing.items.push({ event, decision });
      return;
    }

    const timer = setTimeout(() => {
      void this.flushHighBatch(event.customerId);
    }, HIGH_BATCH_WINDOW_MS);

    this.highBatches.set(event.customerId, {
      timer,
      items: [{ event, decision }]
    });
  }

  private async flushHighBatch(customerId: string): Promise<void> {
    const batch = this.highBatches.get(customerId);
    if (!batch) {
      return;
    }

    this.highBatches.delete(customerId);
    clearTimeout(batch.timer);

    const settings = loadAlertSettings(customerId);
    if (!settings || batch.items.length === 0) {
      return;
    }

    const maxRisk = Math.max(...batch.items.map((item) => item.decision.riskScore));
    const alertId = uuidv4();
    await dispatchChannels(
      settings,
      customerId,
      batch.items[0].event.id,
      'HIGH',
      {
        subject: `[HIGH] RedTeamingAI batch alert (${batch.items.length} events)`,
        html: renderHighAlertTemplate(alertId, batch.items.map((item) => item.event), maxRisk)
      },
      {
        severity: 'high',
        title: 'High Severity Batch Alert',
        body: `${batch.items.length} events batched in 5 minutes. maxRisk=${maxRisk}`,
        event: batch.items[0].event
      }
    );
  }

  async sendDailyDigest(customerId: string): Promise<void> {
    const settings = loadAlertSettings(customerId);
    if (!settings || !settings.dailyDigestEnabled) {
      return;
    }

    const today = getStats(customerId, '24h');
    const week = getStats(customerId, '7d');
    const priorWeekCalls = Math.max(1, week.totalCalls - today.totalCalls);
    const wowDeltaPercent = ((today.totalCalls - priorWeekCalls / 6) / Math.max(1, priorWeekCalls / 6)) * 100;

    const alertId = uuidv4();
    await dispatchChannels(
      settings,
      customerId,
      null,
      'DIGEST',
      {
        subject: 'RedTeamingAI Daily Digest',
        html: renderDailyDigestTemplate(alertId, today, wowDeltaPercent)
      },
      {
        severity: 'digest',
        title: 'Daily Security Digest',
        body: `calls=${today.totalCalls} blocked=${today.blockedCount} avgRisk=${today.avgRiskScore.toFixed(1)}`
      }
    );
  }

  scheduleDigests(): void {
    setInterval(() => {
      const rows = db.prepare('SELECT customer_id, timezone, digest_hour, daily_digest_enabled FROM alert_settings WHERE daily_digest_enabled = 1').all() as Array<Record<string, unknown>>;

      for (const row of rows) {
        const customerId = String(row.customer_id);
        const timezone = typeof row.timezone === 'string' ? row.timezone : 'UTC';
        const digestHour = Number(row.digest_hour ?? 8);

        const localHour = Number(
          new Intl.DateTimeFormat('en-US', {
            hour: 'numeric',
            hour12: false,
            timeZone: timezone
          }).format(new Date())
        );

        if (localHour === digestHour) {
          void this.sendDailyDigest(customerId);
        }
      }
    }, DIGEST_SCHEDULE_MS).unref();
  }
}

export const alertManager = new AlertManager();
