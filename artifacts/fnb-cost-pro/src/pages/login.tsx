import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Shield, Eye, EyeOff } from "lucide-react";
const logoImage = "/website-logo.png";
import { RestaurantBackground } from "@/components/restaurant-background";
import { useAppLanguage } from "@/lib/language-context";

const loginSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginValues = z.infer<typeof loginSchema>;

export default function Login() {
  const [showPassword, setShowPassword] = useState(false);
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const { toast } = useToast();
  const { t } = useAppLanguage();
  const [ssoProvider, setSsoProvider] = useState<string>("replit");

  const sessionExpired =
    new URLSearchParams(window.location.search).get("reason") === "session_expired";

  const ssoErrorCode = new URLSearchParams(window.location.search).get("error");
  const SSO_ERROR_MESSAGES: Record<string, string> = {
    "google-invitation-email-mismatch":
      "The Google account you used doesn't match the email address this invitation was sent to. Please sign in with the Google account that matches the invited email, or return to the invitation link and create a password instead.",
    "google-access-denied":
      "Your Google account isn't linked to this organization. Please contact your administrator or use a password to sign in.",
    "google-auth-failed":
      "Google sign-in failed. Please try again.",
    "google-missing-email":
      "Google did not share your email address. Please grant email access and try again.",
    "google-unverified-email":
      "Your Google account's email address is not verified. Please verify it with Google first.",
    "google-invitation-conflict":
      "A pending invitation for this account requires administrative action. Please contact your administrator.",
  };
  const ssoErrorMessage = ssoErrorCode ? (SSO_ERROR_MESSAGES[ssoErrorCode] ?? "Sign-in failed. Please try again.") : null;

  useEffect(() => {
    // Determine which SSO provider is active so the right button shows.
    // Defaults to the generic SSO button if the check fails.
    fetch("/api/sso/provider", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.provider) setSsoProvider(data.provider);
      })
      .catch(() => {});
  }, []);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const isLoading = form.formState.isSubmitting;

  async function onSubmit(data: LoginValues) {
    try {
      await login(data.email, data.password);

      // Check the user's role from the auth context after login
      // Note: The login function updates the user in the auth context
      const response = await fetch("/api/auth/me", {
        credentials: "include",
      });

      if (response.ok) {
        const userData = await response.json();

        // Global admins should land on the companies page
        if (userData.role === "global_admin") {
          setLocation("/companies");
        } else {
          setLocation("/");
        }
      } else {
        setLocation("/");
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: t.auth.loginFailed,
        description: error.message || t.auth.invalidCredentials,
      });
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <RestaurantBackground />
      <div className="w-full max-w-md relative z-10 flex flex-col gap-3">
        {sessionExpired && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {t.auth.sessionExpired}
          </div>
        )}
        {ssoErrorMessage && (
          <div
            className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            data-testid="text-sso-error"
          >
            {ssoErrorMessage}
          </div>
        )}
        <Card className="w-full">
        <CardHeader className="space-y-4">
          <div className="flex justify-center">
            <img
              src={logoImage}
              alt="FNB Cost Pro"
              className="h-24 w-auto"
            />
          </div>
          <CardTitle>{t.auth.signIn}</CardTitle>
          <CardDescription>
            {t.auth.enterCredentials}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel data-testid="label-email">{t.auth.email}</FormLabel>
                    <FormControl>
                      <Input
                        id="email"
                        type="text"
                        placeholder="you@example.com"
                        autoComplete="email"
                        data-testid="input-email"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage data-testid="error-email" />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel data-testid="label-password">{t.auth.password}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          autoComplete="current-password"
                          className="pr-10"
                          data-testid="input-password"
                          {...field}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                          onClick={() => setShowPassword(!showPassword)}
                          tabIndex={-1}
                          data-testid="button-toggle-password"
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          )}
                        </Button>
                      </div>
                    </FormControl>
                    <FormMessage data-testid="error-password" />
                  </FormItem>
                )}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:underline cursor-pointer"
                  onClick={() => setLocation("/forgot-password")}
                  data-testid="link-forgot-password"
                >
                  {t.auth.forgotPassword}
                </button>
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={isLoading}
                data-testid="button-login"
              >
                {isLoading ? t.auth.signingIn : t.auth.signIn}
              </Button>
            </form>
          </Form>

          <div className="relative my-6">
            <Separator />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
              OR
            </span>
          </div>

          <div className="space-y-3">
            {ssoProvider === "google" ? (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => window.location.href = "/api/sso/login"}
                data-testid="button-sso-google"
              >
                <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.97 10.97 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
                </svg>
                {t.auth.continueWithGoogle}
              </Button>
            ) : (
              <>
                <p className="text-sm text-muted-foreground text-center mb-3">
                  {t.auth.enterpriseSso}
                </p>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => window.location.href = "/api/sso/login"}
                  data-testid="button-sso-replit"
                >
                  <Shield className="mr-2 h-4 w-4" />
                  {t.auth.signInWithSso}
                </Button>
              </>
            )}
          </div>

          <div className="relative mt-6">
            <Separator />
          </div>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              {t.auth.noAccount}{" "}
              <button
                className="text-sm font-semibold text-primary hover:underline cursor-pointer"
                onClick={() => setLocation("/signup")}
                data-testid="link-sign-up"
              >
                {t.auth.signUp}
              </button>
            </p>
          </div>

        </CardContent>
        </Card>
      </div>
    </div>
  );
}
