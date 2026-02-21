import type { AnomalyFlag, AnomalyResult, LoggedEvent } from '../types/index.js';

const FIVE_MINUTE_WINDOW_MS = 5 * 60 * 1000;
const TEN_SECOND_WINDOW_MS = 10 * 1000;
const TEN_MINUTE_RETENTION_MS = 10 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

interface EventWindow {
  callTimestamps: number[];
  errorTimestamps: number[];
  observedTools: string[];
}

interface InternalFlag extends AnomalyFlag {
  shouldBlock?: boolean;
}

export class AnomalyDetector {
  private readonly windows = new Map<string, EventWindow>();

  constructor() {
    setInterval(() => this.cleanupStaleWindows(), CLEANUP_INTERVAL_MS).unref();
  }

  analyze(event: LoggedEvent): AnomalyResult {
    const now = Date.now();
    const agentKey = event.agentId ?? 'anonymous';
    const window = this.getOrCreateWindow(agentKey);

    window.callTimestamps.push(now);
    window.observedTools.push(...event.toolCallsRequested);
    if (this.isErrorResponse(event.rawResponse)) {
      window.errorTimestamps.push(now);
    }

    const flags: InternalFlag[] = [
      this.checkHighFrequency(window, now),
      this.checkBurstSpike(window, now),
      this.checkLargePayload(event),
      this.checkExcessiveCost(event),
      this.checkFileExfiltration(event),
      this.checkExternalNetwork(event),
      this.checkCredentialAccess(event),
      this.checkRecursiveSpawn(event),
      this.checkRepeatedFailures(window, now),
      this.checkToolEnumeration(window)
    ].filter((flag): flag is InternalFlag => flag !== null);

    const score = Math.min(100, flags.reduce((sum, flag) => sum + flag.score, 0));
    const shouldBlock = score >= 80 || flags.some((flag) => flag.shouldBlock === true);

    return {
      score,
      flags: flags.map(({ name, score: flagScore, explanation }) => ({ name, score: flagScore, explanation })),
      shouldBlock
    };
  }

  private getOrCreateWindow(agentKey: string): EventWindow {
    const current = this.windows.get(agentKey);
    if (current) {
      return current;
    }

    const created: EventWindow = {
      callTimestamps: [],
      errorTimestamps: [],
      observedTools: []
    };
    this.windows.set(agentKey, created);
    return created;
  }

  private cleanupStaleWindows(): void {
    const minTimestamp = Date.now() - TEN_MINUTE_RETENTION_MS;

    for (const [agentKey, window] of this.windows.entries()) {
      window.callTimestamps = window.callTimestamps.filter((timestamp) => timestamp >= minTimestamp);
      window.errorTimestamps = window.errorTimestamps.filter((timestamp) => timestamp >= minTimestamp);

      if (window.callTimestamps.length === 0) {
        this.windows.delete(agentKey);
      }
    }
  }

  private countWithin(timestamps: number[], now: number, rangeMs: number): number {
    return timestamps.filter((timestamp) => now - timestamp <= rangeMs).length;
  }

  private isErrorResponse(rawResponse: string): boolean {
    if (/\berror\b|\bfail(?:ed|ure)?\b|\bexception\b/i.test(rawResponse)) {
      return true;
    }

    try {
      const parsed = JSON.parse(rawResponse) as { error?: unknown };
      return parsed.error !== undefined;
    } catch {
      return false;
    }
  }

  private checkHighFrequency(window: EventWindow, now: number): InternalFlag | null {
    if (this.countWithin(window.callTimestamps, now, FIVE_MINUTE_WINDOW_MS) > 20) {
      return { name: 'high_frequency', score: 40, explanation: 'Agent exceeded 20 calls in 5 minutes.' };
    }
    return null;
  }

  private checkBurstSpike(window: EventWindow, now: number): InternalFlag | null {
    if (this.countWithin(window.callTimestamps, now, TEN_SECOND_WINDOW_MS) > 5) {
      return { name: 'burst_spike', score: 35, explanation: 'Agent exceeded 5 calls in 10 seconds.' };
    }
    return null;
  }

  private checkLargePayload(event: LoggedEvent): InternalFlag | null {
    if (event.rawRequest.length > 51_200) {
      return { name: 'large_payload', score: 25, explanation: 'Request payload exceeded 50KB.' };
    }
    return null;
  }

  private checkExcessiveCost(event: LoggedEvent): InternalFlag | null {
    if (event.costUsd > 0.5) {
      return { name: 'excessive_cost', score: 30, explanation: 'Event cost exceeded $0.50.' };
    }
    return null;
  }

  private checkFileExfiltration(event: LoggedEvent): InternalFlag | null {
    const sensitiveToolCalls = event.toolCallsRequested.filter((toolName) => toolName === 'file_read' || toolName === 'list_directory').length;
    if (sensitiveToolCalls > 10) {
      return {
        name: 'file_exfiltration',
        score: 50,
        explanation: 'Repeated file system enumeration/read pattern detected.',
        shouldBlock: true
      };
    }
    return null;
  }

  private checkExternalNetwork(event: LoggedEvent): InternalFlag | null {
    if (event.toolCallsRequested.some((toolName) => /http|fetch|request|webhook/i.test(toolName))) {
      return { name: 'external_network', score: 45, explanation: 'External network access tool detected.' };
    }
    return null;
  }

  private checkCredentialAccess(event: LoggedEvent): InternalFlag | null {
    if (event.toolCallsRequested.some((toolName) => /secret|password|api.?key|token|credential/i.test(toolName))) {
      return {
        name: 'credential_access',
        score: 60,
        explanation: 'Credential access pattern detected in tool usage.',
        shouldBlock: true
      };
    }
    return null;
  }

  private checkRecursiveSpawn(event: LoggedEvent): InternalFlag | null {
    if (event.toolCallsRequested.some((toolName) => /agent|delegate|spawn/i.test(toolName))) {
      return { name: 'recursive_spawn', score: 35, explanation: 'Recursive delegation/spawn pattern detected.' };
    }
    return null;
  }

  private checkRepeatedFailures(window: EventWindow, now: number): InternalFlag | null {
    if (this.countWithin(window.errorTimestamps, now, TEN_MINUTE_RETENTION_MS) > 5) {
      return { name: 'repeated_failures', score: 30, explanation: 'Agent produced over 5 failed/error responses in 10 minutes.' };
    }
    return null;
  }

  private checkToolEnumeration(window: EventWindow): InternalFlag | null {
    const uniqueTools = new Set(window.observedTools);
    if (uniqueTools.size > 8) {
      return { name: 'tool_enumeration', score: 45, explanation: 'Agent touched over 8 unique tools in active session.' };
    }
    return null;
  }
}

export const anomalyDetector = new AnomalyDetector();
