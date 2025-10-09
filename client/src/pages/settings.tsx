import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, User, Plug, Settings as SettingsIcon } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { CompanySettings, SystemPreferences } from "@shared/schema";

export default function Settings() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("company");

  const { data: companySettings, isLoading: companyLoading } = useQuery<CompanySettings>({
    queryKey: ["/api/company-settings"],
  });

  const { data: systemPrefs, isLoading: prefsLoading } = useQuery<SystemPreferences>({
    queryKey: ["/api/system-preferences"],
  });

  const updateCompanyMutation = useMutation({
    mutationFn: async (data: Partial<CompanySettings>) => {
      return await apiRequest("PATCH", "/api/company-settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
      toast({
        title: "Success",
        description: "Company information updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update company information",
        variant: "destructive",
      });
    },
  });

  const updatePrefsMutation = useMutation({
    mutationFn: async (data: Partial<SystemPreferences>) => {
      return await apiRequest("PATCH", "/api/system-preferences", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-preferences"] });
      toast({
        title: "Success",
        description: "System preferences updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update system preferences",
        variant: "destructive",
      });
    },
  });

  const handleCompanySave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get("company-name") as string,
      address: formData.get("company-address") as string,
      city: formData.get("company-city") as string,
      state: formData.get("company-state") as string,
      zip: formData.get("company-zip") as string,
      phone: formData.get("company-phone") as string,
      email: formData.get("company-email") as string,
    };
    updateCompanyMutation.mutate(data);
  };

  const handlePrefsSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      unitSystem: formData.get("unit-system") as string,
      currency: formData.get("currency") as string,
      timezone: formData.get("timezone") as string,
      posSystem: formData.get("pos-system") as string,
      posApiKey: formData.get("pos-api-key") as string,
    };
    updatePrefsMutation.mutate(data);
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-settings-title">
          Settings
        </h1>
        <p className="text-muted-foreground mt-2">
          Manage your company information, user profile, and system preferences
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 max-w-2xl">
          <TabsTrigger value="company" data-testid="tab-company">
            <Building2 className="h-4 w-4 mr-2" />
            Company
          </TabsTrigger>
          <TabsTrigger value="user" data-testid="tab-user">
            <User className="h-4 w-4 mr-2" />
            User Profile
          </TabsTrigger>
          <TabsTrigger value="connections" data-testid="tab-connections">
            <Plug className="h-4 w-4 mr-2" />
            Data Connections
          </TabsTrigger>
          <TabsTrigger value="preferences" data-testid="tab-preferences">
            <SettingsIcon className="h-4 w-4 mr-2" />
            Preferences
          </TabsTrigger>
        </TabsList>

        <TabsContent value="company" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Company Information</CardTitle>
              <CardDescription>
                Basic information about your restaurant or business
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCompanySave} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="company-name">Company Name</Label>
                    <Input
                      id="company-name"
                      name="company-name"
                      placeholder="Your Restaurant Name"
                      defaultValue={companySettings?.name || ""}
                      data-testid="input-company-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="company-phone">Phone Number</Label>
                    <Input
                      id="company-phone"
                      name="company-phone"
                      type="tel"
                      placeholder="(555) 123-4567"
                      defaultValue={companySettings?.phone || ""}
                      data-testid="input-company-phone"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="company-address">Street Address</Label>
                  <Input
                    id="company-address"
                    name="company-address"
                    placeholder="123 Main Street"
                    defaultValue={companySettings?.address || ""}
                    data-testid="input-company-address"
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="company-city">City</Label>
                    <Input
                      id="company-city"
                      name="company-city"
                      placeholder="City"
                      defaultValue={companySettings?.city || ""}
                      data-testid="input-company-city"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="company-state">State</Label>
                    <Input
                      id="company-state"
                      name="company-state"
                      placeholder="State"
                      defaultValue={companySettings?.state || ""}
                      data-testid="input-company-state"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="company-zip">ZIP Code</Label>
                    <Input
                      id="company-zip"
                      name="company-zip"
                      placeholder="12345"
                      defaultValue={companySettings?.zip || ""}
                      data-testid="input-company-zip"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="company-email">Email Address</Label>
                  <Input
                    id="company-email"
                    name="company-email"
                    type="email"
                    placeholder="info@restaurant.com"
                    defaultValue={companySettings?.email || ""}
                    data-testid="input-company-email"
                  />
                </div>

                <Separator />
                
                <div className="flex justify-end">
                  <Button 
                    type="submit" 
                    data-testid="button-save-company"
                    disabled={updateCompanyMutation.isPending}
                  >
                    {updateCompanyMutation.isPending ? "Saving..." : "Save Company Information"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="user" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>User Profile</CardTitle>
              <CardDescription>
                Your personal information and account settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="user-name">Full Name</Label>
                  <Input
                    id="user-name"
                    placeholder="John Doe"
                    data-testid="input-user-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="user-email">Email</Label>
                  <Input
                    id="user-email"
                    type="email"
                    placeholder="john@restaurant.com"
                    data-testid="input-user-email"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="user-role">Role</Label>
                <Select defaultValue="admin">
                  <SelectTrigger id="user-role" data-testid="select-user-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Administrator</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="counter">Counter Staff</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Separator />
              
              <div className="flex justify-end">
                <Button data-testid="button-save-user">
                  Save User Profile
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="connections" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>POS System Integration</CardTitle>
              <CardDescription>
                Configure your point-of-sale system connection for real-time sales data
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handlePrefsSave} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="pos-system">POS System</Label>
                  <Select name="pos-system" defaultValue={systemPrefs?.posSystem || "none"}>
                    <SelectTrigger id="pos-system" data-testid="select-pos-system">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None (Manual Entry)</SelectItem>
                      <SelectItem value="square">Square</SelectItem>
                      <SelectItem value="toast">Toast</SelectItem>
                      <SelectItem value="clover">Clover</SelectItem>
                      <SelectItem value="custom">Custom API</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pos-api-key">API Key</Label>
                  <Input
                    id="pos-api-key"
                    name="pos-api-key"
                    type="password"
                    placeholder="Enter API key"
                    defaultValue={systemPrefs?.posApiKey || ""}
                    data-testid="input-pos-api-key"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pos-webhook">Webhook URL</Label>
                  <Input
                    id="pos-webhook"
                    placeholder="wss://your-app.com/ws/pos"
                    defaultValue={systemPrefs?.posWebhookUrl || ""}
                    data-testid="input-pos-webhook"
                    readOnly
                  />
                  <p className="text-xs text-muted-foreground">
                    Configure this URL in your POS system to receive real-time sales data
                  </p>
                </div>

                <Separator />
                
                <div className="flex justify-end gap-2">
                  <Button 
                    type="button" 
                    variant="outline" 
                    data-testid="button-test-connection"
                  >
                    Test Connection
                  </Button>
                  <Button 
                    type="submit" 
                    data-testid="button-save-pos"
                    disabled={updatePrefsMutation.isPending}
                  >
                    {updatePrefsMutation.isPending ? "Saving..." : "Save POS Settings"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="preferences" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>System Preferences</CardTitle>
              <CardDescription>
                Configure your system settings and regional preferences
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handlePrefsSave} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="unit-system">Unit System</Label>
                  <Select name="unit-system" defaultValue={systemPrefs?.unitSystem || "imperial"}>
                    <SelectTrigger id="unit-system" data-testid="select-unit-system">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="imperial">Imperial (lb, oz, fl oz)</SelectItem>
                      <SelectItem value="metric">Metric (kg, g, ml, L)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Choose your preferred measurement system for inventory and recipes
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="currency">Currency</Label>
                  <Select name="currency" defaultValue={systemPrefs?.currency || "USD"}>
                    <SelectTrigger id="currency" data-testid="select-currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">US Dollar (USD)</SelectItem>
                      <SelectItem value="EUR">Euro (EUR)</SelectItem>
                      <SelectItem value="GBP">British Pound (GBP)</SelectItem>
                      <SelectItem value="CAD">Canadian Dollar (CAD)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="timezone">Timezone</Label>
                  <Select name="timezone" defaultValue={systemPrefs?.timezone || "America/New_York"}>
                    <SelectTrigger id="timezone" data-testid="select-timezone">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="America/New_York">Eastern Time</SelectItem>
                      <SelectItem value="America/Chicago">Central Time</SelectItem>
                      <SelectItem value="America/Denver">Mountain Time</SelectItem>
                      <SelectItem value="America/Los_Angeles">Pacific Time</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Separator />
                
                <div className="flex justify-end">
                  <Button 
                    type="submit" 
                    data-testid="button-save-preferences"
                    disabled={updatePrefsMutation.isPending}
                  >
                    {updatePrefsMutation.isPending ? "Saving..." : "Save Preferences"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
