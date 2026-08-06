import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ShieldAlert, Mail, ArrowLeft } from "lucide-react";

export default function SsoAccessDenied() {
  const [, setLocation] = useLocation();

  const handleBackToLogin = () => {
    setLocation("/login");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="rounded-full bg-destructive/10 p-4">
              <ShieldAlert className="h-12 w-12 text-destructive" />
            </div>
          </div>
          <CardTitle className="text-2xl" data-testid="text-access-denied-title">
            Access Requires Invitation
          </CardTitle>
          <CardDescription>
            Your SSO authentication was successful, but you need an invitation to access this system
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription>
              <strong>Access Denied:</strong> Only invited users can access this system
            </AlertDescription>
          </Alert>

          <div className="space-y-4">
            <div className="rounded-lg border p-4 space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Mail className="h-4 w-4" />
                How to get access
              </h3>
              <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                <li>Contact your system administrator or company manager</li>
                <li>Request an invitation to join the system</li>
                <li>Once invited, you'll receive an invitation link via email</li>
                <li>Click the invitation link and authenticate with SSO to complete setup</li>
              </ol>
            </div>

            <div className="rounded-lg border p-4 space-y-2">
              <h3 className="font-semibold">Why is this required?</h3>
              <p className="text-sm text-muted-foreground">
                This system uses invitation-only access to ensure proper company and role assignments.
                Your administrator will assign you to the appropriate company and locations when sending your invitation.
              </p>
            </div>
          </div>

          <div className="flex justify-center">
            <Button
              variant="default"
              onClick={handleBackToLogin}
              data-testid="button-back-to-login"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Login
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
