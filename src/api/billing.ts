import express, { Router, type NextFunction, type Request, type Response } from 'express';
import Stripe from 'stripe';
import { z } from 'zod';
import { db } from '../db/connection.js';
import { getCustomerByApiKey, PLAN_LIMITS } from '../db/customers.js';
import type { Plan } from '../types/index.js';
import { sendEmail } from '../alerts/email.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', { apiVersion: '2023-10-16' });

const PLAN_CONFIG: Record<Plan, { amountCents: number; monthlyEventLimit: number; retentionDays: number; nickname: string }> = {
  free: { amountCents: 0, monthlyEventLimit: 10_000, retentionDays: 7, nickname: 'Free' },
  pro: { amountCents: 9_900, monthlyEventLimit: 1_000_000, retentionDays: 30, nickname: 'Pro' },
  business: { amountCents: 49_900, monthlyEventLimit: 10_000_000, retentionDays: 90, nickname: 'Business' },
  enterprise: { amountCents: 200_000, monthlyEventLimit: Number.MAX_SAFE_INTEGER, retentionDays: 365, nickname: 'Enterprise' }
};

const priceIdsByPlan = new Map<Plan, string>();
let plansInitialized = false;

declare global {
  namespace Express {
    interface Request {
      customerId?: string;
      customerPlan?: Plan;
      monthlyEventLimit?: number;
    }
  }
}

function sendError(res: Response, status: number, error: string, code: string, extra?: Record<string, unknown>): void {
  res.status(status).json({ error, code, ...extra });
}

async function ensureBillingPlans(): Promise<void> {
  if (plansInitialized) {
    return;
  }

  for (const [plan, config] of Object.entries(PLAN_CONFIG) as Array<[Plan, (typeof PLAN_CONFIG)[Plan]]>) {
    const productName = `RedTeamingAI ${config.nickname}`;
    const productSearch = await stripe.products.search({ query: `name:'${productName}'` });
    const product = productSearch.data[0]
      ?? (await stripe.products.create({
        name: productName,
        metadata: {
          plan,
          event_limit: String(config.monthlyEventLimit),
          retention_days: String(config.retentionDays)
        }
      }));

    const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
    const existing = prices.data.find((price) =>
      price.unit_amount === config.amountCents &&
      price.recurring?.interval === 'month' &&
      price.currency === 'usd'
    );

    const price = existing
      ?? (await stripe.prices.create({
        product: product.id,
        currency: 'usd',
        unit_amount: config.amountCents,
        recurring: { interval: 'month' },
        nickname: `${plan}-monthly`
      }));

    priceIdsByPlan.set(plan, price.id);
  }

  plansInitialized = true;
}

function getAuthenticatedCustomer(req: Request): { id: string; stripeCustomerId: string | null; plan: Plan; monthlyEventLimit: number } | null {
  if (req.customerId) {
    const row = db
      .prepare('SELECT id, stripe_customer_id, plan, monthly_event_limit FROM customers WHERE id = ?')
      .get(req.customerId) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return {
      id: String(row.id),
      stripeCustomerId: row.stripe_customer_id ? String(row.stripe_customer_id) : null,
      plan: row.plan as Plan,
      monthlyEventLimit: Number(row.monthly_event_limit)
    };
  }

  const key = req.header('X-RedTeamingAI-Key');
  if (!key) {
    return null;
  }

  const customer = getCustomerByApiKey(key);
  if (!customer) {
    return null;
  }

  req.customerId = customer.id;
  return {
    id: customer.id,
    stripeCustomerId: customer.stripeCustomerId,
    plan: customer.plan,
    monthlyEventLimit: customer.monthlyEventLimit
  };
}

function mapPriceToPlan(priceId: string): Plan {
  for (const [plan, id] of priceIdsByPlan.entries()) {
    if (id === priceId) {
      return plan;
    }
  }
  return 'free';
}

function updateCustomerPlanByStripeId(stripeCustomerId: string, plan: Plan): void {
  db.prepare('UPDATE customers SET plan = ?, monthly_event_limit = ? WHERE stripe_customer_id = ?')
    .run(plan, PLAN_LIMITS[plan], stripeCustomerId);
}

async function handlePaymentFailed(stripeCustomerId: string): Promise<void> {
  const row = db.prepare(
    `SELECT c.id as customer_id, a.email_to as email_to
       FROM customers c
  LEFT JOIN alert_settings a ON a.customer_id = c.id
      WHERE c.stripe_customer_id = ?`
  ).get(stripeCustomerId) as Record<string, unknown> | undefined;

  if (row?.email_to && typeof row.email_to === 'string') {
    await sendEmail({
      to: row.email_to,
      subject: '[Billing] Payment failed',
      html: `<div style="font-family:Arial"><h2>Payment Failed</h2><p>Your subscription payment could not be processed.</p><p><a href="https://app.redteamingai.io/billing">Update billing details</a></p></div>`
    });
  }
}

