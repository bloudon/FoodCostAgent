import { useState, createContext, useContext } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import logoImage from "@assets/FNB Cost Pro v1 (5)_1764694673097.png";
import { AccountSetupStep, CompanySetupStep, StoreSetupStep, CategoriesReviewStep } from "@/pages/onboarding-steps";

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
  { id: "company", label: "Company" },
  { id: "store", label: "Store" },
  { id: "categories", label: "Categories" },
];

export default function OnboardingWizard() {
  const [, navigate] = useLocation();
  const { refreshAuth } = useAuth();
  const [stepIndex, setStepIndex] = useState(0);
  const [wizardData, setWizardData] = useState<WizardData>({});

  const updateWizardData = (key: keyof WizardData, data: any) => {
    setWizardData((prev) => ({ ...prev, [key]: data }));
  };

  const handleStepComplete = () => {
    if (stepIndex < STEPS.length - 1) {
      setStepIndex((i) => i + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      navigate("/");
    }
  };

  const currentStep = STEPS[stepIndex];

  return (
    <OnboardingContext.Provider value={{ wizardData, updateWizardData }}>
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-4 py-8">
          <div className="flex justify-center mb-8">
            <img src={logoImage} alt="FNB Cost Pro" className="h-14 w-auto" />
          </div>

          <div className="mb-8">
            <div className="flex items-center gap-0">
              {STEPS.map((step, idx) => (
                <div key={step.id} className="flex items-center flex-1">
                  <div className="flex flex-col items-center flex-1">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors ${
                        idx < stepIndex
                          ? "bg-primary border-primary text-primary-foreground"
                          : idx === stepIndex
                          ? "bg-background border-primary text-primary"
                          : "bg-background border-muted-foreground/30 text-muted-foreground/50"
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

          <div className="bg-card rounded-lg border p-6 md:p-8">
            {currentStep.id === "account" && (
              <AccountSetupStep onComplete={handleStepComplete} />
            )}
            {currentStep.id === "company" && (
              <CompanySetupStep onComplete={handleStepComplete} />
            )}
            {currentStep.id === "store" && (
              <StoreSetupStep onComplete={handleStepComplete} />
            )}
            {currentStep.id === "categories" && (
              <CategoriesReviewStep onComplete={handleStepComplete} />
            )}
          </div>

          <p className="text-center text-xs text-muted-foreground mt-6">
            Step {stepIndex + 1} of {STEPS.length}
          </p>
        </div>
      </div>
    </OnboardingContext.Provider>
  );
}
