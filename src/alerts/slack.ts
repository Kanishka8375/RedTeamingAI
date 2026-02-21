import type { LoggedEvent } from '../types/index.js';

const COLOR_BY_SEVERITY: Record<'critical' | 'high' | 'digest', string> = {
  critical: '#ef4444',
  high: '#f59e0b',
  digest: '#10b981'
};

type SlackSeverity = 'critical' | 'high' | 'digest';

interface SlackMessageOptions {
  severity: SlackSeverity;
  title: string;
  body: string;
  event?: LoggedEvent;
}

function buildBlockKit(options: SlackMessageOptions): Record<string, unknown> {
  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${options.title}*\n${options.body}`
      }
    }
  ];

  if (options.event?.agentId) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Block Agent' },
          style: 'danger',
          url: `https://app.redteamingai.io/agents/${encodeURIComponent(options.event.agentId)}/block`
        }
      ]
    });
  }

  return {
    attachments: [
      {
        color: COLOR_BY_SEVERITY[options.severity],
        blocks
      }
    ]
  };
}

export async function sendSlackMessage(webhookUrl: string, options: SlackMessageOptions): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildBlockKit(options))
  });

  if (!response.ok) {
    throw new Error(`Slack webhook failed: ${response.status}`);
  }
}
