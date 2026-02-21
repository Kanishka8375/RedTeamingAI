export type ISO8601Timestamp = string;
export type UUID = string;

export type Plan = 'free' | 'pro' | 'business' | 'enterprise';
export type PolicyAction = 'ALLOW' | 'BLOCK' | 'ALERT';
export type PolicySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type PatternLayer = 'phrase' | 'regex' | 'structural';

export interface LoggedEvent {
  id: UUID;
  timestamp: ISO8601Timestamp;
  customerId: UUID;
  agentId: string | null;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
  toolCallsRequested: string[];
  toolCallsInResponse: string[];
  requestHash: string;
  responsePreview: string;
  riskScore: number;
  blocked: boolean;
  anomalyFlags: string[];
  rawRequest: string;
  rawResponse: string;
}

export interface Customer {
  id: UUID;
  apiKey: string;
  name: string;
  plan: Plan;
  monthlyEventLimit: number;
  stripeCustomerId: string | null;
  createdAt: ISO8601Timestamp;
  blocked: boolean;
}

export interface PolicyRule {
  id: UUID;
  customerId: UUID;
  name: string;
  description: string;
  condition: string;
  action: PolicyAction;
  severity: PolicySeverity;
  enabled: boolean;
  hitCount: number;
  createdAt: ISO8601Timestamp;
}

export interface AnomalyFlag {
  name: string;
  score: number;
  explanation: string;
}

export interface AnomalyResult {
  score: number;
  flags: AnomalyFlag[];
  shouldBlock: boolean;
}

export interface PolicyDecision {
  action: PolicyAction;
  violations: PolicyRule[];
  score: number;
}

export interface MatchedPattern {
  name: string;
  layer: PatternLayer;
  confidence: number;
  matchedText: string;
}

export interface ScanResult {
  injectionDetected: boolean;
  confidence: number;
  patterns: MatchedPattern[];
  score: number;
}

export interface SecurityDecision {
  eventId: UUID;
  riskScore: number;
  blocked: boolean;
  flags: string[];
  anomaly: AnomalyResult;
  injection: ScanResult;
  policy: PolicyDecision;
  processingTimeMs: number;
}

export interface AgentStat {
  agentId: string;
  calls: number;
  blocked: number;
  costUsd: number;
}

export interface ModelCost {
  model: string;
  costUsd: number;
  calls: number;
}

export interface RiskDistribution {
  low: number;
  medium: number;
  high: number;
  critical: number;
}

export interface TimePoint {
  bucket: string;
  calls: number;
  blocked: number;
  costUsd: number;
}

export interface StatsResult {
  totalCalls: number;
  totalCostUsd: number;
  blockedCount: number;
  avgRiskScore: number;
  topAgents: AgentStat[];
  costByModel: ModelCost[];
  riskDistribution: RiskDistribution;
  callsOverTime: TimePoint[];
}

export interface EventFilters {
  limit: number;
  offset: number;
  startDate?: ISO8601Timestamp;
  endDate?: ISO8601Timestamp;
  minRisk?: number;
  blocked?: boolean;
  agentId?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
}

export interface ParsedTool {
  name: string;
  args: Record<string, unknown>;
}

export interface AlertSettings {
  customerId: UUID;
  emailEnabled: boolean;
  slackEnabled: boolean;
  dailyDigestEnabled: boolean;
  emailTo: string | null;
  slackWebhookUrl: string | null;
  timezone: string;
  digestHour: number;
}

export interface BillingHistoryRecord {
  id: UUID;
  customerId: UUID;
  plan: Plan;
  amountUsd: number;
  stripeInvoiceId: string | null;
  status: 'pending' | 'paid' | 'failed' | 'void';
  createdAt: ISO8601Timestamp;
}

export interface BlockedAgent {
  id: UUID;
  customerId: UUID;
  agentId: string;
  reason: string;
  createdAt: ISO8601Timestamp;
}

export interface AttackPattern {
  id: UUID;
  name: string;
  pattern: string;
  patternType: 'phrase' | 'regex' | 'structural';
  enabled: boolean;
  createdAt: ISO8601Timestamp;
}

export interface AlertLogEntry {
  id: UUID;
  customerId: UUID;
  eventId: UUID | null;
  channel: 'email' | 'slack' | 'multi';
  severity: PolicySeverity;
  status: 'sent' | 'failed' | 'queued';
  message: string;
  createdAt: ISO8601Timestamp;
}

export interface ErrorResponse {
  error: string;
  code: string;
}
