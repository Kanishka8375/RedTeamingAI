import { useEffect, useMemo, useState } from 'react';
import type { LoggedEvent, PolicyRule } from '../../../src/types';

interface PolicyManagerProps {
  apiKey: string;
  recentEvents: LoggedEvent[];
}

const templates = [
  'cost > 0.50',
  "tools.some(t => /password|token/i.test(t.name))",
  "event.riskScore >= 70",
  "event.blocked === true"
];

const validActions = ['ALLOW', 'BLOCK', 'ALERT'] as const;
const validSeverities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

function evaluateCondition(event: LoggedEvent, conditionText: string): boolean {
  const trimmed = conditionText.trim();

  const blockedMatch = trimmed.match(/^event\.blocked\s*===\s*(true|false)$/);
  if (blockedMatch) {
    return event.blocked === (blockedMatch[1] === 'true');
  }

  const riskMatch = trimmed.match(/^event\.riskScore\s*(>=|>|<=|<|===)\s*(\d+)$/);
  if (riskMatch) {
    const op = riskMatch[1];
    const value = Number(riskMatch[2]);
    if (op === '>=') return event.riskScore >= value;
    if (op === '>') return event.riskScore > value;
    if (op === '<=') return event.riskScore <= value;
    if (op === '<') return event.riskScore < value;
    return event.riskScore === value;
  }

  const costMatch = trimmed.match(/^cost\s*(>=|>|<=|<|===)\s*(\d+(?:\.\d+)?)$/);
  if (costMatch) {
    const op = costMatch[1];
    const value = Number(costMatch[2]);
    if (op === '>=') return event.costUsd >= value;
    if (op === '>') return event.costUsd > value;
    if (op === '<=') return event.costUsd <= value;
    if (op === '<') return event.costUsd < value;
    return event.costUsd === value;
  }

  const tokenRegex = /password|token|secret/i;
  if (trimmed.includes('tools.some') && tokenRegex.test(trimmed)) {
    return event.toolCallsRequested.some((tool) => tokenRegex.test(tool));
  }

  return false;
}

export default function PolicyManager({ apiKey, recentEvents }: PolicyManagerProps) {
  const [policies, setPolicies] = useState<PolicyRule[]>([]);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [condition, setCondition] = useState('');
  const [action, setAction] = useState<(typeof validActions)[number]>('ALERT');
  const [severity, setSeverity] = useState<(typeof validSeverities)[number]>('MEDIUM');
  const [enabled, setEnabled] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Array<{ eventId: string; result: boolean }>>([]);

  useEffect(() => {
    fetch('http://localhost:4000/api/policies', { headers: { 'X-RedTeamingAI-Key': apiKey } })
      .then((res) => res.json())
      .then((rows) => {
        if (Array.isArray(rows)) {
          setPolicies(rows as PolicyRule[]);
        }
      })
      .catch(() => setPolicies([]));
  }, [apiKey]);

  const selectedPolicy = useMemo(
    () => policies.find((policy) => policy.id === selectedPolicyId) ?? null,
    [policies, selectedPolicyId]
  );

  useEffect(() => {
    if (!selectedPolicy) return;
    setName(selectedPolicy.name);
    setDescription(selectedPolicy.description);
    setCondition(selectedPolicy.condition);
    setAction(selectedPolicy.action);
    setSeverity(selectedPolicy.severity);
    setEnabled(selectedPolicy.enabled);
  }, [selectedPolicy]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!condition.trim()) {
        setTestResults([]);
        return;
      }

      const results = recentEvents.slice(0, 10).map((event) => ({
        eventId: event.id,
        result: evaluateCondition(event, condition)
      }));
      setTestResults(results);
    }, 500);

    return () => window.clearTimeout(timer);
  }, [condition, recentEvents]);

  const savePolicy = (): void => {
    if (name.trim().length < 2) {
      setValidationError('Policy name must be at least 2 characters.');
      return;
    }
    if (description.trim().length < 2) {
      setValidationError('Description must be at least 2 characters.');
      return;
    }
    if (!condition.trim()) {
      setValidationError('Condition is required.');
      return;
    }

    setValidationError(null);

    fetch('http://localhost:4000/api/policies', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-RedTeamingAI-Key': apiKey
      },
      body: JSON.stringify({ name, description, condition, action, severity, enabled })
    })
      .then((res) => {
        if (!res.ok) throw new Error('Save failed');
        return fetch('http://localhost:4000/api/policies', { headers: { 'X-RedTeamingAI-Key': apiKey } });
      })
      .then((res) => res.json())
      .then((rows) => setPolicies(Array.isArray(rows) ? (rows as PolicyRule[]) : []))
      .catch(() => setValidationError('Unable to save policy.'));
  };

  return (
    <section className="bg-slate-900 border border-slate-800 rounded p-4">
      <h2 className="text-cyan-300 font-semibold mb-3">Policy Manager</h2>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="bg-slate-800 rounded p-2 max-h-[26rem] overflow-auto">
          <h3 className="text-xs text-slate-400 mb-2">Policies</h3>
          <div className="space-y-1">
            {policies.map((policy) => (
              <button
                key={policy.id}
                className={`w-full text-left px-2 py-2 rounded text-sm ${selectedPolicyId === policy.id ? 'bg-cyan-500 text-slate-950' : 'bg-slate-700 text-slate-100'}`}
                onClick={() => setSelectedPolicyId(policy.id)}
              >
                {policy.name}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-slate-800 rounded p-3 space-y-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Policy name" className="w-full bg-slate-700 rounded px-2 py-1 text-sm" />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" className="w-full bg-slate-700 rounded px-2 py-1 text-sm" />
          <textarea value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="Condition" className="w-full h-24 bg-slate-700 rounded px-2 py-1 text-sm" />

          <div className="flex flex-wrap gap-2">
            {templates.map((template) => (
              <button key={template} onClick={() => setCondition(template)} className="text-xs px-2 py-1 rounded border border-cyan-500 text-cyan-300">{template}</button>
            ))}
          </div>

          <div className="flex gap-2 text-xs">
            <select value={action} onChange={(e) => setAction(e.target.value as (typeof validActions)[number])} className="bg-slate-700 rounded px-2 py-1">
              {validActions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <select value={severity} onChange={(e) => setSeverity(e.target.value as (typeof validSeverities)[number])} className="bg-slate-700 rounded px-2 py-1">
              {validSeverities.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <label className="flex items-center gap-1"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> enabled</label>
          </div>

          {validationError ? <p className="text-xs text-red-300">{validationError}</p> : null}
          <button onClick={savePolicy} className="bg-cyan-500 text-slate-950 font-semibold px-3 py-1.5 rounded text-sm">Save Policy</button>

          <div className="pt-2 border-t border-slate-700">
            <h4 className="text-xs text-slate-400 mb-1">Live condition test (last 10 events)</h4>
            <div className="space-y-1 max-h-24 overflow-auto">
              {testResults.map((result) => (
                <div key={result.eventId} className="text-xs flex items-center justify-between">
                  <span className="text-slate-300">{result.eventId.slice(0, 8)}</span>
                  <span className={result.result ? 'text-emerald-300' : 'text-slate-400'}>{result.result ? 'match' : 'no match'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
