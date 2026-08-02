import { Link } from "wouter";
import { FileBarChart2, Package, ShoppingCart, CalendarClock, ChevronRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

const REPORT_CARDS = [
  {
    type: "recipe_cost",
    icon: FileBarChart2,
    title: "Recipe Cost",
    description: "View computed cost, yield, and cost-per-unit for every active recipe.",
    color: "text-amber-500",
    bg: "bg-amber-50 dark:bg-amber-950/30",
  },
  {
    type: "inventory_value",
    icon: Package,
    title: "Inventory Value",
    description: "See on-hand quantities multiplied by unit cost across one or all locations.",
    color: "text-emerald-500",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
  },
  {
    type: "purchase_activity",
    icon: ShoppingCart,
    title: "Purchase Activity",
    description: "Review completed receipts with vendor totals filtered by location and date.",
    color: "text-blue-500",
    bg: "bg-blue-50 dark:bg-blue-950/30",
  },
] as const;

const MANAGER_ROLES = ["store_manager", "company_admin", "global_admin"];

export default function ReportsHub() {
  const { user } = useAuth();
  const isManager = MANAGER_ROLES.includes(user?.role ?? "");

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="text-muted-foreground mt-1">Run, export, and schedule operational reports.</p>
        </div>
        {isManager && (
          <Link href="/reports/scheduled">
            <Button variant="outline" className="gap-2">
              <CalendarClock className="h-4 w-4" />
              Scheduled Reports
            </Button>
          </Link>
        )}
      </div>

      {/* Report type cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        {REPORT_CARDS.map(({ type, icon: Icon, title, description, color, bg }) => (
          <Link key={type} href={`/reports/view?type=${type}`}>
            <Card className="group cursor-pointer hover:shadow-md transition-shadow h-full">
              <CardHeader className="pb-3">
                <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center mb-3`}>
                  <Icon className={`h-5 w-5 ${color}`} />
                </div>
                <CardTitle className="text-base">{title}</CardTitle>
                <CardDescription className="text-sm">{description}</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <span className="text-sm font-medium text-primary inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                  Run report <ChevronRight className="h-3.5 w-3.5" />
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Scheduled reports promo for non-managers */}
      {!isManager && (
        <p className="text-sm text-muted-foreground">
          Managers can set up scheduled report delivery under <strong>Scheduled Reports</strong>.
        </p>
      )}
    </div>
  );
}
