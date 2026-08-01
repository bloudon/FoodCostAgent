import type { Request, Response } from "express";
import Stripe from "stripe";
import { db } from "./db";
import { companies } from "@shared/schema";
import { eq } from "drizzle-orm";
import { PLAN_CATALOG, ADDITIONAL_LOCATION_PRICING } from "@shared/plan-catalog";

interface SubscriptionEventData extends Stripe.Event.Data {
  previous_attributes?: Partial<Stripe.Subscription>;
}

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not configured on this server");
    _stripe = new Stripe(key, { apiVersion: "2026-02-25.clover" });
  }
  return _stripe;
}

const TRIAL_DAYS = 14;

/** Canonical lookup keys for the platform base price, sourced from PLAN_CATALOG. */
const PLATFORM_LOOKUP_KEYS = {
  monthly: PLAN_CATALOG.platform.stripeLookupKeys.monthly!,
  annual:  PLAN_CATALOG.platform.stripeLookupKeys.annual!,
};

/** Canonical lookup keys for per-additional-location price items. */
const LOCATION_LOOKUP_KEYS = {
  monthly: ADDITIONAL_LOCATION_PRICING.stripeLookupKeys.monthly,
  annual:  ADDITIONAL_LOCATION_PRICING.stripeLookupKeys.annual,
};

/** All valid new lookup keys (used for filtering /api/billing/plans response). */
const VALID_LOOKUP_KEYS = new Set([
  PLATFORM_LOOKUP_KEYS.monthly,
  PLATFORM_LOOKUP_KEYS.annual,
  LOCATION_LOOKUP_KEYS.monthly,
  LOCATION_LOOKUP_KEYS.annual,
]);

/**
 * Resolves the Stripe Price object for a given lookup key.
 * Returns undefined if no active price is found.
 */
async function findPriceByLookupKey(lookupKey: string): Promise<Stripe.Price | undefined> {
  const result = await getStripe().prices.search({
    query: `lookup_key:'${lookupKey}' AND active:'true'`,
    limit: 1,
  });
  return result.data[0];
}

/**
 * Extracts the additional-location quantity from a Stripe subscription's line items.
 * Returns 0 if no additional-location item is found.
 */
function extractAdditionalLocationQty(subscription: Stripe.Subscription): number {
  for (const item of subscription.items.data) {
    const lk = item.price?.lookup_key ?? "";
    if (lk === LOCATION_LOOKUP_KEYS.monthly || lk === LOCATION_LOOKUP_KEYS.annual) {
      return item.quantity ?? 0;
    }
  }
  return 0;
}

/**
 * Extracts the billing interval ("monthly" | "annual") from a Stripe subscription.
 */
function extractBillingInterval(subscription: Stripe.Subscription): "monthly" | "annual" | null {
  for (const item of subscription.items.data) {
    const lk = item.price?.lookup_key ?? "";
    if (lk === PLATFORM_LOOKUP_KEYS.annual || lk === LOCATION_LOOKUP_KEYS.annual) {
      return "annual";
    }
    if (lk === PLATFORM_LOOKUP_KEYS.monthly || lk === LOCATION_LOOKUP_KEYS.monthly) {
      return "monthly";
    }
  }
  // Fall back to recurring interval from first item
  const interval = subscription.items.data[0]?.price?.recurring?.interval;
  if (interval === "year") return "annual";
  if (interval === "month") return "monthly";
  return null;
}

/**
 * GET /api/billing/plans
 * Returns Platform and Additional Location prices from Stripe.
 * Only prices with lookup keys defined in PLAN_CATALOG / ADDITIONAL_LOCATION_PRICING are returned.
 */
