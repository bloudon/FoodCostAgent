import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Pizza, Shield } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [, setLocation] = useLocation();
  const { login, user } = useAuth();
  const { toast } = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);

    try {
      await login(email, password);
      
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
        title: "Login failed",
        description: error.message || "Invalid credentials",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-4">
          <div className="flex justify-center">
            <div className="flex items-center gap-2">
              <Pizza className="h-10 w-10 text-primary" />
              <h1 className="text-2xl font-bold">FnBcostpro.com</h1>
            </div>
          </div>
          <CardTitle>Sign In</CardTitle>
          <CardDescription>
            Enter your credentials to access your restaurant inventory system
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" data-testid="label-email">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@pizza.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                data-testid="input-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" data-testid="label-password">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                data-testid="input-password"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={isLoading}
              data-testid="button-login"
            >
              {isLoading ? "Signing in..." : "Sign In"}
            </Button>
          </form>

          <div className="relative my-6">
            <Separator />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
              OR
            </span>
          </div>

          <div className="space-y-3">
            <p className="text-sm text-muted-foreground text-center mb-3">
              Enterprise SSO
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => window.location.href = "/api/sso/login"}
              data-testid="button-sso-replit"
            >
              <Shield className="mr-2 h-4 w-4" />
              Sign in with SSO
            </Button>
          </div>

          <div className="relative mt-6">
            <Separator />
          </div>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              New to FnBcostpro?{" "}
              <button
                className="text-sm font-semibold text-primary hover:underline cursor-pointer"
                onClick={() => setLocation("/onboarding")}
                data-testid="link-sign-up"
              >
                Sign up for free
              </button>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
