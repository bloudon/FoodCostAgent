import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Company } from "@shared/schema";
import { Building2, ChevronRight, ImageIcon } from "lucide-react";
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
    <div className="bg-accent border-b border-accent-border px-4 py-2 flex items-center justify-between flex-wrap gap-1">
      <div className="flex items-center gap-2 min-w-0">
        <Badge variant="secondary" className="gap-1.5 bg-background/90 shrink-0">
          <Building2 className="h-3 w-3" />
          <span className="hidden sm:inline">Global Admin</span>
          <span className="sm:hidden">Admin</span>
        </Badge>
        {company && (
          <>
            <ChevronRight className="h-4 w-4 text-accent-foreground/70 shrink-0" />
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-medium text-accent-foreground truncate max-w-[110px] sm:max-w-none">{company.name}</span>
              <Badge variant="outline" className="text-xs border-accent-foreground/30 hidden sm:inline-flex shrink-0">
                {company.code || company.id.slice(0, 8)}
              </Badge>
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/admin/backgrounds")}
          className="gap-1.5"
          data-testid="button-admin-backgrounds"
        >
          <ImageIcon className="h-4 w-4" />
          <span className="hidden sm:inline">Backgrounds</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBackToCompanies}
          className="gap-1.5"
          data-testid="button-back-to-companies"
        >
          <Building2 className="h-4 w-4" />
          <span className="hidden sm:inline">All Companies</span>
        </Button>
      </div>
    </div>
  );
}
