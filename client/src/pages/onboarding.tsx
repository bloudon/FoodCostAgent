import { useState, createContext, useContext } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Stepper, Step } from "@/components/ui/stepper";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { CompanySetupStep, StoreSetupStep, CategoriesReviewStep, VendorsOrderGuidesStep } from "@/pages/onboarding-steps";
import logoImage from "@assets/FNB Cost Pro v1 (5)_1764694673097.png";

// Onboarding wizard steps
const ONBOARDING_STEPS: Step[] = [
  { id: "welcome", label: "Welcome", description: "Get started" },
  { id: "company", label: "Company", description: "Basic info" },
  { id: "stores", label: "Stores", description: "Locations" },
  { id: "categories", label: "Categories", description: "Organize items" },
  { id: "vendors", label: "Vendors", description: "Suppliers" },
  { id: "inventory", label: "Inventory", description: "Review items" },
  { id: "recipes", label: "Recipes", description: "Sample recipes" },
  { id: "menu", label: "Menu", description: "Menu items" },
  { id: "complete", label: "Complete", description: "Finish setup" },
];

// Wizard context for sharing state across steps
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

// Helper to check if a step is complete
function isStepComplete(stepId: string, wizardData: Record<string, any>): boolean {
  switch (stepId) {
    case "welcome":
      return true; // Welcome step is always complete
    case "company":
      return !!wizardData.company?.name;
    case "stores":
      return !!wizardData.store?.name;
    case "categories":
      return true; // Categories are auto-created
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
      // Wizard complete - navigate to dashboard
      navigate("/");
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleSkip = () => {
    // For skippable steps, move to next step
    handleNext();
  };

  const canGoBack = currentStep > 0;
  const isLastStep = currentStep === ONBOARDING_STEPS.length - 1;
  
  // Check if current step is complete (gates Next button for required steps)
  const currentStepId = ONBOARDING_STEPS[currentStep]?.id;
  const isCurrentStepComplete = isStepComplete(currentStepId, wizardData);
  
  // Required steps that must be completed before proceeding
  const REQUIRED_STEPS = ["company", "stores"];
  const isRequiredStep = REQUIRED_STEPS.includes(currentStepId);
  
  // Can only proceed if: (1) step is complete, OR (2) step is not required
  const canProceed = isCurrentStepComplete || !isRequiredStep;
  
  // Skip is only available for optional steps (not required steps, not first/last)
  const canSkip = currentStep > 0 && currentStep < ONBOARDING_STEPS.length - 1 && !isRequiredStep;

  return (
    <OnboardingContext.Provider value={{ wizardData, updateWizardData }}>
      <div className="min-h-screen bg-background flex flex-col p-4 md:p-8">
        {/* Header */}
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
          
          {/* Progress Stepper - shows completion status */}
          <Stepper 
            steps={ONBOARDING_STEPS.map((step, index) => ({
              ...step,
              isComplete: index < currentStep || (index === currentStep && isStepComplete(step.id, wizardData))
            }))} 
            currentStep={currentStep} 
            className="mt-6" 
          />
        </div>

        {/* Step Content */}
        <div className="flex-1 max-w-5xl w-full mx-auto">
          <Card className="h-full">
            <CardContent className="p-6 md:p-8">
              {renderStepContent(currentStep, handleNext)}
            </CardContent>
          </Card>
        </div>

        {/* Navigation Footer */}
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
              {canSkip && (
                <Button
                  variant="ghost"
                  onClick={handleSkip}
                  data-testid="button-skip"
                >
                  Skip
                </Button>
              )}
              
              <Button
                onClick={handleNext}
                disabled={!canProceed}
                data-testid="button-next"
              >
                {isLastStep ? (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Complete Setup
                  </>
                ) : (
                  <>
                    Next
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </OnboardingContext.Provider>
  );
}

// Render step content with onComplete handler
function renderStepContent(step: number, onStepComplete: () => void): JSX.Element {
  switch (step) {
    case 0:
      return <WelcomeStep />;
    case 1:
      return <CompanySetupStep onComplete={onStepComplete} />;
    case 2:
      return <StoreSetupStep onComplete={onStepComplete} />;
    case 3:
      return <CategoriesReviewStep onComplete={onStepComplete} />;
    case 4:
      return <VendorsOrderGuidesStep onComplete={onStepComplete} />;
    case 5:
      return <InventoryStep />;
    case 6:
      return <RecipesStep />;
    case 7:
      return <MenuStep />;
    case 8:
      return <CompleteStep />;
    default:
      return <div>Unknown step</div>;
  }
}

// Placeholder step components
function WelcomeStep() {
  return (
    <div className="text-center py-12" data-testid="step-welcome">
      <h2 className="text-3xl font-bold mb-4">Welcome to FnBcostpro!</h2>
      <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
        Let's get your restaurant management system set up. This wizard will guide you through
        the essential steps to start managing your inventory, recipes, and costs.
      </p>
      <p className="text-sm text-muted-foreground">
        This should take about 10-15 minutes. You can skip optional steps and come back to them later.
      </p>
    </div>
  );
}

// These step components are now imported from onboarding-steps.tsx

function VendorsStep() {
  return (
    <div data-testid="step-vendors">
      <h2 className="text-2xl font-bold mb-2">Vendors & Order Guides</h2>
      <p className="text-muted-foreground mb-6">Add vendors and import order guides</p>
      <p className="text-sm">Vendor order guide import will be implemented here...</p>
    </div>
  );
}

function InventoryStep() {
  return (
    <div data-testid="step-inventory">
      <h2 className="text-2xl font-bold mb-2">Inventory Review</h2>
      <p className="text-muted-foreground mb-6">Review and organize your inventory items</p>
      <p className="text-sm">Inventory review will be implemented here...</p>
    </div>
  );
}

function RecipesStep() {
  return (
    <div data-testid="step-recipes">
      <h2 className="text-2xl font-bold mb-2">Sample Recipes</h2>
      <p className="text-muted-foreground mb-6">Create some sample recipes to get started</p>
      <p className="text-sm">Recipe creation will be implemented here...</p>
    </div>
  );
}

function MenuStep() {
  return (
    <div data-testid="step-menu">
      <h2 className="text-2xl font-bold mb-2">Menu Items</h2>
      <p className="text-muted-foreground mb-6">Add menu items and link to recipes</p>
      <p className="text-sm">Menu item management will be implemented here...</p>
    </div>
  );
}

function CompleteStep() {
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
      <p className="text-sm text-muted-foreground">
        Click "Complete Setup" below to go to your dashboard.
      </p>
    </div>
  );
}
