import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Step {
  id: string;
  label: string;
  description?: string;
}

interface StepperProps {
  steps: Step[];
  currentStep: number;
  className?: string;
}

export function Stepper({ steps, currentStep, className }: StepperProps) {
  return (
    <div className={cn("w-full", className)} data-testid="stepper-container">
      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isCurrent = index === currentStep;
          const isUpcoming = index > currentStep;

          return (
            <div key={step.id} className="flex items-center flex-1 last:flex-none">
              {/* Step Circle */}
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all",
                    isCompleted && "bg-primary border-primary text-primary-foreground",
                    isCurrent && "border-primary bg-background text-primary",
                    isUpcoming && "border-muted-foreground/30 bg-background text-muted-foreground"
                  )}
                  data-testid={`step-indicator-${index}`}
                >
                  {isCompleted ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    <span className="text-sm font-semibold">{index + 1}</span>
                  )}
                </div>
                
                {/* Step Label - Hidden on small screens */}
                <div className="hidden sm:flex flex-col items-center mt-2 max-w-[120px]">
                  <span
                    className={cn(
                      "text-sm font-medium text-center",
                      isCurrent && "text-primary",
                      !isCurrent && "text-muted-foreground"
                    )}
                    data-testid={`step-label-${index}`}
                  >
                    {step.label}
                  </span>
                  {step.description && (
                    <span className="text-xs text-muted-foreground text-center mt-0.5">
                      {step.description}
                    </span>
                  )}
                </div>
              </div>

              {/* Connector Line */}
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-2 transition-all",
                    index < currentStep ? "bg-primary" : "bg-muted-foreground/30"
                  )}
                  data-testid={`step-connector-${index}`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile Step Label - Shows current step only */}
      <div className="sm:hidden mt-4 text-center">
        <span className="text-sm font-medium text-primary">
          {steps[currentStep]?.label}
        </span>
        {steps[currentStep]?.description && (
          <p className="text-xs text-muted-foreground mt-1">
            {steps[currentStep]?.description}
          </p>
        )}
      </div>
    </div>
  );
}
