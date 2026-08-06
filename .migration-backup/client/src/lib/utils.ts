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

/**
 * Parse a countDate value returned from the API.
 * countDate is stored as UTC midnight (e.g. 2026-04-17T00:00:00.000Z).
 * Using new Date() directly shifts it to the previous evening in US timezones.
 * This extracts the UTC date components and creates a local-midnight Date so
 * format() / toLocaleDateString() show the correct calendar day.
 */
export function parseCountDate(raw: string | null | undefined): Date {
  if (!raw) return new Date();
  const d = new Date(raw);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function formatDateString(dateString: string | null | undefined): string {
  if (!dateString) return '-';
  
  // Parse YYYY-MM-DD string without timezone conversion
  // This avoids the timezone shift bug when using new Date()
  const parts = dateString.slice(0, 10).split('-');
  if (parts.length !== 3) return dateString;
  
  const year = parseInt(parts[0]);
  const month = parseInt(parts[1]);
  const day = parseInt(parts[2]);
  
  // Create date in local timezone (no UTC conversion)
  const date = new Date(year, month - 1, day);
  
  return date.toLocaleDateString();
}
