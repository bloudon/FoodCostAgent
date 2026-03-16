import { useLocation } from "wouter";
import { Check, Calendar, Headphones, BarChart3, Shield, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RestaurantBackground } from "@/components/restaurant-background";
const logoImage = "/logo.png";

const HIGHLIGHTS = [
  {
    icon: Shield,
    title: "Multi-Brand Support",
    description: "Manage inventory across multiple brands and concepts from    a single dashboard.",
  },
  {
    icon: BarChart3,
    title: "Franchise Analytics",
    description: "Get consolidated reporting and variance analysis across all your locations.",
  },
  {
    icon: Headphones,
    title: "SLA-Backed Support",
    description: "Dedicated account manager with guaranteed response times and priority escalation.",
  },
  {
    icon: Calendar,
    title: "Dedicated Onboarding",
    description: "Hands-on setup with data migration, training, and configuration support from our team.",
  },
];

const NEXT_STEPS = [
  "Our Enterprise team will review your inquiry and reach out within 1 business day.",
  "We'll schedule a discovery call to understand your operation and requirements.",
  "You'll receive a custom proposal tailored to your organization.",
  "Once approved, our team will guide you through a hands-on onboarding process.",
];

export default function EnterpriseOnboarding() {
  const [, navigate] = useLocation();

  return (
    <div className="relative min-h-screen bg-background">
      <RestaurantBackground />
      <div className="relative z-10 max-w-2xl mx-auto px-4 py-8">
        <div className="flex justify-center mb-8">
          <img src={logoImage} alt="FNB Cost Pro" className="h-14 w-auto" />
        </div>

        <div className="bg-card rounded-lg border overflow-hidden mb-6">
          <div className="p-6 md:p-8 text-center">
            <h1 className="text-2xl font-bold mb-2" data-testid="text-onboarding-title">
              Welcome to Enterprise
            </h1>
            <p className="text-muted-foreground text-sm">
              Our team will reach out within 1 business day to schedule your onboarding call.
            </p>
          </div>
        </div>

        <div className="bg-card rounded-lg border overflow-hidden mb-6">
          <div className="p-6 md:p-8">
            <h2 className="text-lg font-semibold mb-4" data-testid="text-next-steps-title">What Happens Next</h2>
            <ol className="space-y-3">
              {NEXT_STEPS.map((step, index) => (
                <li key={index} className="flex items-start gap-3">
                  <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                    {index + 1}
                  </span>
                  <span className="text-sm text-muted-foreground pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {HIGHLIGHTS.map((item) => (
            <Card key={item.title}>
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-md bg-muted">
                    <item.icon className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold mb-1" data-testid={`text-highlight-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                      {item.title}
                    </h3>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            data-testid="button-book-demo"
            variant="default"
            className="flex-1"
            onClick={() => window.open("#", "_blank")}
          >
            <Calendar className="w-4 h-4 mr-2" />
            Book a Demo
          </Button>
          <Button
            data-testid="button-login"
            variant="outline"
            className="flex-1"
            onClick={() => navigate("/login")}
          >
            <LogIn className="w-4 h-4 mr-2" />
            Log Into the App
          </Button>
        </div>
      </div>
    </div>
  );
}
