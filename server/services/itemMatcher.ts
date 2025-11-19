import type { VendorProduct } from '../integrations/types';
import type { IStorage } from '../storage';

export type MatchConfidence = 'high' | 'medium' | 'low' | 'none';

export interface MatchResult {
  inventoryItemId: string | null;
  inventoryItemName: string | null;
  confidence: MatchConfidence;
  score: number;
  matchReason: string;
}

/**
 * Smart Item Matching Engine
 * 
 * Matches vendor products to existing inventory items using:
 * - Fuzzy name matching (string similarity)
 * - Category matching
 * - SKU detection
 * - Multi-factor confidence scoring
 */
export class ItemMatcher {
  constructor(private storage: IStorage) {}

  /**
   * Find best matching inventory item for a vendor product
   */
  async findBestMatch(
    vendorProduct: VendorProduct,
    companyId: string,
    storeId: string
  ): Promise<MatchResult> {
    // Get all inventory items and categories for this company
    const [inventoryItems, categories] = await Promise.all([
      this.storage.getInventoryItems(companyId),
      this.storage.getCategories(companyId)
    ]);
    
    if (inventoryItems.length === 0) {
      return {
        inventoryItemId: null,
        inventoryItemName: null,
        confidence: 'none',
        score: 0,
        matchReason: 'No inventory items in system',
      };
    }

    // Build category lookup map
    const categoryMap = new Map(categories.map(c => [c.id, c.name]));

    let bestMatch: MatchResult = {
      inventoryItemId: null,
      inventoryItemName: null,
      confidence: 'none',
      score: 0,
      matchReason: 'No match found',
    };

    // Try each matching strategy
    for (const item of inventoryItems) {
      const itemCategoryName = item.categoryId ? categoryMap.get(item.categoryId) : null;
      
      const scores = {
        name: this.calculateNameSimilarity(vendorProduct.vendorProductName, item.name),
        sku: this.checkSkuMatch(vendorProduct.vendorSku, item.pluSku),
        category: this.calculateCategoryMatch(vendorProduct.categoryCode, itemCategoryName),
      };

      // Calculate weighted score
      const totalScore = (
        scores.name * 0.6 +     // Name is most important
        scores.sku * 0.25 +     // SKU is secondary
        scores.category * 0.15  // Category provides additional signal
      );

      if (totalScore > bestMatch.score) {
        const confidence = this.determineConfidence(totalScore, scores);
        const matchReason = this.buildMatchReason(scores);

        bestMatch = {
          inventoryItemId: item.id,
          inventoryItemName: item.name,
          confidence,
          score: totalScore,
          matchReason,
        };
      }
    }

    return bestMatch;
  }

  /**
   * Calculate string similarity using Levenshtein distance
   */
  private calculateNameSimilarity(str1: string, str2: string): number {
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();

    // Exact match
    if (s1 === s2) return 1.0;

    // Substring match
    if (s1.includes(s2) || s2.includes(s1)) return 0.8;

    // Levenshtein distance
    const distance = this.levenshteinDistance(s1, s2);
    const maxLength = Math.max(s1.length, s2.length);
    const similarity = 1 - (distance / maxLength);

    return Math.max(0, similarity);
  }

  /**
   * Levenshtein distance algorithm
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Check if SKUs match
   */
  private checkSkuMatch(vendorSku: string, inventorySku?: string | null): number {
    if (!vendorSku || !inventorySku) return 0;

    const v = vendorSku.toLowerCase().trim();
    const i = inventorySku.toLowerCase().trim();

    if (v === i) return 1.0;
    if (v.includes(i) || i.includes(v)) return 0.5;

    return 0;
  }

  /**
   * Calculate category match score
   * Maps vendor category codes (e.g., "DAIRY", "PRODUCE") to inventory category names
   */
  private calculateCategoryMatch(vendorCategory?: string | null, inventoryCategory?: string | null): number {
    if (!vendorCategory || !inventoryCategory) return 0;

    const v = vendorCategory.toLowerCase().trim();
    const i = inventoryCategory.toLowerCase().trim();

    // Exact match
    if (v === i) return 1.0;

    // Substring match (e.g., "frozen" matches "frozen foods")
    if (v.includes(i) || i.includes(v)) return 0.8;

    // Common category mappings (vendor codes to common names)
    const categoryMappings: Record<string, string[]> = {
      'dairy': ['dairy', 'milk', 'cheese', 'walk-in'],
      'frozen': ['frozen', 'freezer'],
      'produce': ['produce', 'fruits', 'vegetables', 'fresh'],
      'meat': ['meat', 'protein', 'butcher', 'walk-in'],
      'dry': ['dry', 'pantry', 'grocery'],
      'beverage': ['beverage', 'drinks', 'soda'],
      'bakery': ['bakery', 'bread', 'baked goods'],
    };

    // Check if vendor category maps to inventory category
    for (const [key, variants] of Object.entries(categoryMappings)) {
      if (v.includes(key) || variants.some(variant => v.includes(variant))) {
        if (variants.some(variant => i.includes(variant))) {
          return 0.7; // Good semantic match
        }
      }
    }

    // Fuzzy similarity for unmapped categories
    const similarity = this.calculateNameSimilarity(v, i);
    return similarity > 0.5 ? similarity * 0.6 : 0; // Scale down fuzzy category matches
  }

  /**
   * Determine confidence level based on scores
   */
  private determineConfidence(
    totalScore: number,
    scores: { name: number; sku: number; category: number }
  ): MatchConfidence {
    // High confidence: strong name match OR exact SKU match
    if (totalScore >= 0.85 || scores.sku === 1.0) {
      return 'high';
    }

    // Medium confidence: decent name match
    if (totalScore >= 0.65) {
      return 'medium';
    }

    // Low confidence: some similarity
    if (totalScore >= 0.45) {
      return 'low';
    }

    return 'none';
  }

  /**
   * Build human-readable match reason
   */
  private buildMatchReason(scores: { name: number; sku: number; category: number }): string {
    const reasons: string[] = [];

    if (scores.name >= 0.9) {
      reasons.push('Strong name match');
    } else if (scores.name >= 0.7) {
      reasons.push('Good name match');
    } else if (scores.name >= 0.5) {
      reasons.push('Partial name match');
    }

    if (scores.sku === 1.0) {
      reasons.push('Exact SKU match');
    } else if (scores.sku > 0) {
      reasons.push('Partial SKU match');
    }

    return reasons.length > 0 ? reasons.join(', ') : 'Low similarity';
  }

  /**
   * Batch match multiple vendor products
   */
  async batchMatch(
    vendorProducts: VendorProduct[],
    companyId: string,
    storeId: string
  ): Promise<Map<string, MatchResult>> {
    const results = new Map<string, MatchResult>();

    for (const product of vendorProducts) {
      const match = await this.findBestMatch(product, companyId, storeId);
      results.set(product.vendorSku, match);
    }

    return results;
  }
}
