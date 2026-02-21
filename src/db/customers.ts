import { v4 as uuidv4 } from 'uuid';
import { db } from './connection.js';
import type { Customer, Plan } from '../types/index.js';

const PLAN_LIMITS: Record<Plan, number> = {
  free: 10000,
  pro: 1000000,
  business: 10000000,
  enterprise: Number.MAX_SAFE_INTEGER
};

const mapCustomer = (row: Record<string, unknown>): Customer => ({
  id: String(row.id),
  apiKey: String(row.api_key),
  name: String(row.name),
  plan: row.plan as Plan,
  monthlyEventLimit: Number(row.monthly_event_limit),
  stripeCustomerId: row.stripe_customer_id ? String(row.stripe_customer_id) : null,
  createdAt: String(row.created_at),
  blocked: Number(row.blocked) === 1
});

export function createCustomer(name: string, apiKey: string, plan: Plan = 'free'): Customer {
  const customer: Customer = {
    id: uuidv4(),
    apiKey,
    name,
    plan,
    monthlyEventLimit: PLAN_LIMITS[plan],
    stripeCustomerId: null,
    createdAt: new Date().toISOString(),
    blocked: false
  };
  db.prepare(`INSERT INTO customers(id, api_key, name, plan, monthly_event_limit, stripe_customer_id, created_at, blocked)
    VALUES(@id, @api_key, @name, @plan, @monthly_event_limit, @stripe_customer_id, @created_at, @blocked)`).run({
    id: customer.id,
    api_key: customer.apiKey,
    name: customer.name,
    plan: customer.plan,
    monthly_event_limit: customer.monthlyEventLimit,
    stripe_customer_id: customer.stripeCustomerId,
    created_at: customer.createdAt,
    blocked: 0
  });
  return customer;
}

export function getCustomerByApiKey(apiKey: string): Customer | null {
  const row = db.prepare('SELECT * FROM customers WHERE api_key = ?').get(apiKey) as Record<string, unknown> | undefined;
  return row ? mapCustomer(row) : null;
}

export function isAgentBlocked(customerId: string, agentId: string): boolean {
  const row = db.prepare('SELECT 1 as ok FROM blocked_agents WHERE customer_id = ? AND agent_id = ?').get(customerId, agentId) as { ok: number } | undefined;
  return Boolean(row?.ok);
}

export function checkMonthlyLimit(customerId: string, limit: number): { count: number; exceeded: boolean } {
  const row = db.prepare(`SELECT COUNT(*) as count FROM events
    WHERE customer_id = ? AND strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')`).get(customerId) as { count: number };
  return { count: row.count, exceeded: row.count >= limit };
}

export { PLAN_LIMITS };
