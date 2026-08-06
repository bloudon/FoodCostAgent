import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Building, Check, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { RestaurantBackground } from "@/components/restaurant-background";
const logoImage = "/logo.png";

const inquirySchema = z.object({
  name: z.string().min(1, "Name is required"),
  company: z.string().min(1, "Company name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().min(1, "Phone number is required"),
  locationCount: z.string().min(1, "Number of locations is required"),
  message: z.string().optional(),
});

type InquiryFormValues = z.infer<typeof inquirySchema>;

const LOCATION_OPTIONS = [
  { value: "3-5", label: "3–5 locations" },
  { value: "6-10", label: "6–10 locations" },
  { value: "11-25", label: "11–25 locations" },
  { value: "26-50", label: "26–50 locations" },
  { value: "50+", label: "50+ locations" },
];

export default function EnterpriseInquiry() {
  const [, navigate] = useLocation();
  const [submitted, setSubmitted] = useState(false);

  const form = useForm<InquiryFormValues>({
    resolver: zodResolver(inquirySchema),
    defaultValues: {
      name: "",
      company: "",
      email: "",
      phone: "",
      locationCount: "",
      message: "",
    },
  });

  const onSubmit = (data: InquiryFormValues) => {
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="relative min-h-screen bg-background">
        <RestaurantBackground />
        <div className="relative z-10 max-w-lg mx-auto px-4 py-16 flex flex-col items-center">
          <img src={logoImage} alt="FNB Cost Pro" className="h-14 w-auto mb-8" />
          <div className="bg-card rounded-lg border overflow-hidden w-full">
            <div className="p-8 text-center space-y-4">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
                <Check className="h-7 w-7 text-green-600" />
              </div>
              <h1 className="text-2xl font-bold" data-testid="text-thank-you-title">Thank You!</h1>
              <p className="text-muted-foreground text-sm" data-testid="text-thank-you-message">
                We've received your inquiry. Our Enterprise team will reach out within 1 business day to discuss your needs and schedule an onboarding call.
              </p>
              <div className="pt-4 flex flex-col gap-3">
                <Button
                  data-testid="button-view-onboarding"
                  onClick={() => navigate("/enterprise-onboarding")}
                  variant="default"
                  className="w-full"
                >
                  See What's Next
                </Button>
                <Button
                  data-testid="button-back-home"
                  onClick={() => navigate("/")}
                  variant="outline"
                  className="w-full"
                >
                  Back to Home
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-background">
      <RestaurantBackground />
      <div className="relative z-10 max-w-lg mx-auto px-4 py-8">
        <div className="flex justify-center mb-8">
          <img src={logoImage} alt="FNB Cost Pro" className="h-14 w-auto" />
        </div>

        <div className="bg-card rounded-lg border overflow-hidden">
          <div className="p-6 md:p-8">
            <div className="flex items-center gap-2 mb-2">
              <Building className="w-5 h-5 text-muted-foreground" />
              <h1 className="text-xl font-bold" data-testid="text-inquiry-title">Enterprise Inquiry</h1>
            </div>
            <p className="text-sm text-muted-foreground mb-6">
              Tell us about your operation and we'll put together a custom plan for your organization.
            </p>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Name</FormLabel>
                      <FormControl>
                        <Input data-testid="input-name" placeholder="Jane Smith" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="company"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company Name</FormLabel>
                      <FormControl>
                        <Input data-testid="input-company" placeholder="Acme Restaurant Group" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input data-testid="input-email" type="email" placeholder="jane@example.com" {...field} />
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
                          <Input data-testid="input-phone" type="tel" placeholder="(555) 123-4567" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="locationCount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Number of Locations</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-location-count">
                            <SelectValue placeholder="Select range" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {LOCATION_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value} data-testid={`option-locations-${opt.value}`}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="message"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Message (optional)</FormLabel>
                      <FormControl>
                        <Textarea
                          data-testid="input-message"
                          placeholder="Tell us about your operation, current challenges, or specific needs..."
                          className="resize-none"
                          rows={4}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  data-testid="button-submit-inquiry"
                  className="w-full"
                  disabled={form.formState.isSubmitting}
                >
                  <Send className="w-4 h-4 mr-2" />
                  Submit Inquiry
                </Button>
              </form>
            </Form>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4">
          We typically respond within 1 business day.
        </p>
      </div>
    </div>
  );
}
