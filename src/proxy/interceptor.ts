import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { alertManager } from '../alerts/index.js';
import { broadcastEvent } from '../api/websocket.js';
import { getCustomerByApiKey, checkMonthlyLimit, isAgentBlocked } from '../db/customers.js';
import { insertEvent, updateSecurityResult } from '../db/events.js';
import { analyzeEvent } from '../security/pipeline.js';
import type { LoggedEvent } from '../types/index.js';
import { forwardRequest } from './forwarder.js';
import { calculateCost } from './pricing.js';

const RESPONSE_PREVIEW_LENGTH = 256;

function parseUsage(rawResponse: string): { promptTokens: number; completionTokens: number } {
  try {
    const parsed = JSON.parse(rawResponse) as {
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        input_tokens?: number;
        output_tokens?: number;
      };
    };

    const usage = parsed.usage;
    return {
      promptTokens: usage?.prompt_tokens ?? usage?.input_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? usage?.output_tokens ?? 0
    };
  } catch {
    return { promptTokens: 0, completionTokens: 0 };
  }
}

function extractRequestedTools(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) {
    return [];
  }

  const payload = body as Record<string, unknown>;
  if (!Array.isArray(payload.tools)) {
    return [];
  }

  return payload.tools
    .map((tool): string | null => {
      if (typeof tool !== 'object' || tool === null) {
        return null;
      }
      const record = tool as Record<string, unknown>;
      const name = record.name ?? record.type;
      return typeof name === 'string' ? name : null;
    })
    .filter((toolName): toolName is string => toolName !== null);
}

export async function interceptor(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const rawRequest = JSON.stringify(req.body ?? {});

  try {
    const apiKey = req.header('X-RedTeamingAI-Key') ?? (typeof req.body?.apiKey === 'string' ? req.body.apiKey : undefined);
    if (!apiKey) {
      res.status(401).json({ error: 'Missing API key', code: 'AUTH_REQUIRED' });
      return;
    }

    const customer = getCustomerByApiKey(apiKey);
    if (!customer || customer.blocked) {
      res.status(401).json({ error: 'Invalid API key', code: 'AUTH_INVALID' });
      return;
    }

    const agentId = req.header('X-Agent-ID') ?? null;
    if (agentId !== null && isAgentBlocked(customer.id, agentId)) {
      res.status(403).json({ error: 'Agent blocked', code: 'AGENT_BLOCKED' });
      return;
    }

    const usageCheck = checkMonthlyLimit(customer.id, customer.monthlyEventLimit);
    if (usageCheck.exceeded) {
      res.status(429).json({
        error: 'Monthly event limit exceeded',
        code: 'PLAN_LIMIT',
        upgradeUrl: '/plans'
      });
      return;
    }

    const startedAt = Date.now();
    const forwardResult = await forwardRequest(req, rawRequest, res);

    const model = typeof req.body?.model === 'string' ? req.body.model : 'gpt-4o';
    const usage = parseUsage(forwardResult.rawResponse);

    const baseEvent: Omit<LoggedEvent, 'id'> = {
      timestamp: new Date().toISOString(),
      customerId: customer.id,
      agentId,
      model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costUsd: calculateCost(model, usage.promptTokens, usage.completionTokens),
      latencyMs: forwardResult.latencyMs,
      toolCallsRequested: extractRequestedTools(req.body),
      toolCallsInResponse: [],
      requestHash: crypto.createHash('sha256').update(rawRequest).digest('hex'),
      responsePreview: forwardResult.rawResponse.slice(0, RESPONSE_PREVIEW_LENGTH),
      riskScore: 0,
      blocked: false,
      anomalyFlags: [],
      rawRequest,
      rawResponse: forwardResult.rawResponse
    };

    const inserted = insertEvent(baseEvent);
    const decision = await analyzeEvent(inserted, customer.id);
    updateSecurityResult(inserted.id, decision);

    const processedEvent: LoggedEvent = {
      ...inserted,
      riskScore: decision.riskScore,
      blocked: decision.blocked,
      anomalyFlags: decision.flags,
      latencyMs: Math.max(inserted.latencyMs, Date.now() - startedAt)
    };

    if (decision.blocked || decision.riskScore > 50) {
      void alertManager.sendAlert(processedEvent, decision);
    }
    broadcastEvent(customer.id, processedEvent);

    if (!forwardResult.streamed) {
      res.setHeader('X-RedTeamingAI-Event-ID', inserted.id);
      res.setHeader('X-RedTeamingAI-Risk-Score', String(decision.riskScore));

      if (decision.blocked) {
        res.status(403).json({
          error: 'Blocked by security policy',
          eventId: inserted.id,
          riskScore: decision.riskScore,
          flags: decision.flags
        });
        return;
      }

      res.status(forwardResult.status).set(forwardResult.headers).send(forwardResult.rawResponse);
      return;
    }

    // Response already streamed to client.
    return;
  } catch (error) {
    if (!res.headersSent) {
      try {
        const failOpen = await forwardRequest(req, rawRequest);
        res.status(failOpen.status).set(failOpen.headers).send(failOpen.rawResponse);
        return;
      } catch {
        res.status(502).json({ error: 'Proxy forwarding failed', code: 'PROXY_ERROR' });
        return;
      }
    }

    console.error('Interceptor processing error after headers sent:', error);
  }
}
