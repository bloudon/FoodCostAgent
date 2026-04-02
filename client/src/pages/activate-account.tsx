import { useState, useMemo, useRef, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Eye, EyeOff } from "lucide-react";
const logoImage = "/logo.png";

const activateSchema = z.object({
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type ActivateValues = z.infer<typeof activateSchema>;

export default function ActivateAccount() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const { refreshAuth } = useAuth();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Two-step state
  const [step, setStep] = useState<"otp" | "password">("otp");
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([null, null, null, null, null, null]);

  const emailFromUrl = useMemo(() => {
    const params = new URLSearchParams(searchString);
    return params.get("email") || "";
  }, [searchString]);

  const variantFromUrl = useMemo(() => {
    const params = new URLSearchParams(searchString);
    return params.get("v") || "";
  }, [searchString]);

  const form = useForm<ActivateValues>({
    resolver: zodResolver(activateSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  // Auto-focus first digit on mount
  useEffect(() => {
    setTimeout(() => inputRefs.current[0]?.focus(), 100);
  }, []);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const focusInput = (i: number) => {
    if (i >= 0 && i < 6) inputRefs.current[i]?.focus();
  };

  const handleDigitChange = (i: number, value: string) => {
    if (value.length > 1) {
      const cleaned = value.replace(/\D/g, "").slice(0, 6);
      if (cleaned.length === 6) {
        setDigits(cleaned.split(""));
        inputRefs.current[5]?.focus();
        return;
      }
      value = value.slice(-1);
    }
    if (!/^\d?$/.test(value)) return;
    const next = [...digits];
    next[i] = value;
    setDigits(next);
    if (value && i < 5) focusInput(i + 1);
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      focusInput(i - 1);
    }
  };

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const otp = digits.join("");
      const response = await apiRequest("POST", "/api/auth/verify-otp", {
        email: emailFromUrl,
        otp,
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Invalid code" }));
        throw new Error(err.error || "Invalid or expired code");
      }
      return response.json();
    },
    onSuccess: () => {
      setStep("password");
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Incorrect or expired code",
        description: error.message || "Please check the code and try again.",
      });
      setDigits(["", "", "", "", "", ""]);
      setTimeout(() => focusInput(0), 50);
    },
  });

  const resendMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/auth/resend-activation-otp", {
        email: emailFromUrl,
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Failed to resend" }));
        throw new Error(err.error || "Failed to resend");
      }
      return response.json();
    },
    onSuccess: () => {
      setResendCooldown(30);
      toast({ title: "Code resent", description: "Check your email for a new verification code." });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Resend failed",
        description: error.message || "Could not resend code. Please try again.",
      });
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (data: ActivateValues) => {
      const response = await apiRequest("POST", "/api/leads/activate", {
        email: emailFromUrl,
        password: data.password,
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Activation failed" }));
        throw new Error(err.error || "Failed to activate account");
      }
      return response.json();
    },
    onSuccess: async (result) => {
      if (result.user) {
        await refreshAuth();
      }
      setLocation(variantFromUrl === "b" ? "/onboarding/menu-scan" : "/");
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Activation failed",
        description: error.message || "Failed to activate account. Please try again.",
      });
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-4">
          <div className="flex justify-center">
            <img src={logoImage} alt="FNB Cost Pro" className="h-20 w-auto" />
          </div>
          {step === "otp" ? (
            <>
              <CardTitle data-testid="text-activate-title">Verify Your Email</CardTitle>
              <CardDescription>
                We sent a 6-digit code to <strong>{emailFromUrl}</strong>. Enter it below to verify your email address.
              </CardDescription>
            </>
          ) : (
            <>
              <CardTitle data-testid="text-activate-title">Set Your Password</CardTitle>
              <CardDescription>
                Email verified! Choose a password to complete your account setup.
              </CardDescription>
            </>
          )}
        </CardHeader>

        <CardContent>
          {step === "otp" ? (
            <div className="space-y-6">
              <div className="flex justify-center gap-2">
                {digits.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => { inputRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={digit}
                    onChange={(e) => handleDigitChange(i, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    data-testid={`input-otp-${i}`}
                    className="w-11 h-14 text-center text-xl font-semibold border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                ))}
              </div>

              <Button
                className="w-full"
                onClick={() => verifyMutation.mutate()}
                disabled={digits.join("").length < 6 || verifyMutation.isPending}
                data-testid="button-verify-otp"
              >
                {verifyMutation.isPending ? "Verifying..." : "Verify Code"}
              </Button>

              <div className="text-center">
                <p className="text-sm text-muted-foreground">
                  Didn&apos;t receive a code?{" "}
                  <button
                    className="text-sm font-semibold text-primary hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => resendMutation.mutate()}
                    disabled={resendCooldown > 0 || resendMutation.isPending}
                    data-testid="button-resend-otp"
                  >
                    {resendCooldown > 0
                      ? `Resend in ${resendCooldown}s`
                      : resendMutation.isPending
                      ? "Sending..."
                      : "Resend code"}
                  </button>
                </p>
              </div>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => activateMutation.mutate(data))} className="space-y-4">
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            type={showPassword ? "text" : "password"}
                            placeholder="At least 6 characters"
                            {...field}
                            data-testid="input-password"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-0 top-0 h-full"
                            onClick={() => setShowPassword(!showPassword)}
                            tabIndex={-1}
                            data-testid="button-toggle-password"
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
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
                      <FormLabel>Confirm Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            type={showConfirmPassword ? "text" : "password"}
                            placeholder="Re-enter your password"
                            {...field}
                            data-testid="input-confirm-password"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-0 top-0 h-full"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            tabIndex={-1}
                            data-testid="button-toggle-confirm-password"
                          >
                            {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full"
                  disabled={activateMutation.isPending}
                  data-testid="button-activate"
                >
                  {activateMutation.isPending ? "Activating..." : "Activate & Get Started"}
                </Button>
              </form>
            </Form>
          )}

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Already activated?{" "}
              <button
                className="text-sm font-semibold text-primary hover:underline cursor-pointer"
                onClick={() => setLocation("/login")}
                data-testid="link-sign-in"
              >
                Sign in
              </button>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
