import type { LoggedEvent, SecurityDecision } from '../types/index.js';
import { anomalyDetector } from './anomaly.js';
import { policyEngine, parseToolsFromRawRequest } from './policy.js';
import { injectionScanner } from './scanner.js';

const ANOMALY_WEIGHT = 0.35;
const INJECTION_WEIGHT = 0.45;
const POLICY_WEIGHT = 0.20;

function normalizeScore(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }
  return Math.max(0, Math.min(100, score));
}

export async function analyzeEvent(event: LoggedEvent, _customerId: string): Promise<SecurityDecision> {
  const startedAt = process.hrtime.bigint();

  const parsedTools = parseToolsFromRawRequest(event.rawRequest);

  const [anomaly, injection] = await Promise.all([
    Promise.resolve(anomalyDetector.analyze(event)),
    Promise.resolve(injectionScanner.analyze(event))
  ]);

  const policy = policyEngine.evaluate(event, parsedTools);

  const anomalyScore = normalizeScore(anomaly.score);
  const injectionScore = normalizeScore(injection.score);
  const policyScore = normalizeScore(policy.score);

  const weightedRisk = Math.round(
    anomalyScore * ANOMALY_WEIGHT +
      injectionScore * INJECTION_WEIGHT +
      policyScore * POLICY_WEIGHT
  );

  const riskScore = Math.min(100, weightedRisk);
  const blocked = anomaly.shouldBlock || injection.confidence >= 80 || policy.action === 'BLOCK';

  const flags = Array.from(
    new Set([
      ...anomaly.flags.map((flag) => flag.name),
      ...injection.patterns.map((pattern) => pattern.name),
      ...policy.violations.map((violation) => violation.name)
    ])
  );

  const processingTimeMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

  return {
    eventId: event.id,
    riskScore,
    blocked,
    flags,
    anomaly,
    injection,
    policy,
    processingTimeMs
  };
}
