import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Shield, CheckCircle, XCircle, Loader2 } from "lucide-react";
import logoImage from "@assets/FNB Cost Pro v1 (2)_1764652779538.png";

interface InvitationDetails {
  email: string;
  role: string;
  companyName: string;
  expiresAt: Date;
}

export default function AcceptInvitation() {
  const [, params] = useRoute("/accept-invitation/:token");
  const token = params?.token;
  const { toast } = useToast();

  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("Invalid invitation link");
      setLoading(false);
      return;
    }

    // Fetch invitation details by token
    const fetchInvitation = async () => {
      try {
        const res = await fetch(`/api/invitations/by-token/${token}`);
        
        if (!res.ok) {
          if (res.status === 404) {
            setError("This invitation is invalid, expired, or has been revoked");
          } else {
            setError("Failed to load invitation");
          }
          setLoading(false);
          return;
        }
        
        const data = await res.json();
        setInvitation(data);
        setLoading(false);
      } catch (err: any) {
        setError(err.message || "Failed to load invitation");
        setLoading(false);
      }
    };

    fetchInvitation();
  }, [token]);

  const handleAcceptInvitation = async () => {
    if (!token) return;
    
    try {
      // Store invitation token in session before redirecting to SSO
      const res = await fetch(`/api/invitations/prepare-acceptance/${token}`, {
        method: "POST",
        credentials: "include",
      });
      
      if (!res.ok) {
        toast({
          title: "Error",
          description: "Failed to prepare invitation. Please try again.",
          variant: "destructive",
        });
        return;
      }
      
      // Redirect to SSO login
      window.location.href = "/api/sso/login";
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to prepare invitation. Please try again.",
        variant: "destructive",
      });
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case "global_admin":
        return "Global Admin";
      case "company_admin":
        return "Company Admin";
      case "store_manager":
        return "Store Manager";
      case "store_user":
        return "Store User";
      default:
        return role;
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Loading invitation...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-4">
            <div className="flex justify-center">
              <XCircle className="h-16 w-16 text-destructive" />
            </div>
            <CardTitle className="text-center">Invalid Invitation</CardTitle>
            <CardDescription className="text-center">
              {error}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground text-center">
              This invitation may have expired or been revoked.
            </p>
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
            <img 
              src={logoImage} 
              alt="FNB Cost Pro" 
              className="h-20 w-auto"
            />
          </div>
          <div className="flex justify-center">
            <CheckCircle className="h-16 w-16 text-green-600" />
          </div>
          <CardTitle className="text-center">You're Invited!</CardTitle>
          <CardDescription className="text-center">
            You've been invited to join {invitation?.companyName || "a company"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {invitation && (
            <div className="space-y-3 border rounded-lg p-4 bg-muted/50">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-muted-foreground">Email:</span>
                <span className="font-medium" data-testid="text-invitation-email">{invitation.email}</span>
                
                <span className="text-muted-foreground">Company:</span>
                <span className="font-medium" data-testid="text-invitation-company">{invitation.companyName}</span>
                
                <span className="text-muted-foreground">Role:</span>
                <Badge variant="secondary" data-testid="badge-invitation-role">
                  {getRoleLabel(invitation.role)}
                </Badge>
                
                <span className="text-muted-foreground">Expires:</span>
                <span className="text-sm" data-testid="text-invitation-expires">
                  {new Date(invitation.expiresAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          )}
          
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              Click the button below to sign in with your SSO account and accept this invitation
            </p>
            
            <Button
              className="w-full"
              size="lg"
              onClick={handleAcceptInvitation}
              data-testid="button-accept-invitation"
            >
              <Shield className="mr-2 h-5 w-5" />
              Accept Invitation via SSO
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              By accepting this invitation, you agree to join the company and will be granted access to the system based on your assigned role.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
