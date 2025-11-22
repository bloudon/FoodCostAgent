import { IStorage } from '../storage';
import { CsvOrderGuide, CsvParseOptions } from '../integrations/csv/CsvOrderGuide';
import { ItemMatcher } from './itemMatcher';
import { VendorKey } from '../integrations/types';
import type {
  InsertOrderGuide,
  InsertOrderGuideLine,
} from '@shared/schema';

interface OrderGuideUploadResult {
  orderGuideId: string;
  totalItems: number;
  highConfidenceMatches: number;
  mediumConfidenceMatches: number;
  lowConfidenceMatches: number;
  noMatches: number;
  readyForReview: boolean;
}

/**
 * OrderGuideProcessor - Handles vendor order guide import workflow
 */
export class OrderGuideProcessor {
  private matcher: ItemMatcher;

  constructor(private storage: IStorage) {
    this.matcher = new ItemMatcher(storage);
  }

  /**
   * Process uploaded order guide CSV
   */
  async processUpload(params: {
    csvContent: string;
    vendorKey: VendorKey;
    vendorId: string;
    companyId: string;
    storeId: string;
    fileName: string;
    skipRows?: number;
  }): Promise<OrderGuideUploadResult> {
    const { csvContent, vendorKey, vendorId, companyId, storeId, fileName, skipRows = 0 } = params;

    // Step 1: Parse CSV
    const parseOptions: CsvParseOptions = {
      vendorKey,
      skipRows,
    };

    const orderGuide = await CsvOrderGuide.parse(csvContent, parseOptions);

    if (orderGuide.products.length === 0) {
      throw new Error('No products found in CSV file');
    }

    // Step 2: Create order guide record
    const guideInsert: InsertOrderGuide = {
      companyId,
      vendorId,
      vendorKey,
      fileName,
      rowCount: orderGuide.products.length,
      status: 'pending_review',
      source: 'csv',
    };

    const createdGuide = await this.storage.createOrderGuide(guideInsert);

    // Step 3: Match products and create order guide lines
    const lines: InsertOrderGuideLine[] = [];
    const stats = {
      highConfidenceMatches: 0,
      mediumConfidenceMatches: 0,
      lowConfidenceMatches: 0,
      noMatches: 0,
    };

    for (const product of orderGuide.products) {
      const match = await this.matcher.findBestMatch(product, companyId, storeId);

      // Update stats
      if (match.confidence === 'high') stats.highConfidenceMatches++;
      else if (match.confidence === 'medium') stats.mediumConfidenceMatches++;
      else if (match.confidence === 'low') stats.lowConfidenceMatches++;
      else stats.noMatches++;

      // Determine match status (aligned with getForReview() expectations)
      let matchStatus: 'matched' | 'ambiguous' | 'new';
      if (match.confidence === 'high') {
        matchStatus = 'matched';  // High confidence = auto-matched
      } else if (match.confidence === 'medium' || match.confidence === 'low') {
        matchStatus = 'ambiguous';  // Medium/low confidence = needs review
      } else {
        matchStatus = 'new';  // No match = new item
      }

      // Convert match score to 0-100 range
      const matchConfidenceScore = Math.round(match.score * 100);

      const line: InsertOrderGuideLine = {
        orderGuideId: createdGuide.id,
        vendorSku: product.vendorSku,
        productName: product.vendorProductName,
        packSize: product.description,
        uom: product.unit,
        caseSize: product.caseSize ?? null,
        caseSizeRaw: product.caseSizeRaw ?? null,         // Preserve raw pack string (e.g., "6/5 LB")
        innerPack: product.innerPack ?? null,
        innerPackRaw: product.innerPackRaw ?? null,      // Preserve raw inner pack string
        price: product.price ?? null,
        brandName: product.brandName,
        category: product.categoryCode,
        gtin: product.upc,
        matchStatus,
        matchedInventoryItemId: match.inventoryItemId,
        matchConfidence: matchConfidenceScore,
      };

      lines.push(line);
    }

    // Step 4: Batch create order guide lines
    await this.storage.createOrderGuideLinesBatch(lines);

    // Step 5: Return summary
    return {
      orderGuideId: createdGuide.id,
      totalItems: orderGuide.products.length,
      highConfidenceMatches: stats.highConfidenceMatches,
      mediumConfidenceMatches: stats.mediumConfidenceMatches,
      lowConfidenceMatches: stats.lowConfidenceMatches,
      noMatches: stats.noMatches,
      readyForReview: true,
    };
  }

