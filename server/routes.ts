import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { z } from "zod";
import { createSession, requireAuth, verifyPassword } from "./auth";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import {
  insertUnitSchema,
  insertUnitConversionSchema,
  insertStorageLocationSchema,
  insertCategorySchema,
  insertVendorSchema,
  insertInventoryItemSchema,
  insertVendorItemSchema,
  insertRecipeSchema,
  insertRecipeComponentSchema,
  insertInventoryCountSchema,
  insertInventoryCountLineSchema,
  insertPurchaseOrderSchema,
  insertPOLineSchema,
  insertReceiptSchema,
  insertReceiptLineSchema,
  insertPOSSaleSchema,
  insertPOSSalesLineSchema,
  insertMenuItemSchema,
  insertRecipeVersionSchema,
  insertTransferLogSchema,
  insertWasteLogSchema,
  insertCompanySettingsSchema,
  insertSystemPreferencesSchema,
} from "@shared/schema";

// Swagger/OpenAPI Configuration
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Restaurant Inventory API',
      version: '1.0.0',
      description: 'Restaurant inventory management and vendor integration API',
    },
    servers: [
      {
        url: '/api',
        description: 'API Server',
      },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'auth_session',
        },
      },
      schemas: {
        PurchaseOrder: {
          type: 'object',
          properties: {
            internalOrderId: { type: 'string' },
            vendorKey: { type: 'string', enum: ['sysco', 'gfs', 'usfoods'] },
            orderDate: { type: 'string', format: 'date-time' },
            expectedDeliveryDate: { type: 'string', format: 'date-time' },
            lines: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  vendorSku: { type: 'string' },
                  productName: { type: 'string' },
                  quantity: { type: 'number' },
                  unitPrice: { type: 'number' },
                  lineTotal: { type: 'number' },
                },
              },
            },
            totalAmount: { type: 'number' },
          },
        },
        Invoice: {
          type: 'object',
          properties: {
            externalInvoiceId: { type: 'string' },
            vendorKey: { type: 'string', enum: ['sysco', 'gfs', 'usfoods'] },
            invoiceDate: { type: 'string', format: 'date-time' },
            totalAmount: { type: 'number' },
          },
        },
      },
    },
  },
  apis: ['./server/routes.ts'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

export async function registerRoutes(app: Express): Promise<Server> {
  // Swagger UI Documentation (mounted at /docs to avoid Vite middleware conflict)
  app.use('/docs', swaggerUi.serve);
  app.get('/docs', swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Restaurant Inventory API Docs',
  }));

  // ============ AUTHENTICATION ============
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = z.object({
        email: z.string().email(),
        password: z.string().min(1),
      }).parse(req.body);

      const user = await storage.getUserByEmail(email);
      if (!user || !(await verifyPassword(password, user.passwordHash))) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const token = await createSession(
        user.id,
        req.headers["user-agent"],
        req.ip
      );

      res.cookie("session", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      res.json({ user: { id: user.id, email: user.email, role: user.role } });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/auth/logout", requireAuth, async (req, res) => {
    try {
      const sessionId = (req as any).sessionId;
      if (sessionId) {
        await storage.revokeAuthSession(sessionId);
      }
      res.clearCookie("session");
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/auth/me", requireAuth, async (req, res) => {
    const user = (req as any).user;
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json({ id: user.id, email: user.email, role: user.role });
  });


  // ============ UNITS ============
  app.get("/api/units", async (req, res) => {
    const units = await storage.getUnits();
    res.json(units);
  });

  app.post("/api/units", async (req, res) => {
    try {
      const data = insertUnitSchema.parse(req.body);
      const unit = await storage.createUnit(data);
      res.status(201).json(unit);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ UNIT CONVERSIONS ============
  app.get("/api/unit-conversions", async (req, res) => {
    const conversions = await storage.getUnitConversions();
    const units = await storage.getUnits();
    
    const enriched = conversions.map((conv) => {
      const fromUnit = units.find((u) => u.id === conv.fromUnitId);
      const toUnit = units.find((u) => u.id === conv.toUnitId);
      return {
        ...conv,
        fromUnit,
        toUnit,
      };
    });
    
    res.json(enriched);
  });

  app.post("/api/unit-conversions", async (req, res) => {
    try {
      const data = insertUnitConversionSchema.parse(req.body);
      const conversion = await storage.createUnitConversion(data);
      res.status(201).json(conversion);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/unit-conversions/:id", async (req, res) => {
    try {
      const data = insertUnitConversionSchema.partial().parse(req.body);
      const conversion = await storage.updateUnitConversion(req.params.id, data);
      if (!conversion) {
        return res.status(404).json({ error: "Unit conversion not found" });
      }
      res.json(conversion);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/unit-conversions/:id", async (req, res) => {
    try {
      await storage.deleteUnitConversion(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ STORAGE LOCATIONS ============
  app.get("/api/storage-locations", async (req, res) => {
    const locations = await storage.getStorageLocations();
    res.json(locations);
  });

  app.get("/api/storage-locations/:id", async (req, res) => {
    const location = await storage.getStorageLocation(req.params.id);
    if (!location) {
      return res.status(404).json({ error: "Storage location not found" });
    }
    res.json(location);
  });

  app.post("/api/storage-locations", async (req, res) => {
    try {
      const data = insertStorageLocationSchema.parse(req.body);
      const location = await storage.createStorageLocation(data);
      res.status(201).json(location);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/storage-locations/:id", async (req, res) => {
    try {
      const data = insertStorageLocationSchema.partial().parse(req.body);
      const location = await storage.updateStorageLocation(req.params.id, data);
      if (!location) {
        return res.status(404).json({ error: "Storage location not found" });
      }
      res.json(location);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/storage-locations/:id", async (req, res) => {
    try {
      await storage.deleteStorageLocation(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ CATEGORIES ============
  app.get("/api/categories", async (req, res) => {
    const categories = await storage.getCategories();
    res.json(categories);
  });

  app.get("/api/categories/:id", async (req, res) => {
    const category = await storage.getCategory(req.params.id);
    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.json(category);
  });

  app.post("/api/categories", async (req, res) => {
    try {
      const data = insertCategorySchema.parse(req.body);
      const category = await storage.createCategory(data);
      res.status(201).json(category);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/categories/:id", async (req, res) => {
    try {
      const data = insertCategorySchema.partial().parse(req.body);
      const category = await storage.updateCategory(req.params.id, data);
      if (!category) {
        return res.status(404).json({ error: "Category not found" });
      }
      res.json(category);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/categories/:id", async (req, res) => {
    try {
      await storage.deleteCategory(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ VENDORS ============
  app.get("/api/vendors", async (req, res) => {
    const vendors = await storage.getVendors();
    res.json(vendors);
  });

  app.get("/api/vendors/:id", async (req, res) => {
    const vendor = await storage.getVendor(req.params.id);
    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }
    res.json(vendor);
  });

  app.post("/api/vendors", async (req, res) => {
    try {
      const data = insertVendorSchema.parse(req.body);
      const vendor = await storage.createVendor(data);
      res.status(201).json(vendor);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/vendors/:id", async (req, res) => {
    try {
      const data = insertVendorSchema.partial().parse(req.body);
      const vendor = await storage.updateVendor(req.params.id, data);
      if (!vendor) {
        return res.status(404).json({ error: "Vendor not found" });
      }
      res.json(vendor);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/vendors/:id", async (req, res) => {
    try {
      await storage.deleteVendor(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ VENDOR INTEGRATIONS ============

  /**
   * @swagger
   * /vendors/{vendorKey}/po:
   *   post:
   *     summary: Submit Purchase Order via EDI
   *     description: Submit a purchase order to a vendor via EDI 850 transaction
   *     tags: [Vendor Integrations]
   *     security:
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: vendorKey
   *         required: true
   *         schema:
   *           type: string
   *           enum: [sysco, gfs, usfoods]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/PurchaseOrder'
   *     responses:
   *       200:
   *         description: PO submitted successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 externalId:
   *                   type: string
   *                 status:
   *                   type: string
   *                   enum: [queued, sent, acknowledged, failed]
   */
  app.post("/api/vendors/:vendorKey/po", requireAuth, async (req, res) => {
    try {
      const vendorKey = req.params.vendorKey as 'sysco' | 'gfs' | 'usfoods';
      
      // Validate vendor key
      if (!['sysco', 'gfs', 'usfoods'].includes(vendorKey)) {
        return res.status(400).json({ error: 'Invalid vendor key' });
      }

      // Get vendor adapter
      const { getVendorAdapter } = await import('./integrations/registry');
      const adapter = await getVendorAdapter(vendorKey);
      
      if (!adapter) {
        return res.status(404).json({ error: 'Vendor adapter not configured' });
      }

      // Map internal PO to EDI 850 format
      const po = req.body;
      
      // Generate X12 from normalized JSON
      const { generateX12 } = await import('./integrations/edi-generator');
      const x12Document = generateX12(po);

      // Submit to vendor via adapter
      const response = await adapter.submitPO(po);

      // Log EDI message with both normalized JSON and raw X12
      await storage.createEdiMessage({
        vendorKey,
        direction: 'outbound',
        docType: '850',
        controlNumber: response.externalId || po.poNumber,
        status: response.status || 'sent',
        payloadJson: JSON.stringify(po),
        rawEdi: x12Document,
      });

      res.json(response);
    } catch (error: any) {
      console.error('[Vendor PO Submit Error]', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * @swagger
   * /vendors/{vendorKey}/invoices:
   *   get:
   *     summary: Fetch Invoices from Vendor
   *     description: Retrieve invoices from vendor via EDI 810 for a date range
   *     tags: [Vendor Integrations]
   *     security:
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: vendorKey
   *         required: true
   *         schema:
   *           type: string
   *           enum: [sysco, gfs, usfoods]
   *       - in: query
   *         name: start
   *         required: true
   *         schema:
   *           type: string
   *           format: date
   *       - in: query
   *         name: end
   *         required: true
   *         schema:
   *           type: string
   *           format: date
   *     responses:
   *       200:
   *         description: List of invoices
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/Invoice'
   */
  app.get("/api/vendors/:vendorKey/invoices", requireAuth, async (req, res) => {
    try {
      const vendorKey = req.params.vendorKey as 'sysco' | 'gfs' | 'usfoods';
      const start = req.query.start as string;
      const end = req.query.end as string;

      if (!start || !end) {
        return res.status(400).json({ error: 'start and end dates required' });
      }

      const { getVendorAdapter } = await import('./integrations/registry');
      const adapter = await getVendorAdapter(vendorKey);

      if (!adapter) {
        return res.status(404).json({ error: 'Vendor adapter not configured' });
      }

      const invoices = await adapter.fetchInvoices({ start, end });
      res.json(invoices);
    } catch (error: any) {
      console.error('[Vendor Invoices Error]', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * @swagger
   * /vendors/{vendorKey}/order-guides/import:
   *   post:
   *     summary: Import Order Guide from CSV
   *     description: Parse and import vendor order guide from CSV file
   *     tags: [Vendor Integrations]
   *     security:
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: vendorKey
   *         required: true
   *         schema:
   *           type: string
   *           enum: [sysco, gfs, usfoods]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               csvContent:
   *                 type: string
   *               fileName:
   *                 type: string
   *     responses:
   *       200:
   *         description: Order guide imported successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 orderGuideId:
   *                   type: string
   *                 productsImported:
   *                   type: number
   */
  app.post("/api/vendors/:vendorKey/order-guides/import", requireAuth, async (req, res) => {
    try {
      const vendorKey = req.params.vendorKey as 'sysco' | 'gfs' | 'usfoods';
      const { csvContent, fileName } = req.body;

      if (!csvContent) {
        return res.status(400).json({ error: 'CSV content required' });
      }

      // Parse CSV using vendor-specific parser
      const { CsvOrderGuide } = await import('./integrations/csv/CsvOrderGuide');
      const orderGuide = await CsvOrderGuide.parse(csvContent, { vendorKey });

      // Create order guide record
      const guideRecord = await storage.createOrderGuide({
        vendorKey,
        source: 'csv',
        rowCount: orderGuide.products.length,
        fileName: fileName || undefined,
        effectiveDate: new Date(orderGuide.effectiveDate),
        expirationDate: orderGuide.expirationDate ? new Date(orderGuide.expirationDate) : undefined,
      });

      // Create order guide lines in batch
      const lines = orderGuide.products.map(p => ({
        orderGuideId: guideRecord.id,
        vendorSku: p.vendorSku,
        productName: p.vendorProductName,
        packSize: p.description,
        uom: p.unit,
        caseSize: p.caseSize,
        price: p.price,
        gtin: p.upc,
        category: p.categoryCode,
        brandName: p.brandName,
      }));

      await storage.createOrderGuideLinesBatch(lines);

      res.json({
        orderGuideId: guideRecord.id,
        productsImported: lines.length,
        effectiveDate: guideRecord.effectiveDate,
      });
    } catch (error: any) {
      console.error('[Order Guide Import Error]', error);
      res.status(500).json({ error: error.message });
    }
  });

  // PunchOut - Initialize Session
  app.post("/api/vendors/:vendorKey/punchout/init", requireAuth, async (req, res) => {
    try {
      const vendorKey = req.params.vendorKey as 'sysco' | 'gfs' | 'usfoods';
      const { getVendorAdapter } = await import('./integrations/registry');
      const adapter = await getVendorAdapter(vendorKey);

      if (!adapter) {
        return res.status(404).json({ error: 'Vendor adapter not configured' });
      }

      if (!adapter.punchoutInit) {
        return res.status(400).json({ error: 'Vendor does not support PunchOut' });
      }

      const initResponse = await adapter.punchoutInit(req.body);
      res.json(initResponse);
    } catch (error: any) {
      console.error('[PunchOut Init Error]', error);
      res.status(500).json({ error: error.message });
    }
  });

  // PunchOut - Process Cart Return
  app.post("/api/vendors/:vendorKey/punchout/return", requireAuth, async (req, res) => {
    try {
      const vendorKey = req.params.vendorKey as 'sysco' | 'gfs' | 'usfoods';
      const { getVendorAdapter } = await import('./integrations/registry');
      const adapter = await getVendorAdapter(vendorKey);

      if (!adapter) {
        return res.status(404).json({ error: 'Vendor adapter not configured' });
      }

      if (!adapter.punchoutReturn) {
        return res.status(400).json({ error: 'Vendor does not support PunchOut' });
      }

      const orderDraft = await adapter.punchoutReturn(req.body);
      res.json(orderDraft);
    } catch (error: any) {
      console.error('[PunchOut Return Error]', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Webhook - Receive Inbound EDI Documents
  app.post("/webhooks/edi/:vendorKey", async (req, res) => {
    try {
      const vendorKey = req.params.vendorKey as 'sysco' | 'gfs' | 'usfoods';
      
      // Verify HMAC signature for security
      const signature = req.headers['x-edi-signature'] as string;
      const webhookSecret = process.env.EDI_WEBHOOK_SECRET || '';
      const rawBody = (req as any).rawBody;
      
      if (!webhookSecret) {
        console.error('[EDI Webhook] No EDI_WEBHOOK_SECRET configured');
        return res.status(500).json({ error: 'Webhook not configured' });
      }

      if (!signature) {
        return res.status(401).json({ error: 'Missing signature' });
      }

      if (!rawBody) {
        console.error('[EDI Webhook] No raw body available for verification');
        return res.status(500).json({ error: 'Webhook verification error' });
      }

      // Verify HMAC-SHA256 signature using raw request body
      const crypto = await import('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

      // Use timing-safe comparison to prevent timing attacks
      // Check lengths match before comparison (constant-time for length check)
      const sigBuffer = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expectedSignature);
      
      let isValid = false;
      if (sigBuffer.length === expectedBuffer.length) {
        isValid = crypto.timingSafeEqual(sigBuffer, expectedBuffer);
      }

      if (!isValid) {
        console.error('[EDI Webhook] Invalid signature');
        return res.status(401).json({ error: 'Invalid signature' });
      }

      // Parse X12 to normalized JSON
      const { parseX12 } = await import('./integrations/edi-parser');
      let parseResult;
      
      try {
        parseResult = parseX12(rawBody);
      } catch (parseError: any) {
        console.error('[EDI Webhook] Parse error:', parseError.message);
        
        // Store failed message for debugging
        await storage.createEdiMessage({
          vendorKey,
          direction: 'inbound',
          docType: 'unknown',
          status: 'failed',
          rawEdi: rawBody,
          errorMessage: parseError.message,
        });
        
        return res.status(400).json({ error: 'Invalid EDI format', details: parseError.message });
      }

      const { normalized, raw } = parseResult;
      const docType = normalized.docType;

      // Extract control number based on document type
      let controlNumber = '';
      if (docType === '850' && 'poNumber' in normalized) {
        controlNumber = normalized.poNumber;
      } else if (docType === '855' && 'poNumber' in normalized) {
        controlNumber = normalized.poNumber;
      } else if (docType === '810' && 'invoiceNumber' in normalized) {
        controlNumber = normalized.invoiceNumber;
      }

      // Store inbound EDI message with both normalized JSON and raw X12
      const ediMessage = await storage.createEdiMessage({
        vendorKey,
        direction: 'inbound',
        docType,
        controlNumber,
        status: 'received',
        payloadJson: JSON.stringify(normalized),
        rawEdi: raw,
      });

      // Process based on document type
      if (docType === '855') {
        // Purchase Order Acknowledgment
        console.log('[EDI 855] PO Acknowledgment received', controlNumber);
        // TODO: Update PO status in database
      } else if (docType === '810') {
        // Invoice
        console.log('[EDI 810] Invoice received', controlNumber);
        // TODO: Create receipt record
      }

      res.json({ 
        received: true, 
        messageId: ediMessage.id,
        docType,
        controlNumber,
      });
    } catch (error: any) {
      console.error('[EDI Webhook Error]', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============ INVENTORY ITEMS ============
  app.get("/api/inventory-items", async (req, res) => {
    const locationId = req.query.location_id as string | undefined;
    const items = await storage.getInventoryItems(locationId);
    
    const locations = await storage.getStorageLocations();
    const units = await storage.getUnits();
    const categories = await storage.getCategories();
    
    const enriched = items.map((item) => {
      const location = locations.find((l) => l.id === item.storageLocationId);
      const unit = units.find((u) => u.id === item.unitId);
      const category = item.categoryId ? categories.find((c) => c.id === item.categoryId) : null;
      
      return {
        id: item.id,
        name: item.name,
        categoryId: item.categoryId,
        category: category?.name || null,
        pluSku: item.pluSku,
        pricePerUnit: item.pricePerUnit,
        unitId: item.unitId,
        caseSize: item.caseSize,
        imageUrl: item.imageUrl,
        parLevel: item.parLevel,
        reorderLevel: item.reorderLevel,
        storageLocationId: item.storageLocationId,
        onHandQty: item.onHandQty,
        location: location || { id: item.storageLocationId, name: '' },
        unit: unit || { id: item.unitId, name: '', abbreviation: '' },
      };
    });
    
    res.json(enriched);
  });

  app.get("/api/inventory-items/aggregated", async (req, res) => {
    const aggregated = await storage.getInventoryItemsAggregated();
    res.json(aggregated);
  });

  app.get("/api/inventory-items/:id", async (req, res) => {
    const item = await storage.getInventoryItem(req.params.id);
    if (!item) {
      return res.status(404).json({ error: "Inventory item not found" });
    }
    res.json(item);
  });

  app.post("/api/inventory-items", async (req, res) => {
    try {
      const { locationIds, ...itemData } = req.body;
      const data = insertInventoryItemSchema.parse(itemData);
      
      // Validate locationIds if provided
      if (locationIds !== undefined) {
        if (!Array.isArray(locationIds)) {
          return res.status(400).json({ error: "locationIds must be an array" });
        }
        if (locationIds.length === 0) {
          return res.status(400).json({ error: "At least one storage location is required" });
        }
      }
      
      const item = await storage.createInventoryItem(data);
      
      // Set locations if provided
      if (locationIds && Array.isArray(locationIds) && locationIds.length > 0) {
        await storage.setInventoryItemLocations(item.id, locationIds, data.storageLocationId);
      }
      
      res.status(201).json(item);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/inventory-items/:id", async (req, res) => {
    try {
      const { locationIds, ...updateData } = req.body;
      const updates = insertInventoryItemSchema.partial().parse(updateData);
      
      // Validate numeric fields are not NaN
      if (updates.pricePerUnit !== undefined && isNaN(updates.pricePerUnit)) {
        return res.status(400).json({ error: "Invalid pricePerUnit value" });
      }
      if (updates.caseSize !== undefined && isNaN(updates.caseSize)) {
        return res.status(400).json({ error: "Invalid caseSize value" });
      }
      if (updates.onHandQty !== undefined && isNaN(updates.onHandQty)) {
        return res.status(400).json({ error: "Invalid onHandQty value" });
      }
      if (updates.parLevel !== undefined && updates.parLevel !== null && isNaN(updates.parLevel)) {
        return res.status(400).json({ error: "Invalid parLevel value" });
      }
      if (updates.reorderLevel !== undefined && updates.reorderLevel !== null && isNaN(updates.reorderLevel)) {
        return res.status(400).json({ error: "Invalid reorderLevel value" });
      }
      
      // Validate locationIds if provided
      if (locationIds !== undefined) {
        if (!Array.isArray(locationIds)) {
          return res.status(400).json({ error: "locationIds must be an array" });
        }
        if (locationIds.length === 0) {
          return res.status(400).json({ error: "At least one storage location is required" });
        }
      }
      
      const item = await storage.updateInventoryItem(req.params.id, updates);
      if (!item) {
        return res.status(404).json({ error: "Inventory item not found" });
      }
      
      // Update locations if provided
      if (locationIds && Array.isArray(locationIds) && locationIds.length > 0) {
        await storage.setInventoryItemLocations(req.params.id, locationIds, updates.storageLocationId || item.storageLocationId);
      }
      
      res.json(item);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/inventory-items/:id/locations", async (req, res) => {
    const locations = await storage.getInventoryItemLocations(req.params.id);
    res.json(locations);
  });

  app.get("/api/inventory-items/:id/vendor-items", async (req, res) => {
    const vendorItems = await storage.getVendorItemsByInventoryItem(req.params.id);
    const vendors = await storage.getVendors();
    const units = await storage.getUnits();
    
    const enriched = vendorItems.map((vi) => {
      const vendor = vendors.find((v) => v.id === vi.vendorId);
      const unit = units.find((u) => u.id === vi.purchaseUnitId);
      return {
        ...vi,
        vendor,
        unit,
      };
    });
    
    res.json(enriched);
  });

  // ============ VENDOR ITEMS ============
  app.get("/api/vendor-items", async (req, res) => {
    const vendorId = req.query.vendor_id as string | undefined;
    const vendorItems = await storage.getVendorItems(vendorId);
    const inventoryItems = await storage.getInventoryItems();
    const units = await storage.getUnits();
    
    const enriched = vendorItems.map((vi) => {
      const item = inventoryItems.find((i) => i.id === vi.inventoryItemId);
      const unit = units.find((u) => u.id === vi.purchaseUnitId);
      return {
        ...vi,
        inventoryItem: item,
        unit,
      };
    });
    
    res.json(enriched);
  });

  app.post("/api/vendor-items", async (req, res) => {
    try {
      const data = insertVendorItemSchema.parse(req.body);
      const vendorItem = await storage.createVendorItem(data);
      res.status(201).json(vendorItem);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/vendor-items/:id", async (req, res) => {
    try {
      const updates = insertVendorItemSchema.partial().parse(req.body);
      const vendorItem = await storage.updateVendorItem(req.params.id, updates);
      if (!vendorItem) {
        return res.status(404).json({ error: "Vendor item not found" });
      }
      res.json(vendorItem);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/vendor-items/:id", async (req, res) => {
    try {
      await storage.deleteVendorItem(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ RECIPES ============
  app.get("/api/recipes", async (req, res) => {
    const recipes = await storage.getRecipes();
    res.json(recipes);
  });

  app.get("/api/recipes/:id", async (req, res) => {
    const recipe = await storage.getRecipe(req.params.id);
    if (!recipe) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    const components = await storage.getRecipeComponents(req.params.id);
    const units = await storage.getUnits();
    const inventoryItems = await storage.getInventoryItems();
    const recipes = await storage.getRecipes();

    const expandedComponents = await Promise.all(
      components.map(async (comp) => {
        const unit = units.find((u) => u.id === comp.unitId);
        if (comp.componentType === "inventory_item") {
          const item = inventoryItems.find((i) => i.id === comp.componentId);
          return {
            ...comp,
            name: item?.name || "Unknown",
            unitName: unit?.name || "Unknown",
          };
        } else {
          const subRecipe = recipes.find((r) => r.id === comp.componentId);
          return {
            ...comp,
            name: subRecipe?.name || "Unknown",
            unitName: unit?.name || "Unknown",
          };
        }
      })
    );

    const computedCost = await calculateRecipeCost(recipe.id);
    
    res.json({
      ...recipe,
      computedCost,
      components: expandedComponents,
    });
  });

  app.post("/api/recipes", async (req, res) => {
    try {
      const data = insertRecipeSchema.parse(req.body);
      const recipe = await storage.createRecipe(data);
      res.status(201).json(recipe);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/recipes/:id/components", async (req, res) => {
    try {
      const data = insertRecipeComponentSchema.parse(req.body);
      const component = await storage.createRecipeComponent({
        ...data,
        recipeId: req.params.id,
      });
      
      const updatedCost = await calculateRecipeCost(req.params.id);
      await storage.updateRecipe(req.params.id, { computedCost: updatedCost });
      
      res.status(201).json(component);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ RECIPE COMPONENTS ============
  app.get("/api/recipe-components/:recipeId", async (req, res) => {
    const components = await storage.getRecipeComponents(req.params.recipeId);
    const units = await storage.getUnits();
    const inventoryItems = await storage.getInventoryItems();
    const recipes = await storage.getRecipes();

    const enriched = await Promise.all(
      components.map(async (comp) => {
        const unit = units.find((u) => u.id === comp.unitId);
        const componentCost = await calculateComponentCost(comp);
        
        if (comp.componentType === "inventory_item") {
          const item = inventoryItems.find((i) => i.id === comp.componentId);
          return {
            ...comp,
            inventoryItemId: comp.componentId,
            inventoryItemName: item?.name || "Unknown",
            unitName: unit?.name || "Unknown",
            componentCost,
          };
        } else {
          const subRecipe = recipes.find((r) => r.id === comp.componentId);
          return {
            ...comp,
            subRecipeId: comp.componentId,
            subRecipeName: subRecipe?.name || "Unknown",
            unitName: unit?.name || "Unknown",
            componentCost,
          };
        }
      })
    );

    res.json(enriched);
  });

  app.patch("/api/recipe-components/:id", async (req, res) => {
    try {
      const component = await storage.getRecipeComponent(req.params.id);
      if (!component) {
        return res.status(404).json({ error: "Component not found" });
      }

      const updateData = {
        qty: req.body.qty !== undefined ? req.body.qty : component.qty,
        unitId: req.body.unitId || component.unitId,
      };

      await storage.updateRecipeComponent(req.params.id, updateData);
      
      const updatedCost = await calculateRecipeCost(component.recipeId);
      await storage.updateRecipe(component.recipeId, { computedCost: updatedCost });
      
      const updated = await storage.getRecipeComponent(req.params.id);
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/recipe-components/:id", async (req, res) => {
    try {
      const component = await storage.getRecipeComponent(req.params.id);
      if (!component) {
        return res.status(404).json({ error: "Component not found" });
      }

      const recipeId = component.recipeId;
      await storage.deleteRecipeComponent(req.params.id);
      
      const updatedCost = await calculateRecipeCost(recipeId);
      await storage.updateRecipe(recipeId, { computedCost: updatedCost });
      
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ LEGACY PRODUCT ENDPOINTS ============
  // Legacy endpoint - returns aggregated inventory items as "products"
  app.get("/api/products", async (req, res) => {
    const aggregated = await storage.getInventoryItemsAggregated();
    res.json(aggregated);
  });

  // ============ INVENTORY ============
  // Legacy endpoint - redirects to inventory items
  app.get("/api/inventory", async (req, res) => {
    const locationId = req.query.location_id as string | undefined;
    const items = await storage.getInventoryItems(locationId);
    
    const locations = await storage.getStorageLocations();
    const units = await storage.getUnits();
    const categories = await storage.getCategories();
    
    const enriched = items.map((item) => {
      const location = locations.find((l) => l.id === item.storageLocationId);
      const unit = units.find((u) => u.id === item.unitId);
      
      const category = item.categoryId ? categories.find((c) => c.id === item.categoryId) : null;
      
      return {
        id: item.id,
        productId: item.id,
        storageLocationId: item.storageLocationId,
        onHandQty: item.onHandQty,
        product: {
          id: item.id,
          name: item.name,
          category: category?.name || null,
          pluSku: item.pluSku,
          pricePerUnit: item.pricePerUnit,
          lastCost: item.pricePerUnit * item.caseSize, // derived: case cost
          unitId: item.unitId,
          caseSize: item.caseSize,
          imageUrl: item.imageUrl,
          parLevel: item.parLevel,
          reorderLevel: item.reorderLevel,
        },
        location: location || null,
        unit: unit || null,
      };
    });
    
    res.json(enriched);
  });

  // ============ INVENTORY COUNTS ============
  app.get("/api/inventory-counts", async (req, res) => {
    const counts = await storage.getInventoryCounts();
    res.json(counts);
  });

  app.get("/api/inventory-counts/:id", async (req, res) => {
    const count = await storage.getInventoryCount(req.params.id);
    if (!count) {
      return res.status(404).json({ error: "Count not found" });
    }
    res.json(count);
  });

  app.get("/api/inventory-count-lines/:countId", async (req, res) => {
    const lines = await storage.getInventoryCountLines(req.params.countId);
    const units = await storage.getUnits();
    const inventoryItems = await storage.getInventoryItems();
    const categories = await storage.getCategories();
    
    const enriched = lines.map(line => {
      const unit = units.find(u => u.id === line.unitId);
      const item = inventoryItems.find(i => i.id === line.inventoryItemId);
      const category = item?.categoryId ? categories.find(c => c.id === item.categoryId) : null;
      
      const enrichedItem = item ? {
        ...item,
        category: category?.name || null,
        lastCost: item.pricePerUnit * item.caseSize
      } : null;
      
      return {
        ...line,
        unitName: unit?.name || "unit",
        inventoryItem: enrichedItem
      };
    });
    
    res.json(enriched);
  });

  app.get("/api/inventory-count-line/:id", async (req, res) => {
    const line = await storage.getInventoryCountLine(req.params.id);
    if (!line) {
      return res.status(404).json({ error: "Count line not found" });
    }
    
    const units = await storage.getUnits();
    const unit = units.find(u => u.id === line.unitId);
    
    const enriched = {
      ...line,
      unitName: unit?.name || "unit"
    };
    
    res.json(enriched);
  });

  app.post("/api/inventory-count-lines", async (req, res) => {
    try {
      const lineData = insertInventoryCountLineSchema.parse(req.body);

      const count = await storage.getInventoryCount(lineData.inventoryCountId);
      if (!count) {
        return res.status(404).json({ error: "Count not found" });
      }

      const line = await storage.createInventoryCountLine(lineData);

      // Note: Inventory counts record what was counted, they don't update inventory levels
      // Inventory adjustments should be done separately if needed

      res.status(201).json(line);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/inventory-count-lines/:id", async (req, res) => {
    try {
      const lineData = insertInventoryCountLineSchema.partial().parse(req.body);
      const existingLine = await storage.getInventoryCountLine(req.params.id);
      
      if (!existingLine) {
        return res.status(404).json({ error: "Count line not found" });
      }

      const updatedLine = await storage.updateInventoryCountLine(req.params.id, lineData);

      // Note: Inventory counts record what was counted, they don't update inventory levels
      // Inventory adjustments should be done separately if needed

      res.json(updatedLine);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/inventory-count-lines/:id", async (req, res) => {
    try {
      const line = await storage.getInventoryCountLine(req.params.id);
      
      if (!line) {
        return res.status(404).json({ error: "Count line not found" });
      }

      await storage.deleteInventoryCountLine(req.params.id);
      
      // Note: Inventory counts record what was counted, they don't update inventory levels
      // Inventory adjustments should be done separately if needed
      
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/inventory-counts", async (req, res) => {
    try {
      const countInput = insertInventoryCountSchema.parse(req.body);
      const count = await storage.createInventoryCount(countInput);

      // Auto-populate count lines for ALL active inventory items
      const allItems = await storage.getInventoryItems();
      const activeItems = allItems.filter(item => item.active === 1);

      for (const item of activeItems) {
        const lineData = {
          inventoryCountId: count.id,
          inventoryItemId: item.id,
          qty: 0,
          unitId: item.unitId,
          unitCost: item.pricePerUnit, // Snapshot the current price
          userId: countInput.userId,
        };

        await storage.createInventoryCountLine(lineData);
      }

      res.status(201).json(count);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/inventory-counts/:id", async (req, res) => {
    try {
      await storage.deleteInventoryCount(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ PURCHASE ORDERS ============
  app.get("/api/purchase-orders", async (req, res) => {
    const orders = await storage.getPurchaseOrders();
    const vendors = await storage.getVendors();
    
    const enriched = await Promise.all(orders.map(async (po) => {
      const vendor = vendors.find((v) => v.id === po.vendorId);
      const lines = await storage.getPOLines(po.id);
      const lineCount = lines.length;
      const totalAmount = lines.reduce((sum, line) => sum + (line.orderedQty * line.priceEach), 0);
      
      return {
        ...po,
        vendorName: vendor?.name || "Unknown",
        lineCount,
        totalAmount,
      };
    }));
    
    res.json(enriched);
  });

  app.get("/api/purchase-orders/:id", async (req, res) => {
    const po = await storage.getPurchaseOrder(req.params.id);
    if (!po) {
      return res.status(404).json({ error: "Purchase order not found" });
    }

    const lines = await storage.getPOLines(req.params.id);
    const vendorItems = await storage.getVendorItems();
    const inventoryItems = await storage.getInventoryItems();
    const units = await storage.getUnits();

    const enrichedLines = lines.map((line) => {
      const vi = vendorItems.find((vi) => vi.id === line.vendorItemId);
      const item = inventoryItems.find((i) => i.id === vi?.inventoryItemId);
      const unit = units.find((u) => u.id === line.unitId);
      return {
        ...line,
        inventoryItemId: vi?.inventoryItemId,
        inventoryItemName: item?.name || "Unknown",
        vendorSku: vi?.vendorSku || "",
        unitName: unit?.name || "",
        caseQuantity: line.caseQuantity,
      };
    });

    res.json({
      ...po,
      lines: enrichedLines,
    });
  });

  app.post("/api/purchase-orders", async (req, res) => {
    try {
      const { lines, ...poData } = req.body;
      const poInput = insertPurchaseOrderSchema.parse(poData);
      const po = await storage.createPurchaseOrder(poInput);

      if (lines && Array.isArray(lines)) {
        for (const line of lines) {
          let vendorItemId = line.vendorItemId;
          
          // Check if this is a misc grocery order with inventoryItemId instead
          if (line.inventoryItemId) {
            // Check if vendor item already exists for this vendor and inventory item
            const vendorItems = await storage.getVendorItems();
            const existingVendorItem = vendorItems.find(
              vi => vi.vendorId === po.vendorId && vi.inventoryItemId === line.inventoryItemId
            );
            
            if (existingVendorItem) {
              vendorItemId = existingVendorItem.id;
            } else {
              // Create a vendor item on the fly for this inventory item
              const vendorItem = await storage.createVendorItem({
                vendorId: po.vendorId,
                inventoryItemId: line.inventoryItemId,
                purchaseUnitId: line.unitId,
                caseSize: 1,
                lastPrice: line.priceEach,
                active: 1,
              });
              vendorItemId = vendorItem.id;
            }
          }
          
          const lineData = insertPOLineSchema.parse({
            vendorItemId,
            orderedQty: line.orderedQty,
            caseQuantity: line.caseQuantity,
            unitId: line.unitId,
            priceEach: line.priceEach,
            purchaseOrderId: po.id,
          });
          await storage.createPOLine(lineData);
        }
      }

      res.status(201).json(po);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/purchase-orders/:id", async (req, res) => {
    try {
      const po = await storage.getPurchaseOrder(req.params.id);
      if (!po) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      const { lines, ...poData } = req.body;
      
      // Update the purchase order
      const updateData = {
        expectedDate: poData.expectedDate !== undefined ? poData.expectedDate : po.expectedDate,
        status: poData.status || po.status,
        notes: poData.notes !== undefined ? poData.notes : po.notes,
      };
      
      await storage.updatePurchaseOrder(req.params.id, updateData);

      // Update lines if provided
      if (lines && Array.isArray(lines)) {
        // Delete existing lines
        const existingLines = await storage.getPOLines(req.params.id);
        for (const line of existingLines) {
          await storage.deletePOLine(line.id);
        }

        // Create new lines
        for (const line of lines) {
          let vendorItemId = line.vendorItemId;
          
          // Check if this is a misc grocery order with inventoryItemId instead
          if (line.inventoryItemId) {
            // Check if vendor item already exists for this vendor and inventory item
            const vendorItems = await storage.getVendorItems();
            const existingVendorItem = vendorItems.find(
              vi => vi.vendorId === po.vendorId && vi.inventoryItemId === line.inventoryItemId
            );
            
            if (existingVendorItem) {
              vendorItemId = existingVendorItem.id;
            } else {
              // Create a vendor item on the fly for this inventory item
              const vendorItem = await storage.createVendorItem({
                vendorId: po.vendorId,
                inventoryItemId: line.inventoryItemId,
                purchaseUnitId: line.unitId,
                caseSize: 1,
                lastPrice: line.priceEach,
                active: 1,
              });
              vendorItemId = vendorItem.id;
            }
          }
          
          const lineData = insertPOLineSchema.parse({
            vendorItemId,
            orderedQty: line.orderedQty,
            caseQuantity: line.caseQuantity,
            unitId: line.unitId,
            priceEach: line.priceEach,
            purchaseOrderId: req.params.id,
          });
          await storage.createPOLine(lineData);
        }
      }

      const updatedPO = await storage.getPurchaseOrder(req.params.id);
      res.json(updatedPO);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/purchase-orders/:id", async (req, res) => {
    try {
      const po = await storage.getPurchaseOrder(req.params.id);
      if (!po) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      // Check if order has been received
      if (po.status === "received") {
        return res.status(400).json({ error: "Cannot delete a received purchase order" });
      }

      // Delete all PO lines first
      const lines = await storage.getPOLines(req.params.id);
      for (const line of lines) {
        await storage.deletePOLine(line.id);
      }

      // Delete the purchase order
      await storage.deletePurchaseOrder(req.params.id);

      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ VENDOR INTEGRATIONS ============
  const { getVendor, getAllVendors } = await import('./integrations');

  // Validation schemas for vendor integration requests
  const syncOrderGuideSchema = z.object({
    since: z.string().optional(),
    fullSync: z.boolean().optional(),
  });

  const fetchInvoicesSchema = z.object({
    start: z.string(),
    end: z.string(),
  });

  const punchoutInitSchema = z.object({
    buyerCookie: z.string(),
    buyerUserId: z.string(),
    buyerEmail: z.string().email().optional(),
    returnUrl: z.string().url(),
  });

  // Get all available vendor integrations
  app.get("/api/vendor-integrations", requireAuth, async (req, res) => {
    const vendors = getAllVendors();
    res.json(vendors.map(v => ({
      key: v.key,
      name: v.name,
      supports: v.supports,
    })));
  });

  // Sync order guide from vendor
  app.post("/api/vendor-integrations/:vendorKey/sync-order-guide", requireAuth, async (req, res) => {
    try {
      const { vendorKey } = req.params;
      const vendor = await getVendor(vendorKey as any);
      
      const params = syncOrderGuideSchema.parse(req.body);
      const orderGuide = await vendor.syncOrderGuide(params);
      
      res.json(orderGuide);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Submit purchase order to vendor
  app.post("/api/vendor-integrations/:vendorKey/submit-po", requireAuth, async (req, res) => {
    try {
      const { vendorKey } = req.params;
      const vendor = await getVendor(vendorKey as any);
      
      // Validate PO structure - reuse existing schema patterns
      const poData = z.object({
        internalOrderId: z.string(),
        vendorKey: z.enum(['sysco', 'gfs', 'usfoods']),
        orderDate: z.string(),
        expectedDeliveryDate: z.string().optional(),
        lines: z.array(z.object({
          vendorSku: z.string(),
          productName: z.string(),
          quantity: z.number(),
          unitPrice: z.number(),
          unitOfMeasure: z.string().optional(),
          lineTotal: z.number(),
        })),
        totalAmount: z.number(),
        notes: z.string().optional(),
      }).parse(req.body);
      
      const result = await vendor.submitPO(poData);
      
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Fetch invoices from vendor
  app.post("/api/vendor-integrations/:vendorKey/fetch-invoices", requireAuth, async (req, res) => {
    try {
      const { vendorKey } = req.params;
      const vendor = await getVendor(vendorKey as any);
      
      const params = fetchInvoicesSchema.parse(req.body);
      const invoices = await vendor.fetchInvoices(params);
      
      res.json(invoices);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Initialize PunchOut session
  app.post("/api/vendor-integrations/:vendorKey/punchout-init", requireAuth, async (req, res) => {
    try {
      const { vendorKey } = req.params;
      const vendor = await getVendor(vendorKey as any);
      
      if (!vendor.punchoutInit) {
        return res.status(400).json({ error: "PunchOut not supported for this vendor" });
      }
      
      const params = punchoutInitSchema.parse(req.body);
      const result = await vendor.punchoutInit(params);
      
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Process PunchOut cart return
  app.post("/api/vendor-integrations/:vendorKey/punchout-return", requireAuth, async (req, res) => {
    try {
      const { vendorKey } = req.params;
      const vendor = await getVendor(vendorKey as any);
      
      if (!vendor.punchoutReturn) {
        return res.status(400).json({ error: "PunchOut not supported for this vendor" });
      }
      
      const params = z.object({
        sessionId: z.string(),
        items: z.array(z.object({
          vendorSku: z.string(),
          quantity: z.number(),
          unitPrice: z.number(),
          description: z.string(),
        })),
        totalAmount: z.number(),
      }).parse(req.body);
      
      const orderDraft = await vendor.punchoutReturn(params);
      
      res.json(orderDraft);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ RECEIPTS ============
  app.get("/api/receipts", async (req, res) => {
    const receipts = await storage.getReceipts();
    res.json(receipts);
  });

  app.post("/api/receipts", async (req, res) => {
    try {
      const { lines, storageLocationId, ...receiptData } = req.body;
      const receiptInput = insertReceiptSchema.parse(receiptData);
      const receipt = await storage.createReceipt(receiptInput);

      if (lines && Array.isArray(lines)) {
        const vendorItems = await storage.getVendorItems();

        for (const line of lines) {
          const lineData = insertReceiptLineSchema.parse({
            ...line,
            receiptId: receipt.id,
          });

          await storage.createReceiptLine(lineData);

          const vi = vendorItems.find((vi) => vi.id === lineData.vendorItemId);
          if (vi) {
            const item = await storage.getInventoryItem(vi.inventoryItemId);
            if (item) {
              const costPerCase = lineData.priceEach;
              const pricePerUnit = costPerCase / (item.caseSize || 1);
              await storage.updateInventoryItem(vi.inventoryItemId, {
                pricePerUnit,
              });
            }

            if (storageLocationId) {
              const item = await storage.getInventoryItem(vi.inventoryItemId);
              if (item && item.storageLocationId === storageLocationId) {
                const newOnHand = (item.onHandQty || 0) + lineData.receivedQty;
                await storage.updateInventoryItem(vi.inventoryItemId, {
                  onHandQty: newOnHand
                });
              }
            }
          }
        }

        await storage.updatePurchaseOrder(receiptInput.purchaseOrderId, {
          status: "received",
        });
      }

      res.status(201).json(receipt);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ POS INGESTION ============
  app.post("/api/pos/ingest", async (req, res) => {
    try {
      const { lines, ...saleData } = req.body;
      const saleInput = insertPOSSaleSchema.parse(saleData);
      const sale = await storage.createPOSSale(saleInput);

      if (lines && Array.isArray(lines)) {
        for (const line of lines) {
          const lineData = insertPOSSalesLineSchema.parse({
            ...line,
            posSalesId: sale.id,
          });
          await storage.createPOSSalesLine(lineData);
        }
      }

      res.status(201).json(sale);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ MENU ITEMS ============
  app.get("/api/menu-items", async (req, res) => {
    const items = await storage.getMenuItems();
    res.json(items);
  });

  app.post("/api/menu-items", async (req, res) => {
    try {
      const data = insertMenuItemSchema.parse(req.body);
      const item = await storage.createMenuItem(data);
      res.status(201).json(item);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ VARIANCE REPORT ============
  app.get("/api/reports/variance", async (req, res) => {
    try {
      const startDate = req.query.start ? new Date(req.query.start as string) : undefined;
      const endDate = req.query.end ? new Date(req.query.end as string) : undefined;

      const theoreticalUsage = await calculateTheoreticalUsage(startDate, endDate);
      const actualUsage = await calculateActualUsage(startDate, endDate);

      // Get actual inventory items to access id and pricePerUnit
      const inventoryItems = await storage.getInventoryItems();
      
      // Create a map of item names to their details for aggregation
      const itemMap = new Map<string, { ids: string[], name: string, pricePerUnit: number }>();
      for (const item of inventoryItems) {
        if (!itemMap.has(item.name)) {
          itemMap.set(item.name, { ids: [item.id], name: item.name, pricePerUnit: item.pricePerUnit });
        } else {
          itemMap.get(item.name)!.ids.push(item.id);
        }
      }
      
      const variance = Array.from(itemMap.values()).map((itemData) => {
        // Sum theoretical and actual for all locations of this item
        const theoretical = itemData.ids.reduce((sum, id) => sum + (theoreticalUsage[id] || 0), 0);
        const actual = itemData.ids.reduce((sum, id) => sum + (actualUsage[id] || 0), 0);
        const varianceUnits = actual - theoretical;
        const varianceCost = varianceUnits * itemData.pricePerUnit; // price per base unit × units
        const variancePercent = theoretical > 0 ? (varianceUnits / theoretical) * 100 : 0;

        return {
          productId: itemData.ids[0], // Keep for backwards compatibility - use first ID
          productName: itemData.name,
          theoreticalUsage: theoretical,
          actualUsage: actual,
          varianceUnits,
          varianceCost,
          variancePercent,
        };
      }).filter(v => v.theoreticalUsage > 0 || v.actualUsage > 0);

      res.json(variance);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ RECIPE COSTS REPORT ============
  app.get("/api/reports/recipe-costs", async (req, res) => {
    try {
      const recipeId = req.query.recipe_id as string | undefined;
      
      if (recipeId) {
        const cost = await calculateRecipeCost(recipeId);
        const recipe = await storage.getRecipe(recipeId);
        res.json({ recipeId, recipeName: recipe?.name, cost });
      } else {
        const recipes = await storage.getRecipes();
        const costs = await Promise.all(
          recipes.map(async (recipe) => ({
            recipeId: recipe.id,
            recipeName: recipe.name,
            cost: await calculateRecipeCost(recipe.id),
          }))
        );
        res.json(costs);
      }
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ RECIPE VERSIONS ============
  app.get("/api/recipe-versions/:recipeId", async (req, res) => {
    const versions = await storage.getRecipeVersions(req.params.recipeId);
    res.json(versions);
  });

  app.post("/api/recipe-versions", async (req, res) => {
    try {
      const data = insertRecipeVersionSchema.parse(req.body);
      const version = await storage.createRecipeVersion(data);
      res.status(201).json(version);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ TRANSFER LOGS ============
  app.get("/api/transfers", async (req, res) => {
    const productId = req.query.product_id as string | undefined;
    const startDate = req.query.start_date ? new Date(req.query.start_date as string) : undefined;
    const endDate = req.query.end_date ? new Date(req.query.end_date as string) : undefined;
    const transfers = await storage.getTransferLogs(productId, startDate, endDate);
    res.json(transfers);
  });

  app.post("/api/transfers", async (req, res) => {
    try {
      const data = insertTransferLogSchema.parse(req.body);
      
      // Get inventory items at from location
      const inventoryItems = await storage.getInventoryItems(data.fromLocationId);
      const fromItem = inventoryItems.find(i => i.id === data.inventoryItemId);
      const fromQty = fromItem?.onHandQty || 0;
      
      // Validate sufficient quantity
      if (fromQty < data.qty) {
        return res.status(400).json({ 
          error: `Insufficient inventory. Available: ${fromQty}, Requested: ${data.qty}` 
        });
      }
      
      // Create transfer log
      const transfer = await storage.createTransferLog(data);
      
      // Update from location inventory
      if (fromItem) {
        await storage.updateInventoryItem(fromItem.id, {
          onHandQty: fromQty - data.qty
        });
      }
      
      // Update to location inventory
      const toItems = await storage.getInventoryItems(data.toLocationId);
      const toItem = toItems.find(i => i.id === data.inventoryItemId);
      if (toItem) {
        await storage.updateInventoryItem(toItem.id, {
          onHandQty: (toItem.onHandQty || 0) + data.qty
        });
      }
      
      res.status(201).json(transfer);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ WASTE LOGS ============
  app.get("/api/waste", async (req, res) => {
    const productId = req.query.product_id as string | undefined;
    const startDate = req.query.start_date ? new Date(req.query.start_date as string) : undefined;
    const endDate = req.query.end_date ? new Date(req.query.end_date as string) : undefined;
    const wasteLogs = await storage.getWasteLogs(productId, startDate, endDate);
    res.json(wasteLogs);
  });

  app.post("/api/waste", async (req, res) => {
    try {
      const data = insertWasteLogSchema.parse(req.body);
      
      // Get inventory item at the location
      const inventoryItems = await storage.getInventoryItems(data.storageLocationId);
      const item = inventoryItems.find(i => i.id === data.inventoryItemId);
      const currentQty = item?.onHandQty || 0;
      
      // Validate sufficient quantity
      if (currentQty < data.qty) {
        return res.status(400).json({ 
          error: `Insufficient inventory. Available: ${currentQty}, Waste amount: ${data.qty}` 
        });
      }
      
      // Create waste log
      const wasteLog = await storage.createWasteLog(data);
      
      // Update inventory level
      if (item) {
        await storage.updateInventoryItem(item.id, {
          onHandQty: currentQty - data.qty
        });
      }
      
      res.status(201).json(wasteLog);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/reports/waste-trends", async (req, res) => {
    const startDate = req.query.start ? new Date(req.query.start as string) : undefined;
    const endDate = req.query.end ? new Date(req.query.end as string) : undefined;
    const wasteLogs = await storage.getWasteLogs(undefined, startDate, endDate);
    const inventoryItems = await storage.getInventoryItems();
    const trends: Record<string, any> = {};
    for (const wasteLog of wasteLogs) {
      if (!trends[wasteLog.inventoryItemId]) {
        const item = inventoryItems.find(i => i.id === wasteLog.inventoryItemId);
        trends[wasteLog.inventoryItemId] = { productId: wasteLog.inventoryItemId, productName: item?.name || "Unknown", totalWasteQty: 0, totalWasteCost: 0, byReason: {} as Record<string, number>, count: 0 };
      }
      const item = inventoryItems.find(i => i.id === wasteLog.inventoryItemId);
      const pricePerUnit = item?.pricePerUnit || 0;
      trends[wasteLog.inventoryItemId].totalWasteQty += wasteLog.qty;
      trends[wasteLog.inventoryItemId].totalWasteCost += wasteLog.qty * pricePerUnit;
      trends[wasteLog.inventoryItemId].count += 1;
      if (!trends[wasteLog.inventoryItemId].byReason[wasteLog.reasonCode]) trends[wasteLog.inventoryItemId].byReason[wasteLog.reasonCode] = 0;
      trends[wasteLog.inventoryItemId].byReason[wasteLog.reasonCode] += wasteLog.qty;
    }
    res.json(Object.values(trends));
  });

  // ============ COGS & COST ANALYSIS ============
  app.get("/api/reports/cogs-summary", async (req, res) => {
    const startDate = req.query.start ? new Date(req.query.start as string) : undefined;
    const endDate = req.query.end ? new Date(req.query.end as string) : undefined;
    
    // Prefetch all data once
    const sales = await storage.getPOSSales(startDate, endDate);
    const menuItems = await storage.getMenuItems();
    const inventoryItems = await storage.getInventoryItems();
    const units = await storage.getUnits();
    
    // Create lookup maps
    const inventoryItemMap = new Map(inventoryItems.map(i => [i.id, i]));
    const menuItemMap = new Map(menuItems.map(m => [m.id, m]));
    const unitMap = new Map(units.map(u => [u.id, u]));
    
    // Pre-calculate menu item costs using calculateRecipeCost (handles sub-recipes)
    const menuItemCostMap = new Map<string, number>();
    for (const menuItem of menuItems) {
      const cost = await calculateRecipeCost(menuItem.recipeId);
      menuItemCostMap.set(menuItem.id, cost);
    }
    
    let totalRevenue = 0;
    let totalCOGS = 0;
    const menuItemSummary: Record<string, { revenue: number, cogs: number, count: number, name: string }> = {};
    
    for (const sale of sales) {
      const saleLines = await storage.getPOSSalesLines(sale.id);
      
      for (const line of saleLines) {
        // Find menu item by pluSku
        const menuItem = menuItems.find(mi => mi.pluSku === line.pluSku);
        if (!menuItem) continue;
        
        const portionCost = menuItemCostMap.get(menuItem.id) || 0;
        const lineCOGS = portionCost * (line.qtySold || 0);
        totalCOGS += lineCOGS;
        
        if (!menuItemSummary[menuItem.id]) {
          menuItemSummary[menuItem.id] = {
            revenue: 0,
            cogs: 0,
            count: 0,
            name: menuItem.name || "Unknown"
          };
        }
        
        // Note: POS sales don't track revenue in this schema, only quantity sold
        menuItemSummary[menuItem.id].cogs += lineCOGS;
        menuItemSummary[menuItem.id].count += line.qtySold || 0;
      }
    }
    
    res.json({
      totalRevenue,
      totalCOGS,
      grossProfit: totalRevenue - totalCOGS,
      grossMarginPercent: totalRevenue > 0 ? ((totalRevenue - totalCOGS) / totalRevenue * 100) : 0,
      menuItems: Object.entries(menuItemSummary).map(([menuItemId, data]) => ({
        menuItemId,
        name: data.name,
        revenue: data.revenue,
        cogs: data.cogs,
        profit: data.revenue - data.cogs,
        marginPercent: data.revenue > 0 ? ((data.revenue - data.cogs) / data.revenue * 100) : 0,
        unitsSold: data.count
      }))
    });
  });

  app.get("/api/reports/price-change-impact", async (req, res) => {
    const inventoryItemId = req.query.product_id as string; // Keep param name for backwards compatibility
    
    if (!inventoryItemId) {
      return res.status(400).json({ error: "product_id is required" });
    }
    
    // Prefetch all data once
    const inventoryItem = await storage.getInventoryItem(inventoryItemId);
    if (!inventoryItem) {
      return res.status(404).json({ error: "Inventory item not found" });
    }
    
    const menuItems = await storage.getMenuItems();
    const impact = [];
    
    // Check each menu item's recipe for the affected inventory item (including sub-recipes)
    for (const menuItem of menuItems) {
      const itemImpact = await calculateInventoryItemImpactInRecipe(menuItem.recipeId, inventoryItemId);
      
      if (!itemImpact.usesItem) continue;
      
      // Calculate current recipe cost using calculateRecipeCost (handles sub-recipes)
      const currentRecipeCost = await calculateRecipeCost(menuItem.recipeId);
      const costPercent = currentRecipeCost > 0 ? (itemImpact.costContribution / currentRecipeCost * 100) : 0;
      
      impact.push({
        menuItemId: menuItem.id,
        menuItemName: menuItem.name,
        recipeId: menuItem.recipeId,
        currentRecipeCost,
        componentQuantity: itemImpact.qty,
        componentCostContribution: itemImpact.costContribution,
        costPercentage: costPercent,
        priceImpactPer10Percent: itemImpact.costContribution * 0.1
      });
    }
    
    res.json({
      product: { // Keep for backwards compatibility
        id: inventoryItem.id,
        name: inventoryItem.name,
        currentCost: inventoryItem.pricePerUnit * inventoryItem.caseSize, // derived: case cost
        pricePerUnit: inventoryItem.pricePerUnit,
        unitId: inventoryItem.unitId
      },
      affectedRecipes: impact.length,
      impactAnalysis: impact
    });
  });

  // ============ COMPANY SETTINGS ============
  app.get("/api/company-settings", async (req, res) => {
    const settings = await storage.getCompanySettings();
    res.json(settings || {});
  });

  app.patch("/api/company-settings", async (req, res) => {
    try {
      const data = insertCompanySettingsSchema.partial().parse(req.body);
      const settings = await storage.updateCompanySettings(data);
      res.json(settings);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ SYSTEM PREFERENCES ============
  app.get("/api/system-preferences", async (req, res) => {
    const preferences = await storage.getSystemPreferences();
    res.json(preferences || {});
  });

  app.patch("/api/system-preferences", async (req, res) => {
    try {
      const data = insertSystemPreferencesSchema.partial().parse(req.body);
      const preferences = await storage.updateSystemPreferences(data);
      res.json(preferences);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Helper function to redact sensitive credential fields
  const redactCredentials = (creds: any) => ({
    id: creds.id,
    vendorKey: creds.vendorKey,
    vendorName: creds.vendorName,
    isActive: creds.isActive,
    lastSyncedAt: creds.lastSyncedAt,
    updatedAt: creds.updatedAt,
    // Indicate which fields are configured without exposing values
    hasApiCredentials: !!(creds.apiKey || creds.apiSecret || creds.apiUrl || creds.username || creds.password),
    hasEdiConfig: !!(creds.ediIsaId || creds.ediGsId || creds.ediQualifier || creds.as2Url || creds.as2Identifier),
    hasSftpConfig: !!(creds.sftpHost || creds.sftpPort || creds.sftpUsername || creds.sftpPassword),
    hasPunchoutConfig: !!(creds.punchoutUrl || creds.punchoutDomain || creds.punchoutIdentity || creds.sharedSecret),
  });

  // Helper function to check admin role
  const requireAdmin = (req: any, res: any, next: any) => {
    const user = req.user;
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" });
    }
    next();
  };

  // ============ VENDOR CREDENTIALS ============
  app.get("/api/vendor-credentials", requireAuth, requireAdmin, async (req, res) => {
    const credentials = await storage.getVendorCredentials();
    // Redact sensitive fields
    const safe = credentials.map(redactCredentials);
    res.json(safe);
  });

  app.get("/api/vendor-credentials/:vendorKey", requireAuth, requireAdmin, async (req, res) => {
    const credentials = await storage.getVendorCredentialsByKey(req.params.vendorKey);
    if (!credentials) {
      return res.status(404).json({ error: "Vendor credentials not found" });
    }
    // Return full credentials only to admins for editing
    res.json(credentials);
  });

  app.post("/api/vendor-credentials", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { insertVendorCredentialsSchema } = await import("@shared/schema");
      const data = insertVendorCredentialsSchema.parse(req.body);
      const credentials = await storage.createVendorCredentials(data);
      res.status(201).json(redactCredentials(credentials));
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/vendor-credentials/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { insertVendorCredentialsSchema } = await import("@shared/schema");
      const data = insertVendorCredentialsSchema.partial().parse(req.body);
      const credentials = await storage.updateVendorCredentials(req.params.id, data);
      if (!credentials) {
        return res.status(404).json({ error: "Vendor credentials not found" });
      }
      
      // Clear adapter cache for this vendor
      const { clearAdapterCache } = await import('./integrations');
      clearAdapterCache(credentials.vendorKey as any);
      
      res.json(redactCredentials(credentials));
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/vendor-credentials/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      await storage.deleteVendorCredentials(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

// ============ HELPER FUNCTIONS ============

async function calculateComponentCost(comp: any): Promise<number> {
  const units = await storage.getUnits();
  const inventoryItems = await storage.getInventoryItems();
  
  const unit = units.find((u) => u.id === comp.unitId);
  const qty = unit ? comp.qty * unit.toBaseRatio : comp.qty;

  if (comp.componentType === "inventory_item") {
    const item = inventoryItems.find((i) => i.id === comp.componentId);
    if (item) {
      return qty * item.pricePerUnit;
    }
  } else if (comp.componentType === "recipe") {
    const subRecipe = await storage.getRecipe(comp.componentId);
    if (subRecipe) {
      const subRecipeCost = await calculateRecipeCost(comp.componentId);
      const subRecipeYieldUnit = units.find(u => u.id === subRecipe.yieldUnitId);
      const subRecipeYieldQty = subRecipeYieldUnit ? subRecipe.yieldQty * subRecipeYieldUnit.toBaseRatio : subRecipe.yieldQty;
      const costPerUnit = subRecipeYieldQty > 0 ? subRecipeCost / subRecipeYieldQty : 0;
      return qty * costPerUnit;
    }
  }
  
  return 0;
}

async function calculateRecipeCost(recipeId: string): Promise<number> {
  const recipe = await storage.getRecipe(recipeId);
  if (!recipe) return 0;

  const components = await storage.getRecipeComponents(recipeId);
  const units = await storage.getUnits();
  const inventoryItems = await storage.getInventoryItems();
  
  let totalCost = 0;

  for (const comp of components) {
    const unit = units.find((u) => u.id === comp.unitId);
    const qty = unit ? comp.qty * unit.toBaseRatio : comp.qty;

    if (comp.componentType === "inventory_item") {
      const item = inventoryItems.find((i) => i.id === comp.componentId);
      if (item) {
        totalCost += qty * item.pricePerUnit;
      }
    } else if (comp.componentType === "recipe") {
      // Get sub-recipe's cost (already includes its waste)
      const subRecipe = await storage.getRecipe(comp.componentId);
      if (subRecipe) {
        const subRecipeCost = await calculateRecipeCost(comp.componentId);
        // Convert sub-recipe's yield to cost per unit, then scale by quantity needed
        const subRecipeYieldUnit = units.find(u => u.id === subRecipe.yieldUnitId);
        const subRecipeYieldQty = subRecipeYieldUnit ? subRecipe.yieldQty * subRecipeYieldUnit.toBaseRatio : subRecipe.yieldQty;
        const costPerUnit = subRecipeYieldQty > 0 ? subRecipeCost / subRecipeYieldQty : 0;
        totalCost += qty * costPerUnit;
      }
    }
  }

  const wasteMultiplier = 1 + recipe.wastePercent / 100;
  return totalCost * wasteMultiplier;
}

async function calculateInventoryItemImpactInRecipe(recipeId: string, targetItemId: string): Promise<{ usesItem: boolean, qty: number, costContribution: number }> {
  const components = await storage.getRecipeComponents(recipeId);
  const units = await storage.getUnits();
  const inventoryItems = await storage.getInventoryItems();
  
  let totalQty = 0;
  let totalCostContribution = 0;

  for (const comp of components) {
    const unit = units.find((u) => u.id === comp.unitId);
    const qty = unit ? comp.qty * unit.toBaseRatio : comp.qty;

    if (comp.componentType === "inventory_item" && comp.componentId === targetItemId) {
      const item = inventoryItems.find((i) => i.id === targetItemId);
      if (item) {
        totalQty += qty;
        totalCostContribution += qty * item.pricePerUnit;
      }
    } else if (comp.componentType === "recipe") {
      const subRecipe = await storage.getRecipe(comp.componentId);
      if (subRecipe) {
        const subImpact = await calculateInventoryItemImpactInRecipe(comp.componentId, targetItemId);
        if (subImpact.usesItem) {
          // Scale sub-recipe usage by yield ratio
          const subRecipeYieldUnit = units.find(u => u.id === subRecipe.yieldUnitId);
          const subRecipeYieldQty = subRecipeYieldUnit ? subRecipe.yieldQty * subRecipeYieldUnit.toBaseRatio : subRecipe.yieldQty;
          
          if (subRecipeYieldQty > 0) {
            // Scale the sub-recipe's item usage by (qty needed / yield)
            const scaleFactor = qty / subRecipeYieldQty;
            totalQty += subImpact.qty * scaleFactor;
            totalCostContribution += subImpact.costContribution * scaleFactor;
          }
        }
      }
    }
  }

  return {
    usesItem: totalQty > 0,
    qty: totalQty,
    costContribution: totalCostContribution
  };
}

async function calculateTheoreticalUsage(
  startDate?: Date,
  endDate?: Date
): Promise<Record<string, number>> {
  const sales = await storage.getPOSSales(startDate, endDate);
  const menuItems = await storage.getMenuItems();
  const usage: Record<string, number> = {};

  for (const sale of sales) {
    const saleLines = await storage.getPOSSalesLines(sale.id);
    
    for (const line of saleLines) {
      const menuItem = menuItems.find((mi) => mi.pluSku === line.pluSku);
      if (menuItem) {
        const recipeUsage = await calculateRecipeUsage(menuItem.recipeId, line.qtySold);
        
        for (const [productId, qty] of Object.entries(recipeUsage)) {
          usage[productId] = (usage[productId] || 0) + qty;
        }
      }
    }
  }

  return usage;
}

async function calculateRecipeUsage(
  recipeId: string,
  multiplier: number
): Promise<Record<string, number>> {
  const components = await storage.getRecipeComponents(recipeId);
  const units = await storage.getUnits();
  const usage: Record<string, number> = {};

  for (const comp of components) {
    const unit = units.find((u) => u.id === comp.unitId);
    const qty = unit ? comp.qty * unit.toBaseRatio : comp.qty;

    if (comp.componentType === "inventory_item") {
      usage[comp.componentId] = (usage[comp.componentId] || 0) + qty * multiplier;
    } else if (comp.componentType === "recipe") {
      const subUsage = await calculateRecipeUsage(comp.componentId, multiplier * comp.qty);
      for (const [inventoryItemId, qty] of Object.entries(subUsage)) {
        usage[inventoryItemId] = (usage[inventoryItemId] || 0) + qty;
      }
    }
  }

  return usage;
}

async function calculateActualUsage(
  startDate?: Date,
  endDate?: Date
): Promise<Record<string, number>> {
  const counts = await storage.getInventoryCounts();
  const receipts = await storage.getReceipts();
  const usage: Record<string, number> = {};

  const filteredCounts = counts.filter((c) => {
    if (startDate && c.countedAt < startDate) return false;
    if (endDate && c.countedAt > endDate) return false;
    return true;
  }).sort((a, b) => a.countedAt.getTime() - b.countedAt.getTime());

  if (filteredCounts.length < 2) {
    return usage;
  }

  const startCount = filteredCounts[0];
  const endCount = filteredCounts[filteredCounts.length - 1];

  const startLines = await storage.getInventoryCountLines(startCount.id);
  const endLines = await storage.getInventoryCountLines(endCount.id);

  const inventoryItemIds = new Set([
    ...startLines.map((l) => l.inventoryItemId),
    ...endLines.map((l) => l.inventoryItemId),
  ]);

  for (const inventoryItemId of Array.from(inventoryItemIds)) {
    const startLine = startLines.find((l) => l.inventoryItemId === inventoryItemId);
    const endLine = endLines.find((l) => l.inventoryItemId === inventoryItemId);

    const startingOnHand = startLine?.qty || 0;
    const endingOnHand = endLine?.qty || 0;

    let receiptsInPeriod = 0;
    const filteredReceipts = receipts.filter((r) => {
      if (startDate && r.receivedAt < startDate) return false;
      if (endDate && r.receivedAt > endDate) return false;
      return true;
    });

    for (const receipt of filteredReceipts) {
      const receiptLines = await storage.getReceiptLines(receipt.id);
      const vendorItems = await storage.getVendorItems();
      
      for (const rLine of receiptLines) {
        const vi = vendorItems.find((vi) => vi.id === rLine.vendorItemId);
        if (vi && vi.inventoryItemId === inventoryItemId) {
          receiptsInPeriod += rLine.receivedQty;
        }
      }
    }

    const actualUsage = startingOnHand + receiptsInPeriod - endingOnHand;
    usage[inventoryItemId] = actualUsage;
  }

  return usage;
}

// ============ WEBSOCKET POS STREAMING ============
export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws/pos" });
  
  wss.on("connection", (ws: WebSocket) => {
    console.log("🔌 POS WebSocket client connected");
    
    ws.on("message", async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === "POS_SALE") {
          // Process POS sale in real-time
          const saleData = insertPOSSaleSchema.parse(message.data);
          const sale = await storage.createPOSSale(saleData);
          
          // Process sale lines if provided
          if (message.lines && Array.isArray(message.lines)) {
            for (const lineData of message.lines) {
              const parsedLine = insertPOSSalesLineSchema.parse({
                ...lineData,
                posSalesId: sale.id,
              });
              await storage.createPOSSalesLine(parsedLine);
            }
          }
          
          // Send confirmation back to client
          ws.send(JSON.stringify({
            type: "SALE_PROCESSED",
            saleId: sale.id,
            timestamp: new Date().toISOString(),
          }));
          
          // Broadcast to all connected clients (for dashboard updates)
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                type: "SALE_UPDATE",
                sale,
              }));
            }
          });
        }
      } catch (error: any) {
        console.error("WebSocket error:", error);
        ws.send(JSON.stringify({
          type: "ERROR",
          message: error.message,
        }));
      }
    });
    
    ws.on("close", () => {
      console.log("🔌 POS WebSocket client disconnected");
    });
    
    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
    });
  });
  
  console.log("✅ WebSocket POS streaming enabled at /ws/pos");
  
  return wss;
}
