import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
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
import { Building2, Store, FolderTree, Check } from "lucide-react";
import { useOnboarding } from "@/pages/onboarding";

// Company Setup Form Schema
const companyFormSchema = z.object({
  name: z.string().min(1, "Company name is required"),
  legalName: z.string().optional(),
  contactEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
});

type CompanyFormValues = z.infer<typeof companyFormSchema>;

export function CompanySetupStep({ onComplete }: { onComplete: () => void }) {
  const { wizardData, updateWizardData } = useOnboarding();
  const { toast } = useToast();

  const form = useForm<CompanyFormValues>({
    resolver: zodResolver(companyFormSchema),
    defaultValues: wizardData.company || {
      name: "",
      legalName: "",
      contactEmail: "",
      phone: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      state: "",
      postalCode: "",
    },
  });

  const createCompanyMutation = useMutation({
    mutationFn: async (data: CompanyFormValues) => {
      const response = await apiRequest("POST", "/api/companies", data);
      
      // Check for HTTP errors
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Failed to create company" }));
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    },
    onSuccess: (company) => {
      // Save company data to wizard context
      updateWizardData("company", company);
      
      toast({
        title: "Company created",
        description: "Your company has been set up successfully.",
      });
      
      // Move to next step
      onComplete();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Error creating company",
        description: error.message || "Failed to create company. Please try again.",
      });
    },
  });

  const onSubmit = async (data: CompanyFormValues) => {
    createCompanyMutation.mutate(data);
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

          <div className="flex justify-end pt-4">
            <Button type="submit" disabled={createCompanyMutation.isPending} data-testid="button-save-company">
              {createCompanyMutation.isPending ? "Creating..." : "Continue"}
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
      // Get company ID from wizard data
      const companyId = wizardData.company?.id;
      if (!companyId) {
        throw new Error("Company must be created first");
      }

      const response = await apiRequest("POST", "/api/stores", { ...data, companyId });
      
      // Check for HTTP errors
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Failed to create store" }));
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    },
    onSuccess: (store) => {
      // Save store data to wizard context
      updateWizardData("store", store);
      
      toast({
        title: "Store created",
        description: "Your store location has been added successfully.",
      });
      
      // Move to next step
      onComplete();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Error creating store",
        description: error.message || "Failed to create store. Please try again.",
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
