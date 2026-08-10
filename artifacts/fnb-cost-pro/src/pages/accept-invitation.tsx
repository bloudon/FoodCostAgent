import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Eye, EyeOff, Loader2, XCircle, AlertTriangle } from "lucide-react";
const logoImage = "/logo.png";

const acceptSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type AcceptValues = z.infer<typeof acceptSchema>;

interface InvitationDetails {
  email: string;
  role: string;
  companyName: string;
  expiresAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  company_admin: "Company Admin",
  store_manager: "Store Manager",
  store_user: "Store Member",
};

// Map error codes returned from Google SSO callback to human-readable messages
const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  "google-invitation-email-mismatch":
    "The Google account you used doesn't match the email address this invitation was sent to. Please sign in with the Google account for that address, or use the password form below.",
  "google-access-denied":
    "Your Google account isn't linked to an invitation. Please use the password form below or check that you're signing in with the correct Google account.",
  "google-auth-failed":
    "Google sign-in failed. Please try again or create your account with a password below.",
  "google-missing-email":
    "Google did not share your email address. Please grant email access and try again, or use the password form below.",
  "google-unverified-email":
    "Your Google account's email address is not verified. Please verify it with Google first, or use the password form below.",
};

export default function AcceptInvitation() {
  const [, params] = useRoute("/accept-invitation/:token");
  const token = params?.token;
  const [, setLocation] = useLocation();
  const { refreshAuth } = useAuth();
  const { toast } = useToast();

  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [loadingInvite, setLoadingInvite] = useState(true);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [ssoProvider, setSsoProvider] = useState<string | null>(null);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  // Read ?error= query param set by Google SSO callback on failure
  const googleError = new URLSearchParams(window.location.search).get("error");
  const googleErrorMessage = googleError ? (GOOGLE_ERROR_MESSAGES[googleError] ?? null) : null;

  const form = useForm<AcceptValues>({
    resolver: zodResolver(acceptSchema),
    defaultValues: { firstName: "", lastName: "", password: "", confirmPassword: "" },
  });

  useEffect(() => {
    if (!token) {
      setInviteError("Invalid invitation link — no token provided.");
      setLoadingInvite(false);
      return;
    }
    fetch(`/api/invitations/by-token/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setInviteError(data.error || "This invitation is invalid, expired, or has already been used.");
        } else {
          setInvitation(await res.json());
        }
      })
      .catch(() => setInviteError("Failed to load invitation. Please try again."))
      .finally(() => setLoadingInvite(false));
  }, [token]);

  useEffect(() => {
    // Determine whether Google SSO is active so we can show the button
    fetch("/api/sso/provider", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.provider === "google") setSsoProvider("google");
      })
      .catch(() => {});
  }, []);

  async function handleGoogleSignUp() {
    if (!token) return;
    setIsGoogleLoading(true);
    try {
      const res = await apiRequest("POST", `/api/invitations/prepare-acceptance/${token}`, {});
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to prepare invitation");
      }
      // Redirect to Google OIDC login — the signed cookie will carry the token through
      window.location.href = "/api/sso/login";
    } catch (err: any) {
      setIsGoogleLoading(false);
      toast({
        variant: "destructive",
        title: "Could not start Google sign-in",
        description: err.message || "Please try again.",
      });
    }
  }

  async function onSubmit(data: AcceptValues) {
    try {
      const res = await apiRequest("POST", "/api/invitations/accept-local", {
        token,
        firstName: data.firstName,
        lastName: data.lastName,
        password: data.password,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to accept invitation");
      }
      await refreshAuth();
      setLocation("/?welcome=true");
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Could not accept invitation",
        description: err.message || "Please try again.",
      });
    }
  }

  if (loadingInvite) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground">Loading invitation...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (inviteError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-4 text-center">
            <div className="flex justify-center">
              <XCircle className="h-14 w-14 text-destructive" />
            </div>
            <CardTitle>Invitation Invalid</CardTitle>
            <CardDescription>{inviteError}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" onClick={() => setLocation("/login")}>
              Go to Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-4">
          <div className="flex justify-center">
            <img src={logoImage} alt="FNB Cost Pro" className="h-20 w-auto" />
          </div>
          <CardTitle data-testid="text-accept-invite-title">Create Your Account</CardTitle>
          <CardDescription>
            You've been invited to join <strong>{invitation?.companyName}</strong> as a{" "}
            <Badge variant="secondary" className="text-xs">
              {ROLE_LABELS[invitation?.role || ""] || invitation?.role}
            </Badge>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground" data-testid="text-invite-email">
            Signing up as: <span className="font-medium text-foreground">{invitation?.email}</span>
          </div>

          {/* Google SSO error explanation (returned from callback via ?error=) */}
          {googleErrorMessage && (
            <div
              className="mb-4 flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
              data-testid="text-google-error"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{googleErrorMessage}</span>
            </div>
          )}

          {/* Google sign-up option — shown only when Google SSO is configured */}
          {ssoProvider === "google" && (
            <>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleGoogleSignUp}
                disabled={isGoogleLoading}
                data-testid="button-google-signup"
              >
                {isGoogleLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.97 10.97 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
                  </svg>
                )}
                Continue with Google
              </Button>

              <div className="relative my-5">
                <Separator />
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
                  OR
                </span>
              </div>
            </>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Jane" {...field} data-testid="input-first-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Doe" {...field} data-testid="input-last-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

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
                disabled={form.formState.isSubmitting}
                data-testid="button-accept-invite"
              >
                {form.formState.isSubmitting ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating Account...</>
                ) : (
                  "Create Account & Join Team"
                )}
              </Button>
            </form>
          </Form>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Already have an account?{" "}
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
