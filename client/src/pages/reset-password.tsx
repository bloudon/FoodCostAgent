import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, Eye, EyeOff, AlertCircle } from "lucide-react";
import logoImage from "@assets/FNB Cost Pro v1 (5)_1764694673097.png";

const schema = z.object({
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type FormValues = z.infer<typeof schema>;

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const token = params.get("token") || "";
  const { toast } = useToast();
  const [success, setSuccess] = useState(false);
  const [invalidToken, setInvalidToken] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const response = await apiRequest("POST", "/api/auth/reset-password", {
        token,
        password: values.password,
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Failed" }));
        if (response.status === 401) throw Object.assign(new Error(err.error), { invalid: true });
        throw new Error(err.error || "Failed to reset password");
      }
      return response.json();
    },
    onSuccess: () => {
      setSuccess(true);
    },
    onError: (error: any) => {
      if (error.invalid) {
        setInvalidToken(true);
      } else {
        toast({
          variant: "destructive",
          title: "Something went wrong",
          description: error.message || "Please try again.",
        });
      }
    },
  });

  const onSubmit = (values: FormValues) => mutation.mutate(values);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-4">
          <div className="flex justify-center">
            <img src={logoImage} alt="FNB Cost Pro" className="h-20 w-auto" />
          </div>
          <CardTitle>Set New Password</CardTitle>
          {!success && !invalidToken && (
            <CardDescription>Choose a new password for your account.</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {success ? (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <CheckCircle className="w-12 h-12 text-green-500" />
              <div>
                <p className="font-semibold text-foreground">Password updated!</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Your password has been changed successfully.
                </p>
              </div>
              <Button
                onClick={() => setLocation("/login")}
                className="mt-2"
                data-testid="button-go-to-login"
              >
                Sign In
              </Button>
            </div>
          ) : invalidToken ? (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <AlertCircle className="w-12 h-12 text-destructive" />
              <div>
                <p className="font-semibold text-foreground">Link expired or invalid</p>
                <p className="text-sm text-muted-foreground mt-1">
                  This reset link is no longer valid. Reset links expire after 1 hour.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => setLocation("/forgot-password")}
                data-testid="button-request-new-link"
              >
                Request a new link
              </Button>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>New Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            type={showPassword ? "text" : "password"}
                            placeholder="At least 6 characters"
                            {...field}
                            className="pr-10"
                            data-testid="input-password"
                          />
                          <button
                            type="button"
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            onClick={() => setShowPassword((v) => !v)}
                            tabIndex={-1}
                          >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm New Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            type={showConfirm ? "text" : "password"}
                            placeholder="Re-enter your password"
                            {...field}
                            className="pr-10"
                            data-testid="input-confirm-password"
                          />
                          <button
                            type="button"
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            onClick={() => setShowConfirm((v) => !v)}
                            tabIndex={-1}
                          >
                            {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={mutation.isPending}
                  data-testid="button-update-password"
                >
                  {mutation.isPending ? "Updating..." : "Update Password"}
                </Button>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
