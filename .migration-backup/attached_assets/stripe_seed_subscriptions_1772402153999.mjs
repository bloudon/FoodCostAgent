/**
 * stripe_seed_subscriptions.mjs
 *
 * Creates FNBCostPro Products + Prices in Stripe TEST mode:
 *  - Products: FNBCostPro Basic, FNBCostPro Pro
 *  - Prices: monthly, quarterly (every 3 months), annual
 *
 * Safe to re-run:
 *  - Products are searched by metadata lookup_key.
 *  - Prices are searched by lookup_key.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... node stripe_seed_subscriptions.mjs
 *
 * Notes:
 * - Use placeholder amounts now. When you finalize pricing, CREATE NEW PRICES
 *   (Stripe prices are not meant to be edited for amount) and update your app mapping.
 */

import Stripe from "stripe";

const secret = process.env.STRIPE_SECRET_KEY;
if (!secret || !secret.startsWith("sk_")) {
  console.error("Missing/invalid STRIPE_SECRET_KEY (should be sk_test_... in test mode).");
  process.exit(1);
}

const stripe = new Stripe(secret, { apiVersion: "2024-06-20" });

// Placeholder pricing in cents (change later by creating new Prices)
const PRICING_CENTS = {
  basic: { monthly: 100, quarterly: 250, annual: 900 }, // $1.00 / $2.50 / $9.00 (test placeholders)
  pro: { monthly: 200, quarterly: 500, annual: 1800 },  // $2.00 / $5.00 / $18.00
};

async function findProductByLookupKey(lookupKey) {
  const res = await stripe.products.search({
    query: `metadata['lookup_key']:'${lookupKey}'`,
    limit: 1,
  });
  return res.data[0] ?? null;
}

async function createOrGetProduct({ name, lookupKey, description }) {
  const existing = await findProductByLookupKey(lookupKey);
  if (existing) return existing;

  return stripe.products.create({
    name,
    description,
    metadata: {
      lookup_key: lookupKey,
      app: "fnbcostpro",
      env: "test",
    },
  });
}

async function findPriceByLookupKey(lookupKey) {
  const res = await stripe.prices.search({
    query: `lookup_key:'${lookupKey}'`,
    limit: 1,
  });
  return res.data[0] ?? null;
}

async function createOrGetRecurringPrice({
  productId,
  lookupKey,
  nickname,
  unitAmount,
  interval,
  intervalCount = 1,
}) {
  const existing = await findPriceByLookupKey(lookupKey);
  if (existing) return existing;

  return stripe.prices.create({
    product: productId,
    currency: "usd",
    unit_amount: unitAmount,
    recurring: {
      interval,        // "month" or "year"
      interval_count: intervalCount, // 3 for quarterly
    },
    lookup_key: lookupKey,
    nickname,
    metadata: { app: "fnbcostpro", env: "test" },
  });
}

async function main() {
  const basicProduct = await createOrGetProduct({
    name: "FNBCostPro Basic",
    lookupKey: "fnb_basic",
    description: "FNBCostPro Basic subscription (test placeholders).",
  });

  const proProduct = await createOrGetProduct({
    name: "FNBCostPro Pro",
    lookupKey: "fnb_pro",
    description: "FNBCostPro Pro subscription (test placeholders).",
  });

  const planDefs = [
    // Basic
    {
      tier: "basic",
      term: "monthly",
      productId: basicProduct.id,
      unitAmount: PRICING_CENTS.basic.monthly,
      interval: "month",
      intervalCount: 1,
    },
    {
      tier: "basic",
      term: "quarterly",
      productId: basicProduct.id,
      unitAmount: PRICING_CENTS.basic.quarterly,
      interval: "month",
      intervalCount: 3,
    },
    {
      tier: "basic",
      term: "annual",
      productId: basicProduct.id,
      unitAmount: PRICING_CENTS.basic.annual,
      interval: "year",
      intervalCount: 1,
    },

    // Pro
    {
      tier: "pro",
      term: "monthly",
      productId: proProduct.id,
      unitAmount: PRICING_CENTS.pro.monthly,
      interval: "month",
      intervalCount: 1,
    },
    {
      tier: "pro",
      term: "quarterly",
      productId: proProduct.id,
      unitAmount: PRICING_CENTS.pro.quarterly,
      interval: "month",
      intervalCount: 3,
    },
    {
      tier: "pro",
      term: "annual",
      productId: proProduct.id,
      unitAmount: PRICING_CENTS.pro.annual,
      interval: "year",
      intervalCount: 1,
    },
  ];

  const created = [];
  for (const p of planDefs) {
    const lookupKey = `fnb_${p.tier}_${p.term}`;
    const nickname = `FNBCostPro ${p.tier.toUpperCase()} - ${p.term}`;

    const price = await createOrGetRecurringPrice({
      productId: p.productId,
      lookupKey,
      nickname,
      unitAmount: p.unitAmount,
      interval: p.interval,
      intervalCount: p.intervalCount,
    });

    created.push({
      lookupKey,
      priceId: price.id,
      unit_amount: price.unit_amount,
      interval: price.recurring?.interval,
      interval_count: price.recurring?.interval_count,
      product: price.product,
    });
  }

  console.log("\n✅ Products:");
  console.log("Basic:", basicProduct.id);
  console.log("Pro:  ", proProduct.id);

  console.log("\n✅ Prices (store these lookup_key -> priceId mappings):");
  for (const row of created) {
    console.log(
      `${row.lookupKey} -> ${row.priceId} | ${row.unit_amount} cents every ${row.interval_count} ${row.interval}(s)`
    );
  }

  console.log("\nNext: use lookup_key (recommended) or priceId when creating Checkout Sessions.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});