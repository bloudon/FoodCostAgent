import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Unit } from "@shared/schema"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function filterUnitsBySystem(units: Unit[] | undefined, unitSystem: string | undefined): Unit[] {
  if (!units) return [];
  if (!unitSystem) unitSystem = "imperial";
  
  return units.filter(unit => 
    unit.system === unitSystem || unit.system === "both"
  );
}

export function formatUnitName(unitName: string | undefined): string {
  if (!unitName) return '-';
  
  // Abbreviate "pound" to "lb."
  if (unitName.toLowerCase() === 'pound') {
    return 'lb.';
  }
  
  return unitName;
}

export function formatRecipeName(recipeName: string | undefined): string {
  if (!recipeName) return '';
  
  // Capitalize the first letter
  return recipeName.charAt(0).toUpperCase() + recipeName.slice(1);
}