export async function getPlans(_req: Request, res: Response) {
  try {
    const prices = await getStripe().prices.list({
      active: true,
      expand: ["data.product"],
      limit: 100,
    });

    const plans = prices.data
      .filter((p) => VALID_LOOKUP_KEYS.has(p.lookup_key ?? ""))
      .map((p) => ({
        id: p.id,
        lookupKey: p.lookup_key,
        unitAmount: p.unit_amount,
        currency: p.currency,
        interval: p.recurring?.interval,
        intervalCount: p.recurring?.interval_count,
        productName: typeof p.product === "object" && p.product !== null ? (p.product as Stripe.Product).name : "",
        productDescription: typeof p.product === "object" && p.product !== null ? (p.product as Stripe.Product).description : "",
        // Categorise for the UI
        priceType: (p.lookup_key ?? "").includes("location") ? "additional_location" : "platform",
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
 * Body: { plan: "platform"|"enterprise", term: "monthly"|"annual", additionalLocations?: number, returnTo?: string }
 *
 * Builds a Stripe Checkout session with:
 *   - One Platform base-price line item
 *   - Zero or more additional-location quantity items when additionalLocations > 0
 *
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

    // Accept both "plan" (new) and "tier" (legacy) body keys
    const rawPlan = req.body?.plan ?? req.body?.tier ?? null;
    const term: string | undefined = req.body?.term;
    const returnTo: string | undefined = req.body?.returnTo;
    const additionalLocations: number = Math.max(0, parseInt(req.body?.additionalLocations ?? "0", 10) || 0);

    if (!rawPlan || !term) {
      return res.status(400).json({ message: "plan and term are required" });
    }

    // Reject quarterly billing — not supported in the new model
    if (term === "quarterly") {
      return res.status(400).json({ message: "Quarterly billing is no longer supported. Please use monthly or annual." });
    }

    if (term !== "monthly" && term !== "annual") {
      return res.status(400).json({ message: "term must be monthly or annual" });
    }

    // Normalize legacy tier names to platform
    const plan = (rawPlan === "basic" || rawPlan === "pro" || rawPlan === "starter") ? "platform" : rawPlan;

    if (plan === "enterprise") {
      return res.status(400).json({ message: "Enterprise plans require direct sales contact. Please use the enterprise inquiry form." });
    }

    if (plan !== "platform") {
      return res.status(400).json({ message: `Unknown plan: ${plan}` });
    }

    // Validate returnTo — only allow relative internal paths to prevent open redirects.
    const safeReturnTo = typeof returnTo === "string" && /^\/[a-zA-Z0-9/_?&=-]*$/.test(returnTo)
      ? returnTo
      : null;

    // Resolve platform base price
    const platformLookupKey = PLATFORM_LOOKUP_KEYS[term as "monthly" | "annual"];
    const platformPrice = await findPriceByLookupKey(platformLookupKey);
    if (!platformPrice) {
      return res.status(404).json({ message: `No active price found for ${platformLookupKey}` });
    }

    // Build line_items — always start with the platform base
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      { price: platformPrice.id, quantity: 1 },
    ];

    // Add additional-location items if requested (> 0 additional locations beyond the included first)
    if (additionalLocations > 0) {
      const locationLookupKey = LOCATION_LOOKUP_KEYS[term as "monthly" | "annual"];
      const locationPrice = await findPriceByLookupKey(locationLookupKey);
      if (!locationPrice) {
        return res.status(404).json({ message: `No active price found for ${locationLookupKey}` });
      }
      lineItems.push({ price: locationPrice.id, quantity: additionalLocations });
    }

    // Look up existing Stripe customer ID for this company (if any)
    const [company] = await db.select({ stripeCustomerId: companies.stripeCustomerId, contactEmail: companies.contactEmail })
      .from(companies)
      .where(eq(companies.id, companyId));

    // Build success URL — handle the case where safeReturnTo already has
    // a query string by using the correct separator (? vs &).
    const successUrl = safeReturnTo
      ? (() => {
          const sep = safeReturnTo.includes("?") ? "&" : "?";
          return `${baseUrl}${safeReturnTo}${sep}planActivated=true`;
        })()
      : `${baseUrl}/menu-insights?welcome=true`;

    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      line_items: lineItems,
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
      },
      success_url: successUrl,
      cancel_url: safeReturnTo ? `${baseUrl}/choose-plan?returnTo=${encodeURIComponent(safeReturnTo)}` : `${baseUrl}/choose-plan`,
      customer: company?.stripeCustomerId || undefined,
      customer_email: company?.stripeCustomerId ? undefined : (company?.contactEmail || undefined),
      client_reference_id: companyId,
      metadata: {
        plan,
        term,
        lookup_key: platformLookupKey,
        additionalLocations: String(additionalLocations),
        companyId,
      },
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

        // Support both new "plan" metadata key and legacy "tier" key
        const rawPlan = session.metadata?.plan || session.metadata?.tier || null;
        // Normalize legacy tier values to platform
        const plan = (rawPlan === "basic" || rawPlan === "pro" || rawPlan === "starter" || rawPlan === "free")
          ? "platform"
          : (rawPlan || "platform");
        const term = session.metadata?.term || null;
        const billingInterval = term === "annual" ? "annual" : term === "monthly" ? "monthly" : null;

        // licensedLocationCount comes from metadata set at checkout time
        const additionalLocationsFromMeta = parseInt(session.metadata?.additionalLocations ?? "0", 10) || 0;
        const licensedLocationCount = 1 + additionalLocationsFromMeta;

        await db.update(companies)
          .set({
            stripeCustomerId: stripeCustomerId || undefined,
            stripeSubscriptionId: stripeSubscriptionId || undefined,
            subscriptionStatus: "trialing",
            subscriptionPlan: plan,
            billingInterval: billingInterval || undefined,
            licensedLocationCount,
          })
          .where(eq(companies.id, companyId));

        console.log(`[Billing] checkout.session.completed: company=${companyId} plan=${plan} term=${term} status=trialing licensedLocationCount=${licensedLocationCount}`);
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

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = typeof subscription.customer === "string" ? subscription.customer : null;
        if (!customerId) break;

        // For enterprise subscriptions, set plan to enterprise and skip location count
        const isEnterprise = subscription.items.data.some((item) => {
          const lk = item.price?.lookup_key ?? "";
          return lk.startsWith("fnb_enterprise");
        });
        if (isEnterprise) {
          await db.update(companies)
            .set({ subscriptionPlan: "enterprise" })
            .where(eq(companies.stripeCustomerId, customerId));
          console.log(`[Billing] ${event.type}: enterprise subscription customer=${customerId}`);
          break;
        }

        // Compute licensedLocationCount from additional-location line item
        const additionalLocationQty = extractAdditionalLocationQty(subscription);
        const licensedLocationCount = 1 + additionalLocationQty;
        const billingInterval = extractBillingInterval(subscription);

        // Handle trial-expired-without-payment case on .updated
        if (event.type === "customer.subscription.updated") {
          const eventData = event.data as SubscriptionEventData;
          const wasTrialing = eventData.previous_attributes?.status === "trialing";
          const nowTerminalOrUnpaid =
            subscription.status === "canceled" ||
            subscription.status === "incomplete_expired" ||
            subscription.status === "past_due" ||
            subscription.status === "unpaid";

          if (wasTrialing && nowTerminalOrUnpaid) {
            await db.update(companies)
              .set({
                subscriptionStatus: "canceled",
                stripeSubscriptionId: null,
              })
              .where(eq(companies.stripeCustomerId, customerId));

            console.log(`[Billing] customer.subscription.updated: trial expired without payment, subscription canceled customer=${customerId}`);
            break;
          }
        }

        // Write licensedLocationCount and billingInterval
        await db.update(companies)
          .set({
            licensedLocationCount,
            ...(billingInterval ? { billingInterval } : {}),
          })
          .where(eq(companies.stripeCustomerId, customerId));

        console.log(`[Billing] ${event.type}: customer=${customerId} licensedLocationCount=${licensedLocationCount} billingInterval=${billingInterval}`);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = typeof subscription.customer === "string" ? subscription.customer : null;
        if (!customerId) break;

        const trialEnd = subscription.trial_end;
        const canceledAt = subscription.canceled_at;
        const deletedEventData = event.data as SubscriptionEventData;
        const previousStatus = deletedEventData.previous_attributes?.status;
        const endedDuringTrial =
          previousStatus === "trialing" ||
          subscription.status === "trialing" ||
          (trialEnd && canceledAt && canceledAt <= trialEnd);

        if (endedDuringTrial) {
          await db.update(companies)
            .set({
              subscriptionStatus: "canceled",
              stripeSubscriptionId: null,
            })
            .where(eq(companies.stripeCustomerId, customerId));

          console.log(`[Billing] customer.subscription.deleted: trial ended without payment, subscription canceled customer=${customerId}`);
        } else {
          await db.update(companies)
            .set({
              subscriptionStatus: "canceled",
              stripeSubscriptionId: null,
            })
            .where(eq(companies.stripeCustomerId, customerId));

          console.log(`[Billing] customer.subscription.deleted: customer=${customerId}`);
        }
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
