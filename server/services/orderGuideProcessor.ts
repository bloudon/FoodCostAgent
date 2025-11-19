import { CsvOrderGuide, type CsvParseOptions } from '../integrations/csv/CsvOrderGuide';
import type { VendorKey } from '../integrations/types';
import { ItemMatcher, type MatchConfidence } from './itemMatcher';
import type { IStorage } from '../storage';
import type { InsertOrderGuide, InsertOrderGuideLine } from '@shared/schema';

export interface OrderGuideUploadResult {
  orderGuideId: string;
  totalItems: number;
  highConfidenceMatches: number;
  mediumConfidenceMatches: number;
  lowConfidenceMatches: number;
  noMatches: number;
  readyForReview: boolean;
}

/**
 * Order Guide Processor
 * 
 * Orchestrates the complete workflow for importing vendor order guides:
 * 1. Parse CSV file
 * 2. Match products to inventory items
 * 3. Store in order_guides and order_guide_lines tables
 * 4. Return summary for user review
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

      // Determine match status
      let matchStatus: 'auto_matched' | 'needs_review' | 'new_item';
      if (match.confidence === 'high') {
        matchStatus = 'auto_matched';
      } else if (match.confidence === 'medium' || match.confidence === 'low') {
        matchStatus = 'needs_review';
      } else {
        matchStatus = 'new_item';
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
        innerPack: product.innerPack ?? null,
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

    // Step 4: Bulk insert order guide lines
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
   * Get order guide with lines for review
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
   * Approve and process order guide
   * This creates vendor_items for all matched items
   */
  async approve(params: {
    orderGuideId: string;
    companyId: string;
    approvedBy: string;
    createNewInventoryItems?: boolean;
  }): Promise<{
    vendorItemsCreated: number;
    inventoryItemsCreated: number;
  }> {
    const { orderGuideId, companyId, createNewInventoryItems = false } = params;

    // Get order guide and lines
    const guide = await this.storage.getOrderGuide(orderGuideId);
    if (!guide) {
      throw new Error('Order guide not found');
    }

    if (guide.status !== 'pending') {
      throw new Error('Order guide has already been processed');
    }

    const lines = await this.storage.getOrderGuideLines(orderGuideId);

    let vendorItemsCreated = 0;
    let inventoryItemsCreated = 0;

    // Process matched and ambiguous items first
    const itemsToProcess = lines.filter(
      l => l.matchedInventoryItemId && (l.matchStatus === 'matched' || l.matchStatus === 'ambiguous')
    );

    for (const line of itemsToProcess) {
      // Check if vendor item already exists
      const existingVendorItems = await this.storage.getVendorItems(
        companyId,
        line.vendorSku
      );

      const alreadyExists = existingVendorItems.some(
        vi => vi.vendorId === guide.vendorId && vi.vendorSku === line.vendorSku
      );

      if (!alreadyExists && line.matchedInventoryItemId && guide.vendorId) {
        // Get the inventory item to find its unit
        const inventoryItem = await this.storage.getInventoryItem(line.matchedInventoryItemId);
        
        if (inventoryItem) {
          // Create vendor item
          await this.storage.createVendorItem({
            vendorId: guide.vendorId,
            inventoryItemId: line.matchedInventoryItemId,
            vendorSku: line.vendorSku,
            purchaseUnitId: inventoryItem.unitId,
            caseSize: line.caseSize ?? 1,
            innerPackSize: line.innerPack ?? undefined,
            lastPrice: line.price ?? undefined,
          });

          vendorItemsCreated++;
        }
      }
    }

    // Optionally create new inventory items for unmatched products
    if (createNewInventoryItems) {
      const newItems = lines.filter(l => l.matchStatus === 'new');

      for (const line of newItems) {
        // TODO: Implement auto-creation of inventory items
        // This requires:
        // 1. Default category selection
        // 2. Unit conversion/mapping
        // 3. Store location assignment
        // For now, skip auto-creation - require manual review
      }
    }

    // Mark order guide as approved
    // TODO: Add updateOrderGuide method to storage
    // await this.storage.updateOrderGuide(orderGuideId, { status: 'approved' });

    return {
      vendorItemsCreated,
      inventoryItemsCreated,
    };
  }
}
