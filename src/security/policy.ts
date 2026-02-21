import vm from 'node:vm';
import { db } from '../db/connection.js';
import type { LoggedEvent, ParsedTool, PolicyDecision, PolicyRule } from '../types/index.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const POLICY_EVAL_TIMEOUT_MS = 10;

const SEVERITY_SCORE: Record<PolicyRule['severity'], number> = {
  LOW: 10,
  MEDIUM: 20,
  HIGH: 30,
  CRITICAL: 40
};

export const DEFAULT_RULES: Array<Omit<PolicyRule, 'id' | 'customerId' | 'createdAt' | 'hitCount'>> = [
  {
    name: 'Block credential extraction tools',
    description: 'Block tool calls likely to access credentials or secrets.',
    condition: "tools.some((tool) => /secret|password|api.?key|token|credential/i.test(tool.name))",
    action: 'BLOCK',
    severity: 'CRITICAL',
    enabled: true
  },
  {
    name: 'Alert high request cost',
    description: 'Raise alert when single request cost exceeds threshold.',
    condition: 'cost > 0.50',
    action: 'ALERT',
    severity: 'HIGH',
    enabled: true
  },
  {
    name: 'Block system prompt exfil attempts',
    description: 'Block requests trying to reveal hidden instructions.',
    condition: '/print your system prompt|reveal your instructions|system prompt/i.test(event.rawRequest)',
    action: 'BLOCK',
    severity: 'CRITICAL',
    enabled: true
  },
  {
    name: 'Alert anonymous agent traffic',
    description: 'Alert on missing agent identity for traceability.',
    condition: '!agentId',
    action: 'ALERT',
    severity: 'MEDIUM',
    enabled: true
  },
  {
    name: 'Block recursive delegation',
    description: 'Block spawn/delegate loops to reduce autonomous spread.',
    condition: "tools.some((tool) => /agent|delegate|spawn/i.test(tool.name))",
    action: 'BLOCK',
    severity: 'HIGH',
    enabled: true
  },
  {
    name: 'Alert broad tool usage',
    description: 'Alert when many tools are requested in one call.',
    condition: 'tools.length > 8',
    action: 'ALERT',
    severity: 'MEDIUM',
    enabled: true
  },
  {
    name: 'Block suspicious webhook exfil',
    description: 'Block likely data exfiltration over external webhook endpoints.',
    condition: '/webhook|pastebin|requestbin|ngrok/i.test(event.rawRequest)',
    action: 'BLOCK',
    severity: 'HIGH',
    enabled: true
  },
  {
    name: 'Alert oversized raw payload',
    description: 'Alert on potential obfuscation in oversized prompt payloads.',
    condition: 'event.rawRequest.length > 50000',
    action: 'ALERT',
    severity: 'MEDIUM',
    enabled: true
  },
  {
    name: 'Block known jailbreak language',
    description: 'Block prompts with explicit instruction override language.',
    condition: '/ignore previous instructions|jailbreak|dan mode/i.test(event.rawRequest)',
    action: 'BLOCK',
    severity: 'HIGH',
    enabled: true
  },
  {
    name: 'Alert premium model usage',
    description: 'Alert when high-cost model families are used.',
    condition: '/gpt-4|opus|sonnet/i.test(model)',
    action: 'ALERT',
    severity: 'LOW',
    enabled: true
  }
];

function mapPolicyRow(row: Record<string, unknown>): PolicyRule {
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    name: String(row.name),
    description: String(row.description),
    condition: String(row.condition),
    action: row.action === 'BLOCK' || row.action === 'ALERT' ? row.action : 'ALLOW',
    severity: row.severity === 'CRITICAL' || row.severity === 'HIGH' || row.severity === 'MEDIUM' ? row.severity : 'LOW',
    enabled: Number(row.enabled) === 1,
    hitCount: Number(row.hit_count),
    createdAt: String(row.created_at)
  };
}

export function parseToolsFromRawRequest(rawRequest: string): ParsedTool[] {
  try {
    const payload = JSON.parse(rawRequest) as Record<string, unknown>;
    if (!Array.isArray(payload.tools)) {
      return [];
    }

    return payload.tools
      .map((tool): ParsedTool | null => {
        if (typeof tool !== 'object' || tool === null) {
          return null;
        }

        const toolRecord = tool as Record<string, unknown>;
        const name = toolRecord.name ?? toolRecord.type;
        const args = toolRecord.args;

        return {
          name: typeof name === 'string' ? name : 'unknown',
          args: typeof args === 'object' && args !== null && !Array.isArray(args) ? args as Record<string, unknown> : {}
        };
      })
      .filter((tool): tool is ParsedTool => tool !== null);
  } catch {
    return [];
  }
}

export class PolicyEngine {
  private readonly cache = new Map<string, PolicyRule[]>();
  private readonly cacheTimestamps = new Map<string, number>();

  loadRules(customerId: string): void {
    const now = Date.now();
    const lastLoad = this.cacheTimestamps.get(customerId);

    if (lastLoad !== undefined && now - lastLoad < CACHE_TTL_MS && this.cache.has(customerId)) {
      return;
    }

    const rows = db
      .prepare('SELECT * FROM policies WHERE customer_id = ? AND enabled = 1 ORDER BY created_at ASC')
      .all(customerId) as Record<string, unknown>[];

    this.cache.set(customerId, rows.map(mapPolicyRow));
    this.cacheTimestamps.set(customerId, now);
  }

  evaluate(event: LoggedEvent, tools: ParsedTool[]): PolicyDecision {
    this.loadRules(event.customerId);

    const rules = this.cache.get(event.customerId) ?? [];
    const violations: PolicyRule[] = [];

    for (const rule of rules) {
      const context = {
        event,
        tools,
        model: event.model,
        cost: event.costUsd,
        agentId: event.agentId
      };

      try {
        const result = vm.runInNewContext(rule.condition, context, { timeout: POLICY_EVAL_TIMEOUT_MS });
        if (result === true) {
          violations.push(rule);
        }
      } catch (error) {
        console.error(`Policy evaluation failed for ${rule.id}:`, error);
      }
    }

    const action: PolicyDecision['action'] = violations.some((rule) => rule.action === 'BLOCK')
      ? 'BLOCK'
      : violations.some((rule) => rule.action === 'ALERT')
        ? 'ALERT'
        : 'ALLOW';

    const score = Math.min(
      100,
      violations.reduce((sum, rule) => sum + SEVERITY_SCORE[rule.severity], 0)
    );

    return {
      action,
      violations,
      score
    };
  }
}

export const policyEngine = new PolicyEngine();
