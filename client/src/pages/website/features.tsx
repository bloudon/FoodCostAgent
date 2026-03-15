import { Link } from "wouter";
import {
  Package, BookOpen, TrendingDown, BarChart3, Truck, Users, RefreshCw,
  ScanLine, ArrowRightLeft, ClipboardList, ChevronRight, CheckCircle, Star,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarketingLayout, CTAButton, SectionHeading, appLink } from "@/components/website/marketing-layout";

type TierLevel = "free" | "basic" | "pro";

const TIER_CONFIG: Record<TierLevel, { label: string; color: string; bg: string; border: string }> = {
  free: { label: "Free", color: "text-gray-600", bg: "bg-gray-100", border: "border-gray-300" },
  basic: { label: "Basic+", color: "text-green-700", bg: "bg-green-50", border: "border-green-300" },
  pro: { label: "Pro", color: "text-orange-700", bg: "bg-orange-50", border: "border-orange-300" },
};

const FEATURE_GROUPS = [
  {
    icon: Package,
    title: "Inventory Management",
    tier: "free" as TierLevel,
    color: "green",
    features: [
      "Track ingredients across multiple storage locations",
      "Set par levels and reorder points per store",
      "Weighted average cost and last-cost pricing",
      "Drag-and-drop storage location ordering",
      "Active/inactive status control at company and store level",
      "Comprehensive unit conversion system (weight, volume, count)",
    ],
    description:
      "Get a real-time view of what you have on hand, where it's stored, and what it costs \u2014 across every location you operate.",
  },
  {
    icon: BookOpen,
    title: "Recipe Costing",
    tier: "basic" as TierLevel,
    color: "orange",
    features: [
      "Ingredient-level cost breakdown with yield adjustments",
      "Nested sub-recipe support for complex preparations",
      "Per-recipe yield override for different waste factors",
      "Automatic cost recalculation when ingredient prices change",
      "Mark recipes as available ingredients in other recipes",
      "Category-based filtering in the recipe builder",
    ],
    description:
      "Build every recipe with precision \u2014 from simple prep items to multi-layer dishes \u2014 and always know your true cost per portion.",
  },
  {
    icon: Truck,
    title: "Vendor & Order Guides",
    tier: "free" as TierLevel,
    color: "green",
    features: [
      "Import order guides from any major food purveyor \u2014 Sysco, GFS, US Foods, and more",
      "Native adapters for leading distributors with automatic format detection",
      "Case-price entry matching real vendor invoices",
      "Automatic unit price calculation from case and inner pack",
      "Order guide approval creates inventory items and populates prices automatically",
      "Assign vendors and order guides to specific stores",
      "Track account numbers and delivery schedules per vendor",
      "Prices flow into recipes \u2014 when a vendor price changes, every affected recipe cost updates automatically",
    ],
    description:
      "Import your vendor catalogs in minutes. Prices auto-populate your inventory and flow directly into recipe costs \u2014 when a vendor updates pricing, every recipe recalculates. No re-entry, no spreadsheets.",
    proFeature: "Cross-shop vendor pricing (Pro): Compare the same item across all your vendor order guides to find the best price \u2014 automatically.",
  },
  {
    icon: BarChart3,
    title: "Food Cost Variance (TFC)",
    tier: "pro" as TierLevel,
    color: "orange",
    features: [
      "Theoretical Food Cost calculated from sales and recipes",
      "Import POS sales data to drive variance reports",
      "Compare theoretical vs. actual food cost by category",
      "Spot over-portioning, waste, and theft instantly",
      "Drill down into individual menu items and recipes",
      "Date-range reporting for period-over-period comparison",
    ],
    description:
      "Stop guessing where your food costs are going. TFC variance shows you exactly where the gap is between what you should spend and what you actually spend.",
  },
  {
    icon: ClipboardList,
    title: "Inventory Counting",
    tier: "free" as TierLevel,
    color: "green",
    features: [
      "Guided count sessions by storage location",
      "Scan or manually enter counts on any device",
      "Estimated on-hand calculation between counts",
      "Count history with user accountability tracking",
      "Variance reports comparing expected vs. counted",
      "Mobile-first design for counting on the floor",
    ],
    description:
      "Conduct fast, accurate inventory counts from your phone or tablet. Every count is logged with date and user for full accountability.",
    proFeature: "Power Inventory counting (Pro): Focus counts on high-cost power items for faster, targeted inventory tracking.",
  },
  {
    icon: Users,
    title: "Multi-Location & Team",
    tier: "pro" as TierLevel,
    color: "orange",
    features: [
      "Manage multiple stores under one company account",
      "Role-based access: admin, manager, staff",
      "Invite team members by email with store assignment",
      "Per-store inventory, par levels, and vendor access",
      "Transfer orders between locations",
      "Waste logging with user accountability",
    ],
    description:
      "Whether you run one F&B location or twenty, FnB Cost Pro keeps everything organized and your team accountable. Unlimited locations on Pro.",
  },
];

function TierBadge({ tier }: { tier: TierLevel }) {
  const config = TIER_CONFIG[tier];
  return (
    <Badge
      variant="outline"
      className={`text-[11px] px-2 py-0 h-5 font-semibold ${config.color} ${config.border} ${config.bg}`}
      data-testid={`tier-badge-${tier}`}
    >
      {config.label}
    </Badge>
  );
}

