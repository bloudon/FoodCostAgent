import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Building2, Store, FolderTree, Check, Plus, Upload, Users, Info, CheckCircle } from "lucide-react";
import { useOnboarding } from "@/pages/onboarding";
import { insertVendorSchema, type Vendor } from "@shared/schema";

// Company Setup Form Schema (includes user credentials for signup)
const companyFormSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  name: z.string().min(1, "Company name is required"),
  legalName: z.string().optional(),
  contactEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  posProvider: z.enum(['thrive', 'toast', 'hungerrush', 'clover', 'other', 'none']).optional(),
  tccAccountId: z.string().optional(),
}).refine(
  (data) => {
    // If Thrive POS is selected, TCC ID is required and must be a valid UUID
    if (data.posProvider === 'thrive') {
      if (!data.tccAccountId || data.tccAccountId.trim() === '') {
        return false;
      }
      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      return uuidRegex.test(data.tccAccountId);
    }
    return true;
  },
  {
    message: "TCC Account ID is required and must be a valid UUID for Thrive POS users",
    path: ["tccAccountId"],
  }
);

type CompanyFormValues = z.infer<typeof companyFormSchema>;

export function CompanySetupStep({ onComplete }: { onComplete: () => void }) {
  const { wizardData, updateWizardData } = useOnboarding();
  const { toast } = useToast();

  const form = useForm<CompanyFormValues>({
    resolver: zodResolver(companyFormSchema),
    defaultValues: wizardData.company || {
      email: "",
      password: "",
      name: "",
      legalName: "",
      contactEmail: "",
      phone: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      state: "",
      postalCode: "",
      posProvider: undefined,
      tccAccountId: "",
    },
  });

  // Watch posProvider field to conditionally show TCC ID
  const posProvider = form.watch("posProvider");

  const onSubmit = async (data: CompanyFormValues) => {
    // Normalize empty strings to undefined for optional fields
    const normalizedData = {
      ...data,
      tccAccountId: data.tccAccountId?.trim() || undefined,
      posProvider: data.posProvider || undefined,
    };
    
    // Just save to wizard context - no API call yet
    // The signup API will be called in the Store Setup step
    updateWizardData("company", normalizedData);
    
    toast({
      title: "Company information saved",
      description: "Proceed to add your first store location.",
    });
    
    // Move to next step
    onComplete();
  };

  return (
    <div data-testid="step-company">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Building2 className="w-6 h-6 text-primary" />
          <h2 className="text-2xl font-bold">Company Information</h2>
        </div>
        <p className="text-muted-foreground">
          Tell us about your restaurant business. This information will appear on reports and documents.
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* User Account Section */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Create Your Account</h3>
            <div className="grid gap-6 md:grid-cols-2">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Email Address *</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="your@email.com" {...field} data-testid="input-email" />
                    </FormControl>
                    <FormDescription className="text-xs">
                      This will be your login email
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Password *</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="At least 6 characters" {...field} data-testid="input-password" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          {/* Company Information Section */}
          <div className="space-y-4 pt-4 border-t">
            <h3 className="text-lg font-semibold">Company Information</h3>
            <div className="grid gap-6 md:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Company Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Joe's Pizza" {...field} data-testid="input-company-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

            <FormField
              control={form.control}
              name="legalName"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Legal Name (Optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Joe's Pizza LLC" {...field} data-testid="input-legal-name" />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Official legal business name (if different from company name)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="posProvider"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>POS System Provider</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-pos-provider">
                        <SelectValue placeholder="Select your POS system (optional)" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="thrive">Thrive POS (The Chef's Companion)</SelectItem>
                      <SelectItem value="toast">Toast POS</SelectItem>
                      <SelectItem value="hungerrush">HungerRush</SelectItem>
                      <SelectItem value="clover">Clover</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                      <SelectItem value="none">No POS System</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription className="text-xs">
                    Select your point-of-sale system for menu and sales integration
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {posProvider === 'thrive' && (
              <FormField
                control={form.control}
                name="tccAccountId"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>TCC Account ID *</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" 
                        {...field} 
                        data-testid="input-tcc-account-id" 
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Your Thrive POS (The Chef's Companion) account identifier
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="contactEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contact Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="contact@joespizza.com" {...field} data-testid="input-contact-email" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input placeholder="(555) 123-4567" {...field} data-testid="input-phone" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="addressLine1"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Input placeholder="123 Main Street" {...field} data-testid="input-address-line1" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="addressLine2"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Address Line 2</FormLabel>
                  <FormControl>
                    <Input placeholder="Suite 100 (optional)" {...field} data-testid="input-address-line2" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="city"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>City</FormLabel>
                  <FormControl>
                    <Input placeholder="New York" {...field} data-testid="input-city" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="state"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>State</FormLabel>
                  <FormControl>
                    <Input placeholder="NY" {...field} data-testid="input-state" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="postalCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Postal Code</FormLabel>
                  <FormControl>
                    <Input placeholder="10001" {...field} data-testid="input-postal-code" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <Button type="submit" data-testid="button-save-company">
              Continue
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

// Store Setup Form Schema
const storeFormSchema = z.object({
  code: z.string().min(1, "Store code is required"),
  name: z.string().min(1, "Store name is required"),
  phone: z.string().optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
});

type StoreFormValues = z.infer<typeof storeFormSchema>;

export function StoreSetupStep({ onComplete }: { onComplete: () => void }) {
  const { wizardData, updateWizardData } = useOnboarding();
  const { refreshAuth } = useAuth();
  const { toast } = useToast();

  const form = useForm<StoreFormValues>({
    resolver: zodResolver(storeFormSchema),
    defaultValues: wizardData.store || {
      code: "S001",
      name: "",
      phone: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      state: "",
      postalCode: "",
    },
  });

  const createStoreMutation = useMutation({
    mutationFn: async (data: StoreFormValues) => {
      // Get company data (including email/password) from wizard
      const companyData = wizardData.company;
      if (!companyData?.email || !companyData?.password) {
        throw new Error("Company information is incomplete. Please go back and complete the company setup.");
      }

      // Call the combined signup endpoint
      const response = await apiRequest("POST", "/api/onboarding/signup", {
        email: companyData.email,
        password: companyData.password,
        company: {
          name: companyData.name,
          legalName: companyData.legalName,
          contactEmail: companyData.contactEmail,
          phone: companyData.phone,
          addressLine1: companyData.addressLine1,
          addressLine2: companyData.addressLine2,
          city: companyData.city,
          state: companyData.state,
          postalCode: companyData.postalCode,
        },
        store: data,
      });
      
      // Check for HTTP errors
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Failed to create account" }));
        throw new Error(errorData.error || errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    },
    onSuccess: async (result) => {
      // Save company and store data to wizard context
      updateWizardData("company", result.company);
      updateWizardData("store", result.store);
      updateWizardData("user", result.user);
      
      // Refresh auth context to recognize the new session before navigating to protected routes
      await refreshAuth();
      
      toast({
        title: "Account created successfully!",
        description: "Welcome to FnBcostpro! Your account has been created and you're now logged in.",
      });
      
      // Move to next step
      onComplete();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Error creating account",
        description: error.message || "Failed to create your account. Please try again.",
      });
    },
  });

  const onSubmit = async (data: StoreFormValues) => {
    createStoreMutation.mutate(data);
  };

  return (
    <div data-testid="step-stores">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Store className="w-6 h-6 text-primary" />
          <h2 className="text-2xl font-bold">Store Location</h2>
        </div>
        <p className="text-muted-foreground">
          Add your first store location. You can add more stores later from the Settings page.
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Store Code *</FormLabel>
                  <FormControl>
                    <Input placeholder="S001" {...field} data-testid="input-store-code" />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Unique identifier for this store
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Store Name *</FormLabel>
                  <FormControl>
                    <Input placeholder="Downtown Location" {...field} data-testid="input-store-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input placeholder="(555) 123-4567" {...field} data-testid="input-store-phone" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="addressLine1"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Input placeholder="456 Downtown Blvd" {...field} data-testid="input-store-address-line1" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="addressLine2"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Address Line 2</FormLabel>
                  <FormControl>
                    <Input placeholder="Suite 200 (optional)" {...field} data-testid="input-store-address-line2" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="city"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>City</FormLabel>
                  <FormControl>
                    <Input placeholder="New York" {...field} data-testid="input-store-city" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="state"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>State</FormLabel>
                  <FormControl>
                    <Input placeholder="NY" {...field} data-testid="input-store-state" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="postalCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Postal Code</FormLabel>
                  <FormControl>
                    <Input placeholder="10001" {...field} data-testid="input-store-postal-code" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="flex justify-end pt-4">
            <Button type="submit" disabled={createStoreMutation.isPending} data-testid="button-save-store">
              {createStoreMutation.isPending ? "Creating..." : "Continue"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

// Categories Review Step (read-only display of default categories)
export function CategoriesReviewStep({ onComplete }: { onComplete: () => void }) {
  const DEFAULT_CATEGORIES = [
    { name: "Frozen", description: "Frozen foods and ingredients" },
    { name: "Walk-In", description: "Refrigerated items in walk-in cooler" },
    { name: "Dry/Pantry", description: "Dry goods and pantry items" },
  ];

  return (
    <div data-testid="step-categories">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <FolderTree className="w-6 h-6 text-primary" />
          <h2 className="text-2xl font-bold">Inventory Categories</h2>
        </div>
        <p className="text-muted-foreground">
          Your company starts with three default categories to organize inventory. You can customize these later.
        </p>
      </div>

      <div className="space-y-3 mb-8">
        {DEFAULT_CATEGORIES.map((category, index) => (
          <Card key={index} className="bg-muted/30" data-testid={`category-card-${index}`}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Check className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">{category.name}</CardTitle>
                  <CardDescription className="text-sm">{category.description}</CardDescription>
                </div>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground">
        <p>
          <strong>Note:</strong> These categories will be automatically created when you complete the setup.
          You can add, rename, or remove categories later from the Settings page.
        </p>
      </div>

      <div className="flex justify-end pt-6">
        <Button onClick={onComplete} data-testid="button-continue-categories">
          Continue
        </Button>
      </div>
    </div>
  );
}

// Vendor form schema for onboarding (simplified)
const onboardingVendorFormSchema = insertVendorSchema.omit({ companyId: true }).pick({
  name: true,
  accountNumber: true,
  phone: true,
  orderGuideType: true,
});
type OnboardingVendorFormData = z.infer<typeof onboardingVendorFormSchema>;

// Vendors & Order Guides Step (vendor management and CSV import)
export function VendorsOrderGuidesStep({ onComplete }: { onComplete: () => void }) {
  const { toast } = useToast();
  const [isVendorDialogOpen, setIsVendorDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [selectedVendorForImport, setSelectedVendorForImport] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [addedVendors, setAddedVendors] = useState<string[]>([]);

  // Fetch existing vendors
  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors"],
  });

  // Vendor form
  const vendorForm = useForm<OnboardingVendorFormData>({
    resolver: zodResolver(onboardingVendorFormSchema),
    defaultValues: {
      name: "",
      accountNumber: "",
      phone: "",
      orderGuideType: "manual",
    },
  });

  // Create vendor mutation
  const createVendorMutation = useMutation({
    mutationFn: async (data: OnboardingVendorFormData) => {
      return await apiRequest("POST", "/api/vendors", {
        ...data,
        active: 1,
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendors"] });
      setAddedVendors(prev => [...prev, variables.name]);
      toast({
        title: "Vendor Added",
        description: `${variables.name} has been added successfully.`,
      });
      setIsVendorDialogOpen(false);
      vendorForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Upload order guide mutation
  const uploadOrderGuideMutation = useMutation({
    mutationFn: async ({ csvContent, vendorId, fileName }: { csvContent: string; vendorId: string; fileName: string }) => {
      const vendor = vendors?.find(v => v.id === vendorId);
      let vendorKey = 'sysco';
      
      if (vendor) {
        const vendorName = vendor.name.toLowerCase();
        if (vendorName.includes('sysco')) vendorKey = 'sysco';
        else if (vendorName.includes('gfs') || vendorName.includes('gordon')) vendorKey = 'gfs';
        else if (vendorName.includes('us foods') || vendorName.includes('usfoods')) vendorKey = 'usfoods';
      }

      return apiRequest('POST', '/api/order-guides/upload', {
        csvContent,
        vendorKey,
        vendorId,
        fileName,
      });
    },
    onSuccess: (data: any) => {
      toast({
        title: 'Order Guide Uploaded',
        description: `${data.totalItems} items processed with ${data.highConfidenceMatches} auto-matched`,
      });
      setIsImportDialogOpen(false);
      setSelectedFile(null);
      setSelectedVendorForImport('');
      
      // Navigate to review page
      window.location.href = `/order-guides/${data.orderGuideId}/review`;
    },
    onError: (error: Error) => {
      toast({
        title: 'Upload Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleImportSubmit = async () => {
    if (!selectedFile || !selectedVendorForImport) {
      toast({
        title: 'Missing Information',
        description: 'Please select both a vendor and a CSV file',
        variant: 'destructive',
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const csvContent = e.target?.result as string;
      uploadOrderGuideMutation.mutate({
        csvContent,
        vendorId: selectedVendorForImport,
        fileName: selectedFile.name,
      });
    };
    reader.readAsText(selectedFile);
  };

  const onVendorSubmit = (data: OnboardingVendorFormData) => {
    createVendorMutation.mutate(data);
  };

  return (
    <div data-testid="step-vendors">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Building2 className="w-6 h-6 text-primary" />
          <h2 className="text-2xl font-bold">Vendors & Order Guides</h2>
        </div>
        <p className="text-muted-foreground">
          Add your vendors and import their order guides to quickly populate your inventory.
        </p>
      </div>

      {/* Show added vendors */}
      {addedVendors.length > 0 && (
        <Card className="mb-4 border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
              <CheckCircle className="w-5 h-5" />
              <span className="font-medium">Vendors Added: {addedVendors.join(", ")}</span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Getting Started</CardTitle>
          <CardDescription>
            You can add vendors manually or import order guides from Sysco, US Foods, or GFS.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="bg-muted/30 border-2">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-primary" />
                  <CardTitle className="text-base">Add Vendors</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  Manually add your vendors and configure delivery schedules.
                </p>
                <Button 
                  variant="outline" 
                  className="w-full" 
                  onClick={() => setIsVendorDialogOpen(true)}
                  data-testid="button-add-vendor"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Vendor
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-muted/30 border-2">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Upload className="w-5 h-5 text-primary" />
                  <CardTitle className="text-base">Import Order Guide</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  Upload a CSV order guide to auto-populate inventory items.
                </p>
                <Button 
                  variant="outline" 
                  className="w-full" 
                  onClick={() => setIsImportDialogOpen(true)}
                  data-testid="button-import-order-guide"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Upload CSV
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <div className="flex gap-3">
              <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-900 dark:text-blue-100">
                <p className="font-medium mb-1">Recommended: Import Order Guide</p>
                <p className="text-blue-700 dark:text-blue-300">
                  Importing an order guide from your distributor is the fastest way to set up your inventory.
                  Our smart matching system will automatically link products and create new inventory items.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end pt-6">
        <Button onClick={onComplete} data-testid="button-continue-vendors">
          Continue
        </Button>
      </div>

      {/* Add Vendor Dialog */}
      <Dialog open={isVendorDialogOpen} onOpenChange={setIsVendorDialogOpen}>
        <DialogContent data-testid="dialog-add-vendor">
          <DialogHeader>
            <DialogTitle>Add Vendor</DialogTitle>
            <DialogDescription>
              Add a new vendor to your system. You can add more details later.
            </DialogDescription>
          </DialogHeader>
          <Form {...vendorForm}>
            <form onSubmit={vendorForm.handleSubmit(onVendorSubmit)} className="space-y-4">
              <FormField
                control={vendorForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vendor Name *</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="e.g., Sysco, US Foods, Gordon Food Service" 
                        {...field} 
                        data-testid="input-vendor-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={vendorForm.control}
                name="accountNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Number</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Your account number" 
                        {...field}
                        value={field.value || ""}
                        data-testid="input-vendor-account"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={vendorForm.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ordering Phone</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="(555) 123-4567" 
                        {...field}
                        value={field.value || ""}
                        data-testid="input-vendor-phone"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setIsVendorDialogOpen(false)}
                  data-testid="button-cancel-vendor"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={createVendorMutation.isPending}
                  data-testid="button-save-vendor"
                >
                  {createVendorMutation.isPending ? "Adding..." : "Add Vendor"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Import Order Guide Dialog */}
      <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
        <DialogContent data-testid="dialog-import-order-guide">
          <DialogHeader>
            <DialogTitle>Import Order Guide</DialogTitle>
            <DialogDescription>
              Upload a CSV order guide from Sysco, US Foods, or GFS. The system will automatically match products to your inventory.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Vendor</label>
              {vendors && vendors.length > 0 ? (
                <Select value={selectedVendorForImport} onValueChange={setSelectedVendorForImport}>
                  <SelectTrigger data-testid="select-vendor-import">
                    <SelectValue placeholder="Choose a vendor" />
                  </SelectTrigger>
                  <SelectContent>
                    {vendors.filter(v => v.active === 1).map(vendor => (
                      <SelectItem key={vendor.id} value={vendor.id}>
                        {vendor.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="text-sm text-muted-foreground p-3 bg-muted rounded-md">
                  No vendors added yet. Please add a vendor first using the "Add Vendor" button.
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Upload CSV File</label>
              <Input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                data-testid="input-file-import"
              />
              {selectedFile && (
                <p className="text-sm text-muted-foreground">
                  Selected: {selectedFile.name}
                </p>
              )}
            </div>

            <div className="rounded-lg bg-muted p-4 space-y-2">
              <p className="text-sm font-medium">How it works:</p>
              <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
                <li>Products are automatically matched to your inventory items</li>
                <li>Review and approve the matched items</li>
                <li>Vendor items are created with current pricing</li>
              </ol>
            </div>
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setIsImportDialogOpen(false)}
              data-testid="button-cancel-import"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleImportSubmit}
              disabled={!selectedFile || !selectedVendorForImport || uploadOrderGuideMutation.isPending}
              data-testid="button-submit-import"
            >
              {uploadOrderGuideMutation.isPending ? 'Uploading...' : 'Upload & Review'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
