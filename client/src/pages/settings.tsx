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

export default function Settings() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("company");

  // Placeholder for future API calls
  const companyInfo = {
    name: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    phone: "",
    email: "",
  };

  const systemPreferences = {
    weightUnit: "pound",
    currency: "USD",
    timezone: "America/New_York",
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
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="company-name">Company Name</Label>
                  <Input
                    id="company-name"
                    placeholder="Your Restaurant Name"
                    defaultValue={companyInfo.name}
                    data-testid="input-company-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company-phone">Phone Number</Label>
                  <Input
                    id="company-phone"
                    type="tel"
                    placeholder="(555) 123-4567"
                    defaultValue={companyInfo.phone}
                    data-testid="input-company-phone"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="company-address">Street Address</Label>
                <Input
                  id="company-address"
                  placeholder="123 Main Street"
                  defaultValue={companyInfo.address}
                  data-testid="input-company-address"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="company-city">City</Label>
                  <Input
                    id="company-city"
                    placeholder="City"
                    defaultValue={companyInfo.city}
                    data-testid="input-company-city"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company-state">State</Label>
                  <Input
                    id="company-state"
                    placeholder="State"
                    defaultValue={companyInfo.state}
                    data-testid="input-company-state"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company-zip">ZIP Code</Label>
                  <Input
                    id="company-zip"
                    placeholder="12345"
                    defaultValue={companyInfo.zip}
                    data-testid="input-company-zip"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="company-email">Email Address</Label>
                <Input
                  id="company-email"
                  type="email"
                  placeholder="info@restaurant.com"
                  defaultValue={companyInfo.email}
                  data-testid="input-company-email"
                />
              </div>

              <Separator />
              
              <div className="flex justify-end">
                <Button data-testid="button-save-company">
                  Save Company Information
                </Button>
              </div>
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
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pos-system">POS System</Label>
                <Select defaultValue="none">
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
                  type="password"
                  placeholder="Enter API key"
                  data-testid="input-pos-api-key"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pos-webhook">Webhook URL</Label>
                <Input
                  id="pos-webhook"
                  placeholder="https://your-app.com/webhook/pos"
                  data-testid="input-pos-webhook"
                  readOnly
                />
                <p className="text-xs text-muted-foreground">
                  Configure this URL in your POS system to receive real-time sales data
                </p>
              </div>

              <Separator />
              
              <div className="flex justify-end gap-2">
                <Button variant="outline" data-testid="button-test-connection">
                  Test Connection
                </Button>
                <Button data-testid="button-save-pos">
                  Save POS Settings
                </Button>
              </div>
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
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="weight-unit">Weight Unit System</Label>
                <Select defaultValue={systemPreferences.weightUnit}>
                  <SelectTrigger id="weight-unit" data-testid="select-weight-unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pound">Pounds (lb)</SelectItem>
                    <SelectItem value="kilogram">Kilograms (kg)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Choose your preferred weight unit for inventory and recipes
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="currency">Currency</Label>
                <Select defaultValue={systemPreferences.currency}>
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
                <Select defaultValue={systemPreferences.timezone}>
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
                <Button data-testid="button-save-preferences">
                  Save Preferences
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
