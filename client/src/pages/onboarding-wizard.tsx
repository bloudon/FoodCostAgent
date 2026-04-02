import { useState, createContext, useContext } from "react";
import { useLocation, Redirect } from "wouter";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
const logoImage = "/logo.png";
import { RestaurantBackground } from "@/components/restaurant-background";
import { AccountSetupStep, EmailVerificationStep, CompanySetupStep, StoreSetupStep } from "@/pages/onboarding-steps";
import { useAuth } from "@/lib/auth-context";

export interface WizardCompanyData {
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
  storeLocationCount?: string;
  name?: string;
  legalName?: string;
  contactEmail?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  posProvider?: "thrive" | "toast" | "hungerrush" | "clover" | "other" | "none";
  tccAccountId?: string;
}

export interface WizardData {
  company?: WizardCompanyData;
  store?: {
    code?: string;
    name?: string;
    phone?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
  };
}

interface OnboardingContextValue {
  wizardData: WizardData;
  updateWizardData: (key: keyof WizardData, data: any) => void;
}

export const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboarding must be used within OnboardingProvider");
  return ctx;
}

const STEPS = [
  { id: "account", label: "Account" },
  { id: "verify", label: "Verify Email" },
  { id: "company", label: "Company" },
  { id: "store", label: "Store" },
];

function parseTotalStores(count?: string): number {
  if (!count) return 1;
  if (count === "10+") return 10;
  const n = parseInt(count, 10);
  return isNaN(n) || n < 1 ? 1 : n;
}

export default function OnboardingWizard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [stepIndex, setStepIndex] = useState(0);
  const [storeIndex, setStoreIndex] = useState(0);
  const [wizardData, setWizardData] = useState<WizardData>({});

  const updateWizardData = (key: keyof WizardData, data: any) => {
    setWizardData((prev) => ({ ...prev, [key]: data }));
  };

  const totalStores = parseTotalStores(wizardData.company?.storeLocationCount);

  if (user && user.role !== "global_admin") {
    return <Redirect to="/" />;
  }

  const handleStepComplete = () => {
    const currentStep = STEPS[stepIndex];

    if (currentStep.id === "store") {
      if (storeIndex + 1 < totalStores) {
        // More stores to collect — stay on store step, advance storeIndex
        setStoreIndex((i) => i + 1);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      } else {
        // All stores done — go to plan selection
        navigate("/choose-plan?welcome=true");
        return;
      }
    }

    if (stepIndex < STEPS.length - 1) {
      setStepIndex((i) => i + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      navigate("/choose-plan?welcome=true");
    }
  };

  const handleSkipRemainingStores = () => {
    navigate("/choose-plan?welcome=true");
  };

  const handleStepBack = () => {
    if (STEPS[stepIndex]?.id === "store" && storeIndex > 0) {
      setStoreIndex((i) => i - 1);
    } else {
      setStepIndex((i) => Math.max(0, i - 1));
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const canGoBack = stepIndex > 0 || (STEPS[stepIndex]?.id === "store" && storeIndex > 0);

  const currentStep = STEPS[stepIndex];

  return (
    <OnboardingContext.Provider value={{ wizardData, updateWizardData }}>
      <div className="relative min-h-screen bg-background">
        <RestaurantBackground />
        <div className="relative z-10 max-w-2xl mx-auto px-4 py-8">
          <div className="flex justify-center mb-8">
            <img src={logoImage} alt="FNB Cost Pro" className="h-14 w-auto" />
          </div>

          <div className="bg-card rounded-lg border overflow-hidden">
            {/* Step indicator header — sits inside the card for a clean contained look */}
            <div className="px-6 md:px-8 pt-6 pb-5 border-b">
              <div className="flex items-center gap-0">
                {STEPS.map((step, idx) => (
                  <div key={step.id} className="flex items-center flex-1">
                    <div className="flex flex-col items-center flex-1">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors ${
                          idx < stepIndex
                            ? "bg-primary border-primary text-primary-foreground"
                            : idx === stepIndex
                            ? "bg-card border-primary text-primary"
                            : "bg-card border-muted-foreground/30 text-muted-foreground/50"
                        }`}
                        data-testid={`step-indicator-${step.id}`}
                      >
                        {idx < stepIndex ? (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          idx + 1
                        )}
                      </div>
                      <span
                        className={`text-xs mt-1 font-medium ${
                          idx === stepIndex ? "text-primary" : idx < stepIndex ? "text-primary/70" : "text-muted-foreground/50"
                        }`}
                      >
                        {step.label}
                      </span>
                    </div>
                    {idx < STEPS.length - 1 && (
                      <div
                        className={`h-0.5 flex-1 mx-1 mb-5 transition-colors ${
                          idx < stepIndex ? "bg-primary" : "bg-muted-foreground/20"
                        }`}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Form content */}
            <div className="p-6 md:p-8">
              {currentStep.id === "account" && (
                <AccountSetupStep onComplete={handleStepComplete} />
              )}
              {currentStep.id === "verify" && (
                <EmailVerificationStep onComplete={handleStepComplete} />
              )}
              {currentStep.id === "company" && (
                <CompanySetupStep onComplete={handleStepComplete} />
              )}
              {currentStep.id === "store" && (
                <StoreSetupStep
                  onComplete={handleStepComplete}
                  storeIndex={storeIndex}
                  totalStores={totalStores}
                />
              )}
            </div>
          </div>

          {/* Back button + step counter */}
          <div className="flex items-center justify-between mt-4">
            <div>
              {canGoBack && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleStepBack}
                  data-testid="button-wizard-back"
                  className="text-muted-foreground"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Back
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {currentStep.id === "store" && totalStores > 1
                ? `Location ${storeIndex + 1} of ${totalStores}`
                : `Step ${stepIndex + 1} of ${STEPS.length}`}
            </p>
          </div>

          {/* Skip remaining locations option — only after first store is saved */}
          {currentStep.id === "store" && storeIndex > 0 && storeIndex < totalStores - 1 && (
            <div className="mt-4 text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSkipRemainingStores}
                data-testid="button-skip-remaining-stores"
                className="text-muted-foreground text-xs"
              >
                I'll set up the remaining {totalStores - storeIndex - 1} location(s) later →
              </Button>
            </div>
          )}
        </div>
      </div>
    </OnboardingContext.Provider>
  );
}