  /**
   * Get order guide for review
   */
  async getForReview(orderGuideId: string) {
    const guide = await this.storage.getOrderGuide(orderGuideId);
    if (!guide) {
      throw new Error('Order guide not found');
    }

    const lines = await this.storage.getOrderGuideLines(orderGuideId);

    // Group lines by match status
    const grouped = {
      matched: lines.filter(l => l.matchStatus === 'matched'),
      ambiguous: lines.filter(l => l.matchStatus === 'ambiguous'),
      new: lines.filter(l => l.matchStatus === 'new'),
    };

    return {
      guide,
      lines: grouped,
      summary: {
        total: lines.length,
        matched: grouped.matched.length,
        ambiguous: grouped.ambiguous.length,
        new: grouped.new.length,
      },
    };
  }

  /**
   * Approve and process order guide with selective import
   */
  async approve(params: {
    orderGuideId: string;
    companyId: string;
    storeId: string;
    approvedBy: string;
    importAll?: boolean;
    selectedLineIds?: string[];
  }): Promise<{
    vendorItemsCreated: number;
    inventoryItemsCreated: number;
  }> {
    const { orderGuideId, companyId, storeId, importAll = false, selectedLineIds = [] } = params;

    // Get order guide and lines
    const guide = await this.storage.getOrderGuide(orderGuideId);
    if (!guide) {
      throw new Error('Order guide not found');
    }

    // SECURITY: Validate multi-tenant isolation - guide must belong to requesting company
    if (guide.companyId !== companyId) {
      throw new Error('Order guide does not belong to this company');
    }

    // SECURITY: Validate order guide status
    if (guide.status !== 'pending_review') {
      throw new Error('Order guide has already been processed');
    }

    // Get all lines belonging to this order guide
    const allLines = await this.storage.getOrderGuideLines(orderGuideId);
    
    // SECURITY: Create a Set of valid line IDs from the fetched guide
    const validLineIds = new Set(allLines.map(line => line.id));
    
    // Filter lines based on selection mode
    let linesToProcess: typeof allLines;
    if (importAll) {
      // Import all lines from this guide
      linesToProcess = allLines;
    } else {
      // SECURITY: Only process lines that:
      // 1. Are in the selectedLineIds array AND
      // 2. Actually belong to this order guide (defense against ID injection)
      linesToProcess = allLines.filter(line => 
        selectedLineIds.includes(line.id) && validLineIds.has(line.id)
      );
    }

    // Validate we have items to process
    if (linesToProcess.length === 0) {
      const error: any = new Error('No valid items selected for import');
      error.statusCode = 400; // Mark as client error (bad selection)
      throw error;
    }

    let vendorItemsCreated = 0;
    let inventoryItemsCreated = 0;

    // Get smart defaults
    const defaults = await this.getSmartDefaults(companyId, storeId);

    // Process items by match status
    for (const line of linesToProcess) {
      if (line.matchStatus === 'new') {
        // Create new inventory item + vendor item
        const result = await this.createNewInventoryAndVendorItem(line, guide.vendorId!, companyId, storeId, defaults);
        if (result.inventoryCreated) inventoryItemsCreated++;
        if (result.vendorItemCreated) vendorItemsCreated++;
      } else if (line.matchedInventoryItemId) {
        // Create vendor item linking to existing inventory
        const created = await this.createVendorItemForExisting(line, guide.vendorId!, companyId);
        if (created) vendorItemsCreated++;
      }
    }

    return {
      vendorItemsCreated,
      inventoryItemsCreated,
    };
  }

