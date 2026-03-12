import { Link } from "wouter";
import {
  Package, BookOpen, TrendingDown, BarChart3, Truck, Users, RefreshCw,
  ScanLine, ArrowRightLeft, ClipboardList, ChevronRight, CheckCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingLayout, CTAButton, SectionHeading, appLink } from "@/components/website/marketing-layout";

const FEATURE_GROUPS = [
  {
    icon: Package,
    title: "Inventory Management",
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
      "Get a real-time view of what you have on hand, where it's stored, and what it costs — across every location you operate.",
  },
  {
    icon: BookOpen,
    title: "Recipe Costing",
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
      "Build every recipe with precision — from simple prep items to multi-layer dishes — and always know your true cost per portion.",
  },
  {
    icon: Truck,
    title: "Vendor & Order Guides",
    color: "green",
    features: [
      "Native import for Sysco, GFS, and US Foods order guides",
      "Case-price entry matching real vendor invoices",
      "Automatic unit price calculation from case and inner pack",
      "Order guide approval creates inventory items automatically",
      "Assign vendors and order guides to specific stores",
      "Track account numbers and delivery schedules per vendor",
    ],
    description:
      "Import vendor catalogs in minutes and build purchase orders without ever re-entering data from an invoice.",
  },
  {
    icon: BarChart3,
    title: "Food Cost Variance (TFC)",
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
  },
  {
    icon: Users,
    title: "Multi-Location & Team",
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
      "Whether you run one location or twenty, FnB Cost Pro keeps everything organized and your team accountable.",
  },
];

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
        <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl ${c.icon} mb-4`}>
          <group.icon className="h-6 w-6" />
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
            Everything a Food Service Operator Needs
          </h1>
          <p className="text-lg text-gray-300 leading-relaxed mb-8">
            FnB Cost Pro was built from the ground up for restaurant operators — not adapted from generic warehouse or retail software.
          </p>
          <CTAButton href={appLink("/signup")} large>
            Start Free Trial
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

      <section className="py-20 bg-green-900 text-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-white mb-4">
            See It in Action — Free for 14 Days
          </h2>
          <p className="text-green-200 mb-8">
            No credit card required. Full access. Cancel anytime.
          </p>
          <CTAButton href={appLink("/signup")} large>
            Start Your Free Trial
          </CTAButton>
        </div>
      </section>
    </MarketingLayout>
  );
}