const checkoutSchema = z.object({
  plan: z.enum(['free', 'pro', 'business', 'enterprise']),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional()
});

export const billingRouter = Router();

billingRouter.post('/billing/create-checkout', async (req: Request, res: Response): Promise<void> => {
  const customer = getAuthenticatedCustomer(req);
  if (!customer) {
    sendError(res, 401, 'Unauthorized', 'AUTH_REQUIRED');
    return;
  }

  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'Validation failed', 'VALIDATION_ERROR');
    return;
  }

  try {
    await ensureBillingPlans();

    if (parsed.data.plan === 'free') {
      sendError(res, 400, 'Free plan does not require checkout', 'PLAN_INVALID');
      return;
    }

    let stripeCustomerId = customer.stripeCustomerId;
    if (!stripeCustomerId) {
      const stripeCustomer = await stripe.customers.create({
        metadata: { customerId: customer.id }
      });
      stripeCustomerId = stripeCustomer.id;
      db.prepare('UPDATE customers SET stripe_customer_id = ? WHERE id = ?').run(stripeCustomerId, customer.id);
    }

    const priceId = priceIdsByPlan.get(parsed.data.plan);
    if (!priceId) {
      sendError(res, 500, 'Plan price unavailable', 'PRICE_NOT_FOUND');
      return;
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: parsed.data.successUrl ?? 'https://app.redteamingai.io/billing/success',
      cancel_url: parsed.data.cancelUrl ?? 'https://app.redteamingai.io/billing/cancel',
      metadata: { plan: parsed.data.plan, customerId: customer.id }
    });

    res.status(200).json({ url: session.url });
  } catch {
    sendError(res, 500, 'Stripe failure', 'STRIPE_ERROR');
  }
});

billingRouter.post('/billing/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response): Promise<void> => {
  const signature = req.header('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    sendError(res, 400, 'Missing Stripe signature', 'MISSING_SIGNATURE');
    return;
  }

  try {
    const payload = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
    const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const stripeCustomerId = String(subscription.customer);
        const priceId = subscription.items.data[0]?.price.id;
        if (priceId) {
          const plan = mapPriceToPlan(priceId);
          updateCustomerPlanByStripeId(stripeCustomerId, plan);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        updateCustomerPlanByStripeId(String(subscription.customer), 'free');
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const stripeCustomerId = typeof invoice.customer === 'string' ? invoice.customer : null;
        if (stripeCustomerId) {
          await handlePaymentFailed(stripeCustomerId);
        }
        break;
      }
      default:
        break;
    }

    res.status(200).json({ received: true });
  } catch {
    sendError(res, 400, 'Invalid webhook signature', 'INVALID_SIGNATURE');
  }
});

billingRouter.get('/billing/portal', async (req: Request, res: Response): Promise<void> => {
  const customer = getAuthenticatedCustomer(req);
  if (!customer) {
    sendError(res, 401, 'Unauthorized', 'AUTH_REQUIRED');
    return;
  }

  if (!customer.stripeCustomerId) {
    sendError(res, 400, 'No Stripe customer available', 'NO_STRIPE_CUSTOMER');
    return;
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customer.stripeCustomerId,
      return_url: 'https://app.redteamingai.io/billing'
    });

    res.status(200).json({ url: session.url });
  } catch {
    sendError(res, 500, 'Stripe failure', 'STRIPE_ERROR');
  }
});

export function checkEventLimit(req: Request, res: Response, next: NextFunction): void {
  const customerId = req.customerId;
  if (!customerId) {
    sendError(res, 401, 'Unauthorized', 'AUTH_REQUIRED');
    return;
  }

  const row = db.prepare('SELECT plan, monthly_event_limit FROM customers WHERE id = ?').get(customerId) as Record<string, unknown> | undefined;
  if (!row) {
    sendError(res, 404, 'Customer not found', 'CUSTOMER_NOT_FOUND');
    return;
  }

  const plan = row.plan as Plan;
  const limit = Number(row.monthly_event_limit ?? PLAN_LIMITS[plan]);
  const usage = db.prepare(
    `SELECT COUNT(*) as count
       FROM events
      WHERE customer_id = ?
        AND strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')`
  ).get(customerId) as { count: number };

  if (usage.count >= limit) {
    sendError(res, 429, 'Monthly event limit reached', 'PLAN_LIMIT_REACHED', {
      currentPlan: plan,
      limit,
      upgradeUrl: '/billing'
    });
    return;
  }

  if (limit !== Number.MAX_SAFE_INTEGER && usage.count >= Math.floor(limit * 0.8)) {
    res.setHeader('X-RedTeamingAI-Limit-Warning', 'true');
  }

  next();
}

export async function initializeBilling(): Promise<void> {
  await ensureBillingPlans();
}