  /**
   * Get smart defaults for auto-creating inventory items
   */
  private async getSmartDefaults(companyId: string, storeId: string) {
    // Get default category (Dry/Pantry as fallback)
    const companyCategories = await this.storage.getCategories(companyId);
    const defaultCategory = companyCategories.find(c => 
      c.name.toLowerCase().includes('dry') || c.name.toLowerCase().includes('pantry')
    ) || companyCategories[0];

    // Get default unit (Pound)
    const allUnits = await this.storage.getUnits();
    const defaultUnit = allUnits.find(u => u.name.toLowerCase() === 'pound') || allUnits[0];

    // Get default storage location for this store
    const storageLocations = await this.storage.getStorageLocations(companyId);
    const defaultStorageLocation = storageLocations.find(sl => 
      sl.name.toLowerCase().includes('dry') || sl.name.toLowerCase().includes('pantry')
    ) || storageLocations[0];

    return {
      categoryId: defaultCategory?.id || null,
      unitId: defaultUnit?.id || null,
      storageLocationId: defaultStorageLocation?.id || null,
      categories: companyCategories,
      units: allUnits,
    };
  }

  /**
   * Map vendor category code to company category
   */
  private async detectCategory(vendorCategoryCode: string | null, defaults: any): Promise<string | null> {
    if (!vendorCategoryCode) return defaults.categoryId;

    const vendorCat = vendorCategoryCode.toLowerCase();

    // Category mapping logic
    const categoryMappings: Record<string, string[]> = {
      'frozen': ['frozen', 'freezer', 'ice cream'],
      'dairy': ['dairy', 'milk', 'cheese', 'yogurt', 'butter', 'cream', 'refrigerated', 'cooler', 'walk-in'],
      'produce': ['produce', 'fruits', 'vegetables', 'fresh', 'salad', 'greens'],
      'meat': ['protein', 'meat', 'poultry', 'chicken', 'beef', 'pork', 'butcher'],
      'seafood': ['seafood', 'fish', 'shellfish', 'salmon', 'shrimp'],
      'dry': ['dry', 'pantry', 'grocery', 'shelf-stable', 'canned'],
      'beverage': ['beverage', 'drinks', 'soda', 'juice', 'water', 'coffee'],
      'bakery': ['bakery', 'bread', 'baked goods', 'pastry'],
    };

    // Try to match vendor category to company categories
    for (const category of defaults.categories) {
      const categoryName = category.name.toLowerCase();
      
      // Exact or substring match
      if (vendorCat.includes(categoryName) || categoryName.includes(vendorCat)) {
        return category.id;
      }

      // Semantic mapping
      for (const [key, variants] of Object.entries(categoryMappings)) {
        const vendorMatches = variants.some(variant => vendorCat.includes(variant));
        const categoryMatches = variants.some(variant => categoryName.includes(variant));
        
        if (vendorMatches && categoryMatches) {
          return category.id;
        }
      }
    }

    // Fallback to default category
    return defaults.categoryId;
  }

  /**
   * Map vendor UOM to system unit
   */
  private async mapVendorUnitToSystemUnit(vendorUom: string | null, defaults: any): Promise<string | null> {
    if (!vendorUom) return defaults.unitId;

    const uom = vendorUom.toLowerCase().trim();

    // Direct abbreviation matches
    const abbrevMatch = defaults.units.find((u: any) => 
      u.abbreviation.toLowerCase() === uom || u.name.toLowerCase() === uom
    );
    if (abbrevMatch) return abbrevMatch.id;

    // Common UOM mappings
    const uomMappings: Record<string, string[]> = {
      'pound': ['lb', 'lbs', 'pound', 'pounds', '#'],
      'ounce': ['oz', 'ounce', 'ounces'],
      'gram': ['g', 'gram', 'grams'],
      'kilogram': ['kg', 'kilo', 'kilogram', 'kilograms'],
      'gallon': ['gal', 'gallon', 'gallons'],
      'quart': ['qt', 'quart', 'quarts'],
      'pint': ['pt', 'pint', 'pints'],
      'cup': ['c', 'cup', 'cups'],
      'fluid ounce': ['fl oz', 'fluid ounce', 'fluid ounces'],
      'liter': ['l', 'liter', 'liters', 'litre', 'litres'],
      'milliliter': ['ml', 'milliliter', 'milliliters'],
      'each': ['ea', 'each', 'unit', 'piece', 'count', 'ct'],
    };

    // Try semantic mapping
    for (const [unitName, variants] of Object.entries(uomMappings)) {
      if (variants.some(variant => uom.includes(variant))) {
        const unit = defaults.units.find((u: any) => u.name.toLowerCase() === unitName);
        if (unit) return unit.id;
      }
    }

    // Fallback to default unit (Pound)
    return defaults.unitId;
  }

