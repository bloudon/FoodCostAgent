// Enriched response types for API endpoints
// These ensure type safety between backend serialization and frontend consumption

export interface EnrichedInventoryItem {
  id: string;
  name: string;
  categoryId: string | null;
  category: string | null;
  pluSku: string | null;
  pricePerUnit: number;
  avgCostPerUnit: number;
  unitId: string;
  caseSize: number;
  yieldPercent: number;
  imageUrl: string | null;
  parLevel: number | null;
  reorderLevel: number | null;
  storageLocationId: string | null;
  onHandQty: number;
  active: number;
  locations: Array<{
    id: string;
    name: string;
    isPrimary: boolean;
  }>;
  unit: {
    id: string;
    name: string;
    abbreviation: string;
  };
}

export interface EnrichedRecipe {
  id: string;
  name: string;
  description: string | null;
  yieldQty: number;
  yieldUnitId: string;
  canBeIngredient: number;
  isPlaceholder: number;
  active: number;
  companyId: string;
  components: Array<{
    id: string;
    quantity: number;
    unitId: string;
    inventoryItemId: string | null;
    subRecipeId: string | null;
    sortOrder: number;
  }>;
  totalCost: number;
  costPerUnit: number;
}

export interface EnrichedMenuItem {
  id: string;
  name: string;
  pluSku: string | null;
  department: string | null;
  category: string | null;
  size: string | null;
  price: number | null;
  isRecipeItem: number;
  recipeId: string | null;
  active: number;
  recipeCost: number | null;
  foodCostPercent: number | null;
}
