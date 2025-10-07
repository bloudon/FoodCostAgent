import { randomUUID } from "crypto";
import type {
  User, InsertUser,
  StorageLocation, InsertStorageLocation,
  Unit, InsertUnit,
  Product, InsertProduct,
  Vendor, InsertVendor,
  VendorProduct, InsertVendorProduct,
  Recipe, InsertRecipe,
  RecipeComponent, InsertRecipeComponent,
  InventoryLevel, InsertInventoryLevel,
  InventoryCount, InsertInventoryCount,
  InventoryCountLine, InsertInventoryCountLine,
  PurchaseOrder, InsertPurchaseOrder,
  POLine, InsertPOLine,
  Receipt, InsertReceipt,
  ReceiptLine, InsertReceiptLine,
  POSSale, InsertPOSSale,
  POSSalesLine, InsertPOSSalesLine,
  MenuItem, InsertMenuItem,
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

export class MemStorage implements IStorage {
  private users: Map<string, User> = new Map();
  private storageLocations: Map<string, StorageLocation> = new Map();
  private units: Map<string, Unit> = new Map();
  private products: Map<string, Product> = new Map();
  private vendors: Map<string, Vendor> = new Map();
  private vendorProducts: Map<string, VendorProduct> = new Map();
  private recipes: Map<string, Recipe> = new Map();
  private recipeComponents: Map<string, RecipeComponent> = new Map();
  private inventoryLevels: Map<string, InventoryLevel> = new Map();
  private inventoryCounts: Map<string, InventoryCount> = new Map();
  private inventoryCountLines: Map<string, InventoryCountLine> = new Map();
  private purchaseOrders: Map<string, PurchaseOrder> = new Map();
  private poLines: Map<string, POLine> = new Map();
  private receipts: Map<string, Receipt> = new Map();
  private receiptLines: Map<string, ReceiptLine> = new Map();
  private posSales: Map<string, POSSale> = new Map();
  private posSalesLines: Map<string, POSSalesLine> = new Map();
  private menuItems: Map<string, MenuItem> = new Map();

  // Users
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(u => u.email === email);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  // Storage Locations
  async getStorageLocations(): Promise<StorageLocation[]> {
    return Array.from(this.storageLocations.values()).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async getStorageLocation(id: string): Promise<StorageLocation | undefined> {
    return this.storageLocations.get(id);
  }

  async createStorageLocation(insertLocation: InsertStorageLocation): Promise<StorageLocation> {
    const id = randomUUID();
    const location: StorageLocation = { ...insertLocation, id };
    this.storageLocations.set(id, location);
    return location;
  }

  // Units
  async getUnits(): Promise<Unit[]> {
    return Array.from(this.units.values());
  }

  async getUnit(id: string): Promise<Unit | undefined> {
    return this.units.get(id);
  }

  async createUnit(insertUnit: InsertUnit): Promise<Unit> {
    const id = randomUUID();
    const unit: Unit = { ...insertUnit, id };
    this.units.set(id, unit);
    return unit;
  }

  // Products
  async getProducts(): Promise<Product[]> {
    return Array.from(this.products.values());
  }

  async getProduct(id: string): Promise<Product | undefined> {
    return this.products.get(id);
  }

  async createProduct(insertProduct: InsertProduct): Promise<Product> {
    const id = randomUUID();
    const product: Product = { ...insertProduct, id };
    this.products.set(id, product);
    return product;
  }

  async updateProduct(id: string, updates: Partial<Product>): Promise<Product | undefined> {
    const product = this.products.get(id);
    if (!product) return undefined;
    const updated = { ...product, ...updates };
    this.products.set(id, updated);
    return updated;
  }

  // Vendors
  async getVendors(): Promise<Vendor[]> {
    return Array.from(this.vendors.values());
  }

  async getVendor(id: string): Promise<Vendor | undefined> {
    return this.vendors.get(id);
  }

  async createVendor(insertVendor: InsertVendor): Promise<Vendor> {
    const id = randomUUID();
    const vendor: Vendor = { ...insertVendor, id };
    this.vendors.set(id, vendor);
    return vendor;
  }

  // Vendor Products
  async getVendorProducts(vendorId?: string): Promise<VendorProduct[]> {
    const all = Array.from(this.vendorProducts.values());
    if (vendorId) {
      return all.filter(vp => vp.vendorId === vendorId);
    }
    return all;
  }

  async getVendorProduct(id: string): Promise<VendorProduct | undefined> {
    return this.vendorProducts.get(id);
  }

  async createVendorProduct(insertVP: InsertVendorProduct): Promise<VendorProduct> {
    const id = randomUUID();
    const vp: VendorProduct = { ...insertVP, id };
    this.vendorProducts.set(id, vp);
    return vp;
  }

  // Recipes
  async getRecipes(): Promise<Recipe[]> {
    return Array.from(this.recipes.values());
  }

  async getRecipe(id: string): Promise<Recipe | undefined> {
    return this.recipes.get(id);
  }

  async createRecipe(insertRecipe: InsertRecipe): Promise<Recipe> {
    const id = randomUUID();
    const recipe: Recipe = { ...insertRecipe, id };
    this.recipes.set(id, recipe);
    return recipe;
  }

  async updateRecipe(id: string, updates: Partial<Recipe>): Promise<Recipe | undefined> {
    const recipe = this.recipes.get(id);
    if (!recipe) return undefined;
    const updated = { ...recipe, ...updates };
    this.recipes.set(id, updated);
    return updated;
  }

  // Recipe Components
  async getRecipeComponents(recipeId: string): Promise<RecipeComponent[]> {
    return Array.from(this.recipeComponents.values()).filter(rc => rc.recipeId === recipeId);
  }

  async createRecipeComponent(insertComponent: InsertRecipeComponent): Promise<RecipeComponent> {
    const id = randomUUID();
    const component: RecipeComponent = { ...insertComponent, id };
    this.recipeComponents.set(id, component);
    return component;
  }

  // Inventory Levels
  async getInventoryLevels(locationId?: string): Promise<InventoryLevel[]> {
    const all = Array.from(this.inventoryLevels.values());
    if (locationId) {
      return all.filter(il => il.storageLocationId === locationId);
    }
    return all;
  }

  async getInventoryLevel(productId: string, locationId: string): Promise<InventoryLevel | undefined> {
    return Array.from(this.inventoryLevels.values()).find(
      il => il.productId === productId && il.storageLocationId === locationId
    );
  }

  async updateInventoryLevel(productId: string, locationId: string, microUnits: number): Promise<InventoryLevel> {
    const existing = await this.getInventoryLevel(productId, locationId);
    if (existing) {
      existing.onHandMicroUnits = microUnits;
      existing.updatedAt = new Date();
      this.inventoryLevels.set(existing.id, existing);
      return existing;
    } else {
      const id = randomUUID();
      const level: InventoryLevel = {
        id,
        productId,
        storageLocationId: locationId,
        onHandMicroUnits: microUnits,
        updatedAt: new Date(),
      };
      this.inventoryLevels.set(id, level);
      return level;
    }
  }

  // Inventory Counts
  async getInventoryCounts(): Promise<InventoryCount[]> {
    return Array.from(this.inventoryCounts.values());
  }

  async getInventoryCount(id: string): Promise<InventoryCount | undefined> {
    return this.inventoryCounts.get(id);
  }

  async createInventoryCount(insertCount: InsertInventoryCount): Promise<InventoryCount> {
    const id = randomUUID();
    const count: InventoryCount = { ...insertCount, id, countedAt: new Date() };
    this.inventoryCounts.set(id, count);
    return count;
  }

  // Inventory Count Lines
  async getInventoryCountLines(countId: string): Promise<InventoryCountLine[]> {
    return Array.from(this.inventoryCountLines.values()).filter(icl => icl.inventoryCountId === countId);
  }

  async createInventoryCountLine(insertLine: InsertInventoryCountLine): Promise<InventoryCountLine> {
    const id = randomUUID();
    const line: InventoryCountLine = { ...insertLine, id };
    this.inventoryCountLines.set(id, line);
    return line;
  }

  // Purchase Orders
  async getPurchaseOrders(): Promise<PurchaseOrder[]> {
    return Array.from(this.purchaseOrders.values());
  }

  async getPurchaseOrder(id: string): Promise<PurchaseOrder | undefined> {
    return this.purchaseOrders.get(id);
  }

  async createPurchaseOrder(insertPO: InsertPurchaseOrder): Promise<PurchaseOrder> {
    const id = randomUUID();
    const po: PurchaseOrder = { ...insertPO, id, createdAt: new Date() };
    this.purchaseOrders.set(id, po);
    return po;
  }

  async updatePurchaseOrder(id: string, updates: Partial<PurchaseOrder>): Promise<PurchaseOrder | undefined> {
    const po = this.purchaseOrders.get(id);
    if (!po) return undefined;
    const updated = { ...po, ...updates };
    this.purchaseOrders.set(id, updated);
    return updated;
  }

  // PO Lines
  async getPOLines(poId: string): Promise<POLine[]> {
    return Array.from(this.poLines.values()).filter(pol => pol.purchaseOrderId === poId);
  }

  async createPOLine(insertLine: InsertPOLine): Promise<POLine> {
    const id = randomUUID();
    const line: POLine = { ...insertLine, id };
    this.poLines.set(id, line);
    return line;
  }

  // Receipts
  async getReceipts(): Promise<Receipt[]> {
    return Array.from(this.receipts.values());
  }

  async getReceipt(id: string): Promise<Receipt | undefined> {
    return this.receipts.get(id);
  }

  async createReceipt(insertReceipt: InsertReceipt): Promise<Receipt> {
    const id = randomUUID();
    const receipt: Receipt = { ...insertReceipt, id, receivedAt: new Date() };
    this.receipts.set(id, receipt);
    return receipt;
  }

  // Receipt Lines
  async getReceiptLines(receiptId: string): Promise<ReceiptLine[]> {
    return Array.from(this.receiptLines.values()).filter(rl => rl.receiptId === receiptId);
  }

  async createReceiptLine(insertLine: InsertReceiptLine): Promise<ReceiptLine> {
    const id = randomUUID();
    const line: ReceiptLine = { ...insertLine, id };
    this.receiptLines.set(id, line);
    return line;
  }

  // POS Sales
  async getPOSSales(startDate?: Date, endDate?: Date): Promise<POSSale[]> {
    let sales = Array.from(this.posSales.values());
    if (startDate) {
      sales = sales.filter(s => s.occurredAt >= startDate);
    }
    if (endDate) {
      sales = sales.filter(s => s.occurredAt <= endDate);
    }
    return sales;
  }

  async createPOSSale(insertSale: InsertPOSSale): Promise<POSSale> {
    const id = randomUUID();
    const sale: POSSale = { ...insertSale, id, occurredAt: new Date() };
    this.posSales.set(id, sale);
    return sale;
  }

  // POS Sales Lines
  async getPOSSalesLines(saleId: string): Promise<POSSalesLine[]> {
    return Array.from(this.posSalesLines.values()).filter(psl => psl.posSalesId === saleId);
  }

  async createPOSSalesLine(insertLine: InsertPOSSalesLine): Promise<POSSalesLine> {
    const id = randomUUID();
    const line: POSSalesLine = { ...insertLine, id };
    this.posSalesLines.set(id, line);
    return line;
  }

  // Menu Items
  async getMenuItems(): Promise<MenuItem[]> {
    return Array.from(this.menuItems.values());
  }

  async getMenuItem(id: string): Promise<MenuItem | undefined> {
    return this.menuItems.get(id);
  }

  async getMenuItemByPLU(pluSku: string): Promise<MenuItem | undefined> {
    return Array.from(this.menuItems.values()).find(mi => mi.pluSku === pluSku);
  }

  async createMenuItem(insertItem: InsertMenuItem): Promise<MenuItem> {
    const id = randomUUID();
    const item: MenuItem = { ...insertItem, id };
    this.menuItems.set(id, item);
    return item;
  }
}

export const storage = new MemStorage();
