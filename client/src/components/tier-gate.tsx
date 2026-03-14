import { type ReactNode } from "react";
import { useTier } from "@/hooks/use-tier";
import { type Tier, type Feature, featureMinTier, TIER_LABELS } from "@shared/tier-config";
import { Card, CardContent } from "@/components/ui/card";
import { Lock } from "lucide-react";

type TierGateProps = {
  feature?: Feature;
  minTier?: Tier;
  children: ReactNode;
  fallback?: ReactNode;
};

export function TierGate({ feature, minTier, children, fallback }: TierGateProps) {
  const { hasFeature, meetsMinimum, isGlobalAdmin } = useTier();

  if (isGlobalAdmin) return <>{children}</>;

  const required = minTier || (feature ? featureMinTier(feature) : "free");
  const allowed = feature ? hasFeature(feature) : meetsMinimum(required);

  if (allowed) return <>{children}</>;

  if (fallback) return <>{fallback}</>;

  return <UpgradePrompt requiredTier={required} />;
}

function UpgradePrompt({ requiredTier }: { requiredTier: Tier }) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6 text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold" data-testid="text-upgrade-title">
            {TIER_LABELS[requiredTier]} Plan Required
          </h2>
          <p className="text-muted-foreground" data-testid="text-upgrade-description">
            This feature is available on the {TIER_LABELS[requiredTier]} plan and above.
            Contact your administrator to upgrade your subscription.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
