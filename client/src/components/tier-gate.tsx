import { type ReactNode } from "react";
import { useTier } from "@/hooks/use-tier";
import type { Feature } from "@shared/tier-config";
import { Card, CardContent } from "@/components/ui/card";
import { Lock } from "lucide-react";

type TierGateProps = {
  feature?: Feature;
  children: ReactNode;
  fallback?: ReactNode;
};

export function TierGate({ feature, children, fallback }: TierGateProps) {
  const { hasFeature, isGlobalAdmin, subscriptionPlan } = useTier();

  if (isGlobalAdmin) return <>{children}</>;

  // If no feature specified, gate on having any active paid plan
  const allowed = feature ? hasFeature(feature) : !!subscriptionPlan;

  if (allowed) return <>{children}</>;

  if (fallback) return <>{fallback}</>;

  return <UpgradePrompt />;
}

function UpgradePrompt() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6 text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold" data-testid="text-upgrade-title">
            Feature Not Available
          </h2>
          <p className="text-muted-foreground" data-testid="text-upgrade-description">
            This feature is not included in your current plan.
            Contact your administrator for more information.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
