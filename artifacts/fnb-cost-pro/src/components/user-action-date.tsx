import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateString } from "@/lib/utils";

interface UserActionDateProps {
  date: string | Date | null | undefined;
  actionLabel?: string;
  userName?: string | null;
  className?: string;
  showDateOnly?: boolean;
}

export function UserActionDate({ 
  date, 
  actionLabel = "Action", 
  userName, 
  className = "",
  showDateOnly = false
}: UserActionDateProps) {
  if (!date) {
    return <span className={className}>-</span>;
  }

  const dateStr = typeof date === 'string' ? date : date.toISOString();
  const formattedDate = formatDateString(dateStr);
  const displayName = userName || "System";
  const tooltipText = `${actionLabel} by ${displayName}`;

  if (showDateOnly && !userName) {
    return <span className={className}>{formattedDate}</span>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span 
          className={`cursor-help border-b border-dotted border-muted-foreground/50 ${className}`}
          data-testid={`date-${actionLabel.toLowerCase().replace(/\s+/g, '-')}`}
        >
          {formattedDate}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-sm">{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  );
}
