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
    // Get all inventory items for this company
    const inventoryItems = await this.storage.getInventoryItems(companyId);
    
    if (inventoryItems.length === 0) {
      return {
        inventoryItemId: null,
        inventoryItemName: null,
        confidence: 'none',
        score: 0,
        matchReason: 'No inventory items in system',
      };
    }

    let bestMatch: MatchResult = {
      inventoryItemId: null,
      inventoryItemName: null,
      confidence: 'none',
      score: 0,
      matchReason: 'No match found',
    };

    // Try each matching strategy
    for (const item of inventoryItems) {
      const scores = {
        name: this.calculateNameSimilarity(vendorProduct.vendorProductName, item.name),
        sku: this.checkSkuMatch(vendorProduct.vendorSku, item.pluSku),
        category: 0, // TODO: Implement category matching
      };

      // Calculate weighted score
      const totalScore = (
        scores.name * 0.7 +  // Name is most important
        scores.sku * 0.3     // SKU is secondary
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
