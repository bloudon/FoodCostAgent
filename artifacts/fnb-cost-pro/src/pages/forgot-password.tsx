import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { MailCheck } from "lucide-react";
const logoImage = "/logo.png";
import { RestaurantBackground } from "@/components/restaurant-background";

const forgotPasswordSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Please enter a valid email address"),
});

type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPassword() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [submitted, setSubmitted] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");

  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const mutation = useMutation({
    mutationFn: async (email: string) => {
      const response = await apiRequest("POST", "/api/auth/forgot-password", { email });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Failed to send reset email");
      }
      return response.json();
    },
    onSuccess: () => {
      setSubmitted(true);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Something went wrong",
        description: error.message || "Please try again.",
      });
    },
  });

  function onSubmit(data: ForgotPasswordValues) {
    setSubmittedEmail(data.email);
    mutation.mutate(data.email);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <RestaurantBackground />
      <Card className="w-full max-w-md relative z-10">
        <CardHeader className="space-y-4">
          <div className="flex justify-center">
            <img src={logoImage} alt="FNB Cost Pro" className="h-20 w-auto" />
          </div>
          <CardTitle>Reset Your Password</CardTitle>
          <CardDescription>
            {submitted
              ? "Check your inbox for the reset link."
              : "Enter your account email and we'll send you a password reset link."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <MailCheck className="w-12 h-12 text-primary" />
              <p className="text-sm text-muted-foreground">
                If an account exists for <strong>{submittedEmail}</strong>, you'll receive a reset
                link shortly. Check your spam folder if it doesn't arrive within a few minutes.
              </p>
              <Button
                variant="outline"
                className="mt-2"
                onClick={() => setLocation("/login")}
                data-testid="button-back-to-login"
              >
                Back to Sign In
              </Button>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email address</FormLabel>
                      <FormControl>
                        <Input
                          type="text"
                          placeholder="you@example.com"
                          autoFocus
                          data-testid="input-email"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage data-testid="error-email" />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={mutation.isPending}
                  data-testid="button-send-reset"
                >
                  {mutation.isPending ? "Sending..." : "Send Reset Link"}
                </Button>
                <div className="text-center">
                  <button
                    type="button"
                    className="text-sm text-muted-foreground hover:underline cursor-pointer"
                    onClick={() => setLocation("/login")}
                    data-testid="link-back-to-login"
                  >
                    Back to Sign In
                  </button>
                </div>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
