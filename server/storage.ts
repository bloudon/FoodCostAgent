import { eq, and, gte, lte } from "drizzle-orm";
import { db } from "./db";
import {
  users, type User, type InsertUser,
  storageLocations, type StorageLocation, type InsertStorageLocation,
  units, type Unit, type InsertUnit,
  products, type Product, type InsertProduct,
  vendors, type Vendor, type InsertVendor,
  vendorProducts, type VendorProduct, type InsertVendorProduct,
  recipes, type Recipe, type InsertRecipe,
  recipeComponents, type RecipeComponent, type InsertRecipeComponent,
  inventoryLevels, type InventoryLevel, type InsertInventoryLevel,
  inventoryCounts, type InventoryCount, type InsertInventoryCount,
  inventoryCountLines, type InventoryCountLine, type InsertInventoryCountLine,
  purchaseOrders, type PurchaseOrder, type InsertPurchaseOrder,
  poLines, type POLine, type InsertPOLine,
  receipts, type Receipt, type InsertReceipt,
  receiptLines, type ReceiptLine, type InsertReceiptLine,
  posSales, type POSSale, type InsertPOSSale,
  posSalesLines, type POSSalesLine, type InsertPOSSalesLine,
  menuItems, type MenuItem, type InsertMenuItem,
} from "@shared/schema";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Storage Locations
  getStorageLocations(): Promise<StorageLocation[]>;
  getStorageLocation(id: string): Promise<StorageLocation | undefined>;
  createStorageLocation(location: InsertStorageLocation): Promise<StorageLocation>;

  // Units
  getUnits(): Promise<Unit[]>;
  getUnit(id: string): Promise<Unit | undefined>;
  createUnit(unit: InsertUnit): Promise<Unit>;

  // Products
  getProducts(): Promise<Product[]>;
  getProduct(id: string): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: string, product: Partial<Product>): Promise<Product | undefined>;

  // Vendors
  getVendors(): Promise<Vendor[]>;
  getVendor(id: string): Promise<Vendor | undefined>;
  createVendor(vendor: InsertVendor): Promise<Vendor>;

  // Vendor Products
  getVendorProducts(vendorId?: string): Promise<VendorProduct[]>;
  getVendorProduct(id: string): Promise<VendorProduct | undefined>;
  createVendorProduct(vendorProduct: InsertVendorProduct): Promise<VendorProduct>;

  // Recipes
  getRecipes(): Promise<Recipe[]>;
  getRecipe(id: string): Promise<Recipe | undefined>;
  createRecipe(recipe: InsertRecipe): Promise<Recipe>;
  updateRecipe(id: string, recipe: Partial<Recipe>): Promise<Recipe | undefined>;

  // Recipe Components
  getRecipeComponents(recipeId: string): Promise<RecipeComponent[]>;
  createRecipeComponent(component: InsertRecipeComponent): Promise<RecipeComponent>;

  // Inventory Levels
  getInventoryLevels(locationId?: string): Promise<InventoryLevel[]>;
  getInventoryLevel(productId: string, locationId: string): Promise<InventoryLevel | undefined>;
  updateInventoryLevel(productId: string, locationId: string, microUnits: number): Promise<InventoryLevel>;

  // Inventory Counts
  getInventoryCounts(): Promise<InventoryCount[]>;
  getInventoryCount(id: string): Promise<InventoryCount | undefined>;
  createInventoryCount(count: InsertInventoryCount): Promise<InventoryCount>;

  // Inventory Count Lines
  getInventoryCountLines(countId: string): Promise<InventoryCountLine[]>;
  createInventoryCountLine(line: InsertInventoryCountLine): Promise<InventoryCountLine>;

  // Purchase Orders
  getPurchaseOrders(): Promise<PurchaseOrder[]>;
  getPurchaseOrder(id: string): Promise<PurchaseOrder | undefined>;
  createPurchaseOrder(po: InsertPurchaseOrder): Promise<PurchaseOrder>;
  updatePurchaseOrder(id: string, po: Partial<PurchaseOrder>): Promise<PurchaseOrder | undefined>;

  // PO Lines
  getPOLines(poId: string): Promise<POLine[]>;
  createPOLine(line: InsertPOLine): Promise<POLine>;

  // Receipts
  getReceipts(): Promise<Receipt[]>;
  getReceipt(id: string): Promise<Receipt | undefined>;
  createReceipt(receipt: InsertReceipt): Promise<Receipt>;

  // Receipt Lines
  getReceiptLines(receiptId: string): Promise<ReceiptLine[]>;
  createReceiptLine(line: InsertReceiptLine): Promise<ReceiptLine>;

  // POS Sales
  getPOSSales(startDate?: Date, endDate?: Date): Promise<POSSale[]>;
  createPOSSale(sale: InsertPOSSale): Promise<POSSale>;

  // POS Sales Lines
  getPOSSalesLines(saleId: string): Promise<POSSalesLine[]>;
  createPOSSalesLine(line: InsertPOSSalesLine): Promise<POSSalesLine>;

  // Menu Items
  getMenuItems(): Promise<MenuItem[]>;
  getMenuItem(id: string): Promise<MenuItem | undefined>;
  getMenuItemByPLU(pluSku: string): Promise<MenuItem | undefined>;
  createMenuItem(item: InsertMenuItem): Promise<MenuItem>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  // Storage Locations
  async getStorageLocations(): Promise<StorageLocation[]> {
    return db.select().from(storageLocations).orderBy(storageLocations.sortOrder);
  }

  async getStorageLocation(id: string): Promise<StorageLocation | undefined> {
    const [location] = await db.select().from(storageLocations).where(eq(storageLocations.id, id));
    return location || undefined;
  }

  async createStorageLocation(insertLocation: InsertStorageLocation): Promise<StorageLocation> {
    const [location] = await db.insert(storageLocations).values(insertLocation).returning();
    return location;
  }

  // Units
  async getUnits(): Promise<Unit[]> {
    return db.select().from(units);
  }

  async getUnit(id: string): Promise<Unit | undefined> {
    const [unit] = await db.select().from(units).where(eq(units.id, id));
    return unit || undefined;
  }

  async createUnit(insertUnit: InsertUnit): Promise<Unit> {
    const [unit] = await db.insert(units).values(insertUnit).returning();
    return unit;
  }

  // Products
  async getProducts(): Promise<Product[]> {
    return db.select().from(products);
  }

  async getProduct(id: string): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product || undefined;
  }

  async createProduct(insertProduct: InsertProduct): Promise<Product> {
    const [product] = await db.insert(products).values(insertProduct).returning();
    return product;
  }

  async updateProduct(id: string, updates: Partial<Product>): Promise<Product | undefined> {
    const [product] = await db
      .update(products)
      .set(updates)
      .where(eq(products.id, id))
      .returning();
    return product || undefined;
  }

  // Vendors
  async getVendors(): Promise<Vendor[]> {
    return db.select().from(vendors);
  }

  async getVendor(id: string): Promise<Vendor | undefined> {
    const [vendor] = await db.select().from(vendors).where(eq(vendors.id, id));
    return vendor || undefined;
  }

  async createVendor(insertVendor: InsertVendor): Promise<Vendor> {
    const [vendor] = await db.insert(vendors).values(insertVendor).returning();
    return vendor;
  }

  // Vendor Products
  async getVendorProducts(vendorId?: string): Promise<VendorProduct[]> {
    if (vendorId) {
      return db.select().from(vendorProducts).where(eq(vendorProducts.vendorId, vendorId));
    }
    return db.select().from(vendorProducts);
  }

  async getVendorProduct(id: string): Promise<VendorProduct | undefined> {
    const [vendorProduct] = await db.select().from(vendorProducts).where(eq(vendorProducts.id, id));
    return vendorProduct || undefined;
  }

  async createVendorProduct(insertVP: InsertVendorProduct): Promise<VendorProduct> {
    const [vendorProduct] = await db.insert(vendorProducts).values(insertVP).returning();
    return vendorProduct;
  }

  // Recipes
  async getRecipes(): Promise<Recipe[]> {
    return db.select().from(recipes);
  }

  async getRecipe(id: string): Promise<Recipe | undefined> {
    const [recipe] = await db.select().from(recipes).where(eq(recipes.id, id));
    return recipe || undefined;
  }

  async createRecipe(insertRecipe: InsertRecipe): Promise<Recipe> {
    const [recipe] = await db.insert(recipes).values(insertRecipe).returning();
    return recipe;
  }

  async updateRecipe(id: string, updates: Partial<Recipe>): Promise<Recipe | undefined> {
    const [recipe] = await db
      .update(recipes)
      .set(updates)
      .where(eq(recipes.id, id))
      .returning();
    return recipe || undefined;
  }

  // Recipe Components
  async getRecipeComponents(recipeId: string): Promise<RecipeComponent[]> {
    return db.select().from(recipeComponents).where(eq(recipeComponents.recipeId, recipeId));
  }

  async createRecipeComponent(insertComponent: InsertRecipeComponent): Promise<RecipeComponent> {
    const [component] = await db.insert(recipeComponents).values(insertComponent).returning();
    return component;
  }

  // Inventory Levels
  async getInventoryLevels(locationId?: string): Promise<InventoryLevel[]> {
    if (locationId) {
      return db.select().from(inventoryLevels).where(eq(inventoryLevels.storageLocationId, locationId));
    }
    return db.select().from(inventoryLevels);
  }

  async getInventoryLevel(productId: string, locationId: string): Promise<InventoryLevel | undefined> {
    const [level] = await db
      .select()
      .from(inventoryLevels)
      .where(
        and(
          eq(inventoryLevels.productId, productId),
          eq(inventoryLevels.storageLocationId, locationId)
        )
      );
    return level || undefined;
  }

  async updateInventoryLevel(productId: string, locationId: string, microUnits: number): Promise<InventoryLevel> {
    const existing = await this.getInventoryLevel(productId, locationId);
    if (existing) {
      const [updated] = await db
        .update(inventoryLevels)
        .set({ 
          onHandMicroUnits: microUnits,
          updatedAt: new Date()
        })
        .where(eq(inventoryLevels.id, existing.id))
        .returning();
      return updated;
    } else {
      const [level] = await db
        .insert(inventoryLevels)
        .values({
          productId,
          storageLocationId: locationId,
          onHandMicroUnits: microUnits,
        })
        .returning();
      return level;
    }
  }

  // Inventory Counts
  async getInventoryCounts(): Promise<InventoryCount[]> {
    return db.select().from(inventoryCounts);
  }

  async getInventoryCount(id: string): Promise<InventoryCount | undefined> {
    const [count] = await db.select().from(inventoryCounts).where(eq(inventoryCounts.id, id));
    return count || undefined;
  }

  async createInventoryCount(insertCount: InsertInventoryCount): Promise<InventoryCount> {
    const [count] = await db.insert(inventoryCounts).values(insertCount).returning();
    return count;
  }

  // Inventory Count Lines
  async getInventoryCountLines(countId: string): Promise<InventoryCountLine[]> {
    return db.select().from(inventoryCountLines).where(eq(inventoryCountLines.inventoryCountId, countId));
  }

  async createInventoryCountLine(insertLine: InsertInventoryCountLine): Promise<InventoryCountLine> {
    const [line] = await db.insert(inventoryCountLines).values(insertLine).returning();
    return line;
  }

  // Purchase Orders
  async getPurchaseOrders(): Promise<PurchaseOrder[]> {
    return db.select().from(purchaseOrders);
  }

  async getPurchaseOrder(id: string): Promise<PurchaseOrder | undefined> {
    const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
    return po || undefined;
  }

  async createPurchaseOrder(insertPO: InsertPurchaseOrder): Promise<PurchaseOrder> {
    const [po] = await db.insert(purchaseOrders).values(insertPO).returning();
    return po;
  }

  async updatePurchaseOrder(id: string, updates: Partial<PurchaseOrder>): Promise<PurchaseOrder | undefined> {
    const [po] = await db
      .update(purchaseOrders)
      .set(updates)
      .where(eq(purchaseOrders.id, id))
      .returning();
    return po || undefined;
  }

  // PO Lines
  async getPOLines(poId: string): Promise<POLine[]> {
    return db.select().from(poLines).where(eq(poLines.purchaseOrderId, poId));
  }

  async createPOLine(insertLine: InsertPOLine): Promise<POLine> {
    const [line] = await db.insert(poLines).values(insertLine).returning();
    return line;
  }

  // Receipts
  async getReceipts(): Promise<Receipt[]> {
    return db.select().from(receipts);
  }

  async getReceipt(id: string): Promise<Receipt | undefined> {
    const [receipt] = await db.select().from(receipts).where(eq(receipts.id, id));
    return receipt || undefined;
  }

  async createReceipt(insertReceipt: InsertReceipt): Promise<Receipt> {
    const [receipt] = await db.insert(receipts).values(insertReceipt).returning();
    return receipt;
  }

  // Receipt Lines
  async getReceiptLines(receiptId: string): Promise<ReceiptLine[]> {
    return db.select().from(receiptLines).where(eq(receiptLines.receiptId, receiptId));
  }

  async createReceiptLine(insertLine: InsertReceiptLine): Promise<ReceiptLine> {
    const [line] = await db.insert(receiptLines).values(insertLine).returning();
    return line;
  }

  // POS Sales
  async getPOSSales(startDate?: Date, endDate?: Date): Promise<POSSale[]> {
    if (startDate && endDate) {
      return db
        .select()
        .from(posSales)
        .where(and(gte(posSales.occurredAt, startDate), lte(posSales.occurredAt, endDate)));
    } else if (startDate) {
      return db.select().from(posSales).where(gte(posSales.occurredAt, startDate));
    } else if (endDate) {
      return db.select().from(posSales).where(lte(posSales.occurredAt, endDate));
    }
    return db.select().from(posSales);
  }

  async createPOSSale(insertSale: InsertPOSSale): Promise<POSSale> {
    const [sale] = await db.insert(posSales).values(insertSale).returning();
    return sale;
  }

  // POS Sales Lines
  async getPOSSalesLines(saleId: string): Promise<POSSalesLine[]> {
    return db.select().from(posSalesLines).where(eq(posSalesLines.posSalesId, saleId));
  }

  async createPOSSalesLine(insertLine: InsertPOSSalesLine): Promise<POSSalesLine> {
    const [line] = await db.insert(posSalesLines).values(insertLine).returning();
    return line;
  }

  // Menu Items
  async getMenuItems(): Promise<MenuItem[]> {
    return db.select().from(menuItems);
  }

  async getMenuItem(id: string): Promise<MenuItem | undefined> {
    const [item] = await db.select().from(menuItems).where(eq(menuItems.id, id));
    return item || undefined;
  }

  async getMenuItemByPLU(pluSku: string): Promise<MenuItem | undefined> {
    const [item] = await db.select().from(menuItems).where(eq(menuItems.pluSku, pluSku));
    return item || undefined;
  }

  async createMenuItem(insertItem: InsertMenuItem): Promise<MenuItem> {
    const [item] = await db.insert(menuItems).values(insertItem).returning();
    return item;
  }
}

export const storage = new DatabaseStorage();
