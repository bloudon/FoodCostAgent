import { IStorage } from '../storage';
import { CsvOrderGuide, CsvParseOptions } from '../integrations/csv/CsvOrderGuide';
import { ItemMatcher } from './itemMatcher';
import { VendorKey } from '../integrations/types';
import * as XLSX from 'xlsx';
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
   * Detect if content is an Excel file by checking for ZIP/XLSX signatures or OLE/XLS signatures
   */
  private isExcelContent(content: string): boolean {
    // Check if it looks like base64-encoded Excel
    // XLSX files start with "PK" (ZIP signature) which is "UE" in base64
    // XLS files start with 0xD0CF11E0 (OLE signature) which is "0M8R" in base64
    if (content.startsWith('UE') || content.startsWith('0M8R')) {
      return true;
    }
    
    // Also check raw content for binary signatures
    // XLSX/ZIP: starts with "PK" (0x50 0x4B)
    // XLS/OLE: starts with 0xD0 0xCF 0x11 0xE0
    if (content.charCodeAt(0) === 0x50 && content.charCodeAt(1) === 0x4B) {
      return true;
    }
    if (content.charCodeAt(0) === 0xD0 && content.charCodeAt(1) === 0xCF) {
      return true;
    }
    
    return false;
  }

  /**
   * Convert Excel file (base64 or raw binary) to CSV content
   */
  private convertExcelToCsv(content: string, isBase64: boolean = true): string {
    let buffer: Buffer;
    
    if (isBase64) {
      // Decode base64 to binary
      buffer = Buffer.from(content, 'base64');
    } else {
      // Content is raw binary string, convert to buffer
      buffer = Buffer.from(content, 'binary');
    }
    
    // Parse Excel workbook
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    
    // Get first sheet
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    // Convert to CSV
    const csvContent = XLSX.utils.sheet_to_csv(worksheet);
    
    console.log('[OrderGuideProcessor] Converted Excel to CSV, first 500 chars:', csvContent.substring(0, 500));
    
    return csvContent;
  }

  /**
   * Process uploaded order guide (CSV or Excel)
   */
  async processUpload(params: {
    fileContent: string;
    vendorKey: VendorKey;
    vendorId: string | null;
    companyId: string;
    storeId: string;
    fileName: string;
    skipRows?: number;
    isExcel?: boolean;
    columnMapping?: import('../integrations/csv/CsvOrderGuide').CsvColumnMapping;
    canonicalNames?: Map<string, string>; // raw product name → AI-normalized name
  }): Promise<OrderGuideUploadResult> {
    const { fileContent, vendorKey, vendorId, companyId, storeId, fileName, skipRows = 0, isExcel = false, columnMapping, canonicalNames } = params;

    // Step 1: Parse file content (convert Excel to CSV if needed)
    // Auto-detect Excel content even if isExcel flag wasn't set (handles misnamed files like .csv that are actually Excel)
    const isActuallyExcel = isExcel || this.isExcelContent(fileContent);
    
    let csvContent: string;
    if (isActuallyExcel) {
      console.log('[OrderGuideProcessor] Detected Excel file, converting to CSV');
      // If isExcel was explicitly set, assume base64 encoding from frontend
      // If auto-detected, the content might be raw binary (read as text)
      const isBase64 = isExcel || fileContent.startsWith('UE') || fileContent.startsWith('0M8R');
      csvContent = this.convertExcelToCsv(fileContent, isBase64);
    } else {
      csvContent = fileContent;
    }

    // Step 2: Parse CSV
    const parseOptions: CsvParseOptions = {
      vendorKey,
      skipRows,
      ...(columnMapping ? { columnMapping } : {}),
    };

    const orderGuide = await CsvOrderGuide.parse(csvContent, parseOptions);

    if (orderGuide.products.length === 0) {
      throw new Error('No products found in file');
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

    // Step 2b: Supersede any previous order guides for this vendor (skip for generic imports)
    if (vendorId) {
      const supersededCount = await this.storage.supersedePreviousOrderGuides(vendorId, createdGuide.id);
      if (supersededCount > 0) {
        console.log(`[OrderGuideProcessor] Superseded ${supersededCount} previous order guide(s) for vendor ${vendorId}`);
      }
    }

    // Step 3: Match products and create order guide lines
    const lines: InsertOrderGuideLine[] = [];
    const stats = {
      highConfidenceMatches: 0,
      mediumConfidenceMatches: 0,
      lowConfidenceMatches: 0,
      noMatches: 0,
    };

    for (const product of orderGuide.products) {
      // Look up AI-normalized canonical name for this product (if available)
      const canonicalName = canonicalNames?.get(product.vendorProductName) ?? undefined;
      
      // Pass canonical name to matcher — it uses both raw and canonical, takes best score
      const match = await this.matcher.findBestMatch(product, companyId, storeId, canonicalName);

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
        isVariableWeight: product.isVariableWeight ? 1 : 0,
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

    // Fetch matched inventory item names for display in review UI
    const matchedIds = lines
      .filter(l => l.matchedInventoryItemId)
      .map(l => l.matchedInventoryItemId as string);
    
    const inventoryNameMap = new Map<string, string>();
    for (const itemId of matchedIds) {
      try {
        const item = await this.storage.getInventoryItem(itemId);
        if (item) inventoryNameMap.set(itemId, item.name);
      } catch {}
    }

    // Enrich lines with matched item name
    const enrichedLines = lines.map(l => ({
      ...l,
      matchedInventoryItemName: l.matchedInventoryItemId
        ? (inventoryNameMap.get(l.matchedInventoryItemId) ?? null)
        : null,
    }));

    // Group lines by match status
    const grouped = {
      matched: enrichedLines.filter(l => l.matchStatus === 'matched'),
      ambiguous: enrichedLines.filter(l => l.matchStatus === 'ambiguous'),
      new: enrichedLines.filter(l => l.matchStatus === 'new'),
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
   * Now supports multi-store assignment via targetStoreIds array
   */
  async approve(params: {
    orderGuideId: string;
    companyId: string;
    targetStoreIds: string[];
    approvedBy: string;
    importAll?: boolean;
    selectedLineIds?: string[];
    /** Per-line overrides: lineId → inventoryItemId (or 'new' to force item creation) */
    lineOverrides?: Record<string, string>;
    /** Per-line vendor overrides: lineId → vendorId (overrides the guide-level vendor for that row) */
    vendorOverrides?: Record<string, string>;
  }): Promise<{
    vendorItemsCreated: number;
    inventoryItemsCreated: number;
    storeAssignmentsCreated: number;
  }> {
    const { orderGuideId, companyId, targetStoreIds, importAll = false, selectedLineIds = [], lineOverrides = {}, vendorOverrides = {} } = params;

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

    // Validate at least one target store
    if (!targetStoreIds || targetStoreIds.length === 0) {
      const error: any = new Error('At least one target store must be selected');
      error.statusCode = 400;
      throw error;
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
    let storeAssignmentsCreated = 0;

    // Use first target store for smart defaults (category detection, units, etc.)
    const primaryStoreId = targetStoreIds[0];
    const defaults = await this.getSmartDefaults(companyId, primaryStoreId);

    // Pre-build a set of valid company inventory item IDs for defence-in-depth validation.
    // This guards against cross-tenant linkage even if a line's matchedInventoryItemId was
    // set by the matching path (e.g. due to incorrect query scope).
    const companyInventoryItems = await this.storage.getInventoryItems(undefined, undefined, companyId);
    const validCompanyItemIds = new Set(companyInventoryItems.map((i: { id: string }) => i.id));

    // Process items by match status
    // guide.vendorId may be null for generic CSV imports (no specific vendor assigned)
    const guideVendorId = guide.vendorId || null;

    for (const line of linesToProcess) {
      // Apply user-specified line overrides before processing
      // 'new' means force item creation even if fuzzy-matched; any other value = override inventoryItemId
      const lineOverride = lineOverrides[line.id];
      let effectiveLine = line;
      if (lineOverride) {
        if (lineOverride === 'new') {
          effectiveLine = { ...line, matchStatus: 'new', matchedInventoryItemId: null };
        } else {
          effectiveLine = { ...line, matchStatus: 'matched', matchedInventoryItemId: lineOverride };
        }
      }

      // Per-row vendor override: user may assign a different vendor for this specific row
      const effectiveVendorId = vendorOverrides[line.id] ?? guideVendorId;

      if (effectiveLine.matchStatus === 'new') {
        // Create new inventory item + vendor item, assigning to all target stores
        const result = await this.createNewInventoryAndVendorItem(
          effectiveLine, 
          effectiveVendorId, 
          companyId, 
          targetStoreIds, 
          defaults
        );
        if (result.inventoryCreated) inventoryItemsCreated++;
        if (result.vendorItemCreated) vendorItemsCreated++;
        storeAssignmentsCreated += result.storeAssignmentsCreated;
      } else if (effectiveLine.matchedInventoryItemId) {
        // SECURITY: Defence-in-depth — verify matched item belongs to this company
        // before creating any vendor item or store assignment
        if (!validCompanyItemIds.has(effectiveLine.matchedInventoryItemId)) {
          console.error(`[OrderGuide] Skipping line ${line.id}: matchedInventoryItemId ${effectiveLine.matchedInventoryItemId} does not belong to company ${companyId}`);
          continue;
        }

        // Create vendor item linking to existing inventory (only if we have a vendor)
        if (effectiveVendorId) {
          const created = await this.createVendorItemForExisting(effectiveLine, effectiveVendorId, companyId);
          if (created) vendorItemsCreated++;
        }
        
        // Assign existing inventory item to all target stores
        const assignmentsCreated = await this.assignInventoryItemToStores(
          effectiveLine.matchedInventoryItemId, 
          companyId, 
          targetStoreIds
        );
        storeAssignmentsCreated += assignmentsCreated;
      }
    }

    return {
      vendorItemsCreated,
      inventoryItemsCreated,
      storeAssignmentsCreated,
    };
  }

  /**
   * Assign an existing inventory item to multiple stores
   */
  private async assignInventoryItemToStores(
    inventoryItemId: string,
    companyId: string,
    targetStoreIds: string[]
  ): Promise<number> {
    let assignmentsCreated = 0;
    
    for (const storeId of targetStoreIds) {
      try {
        // Check if already assigned
        const existing = await this.storage.getStoreInventoryItems(storeId);
        const alreadyAssigned = existing.find(item => item.inventoryItemId === inventoryItemId);
        
        if (!alreadyAssigned) {
          await this.storage.createStoreInventoryItem({
            companyId,
            inventoryItemId,
            storeId,
            active: 1,
            onHandQty: 0,
          });
          assignmentsCreated++;
        }
      } catch (error) {
        // Log but continue - don't fail the whole import for one store assignment
        console.error(`[OrderGuide] Error assigning inventory ${inventoryItemId} to store ${storeId}:`, error);
      }
    }
    
    return assignmentsCreated;
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

    // Try semantic mapping - use exact matching to avoid false positives (e.g., "ct" matching "c" for cup)
    for (const [unitName, variants] of Object.entries(uomMappings)) {
      if (variants.some(variant => uom === variant)) {
        const unit = defaults.units.find((u: any) => u.name.toLowerCase() === unitName);
        if (unit) return unit.id;
      }
    }

    // Fallback to default unit (Pound)
    return defaults.unitId;
  }

  /**
   * Create new inventory item and vendor item for unmatched product
   * Now supports multi-store assignment via targetStoreIds array
   */
  private async createNewInventoryAndVendorItem(
    line: any,
    vendorId: string | null,
    companyId: string,
    targetStoreIds: string[],
    defaults: any
  ): Promise<{ inventoryCreated: boolean; vendorItemCreated: boolean; storeAssignmentsCreated: number }> {
    try {
      // Detect category
      const categoryId = await this.detectCategory(line.category, defaults);

      // Map unit
      const unitId = await this.mapVendorUnitToSystemUnit(line.uom, defaults);

      // Ensure we have required fields
      if (!unitId) {
        console.error('[OrderGuide] Cannot create inventory item without unit');
        return { inventoryCreated: false, vendorItemCreated: false, storeAssignmentsCreated: 0 };
      }

      // Calculate unit price from case price
      // line.price is the CASE price; caseSize now equals total units per case (innerPack folded in)
      // Guard against zero/negative values that would cause Infinity
      const rawCaseSize = Math.max(line.caseSize ?? 1, 1);
      const rawInnerPack = Math.max(line.innerPack ?? 1, 1);
      const totalUnitsPerCase = rawCaseSize * rawInnerPack; // merged caseSize
      const unitPrice = line.price ? line.price / totalUnitsPerCase : 0;

      // Create inventory item with smart defaults
      const inventoryItem = await this.storage.createInventoryItem({
        companyId,
        name: line.productName,
        categoryId: categoryId || undefined,
        unitId: unitId,
        pricePerUnit: unitPrice,
        avgCostPerUnit: unitPrice, // Initialize WAC with first price
        yieldPercent: 100,
        parLevel: 0,
        reorderLevel: 0,
        active: 1,
        isVariableWeight: line.isVariableWeight || 0,
      });

      // Assign to store location
      if (defaults.storageLocationId) {
        await this.storage.setInventoryItemLocations(
          inventoryItem.id,
          [defaults.storageLocationId],
          defaults.storageLocationId
        );
      }

      // Assign to ALL target stores
      let storeAssignmentsCreated = 0;
      for (const storeId of targetStoreIds) {
        try {
          await this.storage.createStoreInventoryItem({
            companyId,
            inventoryItemId: inventoryItem.id,
            storeId,
            active: 1,
            onHandQty: 0,
          });
          storeAssignmentsCreated++;
        } catch (error) {
          // Log but continue - don't fail for one store assignment
          console.error(`[OrderGuide] Error assigning to store ${storeId}:`, error);
        }
      }

      // Create vendor item (only if a vendor is assigned)
      // Fold innerPack into caseSize: total units per case = caseSize × innerPack
      let vendorItemCreated = false;
      if (vendorId) {
        const mergedCaseSize = (line.caseSize ?? 1) * Math.max(line.innerPack ?? 1, 1);
        await this.storage.createVendorItem({
          vendorId,
          inventoryItemId: inventoryItem.id,
          vendorSku: line.vendorSku,
          brandName: line.brandName ?? undefined,
          purchaseUnitId: unitId,
          caseSize: mergedCaseSize,
          lastPrice: unitPrice > 0 ? unitPrice : (line.price ?? undefined),
          lastCasePrice: line.price ?? undefined,
        });
        vendorItemCreated = true;
      }

      return { inventoryCreated: true, vendorItemCreated, storeAssignmentsCreated };
    } catch (error) {
      console.error('[OrderGuide] Error creating new inventory item:', error);
      return { inventoryCreated: false, vendorItemCreated: false, storeAssignmentsCreated: 0 };
    }
  }

  /**
   * Create vendor item for existing inventory item
   * Also syncs case size and pricing from vendor data to the linked inventory item
   */
  private async createVendorItemForExisting(
    line: { vendorSku: string; brandName?: string | null; matchedInventoryItemId?: string | null; caseSize?: number | null; innerPack?: number | null; price?: number | null },
    vendorId: string,
    companyId: string
  ): Promise<boolean> {
    try {
      if (!line.matchedInventoryItemId) {
        return false;
      }

      // Check if vendor item already exists for this vendor+SKU combination
      // Signature: getVendorItems(vendorId?, companyId?, storeId?)
      const existingVendorItems = await this.storage.getVendorItems(vendorId, companyId);
      const existing = existingVendorItems.find(
        vi => vi.vendorId === vendorId && vi.vendorSku === line.vendorSku
      );

      // Get the inventory item to find its unit
      const inventoryItem = await this.storage.getInventoryItem(line.matchedInventoryItemId);
      if (!inventoryItem) {
        return false;
      }

      if (existing) {
        // Vendor item already exists — update pricing if we have new price data
        // This ensures matched imports always refresh vendor pricing
        if (line.price != null && line.price > 0) {
          // Fold innerPack into caseSize: total units per case = caseSize × innerPack
          const mergedCaseSize = Math.max(line.caseSize ?? 1, 1) * Math.max(line.innerPack ?? 1, 1);
          const unitPrice = line.price / mergedCaseSize;
          await this.storage.updateVendorItem(existing.id, {
            lastPrice: unitPrice,
            lastCasePrice: line.price,
            caseSize: mergedCaseSize,
          });
          // Also propagate updated pricing to inventory item
          await this.syncVendorDataToInventoryItem(line, inventoryItem);
        }
        return false; // did not CREATE a new record, but did update
      }

      // No existing vendor item — create one; fold innerPack into caseSize
      const mergedCaseSize = (line.caseSize ?? 1) * Math.max(line.innerPack ?? 1, 1);
      const caseUnitPrice = line.price != null && line.price > 0 && mergedCaseSize > 0
        ? line.price / mergedCaseSize
        : (line.price ?? undefined);
      await this.storage.createVendorItem({
        vendorId,
        inventoryItemId: line.matchedInventoryItemId,
        vendorSku: line.vendorSku,
        brandName: line.brandName ?? undefined,
        purchaseUnitId: inventoryItem.unitId,
        caseSize: mergedCaseSize,
        lastPrice: caseUnitPrice,
        lastCasePrice: line.price ?? undefined,
      });

      // Sync vendor data to linked inventory item
      await this.syncVendorDataToInventoryItem(line, inventoryItem);

      return true;
    } catch (error) {
      console.error('[OrderGuide] Error creating vendor item:', error);
      return false;
    }
  }

  /**
   * Sync vendor data (price, case size, variable weight) to linked inventory item
   */
  private async syncVendorDataToInventoryItem(
    line: any,
    inventoryItem: any
  ): Promise<void> {
    try {
      const updates: any = {};
      
      // Sync price if vendor has pricing data
      // line.price is the CASE price; fold innerPack into caseSize for total units per case
      // Guard against zero/negative values that would cause Infinity
      if (line.price && line.price > 0) {
        const rawCaseSize = Math.max(line.caseSize ?? 1, 1);
        const rawInnerPack = Math.max(line.innerPack ?? 1, 1);
        const totalUnitsPerCase = rawCaseSize * rawInnerPack;
        const unitPrice = line.price / totalUnitsPerCase;
        updates.pricePerUnit = unitPrice;
        console.log(`[OrderGuide] Syncing unit price ${unitPrice.toFixed(4)} (case price ${line.price} ÷ ${totalUnitsPerCase} units) to inventory item ${inventoryItem.id}`);
      }
      
      // Sync merged case size (innerPack folded in) if vendor has case size data
      if (line.caseSize && line.caseSize > 0) {
        const mergedCaseSize = line.caseSize * Math.max(line.innerPack ?? 1, 1);
        updates.caseSize = mergedCaseSize;
        console.log(`[OrderGuide] Syncing case size ${mergedCaseSize} to inventory item ${inventoryItem.id}`);
      }
      
      // Sync variable weight flag if vendor marks item as variable weight
      if (line.isVariableWeight === 1 && inventoryItem.isVariableWeight !== 1) {
        updates.isVariableWeight = 1;
        console.log(`[OrderGuide] Setting variable weight flag on inventory item ${inventoryItem.id}`);
      }
      
      // Only update if there are changes
      if (Object.keys(updates).length > 0) {
        await this.storage.updateInventoryItem(inventoryItem.id, updates);
      }
    } catch (error) {
      console.error('[OrderGuide] Error syncing vendor data to inventory item:', error);
    }
  }
}
