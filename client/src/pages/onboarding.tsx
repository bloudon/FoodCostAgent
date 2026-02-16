import { useState, createContext, useContext } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Stepper, Step } from "@/components/ui/stepper";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { StoreSetupStep } from "@/pages/onboarding-steps";
import logoImage from "@assets/FNB Cost Pro v1 (5)_1764694673097.png";

const ONBOARDING_STEPS: Step[] = [
  { id: "welcome", label: "Welcome", description: "Get started" },
  { id: "stores", label: "Store Setup", description: "First location" },
  { id: "complete", label: "Complete", description: "Finish setup" },
];

interface OnboardingContextType {
  wizardData: Record<string, any>;
  updateWizardData: (stepId: string, data: any) => void;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error("useOnboarding must be used within OnboardingProvider");
  }
  return context;
}

function isStepComplete(stepId: string, wizardData: Record<string, any>): boolean {
  switch (stepId) {
    case "welcome":
      return true;
    case "stores":
      return !!wizardData.store?.name;
    default:
      return false;
  }
}

export default function Onboarding() {
  const [, navigate] = useLocation();
  const [currentStep, setCurrentStep] = useState(0);
  const [wizardData, setWizardData] = useState<Record<string, any>>({});

  const updateWizardData = (stepId: string, data: any) => {
    setWizardData((prev) => ({
      ...prev,
      [stepId]: data,
    }));
  };

  const handleNext = () => {
    if (currentStep < ONBOARDING_STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      navigate("/");
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const canGoBack = currentStep > 0;
  const isLastStep = currentStep === ONBOARDING_STEPS.length - 1;

  const currentStepId = ONBOARDING_STEPS[currentStep]?.id;
  const isCurrentStepComplete = isStepComplete(currentStepId, wizardData);

  const REQUIRED_STEPS = ["stores"];
  const isRequiredStep = REQUIRED_STEPS.includes(currentStepId);

  const canProceed = isCurrentStepComplete || !isRequiredStep;

  return (
    <OnboardingContext.Provider value={{ wizardData, updateWizardData }}>
      <div className="min-h-screen bg-background flex flex-col p-4 md:p-8">
        <div className="max-w-5xl w-full mx-auto mb-8">
          <div className="flex items-center justify-center mb-6">
            <img
              src={logoImage}
              alt="FNB Cost Pro"
              className="h-16 w-auto"
            />
          </div>
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-2xl md:text-3xl font-bold">Setup Wizard</h1>
            <div className="text-sm text-muted-foreground">
              Step {currentStep + 1} of {ONBOARDING_STEPS.length}
            </div>
          </div>

          <Stepper
            steps={ONBOARDING_STEPS.map((step, index) => ({
              ...step,
              isComplete: index < currentStep || (index === currentStep && isStepComplete(step.id, wizardData))
            }))}
            currentStep={currentStep}
            className="mt-6"
          />
        </div>

        <div className="flex-1 max-w-5xl w-full mx-auto">
          <Card className="h-full">
            <CardContent className="p-6 md:p-8">
              {renderStepContent(currentStep, handleNext, navigate)}
            </CardContent>
          </Card>
        </div>

        <div className="max-w-5xl w-full mx-auto mt-6">
          <div className="flex items-center justify-between gap-4">
            <Button
              variant="outline"
              onClick={handleBack}
              disabled={!canGoBack}
              data-testid="button-back"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>

            <div className="flex gap-2">
              {!isLastStep && (
                <Button
                  onClick={handleNext}
                  disabled={!canProceed}
                  data-testid="button-next"
                >
                  Next
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </OnboardingContext.Provider>
  );
}

function renderStepContent(step: number, onStepComplete: () => void, navigate: (path: string) => void): JSX.Element {
  switch (step) {
    case 0:
      return <WelcomeStep />;
    case 1:
      return <StoreSetupStep onComplete={onStepComplete} />;
    case 2:
      return <CompleteStep onNavigate={() => navigate("/")} />;
    default:
      return <div>Unknown step</div>;
  }
}

function WelcomeStep() {
  return (
    <div className="text-center py-12" data-testid="step-welcome">
      <h2 className="text-3xl font-bold mb-4">Welcome to FnBcostpro!</h2>
      <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
        Let's get your first store location set up. This quick wizard will have you ready
        to start managing your inventory, recipes, and costs in just a moment.
      </p>
      <p className="text-sm text-muted-foreground">
        Click "Next" to get started.
      </p>
    </div>
  );
}

function CompleteStep({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="text-center py-12" data-testid="step-complete">
      <div className="w-16 h-16 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mx-auto mb-6">
        <Check className="w-8 h-8 text-green-600 dark:text-green-400" />
      </div>
      <h2 className="text-3xl font-bold mb-4">Setup Complete!</h2>
      <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
        Your FnBcostpro account is ready to use. You can now start managing your inventory,
        creating recipes, and tracking your food costs.
      </p>
      <Button onClick={onNavigate} data-testid="button-go-to-dashboard">
        Go to Dashboard
      </Button>
    </div>
  );
}
