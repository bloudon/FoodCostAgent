import type { Request, Response } from "express";
import Stripe from "stripe";
import { db } from "./db";
import { companies } from "@shared/schema";
import { eq } from "drizzle-orm";

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not configured on this server");
    _stripe = new Stripe(key, { apiVersion: "2024-06-20" });
  }
  return _stripe;
}

const TRIAL_DAYS = 14;

const LOOKUP_KEY: Record<string, string> = {
  "basic:monthly": "fnb_basic_monthly",
  "basic:quarterly": "fnb_basic_quarterly",
  "basic:annual": "fnb_basic_annual",
  "pro:monthly": "fnb_pro_monthly",
  "pro:quarterly": "fnb_pro_quarterly",
  "pro:annual": "fnb_pro_annual",
};

/**
 * GET /api/billing/plans
 * Returns all active prices from Stripe for plan selection UI.
 */
export async function getPlans(_req: Request, res: Response) {
  try {
    const prices = await getStripe().prices.list({
      active: true,
      expand: ["data.product"],
      limit: 100,
    });

    const plans = prices.data
      .filter((p) => {
        const lookupKey = p.lookup_key || "";
        return lookupKey.startsWith("fnb_");
      })
      .map((p) => ({
        id: p.id,
        lookupKey: p.lookup_key,
        unitAmount: p.unit_amount,
        currency: p.currency,
        interval: p.recurring?.interval,
        intervalCount: p.recurring?.interval_count,
        productName: typeof p.product === "object" && p.product !== null ? (p.product as Stripe.Product).name : "",
        productDescription: typeof p.product === "object" && p.product !== null ? (p.product as Stripe.Product).description : "",
      }));

    return res.json({ plans });
  } catch (err: any) {
    if (err?.message?.includes("not configured")) {
      // Stripe key not set — return empty list so UI degrades gracefully
      return res.json({ plans: [] });
    }
    console.error("getPlans error:", err);
    return res.status(500).json({ message: "Failed to fetch plans" });
  }
}

/**
 * POST /api/billing/checkout
 * Body: { tier: "basic"|"pro", term: "monthly"|"quarterly"|"annual" }
 * Returns: { url }
 */
export async function createCheckoutSession(req: Request, res: Response) {
  try {
    const companyId = (req as any).companyId as string | undefined;
    if (!companyId) return res.status(401).json({ message: "Not authenticated" });

    // Derive base URL: use APP_BASE_URL env var, or reconstruct from request
    const baseUrl =
      process.env.APP_BASE_URL ||
      `${req.protocol}://${req.get("host")}`;

    const { tier, term } = req.body ?? {};
    if (!tier || !term) return res.status(400).json({ message: "tier and term are required" });

    const key = `${tier}:${term}`;
    const lookupKey = LOOKUP_KEY[key];
    if (!lookupKey) return res.status(400).json({ message: `Invalid tier/term combination: ${key}` });

    // Fetch price by lookup_key
    const prices = await getStripe().prices.search({
      query: `lookup_key:'${lookupKey}' AND active:'true'`,
      limit: 1,
    });
    const price = prices.data[0];
    if (!price) return res.status(404).json({ message: `No active price found for ${lookupKey}` });

    // Look up existing Stripe customer ID for this company (if any)
    const [company] = await db.select({ stripeCustomerId: companies.stripeCustomerId, contactEmail: companies.contactEmail })
      .from(companies)
      .where(eq(companies.id, companyId));

    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: price.id, quantity: 1 }],
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
      },
      success_url: `${baseUrl}/?welcome=true`,
      cancel_url: `${baseUrl}/choose-plan`,
      customer: company?.stripeCustomerId || undefined,
      customer_email: company?.stripeCustomerId ? undefined : (company?.contactEmail || undefined),
      client_reference_id: companyId,
      metadata: { tier, term, lookup_key: lookupKey, companyId },
    });

    return res.json({ url: session.url });
  } catch (err: any) {
    console.error("createCheckoutSession error:", err);
    return res.status(500).json({ message: "Failed to create checkout session" });
  }
}

/**
 * POST /api/billing/webhook
 * Receives raw body (Buffer) — signature verified against STRIPE_WEBHOOK_SECRET.
 */
export async function stripeWebhook(req: Request, res: Response) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET not configured");
    return res.status(500).send("Webhook secret not configured");
  }

  const sig = req.headers["stripe-signature"];
  if (!sig || typeof sig !== "string") {
    return res.status(400).send("Missing Stripe-Signature header");
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err: any) {
    console.error("Stripe webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const companyId = session.client_reference_id || session.metadata?.companyId;
        if (!companyId) break;

        const stripeCustomerId = typeof session.customer === "string" ? session.customer : null;
        const stripeSubscriptionId = typeof session.subscription === "string" ? session.subscription : null;
        const tier = session.metadata?.tier || null;
        const term = session.metadata?.term || null;

        await db.update(companies)
          .set({
            stripeCustomerId: stripeCustomerId || undefined,
            stripeSubscriptionId: stripeSubscriptionId || undefined,
            subscriptionStatus: "trialing",
            subscriptionTier: tier || undefined,
            subscriptionTerm: term || undefined,
          })
          .where(eq(companies.id, companyId));

        console.log(`[Billing] checkout.session.completed: company=${companyId} tier=${tier} term=${term} status=trialing`);
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
        if (!customerId) break;

        const periodEnd = (invoice as any).lines?.data?.[0]?.period?.end;
        const periodEndDate = periodEnd ? new Date(periodEnd * 1000) : undefined;

        await db.update(companies)
          .set({
            subscriptionStatus: "active",
            ...(periodEndDate ? { subscriptionCurrentPeriodEnd: periodEndDate } : {}),
          })
          .where(eq(companies.stripeCustomerId, customerId));

        console.log(`[Billing] invoice.paid: customer=${customerId}`);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
        if (!customerId) break;

        await db.update(companies)
          .set({ subscriptionStatus: "past_due" })
          .where(eq(companies.stripeCustomerId, customerId));

        console.log(`[Billing] invoice.payment_failed: customer=${customerId}`);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = typeof subscription.customer === "string" ? subscription.customer : null;
        if (!customerId) break;

        await db.update(companies)
          .set({
            subscriptionStatus: "canceled",
            stripeSubscriptionId: null,
          })
          .where(eq(companies.stripeCustomerId, customerId));

        console.log(`[Billing] customer.subscription.deleted: customer=${customerId}`);
        break;
      }

      default:
        break;
    }

    return res.json({ received: true });
  } catch (err: any) {
    console.error("Stripe webhook handler error:", err);
    return res.status(500).send("Webhook handler failed");
  }
}
