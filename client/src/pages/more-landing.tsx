import { Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { useTier } from "@/hooks/use-tier";
import {
  Utensils,
  BookOpen,
  Ruler,
  Tag,
  MapPin,
  Settings,
  Users,
  Store,
  KeyRound,
  Building2,
  UserCog,
  Package,
  Image,
  ChevronRight,
  BarChart3,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NavItem {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  testId: string;
}

// ---------------------------------------------------------------------------
// Nav card row
// ---------------------------------------------------------------------------

function NavRow({ href, icon: Icon, label, description, testId }: NavItem) {
  return (
    <Link href={href} data-testid={testId}>
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-md hover-elevate cursor-pointer">
        <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground leading-snug">{description}</p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Section card
// ---------------------------------------------------------------------------

function SectionCard({
  title,
  items,
}: {
  title: string;
  items: NavItem[];
}) {
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-2 pb-3 space-y-0.5">
        {items.map((item) => (
          <NavRow key={item.href} {...item} />
        ))}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function MoreLanding() {
  const { user } = useAuth();
  const { hasFeature } = useTier();
  const role = user?.role ?? "store_user";
  const isManager = role === "store_manager" || role === "company_admin" || role === "global_admin";
  const isAdmin = role === "company_admin" || role === "global_admin";
  const isGlobalAdmin = role === "global_admin";

  // Insights — manager+ only; essential for mobile where Analyze has no rail slot
  const insights: NavItem[] = isManager
    ? [
        {
          href: "/analyze",
          icon: BarChart3,
          label: "Analyze & Reports",
          description: "Food cost, variance, and sales analytics",
          testId: "more-nav-analyze",
        },
      ]
    : [];

  const menuRecipes: NavItem[] = [
    {
      href: "/menu-items",
      icon: Utensils,
      label: "Menu Items",
      description: "Manage your menu and selling prices",
      testId: "more-nav-menu-items",
    },
    {
      href: "/recipes",
      icon: BookOpen,
      label: "Recipes",
      description: "Build and cost recipes and sub-recipes",
      testId: "more-nav-recipes",
    },
  ];

  const inventorySetup: NavItem[] = [
    {
      href: "/categories",
      icon: Tag,
      label: "Categories",
      description: "Organize inventory into categories",
      testId: "more-nav-categories",
    },
    {
      href: "/unit-conversions",
      icon: Ruler,
      label: "Unit Conversions",
      description: "Custom conversion factors between units",
      testId: "more-nav-unit-conversions",
    },
  ];

  // Storage Locations: manager+ (needed to configure count sheet order)
  // Store Locations: admin+ (company-level config)
  const locations: NavItem[] = [
    ...(isManager
      ? [
          {
            href: "/storage-locations",
            icon: MapPin,
            label: "Storage Locations",
            description: "Define fridges, freezers, and shelves",
            testId: "more-nav-storage-locations",
          } as NavItem,
        ]
      : []),
    ...(isAdmin
      ? [
          {
            href: "/stores",
            icon: Store,
            label: "Store Locations",
            description: "Add and configure store locations",
            testId: "more-nav-stores",
          } as NavItem,
        ]
      : []),
  ];

  const team: NavItem[] = isAdmin
    ? [
        {
          href: "/users",
          icon: Users,
          label: "Users",
          description: "Manage team members and roles",
          testId: "more-nav-users",
        },
      ]
    : [];

  const integrations: NavItem[] = isAdmin
    ? [
        {
          href: "/api-credentials",
          icon: KeyRound,
          label: "API Credentials",
          description: "Manage API keys for integrations",
          testId: "more-nav-api-credentials",
        },
      ]
    : [];

  const company: NavItem[] = isAdmin
    ? [
        {
          href: "/settings",
          icon: Settings,
          label: "Settings",
          description: "Account, billing, and company preferences",
          testId: "more-nav-settings",
        },
      ]
    : [];

  const platformAdmin: NavItem[] = isGlobalAdmin
    ? [
        {
          href: "/companies",
          icon: Building2,
          label: "Companies",
          description: "Manage all companies in the platform",
          testId: "more-nav-companies",
        },
        {
          href: "/admin/users",
          icon: UserCog,
          label: "Admin Users",
          description: "Global user management",
          testId: "more-nav-admin-users",
        },
        {
          href: "/admin/vendor-registry",
          icon: Package,
          label: "Vendor Registry",
          description: "Manage the global vendor catalog",
          testId: "more-nav-vendor-registry",
        },
        {
          href: "/admin/backgrounds",
          icon: Image,
          label: "Backgrounds",
          description: "Manage mobile background images",
          testId: "more-nav-backgrounds",
        },
      ]
    : [];

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">More</h1>
          <p className="text-sm text-muted-foreground">
            Configuration, team management, and platform tools.
          </p>
        </div>

        {insights.length > 0 && (
          <SectionCard title="Insights" items={insights} />
        )}
        <SectionCard title="Menu & Recipes" items={menuRecipes} />
        <SectionCard title="Inventory Setup" items={inventorySetup} />
        {locations.length > 0 && (
          <SectionCard title="Locations" items={locations} />
        )}
        {team.length > 0 && (
          <SectionCard title="Team" items={team} />
        )}
        {integrations.length > 0 && (
          <SectionCard title="Integrations" items={integrations} />
        )}
        {company.length > 0 && (
          <SectionCard title="Company" items={company} />
        )}
        {platformAdmin.length > 0 && (
          <SectionCard title="Platform Administration" items={platformAdmin} />
        )}
      </div>
    </div>
  );
}
