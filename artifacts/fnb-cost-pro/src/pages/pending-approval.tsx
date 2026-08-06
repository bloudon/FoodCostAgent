import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, Clock, Mail } from "lucide-react";

export default function PendingApproval() {
  const [, setLocation] = useLocation();

  // Fetch current user to display their info
  const { data: currentUser } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });

  // Poll for company assignment (every 10 seconds)
  const { data: userStatus } = useQuery<any>({
    queryKey: ["/api/auth/me"],
    refetchInterval: 10000,
  });

  // If user gets company assignment, redirect to dashboard
  useEffect(() => {
    if (userStatus?.companyId) {
      if (userStatus.role === "global_admin") {
        setLocation("/companies");
      } else {
        setLocation("/");
      }
    }
  }, [userStatus, setLocation]);

  const handleLogout = async () => {
    await fetch("/api/sso/logout", {
      method: "GET",
      credentials: "include",
    });
    setLocation("/login");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="rounded-full bg-primary/10 p-4">
              <Clock className="h-12 w-12 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl" data-testid="text-pending-title">
            Account Pending Approval
          </CardTitle>
          <CardDescription>
            Your account has been created, but requires administrator approval
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <Shield className="h-4 w-4" />
            <AlertDescription>
              <strong>Authenticated as:</strong> {currentUser?.email || "SSO User"}
            </AlertDescription>
          </Alert>

          <div className="space-y-4">
            <div className="rounded-lg border p-4 space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Mail className="h-4 w-4" />
                What happens next?
              </h3>
              <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                <li>Your account has been successfully created via SSO</li>
                <li>A system administrator will review your request</li>
                <li>You will be assigned to a company and given appropriate permissions</li>
                <li>Once approved, you will automatically gain access to the system</li>
              </ol>
            </div>

            <div className="rounded-lg border p-4 space-y-2">
              <h3 className="font-semibold">Need immediate access?</h3>
              <p className="text-sm text-muted-foreground">
                Contact your system administrator to expedite the approval process.
                They can assign you to a company and grant the necessary permissions.
              </p>
            </div>
          </div>

          <div className="flex gap-3 justify-between">
            <Button
              variant="outline"
              onClick={handleLogout}
              data-testid="button-logout"
            >
              Sign Out
            </Button>
            <Button
              variant="default"
              onClick={() => window.location.reload()}
              data-testid="button-refresh"
            >
              Check Status
            </Button>
          </div>

          <p className="text-xs text-center text-muted-foreground">
            This page will automatically refresh when your account is approved
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
