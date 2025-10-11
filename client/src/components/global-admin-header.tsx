import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Company } from "@shared/schema";
import { Building2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function GlobalAdminHeader() {
  const [, setLocation] = useLocation();
  const selectedCompanyId = localStorage.getItem("selectedCompanyId");

  const { data: company } = useQuery<Company>({
    queryKey: ["/api/companies", selectedCompanyId],
    enabled: !!selectedCompanyId,
  });

  const handleBackToCompanies = () => {
    localStorage.removeItem("selectedCompanyId");
    setLocation("/companies");
    window.location.reload();
  };

  return (
    <div className="bg-primary/10 border-b px-4 py-2 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Badge variant="secondary" className="gap-1.5">
          <Building2 className="h-3 w-3" />
          Global Admin
        </Badge>
        {company && (
          <>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{company.name}</span>
              <Badge variant="outline" className="text-xs">
                {company.code || company.id.slice(0, 8)}
              </Badge>
            </div>
          </>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleBackToCompanies}
        className="gap-2"
        data-testid="button-back-to-companies"
      >
        <Building2 className="h-4 w-4" />
        All Companies
      </Button>
    </div>
  );
}
