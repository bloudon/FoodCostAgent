import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Company } from "@shared/schema";
import { Building2, MapPin, Store } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function Companies() {
  const [, setLocation] = useLocation();

  const { data: companies, isLoading } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-lg">Loading companies...</div>
      </div>
    );
  }

  const handleSelectCompany = (companyId: string) => {
    // Store selected company in localStorage
    localStorage.setItem("selectedCompanyId", companyId);
    // Redirect to dashboard
    setLocation("/");
    // Reload to apply company filter
    window.location.reload();
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2" data-testid="text-page-title">Companies</h1>
        <p className="text-muted-foreground">
          Select a company to view and manage its data
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {companies?.map((company) => (
          <Card
            key={company.id}
            className="hover-elevate cursor-pointer transition-all"
            onClick={() => handleSelectCompany(company.id)}
            data-testid={`card-company-${company.id}`}
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  <CardTitle className="text-lg">{company.name}</CardTitle>
                </div>
                <Badge variant={company.status === "active" ? "default" : "secondary"}>
                  {company.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {company.addressLine1 && (
                <div className="flex items-start gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div className="text-muted-foreground">
                    <div>{company.addressLine1}</div>
                    {company.addressLine2 && <div>{company.addressLine2}</div>}
                    <div>
                      {company.city && `${company.city}, `}
                      {company.state} {company.postalCode}
                    </div>
                  </div>
                </div>
              )}
              
              <div className="flex items-center gap-2 pt-2">
                <Store className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  View stores and data
                </span>
              </div>

              <Button 
                className="w-full mt-2" 
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelectCompany(company.id);
                }}
                data-testid={`button-select-company-${company.id}`}
              >
                Select Company
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {companies?.length === 0 && (
        <div className="text-center py-12">
          <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No companies found</h3>
          <p className="text-muted-foreground">
            No companies have been created yet.
          </p>
        </div>
      )}
    </div>
  );
}
