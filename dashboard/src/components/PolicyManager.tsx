import { useEffect, useState } from 'react';
import type { LoggedEvent, PolicyRule } from '../../../src/types';

interface PolicyManagerProps {
  apiKey: string;
  recentEvents: LoggedEvent[];
}

const templates = [
  'cost > 0.5',
  "model.includes('gpt-4')",
  "tools.some(t => /file|directory/i.test(t.name))",
  'event.riskScore > 70'
];

const validActions = ['ALLOW', 'BLOCK', 'ALERT'] as const;
const validSeverities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

function evaluateCondition(event: LoggedEvent, condition: string): boolean {
  try {
    const context = {
      event,
      model: event.model,
      cost: event.costUsd,
      tools: event.toolCallsRequested.map((name) => ({ name }))
    };

    const evaluator = new Function('context', `with (context) { return Boolean(${condition}); }`);
    return Boolean(evaluator(context));
  } catch {
    return false;
  }
}

export default function PolicyManager({ apiKey, recentEvents }: PolicyManagerProps) {
  const [policies, setPolicies] = useState<PolicyRule[]>([]);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [name, setName] = useState('Block risky high-cost events');
  const [description, setDescription] = useState('Block events above risk score threshold and cost ceiling.');
  const [condition, setCondition] = useState('event.riskScore > 75 && cost > 0.2');
  const [action, setAction] = useState<(typeof validActions)[number]>('BLOCK');
  const [severity, setSeverity] = useState<(typeof validSeverities)[number]>('HIGH');
  const [enabled, setEnabled] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Array<{ eventId: string; result: boolean }>>([]);

  useEffect(() => {
    fetch('http://localhost:4000/api/policies', { headers: { 'X-RedTeamingAI-Key': apiKey } })
      .then((res) => res.json())
      .then((rows: unknown) => setPolicies(Array.isArray(rows) ? (rows as PolicyRule[]) : []))
      .catch(() => setPolicies([]));
  }, [apiKey]);

  useEffect(() => {
    const selected = policies.find((policy) => policy.id === selectedPolicyId);
    if (!selected) {
      return;
    }

    setName(selected.name);
    setDescription(selected.description);
    setCondition(selected.condition);
    setAction(selected.action);
    setSeverity(selected.severity);
    setEnabled(selected.enabled);
  }, [selectedPolicyId, policies]);

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
    <section className="card">
      <div className="card-head">
        <h2>Policy Manager</h2>
      </div>

      <div className="split-layout">
        <div className="list-panel">
          <h3>Policies</h3>
          {policies.map((policy) => (
            <button
              key={policy.id}
              className={`list-item ${selectedPolicyId === policy.id ? 'active' : ''}`}
              onClick={() => setSelectedPolicyId(policy.id)}
            >
              <strong>{policy.name}</strong>
              <span>{policy.action} • {policy.severity}</span>
            </button>
          ))}
        </div>

        <div className="form-panel">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Policy name" />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" />
          <textarea value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="Condition" rows={4} />

          <div className="button-row">
            {templates.map((template) => (
              <button key={template} onClick={() => setCondition(template)}>{template}</button>
            ))}
          </div>

          <div className="field-row">
            <select value={action} onChange={(e) => setAction(e.target.value as (typeof validActions)[number])}>
              {validActions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <select value={severity} onChange={(e) => setSeverity(e.target.value as (typeof validSeverities)[number])}>
              {validSeverities.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <label><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> enabled</label>
          </div>

          {validationError ? <p className="error-text">{validationError}</p> : null}
          <button className="primary" onClick={savePolicy}>Save Policy</button>

          <div>
            <h3>Live condition test (last 10 events)</h3>
            <div className="test-results">
              {testResults.map((result) => (
                <div key={result.eventId} className="result-row">
                  <span>{result.eventId.slice(0, 8)}</span>
                  <strong>{result.result ? 'match' : 'no match'}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
