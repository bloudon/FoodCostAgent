import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCompany } from "@/hooks/use-company";

interface CostingMethodBadgeProps {
  className?: string;
}

export function CostingMethodBadge({ className }: CostingMethodBadgeProps) {
  const { company } = useCompany();

  if (!company) return null;

  const method = company.costingMethod ?? "last_cost";
  const label = method === "weighted_average" ? "WAC" : "Last Cost";
  const tooltip =
    method === "weighted_average"
      ? "This number is calculated using Weighted Average Cost. Click to change."
      : "This number is calculated using Last Cost. Click to change.";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href="/settings">
          <Badge
            variant="outline"
            className={className}
            data-testid="badge-costing-method"
          >
            {label}
          </Badge>
        </Link>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