  /**
   * Create new inventory item and vendor item for unmatched product
   */
  private async createNewInventoryAndVendorItem(
    line: any,
    vendorId: string,
    companyId: string,
    storeId: string,
    defaults: any
  ): Promise<{ inventoryCreated: boolean; vendorItemCreated: boolean }> {
    try {
      // Detect category
      const categoryId = await this.detectCategory(line.category, defaults);

      // Map unit
      const unitId = await this.mapVendorUnitToSystemUnit(line.uom, defaults);

      // Ensure we have required fields
      if (!unitId) {
        console.error('[OrderGuide] Cannot create inventory item without unit');
        return { inventoryCreated: false, vendorItemCreated: false };
      }

      // Create inventory item with smart defaults
      const inventoryItem = await this.storage.createInventoryItem({
        companyId,
        name: line.productName,
        categoryId: categoryId || undefined,
        unitId: unitId,
        pricePerUnit: line.price || 0,
        avgCostPerUnit: line.price || 0, // Initialize WAC with first price
        yieldPercent: 100,
        parLevel: 0,
        reorderLevel: 0,
        active: 1,
      });

      // Assign to store location
      if (defaults.storageLocationId) {
        await this.storage.setInventoryItemLocations(
          inventoryItem.id,
          [defaults.storageLocationId],
          defaults.storageLocationId
        );
      }

      // Assign to store
      await this.storage.createStoreInventoryItem({
        companyId,
        inventoryItemId: inventoryItem.id,
        storeId,
        active: 1,
        onHandQty: 0,
      });

      // Create vendor item
      const vendorItem = await this.storage.createVendorItem({
        vendorId,
        inventoryItemId: inventoryItem.id,
        vendorSku: line.vendorSku,
        purchaseUnitId: unitId,
        caseSize: line.caseSize ?? 1,
        innerPackSize: line.innerPack ?? undefined,
        lastPrice: line.price ?? undefined,
      });

      return { inventoryCreated: true, vendorItemCreated: true };
    } catch (error) {
      console.error('[OrderGuide] Error creating new inventory item:', error);
      return { inventoryCreated: false, vendorItemCreated: false };
    }
  }

  /**
   * Create vendor item for existing inventory item
   */
  private async createVendorItemForExisting(
    line: any,
    vendorId: string,
    companyId: string
  ): Promise<boolean> {
    try {
      // Check if vendor item already exists
      const existingVendorItems = await this.storage.getVendorItems(companyId, line.vendorSku);
      const alreadyExists = existingVendorItems.some(
        vi => vi.vendorId === vendorId && vi.vendorSku === line.vendorSku
      );

      if (alreadyExists) {
        return false;
      }

      if (!line.matchedInventoryItemId) {
        return false;
      }

      // Get the inventory item to find its unit
      const inventoryItem = await this.storage.getInventoryItem(line.matchedInventoryItemId);
      
      if (!inventoryItem) {
        return false;
      }

      // Create vendor item
      await this.storage.createVendorItem({
        vendorId,
        inventoryItemId: line.matchedInventoryItemId,
        vendorSku: line.vendorSku,
        purchaseUnitId: inventoryItem.unitId,
        caseSize: line.caseSize ?? 1,
        innerPackSize: line.innerPack ?? undefined,
        lastPrice: line.price ?? undefined,
      });

      return true;
    } catch (error) {
      console.error('[OrderGuide] Error creating vendor item:', error);
      return false;
    }
  }
}
