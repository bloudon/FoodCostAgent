import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Store } from "lucide-react";
const logoImage = "/logo.png";

const storeSchema = z.object({
  code: z.string().min(1, "Store code is required"),
  name: z.string().min(1, "Store name is required"),
});

type StoreFormValues = z.infer<typeof storeSchema>;

export default function Onboarding() {
  const [, navigate] = useLocation();
  const { refreshAuth } = useAuth();
  const { toast } = useToast();

  const form = useForm<StoreFormValues>({
    resolver: zodResolver(storeSchema),
    defaultValues: {
      code: "S001",
      name: "",
    },
  });

  const createStoreMutation = useMutation({
    mutationFn: async (data: StoreFormValues) => {
      const response = await apiRequest("POST", "/api/onboarding/store", data);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Failed to create store" }));
        throw new Error(errorData.error || errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    },
    onSuccess: async () => {
      await refreshAuth();
      toast({
        title: "You're all set!",
        description: "Your store has been created. Welcome to FNB Cost Pro.",
      });
      navigate("/");
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Error creating store",
        description: error.message || "Failed to create your store. Please try again.",
      });
    },
  });

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center mb-8">
          <img
            src={logoImage}
            alt="FNB Cost Pro"
            className="h-16 w-auto"
          />
        </div>

        <Card>
          <CardContent className="p-6 md:p-8">
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <Store className="w-5 h-5 text-primary" />
                <h2 className="text-xl font-bold" data-testid="text-onboarding-title">Name Your First Store</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Give your first location a name and code. You can add more stores and details later.
              </p>
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => createStoreMutation.mutate(data))} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Store Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Downtown Location" {...field} autoFocus data-testid="input-store-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

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
                        A short identifier for this store
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full"
                  disabled={createStoreMutation.isPending}
                  data-testid="button-save-store"
                >
                  {createStoreMutation.isPending ? "Setting up..." : "Get Started"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
