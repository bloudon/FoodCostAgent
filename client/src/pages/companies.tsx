import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Company, InsertCompany, insertCompanySchema } from "@shared/schema";
import { Building2, MapPin, Store, Plus, Settings2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

export default function Companies() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isNewCompanyDialogOpen, setIsNewCompanyDialogOpen] = useState(false);

  const { data: companies, isLoading } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const form = useForm<InsertCompany>({
    resolver: zodResolver(insertCompanySchema),
    defaultValues: {
      name: "",
      status: "active",
      country: "US",
      timezone: "America/New_York",
    },
  });

  const createCompanyMutation = useMutation({
    mutationFn: async (data: InsertCompany) => {
      const response = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      setIsNewCompanyDialogOpen(false);
      form.reset();
      toast({ title: "Company created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create company", description: error.message, variant: "destructive" });
    },
  });

  const handleCreateCompany = (data: InsertCompany) => {
    createCompanyMutation.mutate(data);
  };

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
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2" data-testid="text-page-title">Companies</h1>
          <p className="text-muted-foreground">
            Select a company to view and manage its data
          </p>
        </div>
        <Dialog open={isNewCompanyDialogOpen} onOpenChange={setIsNewCompanyDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-company">
              <Plus className="h-4 w-4 mr-2" />
              New Company
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Company</DialogTitle>
              <DialogDescription>Add a new company to the system</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleCreateCompany)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company Name</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Pizza Paradise Inc." data-testid="input-new-company-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="legalName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Legal Name (Optional)</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} data-testid="input-new-legal-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="contactEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Email (Optional)</FormLabel>
                      <FormControl>
                        <Input {...field} type="email" value={field.value || ""} data-testid="input-new-contact-email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="timezone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Timezone</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-new-timezone">
                            <SelectValue placeholder="Select timezone" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="America/New_York">Eastern Time</SelectItem>
                          <SelectItem value="America/Chicago">Central Time</SelectItem>
                          <SelectItem value="America/Denver">Mountain Time</SelectItem>
                          <SelectItem value="America/Los_Angeles">Pacific Time</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsNewCompanyDialogOpen(false)}
                    data-testid="button-cancel-new-company"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createCompanyMutation.isPending} data-testid="button-save-new-company">
                    {createCompanyMutation.isPending ? "Creating..." : "Create Company"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {companies?.map((company) => (
          <Card
            key={company.id}
            className="hover-elevate transition-all"
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

              <div className="flex gap-2 mt-2">
                <Button 
                  className="flex-1" 
                  size="sm"
                  onClick={() => handleSelectCompany(company.id)}
                  data-testid={`button-select-company-${company.id}`}
                >
                  Select Company
                </Button>
                <Button 
                  variant="outline"
                  size="sm"
                  onClick={() => setLocation(`/companies/${company.id}`)}
                  data-testid={`button-manage-company-${company.id}`}
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              </div>
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