function FeatureGroup({ group, reverse }: { group: typeof FEATURE_GROUPS[0]; reverse?: boolean }) {
  const colorMap = {
    green: { icon: "bg-green-100 text-green-700", badge: "text-green-600", check: "text-green-500" },
    orange: { icon: "bg-orange-100 text-orange-600", badge: "text-orange-500", check: "text-orange-500" },
  };
  const c = colorMap[group.color as keyof typeof colorMap];
  return (
    <div
      className={`flex flex-col ${reverse ? "lg:flex-row-reverse" : "lg:flex-row"} gap-12 items-center`}
      data-testid={`feature-group-${group.title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-4">
          <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl ${c.icon}`}>
            <group.icon className="h-6 w-6" />
          </div>
          <TierBadge tier={group.tier} />
        </div>
        <span className={`text-xs font-semibold uppercase tracking-widest ${c.badge} mb-2 block`}>
          {group.title}
        </span>
        <h3 className="text-2xl font-bold text-gray-900 mb-4">{group.title}</h3>
        <p className="text-gray-500 leading-relaxed mb-6">{group.description}</p>
        <ul className="space-y-3">
          {group.features.map((f) => (
            <li key={f} className="flex items-start gap-2.5">
              <CheckCircle className={`h-4 w-4 mt-0.5 flex-shrink-0 ${c.check}`} />
              <span className="text-sm text-gray-600">{f}</span>
            </li>
          ))}
        </ul>
        {group.proFeature && (
          <div className="mt-4 p-3 rounded-lg bg-orange-50 border border-orange-200">
            <div className="flex items-start gap-2">
              <Star className="h-4 w-4 text-orange-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-orange-800">{group.proFeature}</p>
            </div>
          </div>
        )}
      </div>
      <div className="flex-1 w-full">
        <div className="rounded-xl bg-gray-100 border border-gray-200 aspect-video flex items-center justify-center">
          <div className="text-center text-gray-400">
            <group.icon className="h-16 w-16 mx-auto mb-3 opacity-30" />
            <p className="text-sm">{group.title}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WebsiteFeatures() {
  return (
    <MarketingLayout>
      <section className="py-16 bg-gradient-to-b from-gray-900 to-gray-800 text-white text-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <span className="inline-block text-xs font-semibold uppercase tracking-widest text-green-400 mb-4">
            Full Feature Set
          </span>
          <h1 className="text-4xl sm:text-5xl font-extrabold mb-4">
            Everything an F&amp;B Operator Needs
          </h1>
          <p className="text-lg text-gray-300 leading-relaxed mb-6">
            FnB Cost Pro was built from the ground up for Food &amp; Beverage operators \u2014 restaurants, bars, catering, and multi-unit F&amp;B businesses \u2014 not adapted from generic warehouse or retail software.
          </p>
          <div className="flex flex-wrap gap-2 justify-center mb-8">
            {(["free", "basic", "pro"] as TierLevel[]).map((tier) => (
              <TierBadge key={tier} tier={tier} />
            ))}
            <span className="text-xs text-gray-400 self-center ml-1">badges show which plan includes each feature</span>
          </div>
          <CTAButton href={appLink("/signup")} large>
            Start Free
          </CTAButton>
        </div>
      </section>

      <section className="py-20 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-24">
          {FEATURE_GROUPS.map((g, i) => (
            <FeatureGroup key={g.title} group={g} reverse={i % 2 === 1} />
          ))}
        </div>
      </section>

      <section className="py-16 bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            title="The Natural Upgrade Path"
            subtitle="Start free. Upgrade when your business needs it."
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 p-6" data-testid="upgrade-path-free">
              <TierBadge tier="free" />
              <h3 className="text-lg font-semibold text-gray-900 mt-3 mb-2">Get Organized</h3>
              <p className="text-sm text-gray-500 leading-relaxed">
                Track your inventory, import vendor order guides, create purchase orders, and run counts. Everything you need to get your operation organized \u2014 free forever.
              </p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6" data-testid="upgrade-path-basic">
              <TierBadge tier="basic" />
              <h3 className="text-lg font-semibold text-gray-900 mt-3 mb-2">Know Your Costs</h3>
              <p className="text-sm text-gray-500 leading-relaxed">
                When you're ready to know exactly what every dish costs, upgrade to Basic. Build recipes, track food cost per portion, and make pricing decisions with confidence.
              </p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6" data-testid="upgrade-path-pro">
              <TierBadge tier="pro" />
              <h3 className="text-lg font-semibold text-gray-900 mt-3 mb-2">Scale & Optimize</h3>
              <p className="text-sm text-gray-500 leading-relaxed">
                Multi-unit operators need TFC variance reporting, POS import, transfer orders, and unlimited locations. Pro gives you full control across your entire operation.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 bg-green-900 text-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-white mb-4">
            Start Free \u2014 Upgrade When You're Ready
          </h2>
          <p className="text-green-200 mb-8">
            Get started with inventory and ordering at no cost. Add recipe costing and advanced features when your business needs them.
          </p>
          <CTAButton href={appLink("/signup")} large>
            Get Started Free
          </CTAButton>
        </div>
      </section>
    </MarketingLayout>
  );
}
