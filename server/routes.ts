import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import crypto from "crypto";
import multer from "multer";
import { storage } from "./storage";
import { parseCSV } from "./services/tfcCsv";
import { TheoreticalUsageService } from "./services/theoreticalUsage";
import { createOAuthClient, getActiveConnection, getAuthenticatedClient } from "./services/quickbooks";
import OAuthClient from "intuit-oauth";
import { cache, CacheKeys, CacheTTL, cacheInvalidator, cacheLog } from "./cache";
import type { EnrichedInventoryItem } from "../shared/types";
import { z } from "zod";
import { createSession, requireAuth, verifyPassword, hashPassword } from "./auth";
import { getAccessibleStores } from "./permissions";
import { db } from "./db";
import { withTransaction } from "./transaction";
import { eq, and, inArray, gte, lte } from "drizzle-orm";
import { inventoryItems, storeInventoryItems, inventoryItemLocations, storageLocations, menuItems, storeMenuItems, storeRecipes, inventoryCounts, inventoryCountLines, companyStores, vendorItems, inventoryItemPriceHistory, receipts, purchaseOrders, transferOrders, dailyMenuItemSales, theoreticalUsageRuns, theoreticalUsageLines } from "@shared/schema";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { cleanupMenuItemSKUs } from "./cleanup-skus";
import { purgeCompanyData } from "./scripts/purge-company";
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
  createWasteLogSchema,
  insertCompanySettingsSchema,
  insertSystemPreferencesSchema,
  insertCompanySchema,
  insertCompanyStoreSchema,
  insertInvitationSchema,
  insertQuickBooksVendorMappingSchema,
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

      res.json({ 
        user: { 
          id: user.id, 
          email: user.email, 
          role: user.role,
          companyId: user.companyId,
          firstName: user.firstName,
          lastName: user.lastName
        } 
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/auth/logout", requireAuth, async (req, res) => {
    try {
      // Clear cookie-based session
      const sessionId = (req as any).sessionId;
      if (sessionId) {
        await storage.revokeAuthSession(sessionId);
      }
      res.clearCookie("session");
      
      // Clear Passport SSO session if exists
      if ((req as any).isAuthenticated && (req as any).isAuthenticated()) {
        // Use req.logout() which properly handles Passport session cleanup
        (req as any).logout((err: any) => {
          if (err) {
            console.error("Passport logout error:", err);
            return res.status(500).json({ error: "Logout failed" });
          }
          
          // After logout, clear session data if session exists
          if ((req as any).session) {
            // Clear session data without destroying the session object
            // This prevents the "req.session is undefined" error
            (req as any).session.selectedCompanyId = null;
            (req as any).session.pendingInvitationToken = null;
          }
          
          res.status(204).send();
        });
      } else {
        // No Passport session, just send response
        res.status(204).send();
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/auth/me", requireAuth, async (req, res) => {
    const user = (req as any).user;
    const isSSOAuth = (req as any).ssoAuth;
    const authSession = (req as any).authSession;
    
    // Get selectedCompanyId from session
    // For SSO users: read from Passport session (req.session)
    // For username/password users: read from database session (req.authSession)
    let selectedCompanyId = null;
    if (isSSOAuth) {
      selectedCompanyId = (req as any).session?.selectedCompanyId || null;
    } else if (authSession) {
      selectedCompanyId = authSession.selectedCompanyId || null;
    }
    
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json({ 
      id: user.id, 
      email: user.email, 
      role: user.role, 
      companyId: user.companyId,
      firstName: user.firstName,
      lastName: user.lastName,
      ssoProvider: user.ssoProvider,
      ssoId: user.ssoId,
      profileImageUrl: user.profileImageUrl,
      selectedCompanyId
    });
  });

  app.post("/api/auth/select-company", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.body;
      const isSSOAuth = (req as any).ssoAuth;
      const sessionId = (req as any).sessionId;
      
      if (!companyId) {
        return res.status(400).json({ error: "companyId is required" });
      }
      
      // Verify the company exists
      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ error: "Company not found" });
      }
      
      // Update the session with the selected company
      // For SSO users: store in Passport session
      // For username/password users: store in database session
      if (isSSOAuth) {
        (req as any).session.selectedCompanyId = companyId;
      } else if (sessionId) {
        await storage.updateAuthSession(sessionId, { selectedCompanyId: companyId });
      }
      
      res.json({ success: true, companyId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============ API CREDENTIALS (HMAC AUTH) ============
  // Get all API credentials for a company
  app.get("/api/api-credentials", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const credentials = await storage.getApiCredentials(companyId);
      
      // Never expose secret keys in list view
      const sanitizedCredentials = credentials.map(cred => ({
        id: cred.id,
        name: cred.name,
        description: cred.description,
        apiKeyId: cred.apiKeyId,
        isActive: cred.isActive,
        locationCount: cred.locationCount,
        allowedIps: cred.allowedIps,
        lastUsedAt: cred.lastUsedAt,
        createdAt: cred.createdAt,
      }));
      
      res.json(sanitizedCredentials);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get single API credential with locations
  app.get("/api/api-credentials/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const companyId = (req as any).companyId;
      
      const credential = await storage.getApiCredential(id, companyId);
      if (!credential) {
        return res.status(404).json({ error: "API credential not found" });
      }
      
      const locations = await storage.getApiCredentialLocations(id);
      
      // Never expose secret key (even in detail view)
      res.json({
        id: credential.id,
        name: credential.name,
        description: credential.description,
        apiKeyId: credential.apiKeyId,
        isActive: credential.isActive,
        allowedIps: credential.allowedIps,
        lastUsedAt: credential.lastUsedAt,
        createdAt: credential.createdAt,
        locations: locations,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create new API credential
  app.post("/api/api-credentials", requireAuth, async (req, res) => {
    try {
      const { name, description, storeIds, allowedIps } = req.body;
      const companyId = (req as any).companyId;
      const userId = (req as any).user.id;
      
      if (!name || !storeIds || !Array.isArray(storeIds) || storeIds.length === 0) {
        return res.status(400).json({ error: "Name and at least one store location required" });
      }
      
      // Generate cryptographically secure API key ID and secret
      const apiKeyId = crypto.randomBytes(32).toString('hex'); // 64 character public ID
      const secretKey = crypto.randomBytes(64).toString('hex'); // 128 character secret
      
      // Create the credential
      const credential = await storage.createApiCredential({
        companyId,
        name,
        description: description || null,
        apiKeyId,
        secretKey,
        isActive: 1,
        allowedIps: allowedIps || null,
        createdBy: userId,
      });
      
      // Set location mappings
      await storage.setApiCredentialLocations(credential.id, storeIds);
      
      // Return credential with secret key (ONLY shown once at creation)
      res.status(201).json({
        id: credential.id,
        name: credential.name,
        description: credential.description,
        apiKeyId: credential.apiKeyId,
        secretKey: credential.secretKey, // WARNING: Only exposed at creation time
        isActive: credential.isActive,
        allowedIps: credential.allowedIps,
        createdAt: credential.createdAt,
        storeIds: storeIds,
        _warning: "Save the secret key now - it will not be shown again"
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update API credential (name, description, active status, IP whitelist)
  app.patch("/api/api-credentials/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, isActive, allowedIps } = req.body;
      const companyId = (req as any).companyId;
      
      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (isActive !== undefined) updates.isActive = isActive;
      if (allowedIps !== undefined) updates.allowedIps = allowedIps;
      
      const updated = await storage.updateApiCredential(id, companyId, updates);
      if (!updated) {
        return res.status(404).json({ error: "API credential not found" });
      }
      
      res.json({
        id: updated.id,
        name: updated.name,
        description: updated.description,
        apiKeyId: updated.apiKeyId,
        isActive: updated.isActive,
        allowedIps: updated.allowedIps,
        lastUsedAt: updated.lastUsedAt,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete API credential
  app.delete("/api/api-credentials/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const companyId = (req as any).companyId;
      
      await storage.deleteApiCredential(id, companyId);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get locations for an API credential
  app.get("/api/api-credentials/:id/locations", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const companyId = (req as any).companyId;
      
      // Verify credential belongs to company
      const credential = await storage.getApiCredential(id, companyId);
      if (!credential) {
        return res.status(404).json({ error: "API credential not found" });
      }
      
      const locations = await storage.getApiCredentialLocations(id);
      res.json(locations);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update locations for an API credential
  app.put("/api/api-credentials/:id/locations", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { storeIds } = req.body;
      const companyId = (req as any).companyId;
      
      if (!Array.isArray(storeIds) || storeIds.length === 0) {
        return res.status(400).json({ error: "At least one store location required" });
      }
      
      // Verify credential belongs to company
      const credential = await storage.getApiCredential(id, companyId);
      if (!credential) {
        return res.status(404).json({ error: "API credential not found" });
      }
      
      await storage.setApiCredentialLocations(id, storeIds);
      const locations = await storage.getApiCredentialLocations(id);
      
      res.json(locations);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============ USER MANAGEMENT ============
  // Get users for a company
  app.get("/api/users", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const companyId = (req as any).companyId;
      
      // Only global admins and company admins can list users
      if (user.role === "global_admin") {
        // Global admins can list all users or filter by company
        const targetCompanyId = req.query.companyId as string | undefined;
        const users = await storage.getUsers(targetCompanyId);
        res.json(users);
      } else if (user.role === "company_admin" && user.companyId) {
        // Company admins can only list users in their company
        const users = await storage.getUsers(user.companyId);
        res.json(users);
      } else {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create a new user
  app.post("/api/users", requireAuth, async (req, res) => {
    try {
      const currentUser = (req as any).user;
      const { storeIds, ...userData } = req.body;
      
      // Only global admins and company admins can create users
      if (currentUser.role !== "global_admin" && currentUser.role !== "company_admin") {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      
      // Company admins can only create users in their company
      if (currentUser.role === "company_admin") {
        if (!userData.companyId || userData.companyId !== currentUser.companyId) {
          return res.status(403).json({ error: "Can only create users in your company" });
        }
        
        // Company admins cannot create global admins
        if (userData.role === "global_admin") {
          return res.status(403).json({ error: "Cannot create global admin users" });
        }
        
        // Company admins must assign companyId (cannot be null)
        if (!userData.companyId) {
          return res.status(403).json({ error: "Company ID required" });
        }
      }
      
      // Global admins cannot create global admins without explicitly setting null companyId
      if (currentUser.role === "global_admin" && userData.role === "global_admin" && userData.companyId) {
        return res.status(400).json({ error: "Global admins must have null companyId" });
      }
      
      // Hash the password
      const passwordHash = await hashPassword(userData.password);
      delete userData.password;
      
      // Create the user
      const newUser = await storage.createUser({
        ...userData,
        passwordHash,
      });
      
      // Company admins are automatically assigned to all stores
      if (newUser.role === "company_admin" && newUser.companyId) {
        const companyStores = await storage.getCompanyStores(newUser.companyId);
        for (const store of companyStores) {
          await storage.assignUserToStore(newUser.id, store.id);
        }
      } else if (storeIds && Array.isArray(storeIds)) {
        // Assign user to stores if specified (for non-company-admin users)
        // Validate store assignments
        for (const storeId of storeIds) {
          const store = await storage.getCompanyStore(storeId);
          if (!store) {
            return res.status(400).json({ error: `Store ${storeId} not found` });
          }
          
          // Company admins can only assign to stores in their company
          if (currentUser.role === "company_admin" && store.companyId !== currentUser.companyId) {
            return res.status(403).json({ error: "Cannot assign users to stores outside your company" });
          }
          
          // Store must belong to the new user's company
          if (store.companyId !== newUser.companyId) {
            return res.status(400).json({ error: `Store ${storeId} does not belong to user's company` });
          }
          
          await storage.assignUserToStore(newUser.id, storeId);
        }
      }
      
      res.status(201).json(newUser);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Update a user
  app.patch("/api/users/:id", requireAuth, async (req, res) => {
    try {
      const currentUser = (req as any).user;
      const { storeIds, password, ...updates } = req.body;
      
      // Get the target user
      const targetUser = await storage.getUser(req.params.id);
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }
      
      // Only global admins and company admins can update users
      if (currentUser.role === "company_admin") {
        // Company admins can only update users in their company
        if (targetUser.companyId !== currentUser.companyId) {
          return res.status(403).json({ error: "Can only update users in your company" });
        }
        
        // Company admins cannot elevate users to global admin
        if (updates.role === "global_admin") {
          return res.status(403).json({ error: "Cannot elevate users to global admin" });
        }
        
        // Company admins cannot change companyId
        if (updates.companyId && updates.companyId !== currentUser.companyId) {
          return res.status(403).json({ error: "Cannot change user's company" });
        }
        
        // Prevent setting companyId to null
        if (updates.companyId === null) {
          return res.status(403).json({ error: "Cannot remove user's company" });
        }
      } else if (currentUser.role !== "global_admin") {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      
      // Handle password update if provided
      if (password) {
        updates.passwordHash = await hashPassword(password);
      }
      
      // Update the user
      const updatedUser = await storage.updateUser(req.params.id, updates);
      
      // Update store assignments if provided
      if (storeIds !== undefined && Array.isArray(storeIds)) {
        // Validate store assignments
        for (const storeId of storeIds) {
          const store = await storage.getCompanyStore(storeId);
          if (!store) {
            return res.status(400).json({ error: `Store ${storeId} not found` });
          }
          
          // Company admins can only assign to stores in their company
          if (currentUser.role === "company_admin" && store.companyId !== currentUser.companyId) {
            return res.status(403).json({ error: "Cannot assign users to stores outside your company" });
          }
          
          // Store must belong to the target user's company
          if (store.companyId !== targetUser.companyId) {
            return res.status(400).json({ error: `Store ${storeId} does not belong to user's company` });
          }
        }
        
        // Remove all existing assignments
        const currentStores = await storage.getUserStores(req.params.id);
        for (const userStore of currentStores) {
          await storage.removeUserFromStore(req.params.id, userStore.storeId);
        }
        
        // Add new assignments
        for (const storeId of storeIds) {
          await storage.assignUserToStore(req.params.id, storeId);
        }
      }
      
      res.json(updatedUser);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Get user's assigned stores
  app.get("/api/users/:userId/stores", requireAuth, async (req, res) => {
    try {
      const currentUser = (req as any).user;
      const targetUser = await storage.getUser(req.params.userId);
      
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }
      
      // Check permissions
      if (currentUser.role === "company_admin" && targetUser.companyId !== currentUser.companyId) {
        return res.status(403).json({ error: "Access denied" });
      } else if (currentUser.role !== "global_admin" && currentUser.role !== "company_admin") {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      
      const userStores = await storage.getUserStores(req.params.userId);
      res.json(userStores);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============ INVITATIONS ============
  // Get invitation details by token (public endpoint for invitation acceptance)
  app.get("/api/invitations/by-token/:token", async (req, res) => {
    try {
      const { token } = req.params;
      
      const invitation = await storage.getInvitationByToken(token);
      
      if (!invitation) {
        return res.status(404).json({ error: "Invitation not found or expired" });
      }
      
      // Fetch company name to display on acceptance page
      const company = await storage.getCompany(invitation.companyId);
      
      // Return safe invitation details (exclude sensitive fields)
      res.json({
        email: invitation.email,
        role: invitation.role,
        companyName: company?.name || "Unknown Company",
        expiresAt: invitation.expiresAt,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Prepare invitation acceptance (stores token in cookie for SSO callback)
  app.post("/api/invitations/prepare-acceptance/:token", async (req, res) => {
    try {
      const { token } = req.params;
      
      // Validate the invitation token
      const invitation = await storage.getInvitationByToken(token);
      
      if (!invitation) {
        return res.status(404).json({ error: "Invitation not found or expired" });
      }
      
      // Store the invitation token in a signed cookie (survives OAuth redirect)
      // Cookie expires in 15 minutes
      res.cookie('pendingInvitation', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        signed: true,
        maxAge: 15 * 60 * 1000, // 15 minutes
        sameSite: 'lax', // Allow cookie to be sent on OAuth redirects
      });
      
      console.log('[Invitation] Stored invitation token in signed cookie');
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create invitation (admin only)
  app.post("/api/invitations", requireAuth, async (req, res) => {
    try {
      const currentUser = (req as any).user;
      const { email, role, storeIds } = req.body;

      // Only global admins and company admins can send invitations
      if (currentUser.role !== "global_admin" && currentUser.role !== "company_admin") {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Validate required fields
      if (!email || !role) {
        return res.status(400).json({ error: "Email and role are required" });
      }

      // Company admins can only invite to their company
      const companyId = currentUser.role === "company_admin" 
        ? currentUser.companyId 
        : req.body.companyId;

      if (!companyId) {
        return res.status(400).json({ error: "Company ID is required" });
      }

      // Company admins cannot invite global admins
      if (currentUser.role === "company_admin" && role === "global_admin") {
        return res.status(403).json({ error: "Cannot invite global admins" });
      }

      // Validate store assignments for store_user and store_manager roles
      const storeIdsArray = Array.isArray(storeIds) ? storeIds : [];
      if ((role === "store_user" || role === "store_manager") && storeIdsArray.length === 0) {
        return res.status(400).json({ error: "Store users and store managers must be assigned to at least one store" });
      }

      // Check if user already exists in THIS company
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser && existingUser.companyId === companyId) {
        return res.status(400).json({ error: "User is already a member of this company" });
      }

      // Check if there's already a pending invitation for this email and company
      const existingInvitation = await storage.getInvitationByEmail(email, companyId);
      if (existingInvitation) {
        return res.status(400).json({ error: "Pending invitation already exists for this email" });
      }

      // Generate secure token
      const token = crypto.randomBytes(32).toString("hex");

      // Set expiration (7 days from now)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      // Create invitation
      const invitation = await storage.createInvitation({
        email,
        companyId,
        role,
        storeIds: storeIdsArray,
        token,
        invitedBy: currentUser.id,
        expiresAt,
      });

      res.status(201).json(invitation);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // List pending invitations for company (admin only)
  app.get("/api/invitations", requireAuth, async (req, res) => {
    try {
      const currentUser = (req as any).user;

      // Only global admins and company admins can list invitations
      if (currentUser.role !== "global_admin" && currentUser.role !== "company_admin") {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Company admins can only list invitations for their company
      const companyId = currentUser.role === "company_admin"
        ? currentUser.companyId
        : (req.query.companyId as string);

      if (!companyId) {
        return res.status(400).json({ error: "Company ID is required" });
      }

      const invitations = await storage.getPendingInvitations(companyId);
      res.json(invitations);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Revoke invitation (admin only)
  app.delete("/api/invitations/:id", requireAuth, async (req, res) => {
    try {
      const currentUser = (req as any).user;

      // Only global admins and company admins can revoke invitations
      if (currentUser.role !== "global_admin" && currentUser.role !== "company_admin") {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // For company admins, verify they have a company ID
      if (currentUser.role === "company_admin" && !currentUser.companyId) {
        return res.status(403).json({ error: "Company admins must have a company ID" });
      }

      // Company admins can only revoke invitations for their company
      // Global admins can revoke any invitation (no company filter)
      const companyId = currentUser.role === "company_admin"
        ? currentUser.companyId
        : null; // null means no company filter (global admin)

      await storage.revokeInvitation(req.params.id, companyId);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============ OBJECT STORAGE (IMAGE UPLOADS) ============
  // Integration with blueprint:javascript_object_storage for image uploads
  const { ObjectStorageService, ObjectNotFoundError } = await import("./objectStorage");
  const { ObjectPermission } = await import("./objectAcl");
  const sharp = await import("sharp");

  // Diagnostic endpoint to verify object storage configuration
  app.get("/api/objects/status", requireAuth, async (req, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const privateDir = objectStorageService.getPrivateObjectDir();
      const publicPaths = objectStorageService.getPublicObjectSearchPaths();
      
      // Test sidecar connectivity
      const sidecarUrl = "http://127.0.0.1:1106/credential";
      let sidecarStatus = "unknown";
      try {
        const sidecarResponse = await fetch(sidecarUrl);
        sidecarStatus = sidecarResponse.ok ? "connected" : `error: ${sidecarResponse.status}`;
      } catch (e: any) {
        sidecarStatus = `unreachable: ${e.message}`;
      }
      
      res.json({
        configured: true,
        privateDir,
        publicPaths,
        sidecarStatus,
        sidecarUrl,
      });
    } catch (error: any) {
      res.status(500).json({ 
        configured: false,
        error: error.message 
      });
    }
  });

  // Get upload URL for inventory item images
  app.post("/api/objects/upload", requireAuth, async (req, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadUrl: uploadURL }); // Use camelCase to match frontend expectation
    } catch (error: any) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ error: "Failed to generate upload URL", details: error.message });
    }
  });

  // Serve uploaded images with thumbnail support
  app.get("/objects/:objectPath(*)", async (req, res) => {
    const objectStorageService = new ObjectStorageService();
    const thumbnail = req.query.thumbnail === "true";
    
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      
      // Check ACL policy to enforce access control
      const user = (req as any).user; // May be undefined if not authenticated
      const userId = user?.id;
      
      const canAccess = await objectStorageService.canAccessObjectEntity({
        objectFile,
        userId,
        requestedPermission: ObjectPermission.READ,
      });
      
      if (!canAccess) {
        return res.sendStatus(userId ? 403 : 401);
      }
      
      if (thumbnail) {
        // Stream through sharp for thumbnail generation
        const stream = objectFile.createReadStream();
        const [metadata] = await objectFile.getMetadata();
        
        res.set({
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=31536000",
        });

        stream
          .pipe(sharp.default().resize(200, 200, { fit: 'cover' }).jpeg({ quality: 80 }))
          .pipe(res);
      } else {
        // Serve original image
        objectStorageService.downloadObject(objectFile, res);
      }
    } catch (error) {
      console.error("Error serving image:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.sendStatus(404);
      }
      return res.sendStatus(500);
    }
  });

  // Update inventory item with uploaded image
  app.put("/api/inventory-items/:id/image", requireAuth, async (req, res) => {
    try {
      const { imageUrl } = z.object({
        imageUrl: z.string(),
      }).parse(req.body);

      const user = (req as any).user;
      const objectStorageService = new ObjectStorageService();
      
      // Set ACL policy for the uploaded image (public visibility for inventory items)
      const objectPath = await objectStorageService.trySetObjectEntityAclPolicy(
        imageUrl,
        {
          owner: user.id,
          visibility: "public",
        }
      );

      // Update inventory item with the normalized object path
      const item = await storage.updateInventoryItem(req.params.id, {
        imageUrl: objectPath,
      });

      if (!item) {
        return res.status(404).json({ error: "Inventory item not found" });
      }

      res.json({ objectPath });
    } catch (error: any) {
      console.error("Error updating inventory item image:", error);
      res.status(500).json({ error: "Failed to update image" });
    }
  });

  // ============ UNITS ============
  app.get("/api/units", async (req, res) => {
    const cacheKey = CacheKeys.units();
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    
    const units = await storage.getUnits();
    await cache.set(cacheKey, units, CacheTTL.COMPANY);
    res.json(units);
  });

  // Get compatible units for a given unit (same kind: weight/volume/count)
  app.get("/api/units/compatible", requireAuth, async (req, res) => {
    const { unitId } = req.query;
    
    if (!unitId || typeof unitId !== 'string') {
      return res.status(400).json({ error: "unitId query parameter is required" });
    }

    const companyId = (req as any).companyId;
    if (!companyId) {
      return res.status(401).json({ error: "Company ID required" });
    }

    // Get company to check unit system preference
    const company = await storage.getCompany(companyId);
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    const units = await storage.getUnits();
    const targetUnit = units.find(u => u.id === unitId);
    
    if (!targetUnit) {
      return res.status(404).json({ error: "Unit not found" });
    }

    // Fractional pound units to exclude (can be entered in ounces instead)
    const fractionalPounds = ['eighth-pound', 'quarter-pound', 'half-pound'];

    // Filter units by:
    // 1. Same kind (weight/volume/count)
    // 2. Company's unit system preference (imperial/metric/both)
    // 3. Exclude fractional pounds
    let compatibleUnits = units.filter(u => {
      if (u.kind !== targetUnit.kind) return false;
      if (fractionalPounds.includes(u.name)) return false;
      
      // If company prefers "both" or unit has no system, include it
      if (company.preferredUnitSystem === 'both' || !u.system) return true;
      
      // Otherwise, match the company's preference
      return u.system === company.preferredUnitSystem;
    });

    res.json(compatibleUnits);
  });

  app.post("/api/units", async (req, res) => {
    try {
      const data = insertUnitSchema.parse(req.body);
      const unit = await storage.createUnit(data);
      await cache.del(CacheKeys.units());
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
  app.get("/api/storage-locations", requireAuth, async (req: AuthRequest, res) => {
    const locations = await storage.getStorageLocations(req.companyId!);
    res.json(locations);
  });

  app.get("/api/storage-locations/:id", requireAuth, async (req, res) => {
    const location = await storage.getStorageLocation(req.params.id, req.companyId!);
    if (!location) {
      return res.status(404).json({ error: "Storage location not found" });
    }
    res.json(location);
  });

  app.post("/api/storage-locations", requireAuth, async (req: AuthRequest, res) => {
    try {
      const data = insertStorageLocationSchema.parse(req.body);
      // Auto-inject companyId from authenticated user
      const location = await storage.createStorageLocation({ ...data, companyId: req.companyId! });
      res.status(201).json(location);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/storage-locations/:id", requireAuth, async (req, res) => {
    try {
      const data = insertStorageLocationSchema.partial().parse(req.body);
      const location = await storage.updateStorageLocation(req.params.id, req.companyId!, data);
      if (!location) {
        return res.status(404).json({ error: "Storage location not found" });
      }
      res.json(location);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/storage-locations/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteStorageLocation(req.params.id, req.companyId!);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/storage-locations/reorder", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { locationOrders } = req.body;
      if (!Array.isArray(locationOrders)) {
        return res.status(400).json({ error: "locationOrders must be an array" });
      }
      await storage.reorderStorageLocations(req.companyId!, locationOrders);
      res.status(200).json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ CATEGORIES ============
  app.get("/api/categories", requireAuth, async (req, res) => {
    const companyId = (req as any).companyId;
    const cacheKey = CacheKeys.categories(companyId);
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    
    const categories = await storage.getCategories(companyId);
    await cache.set(cacheKey, categories, CacheTTL.COMPANY);
    res.json(categories);
  });

  app.get("/api/categories/:id", requireAuth, async (req, res) => {
    const companyId = (req as any).companyId;
    const category = await storage.getCategory(req.params.id, companyId);
    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.json(category);
  });

  app.post("/api/categories", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const { companyId: _, ...bodyData } = req.body;
      const data = insertCategorySchema.parse({
        ...bodyData,
        companyId,
      });
      const category = await storage.createCategory(data);
      await cache.del(CacheKeys.categories(companyId));
      res.status(201).json(category);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/categories/:id", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      // Strip companyId from request body to prevent cross-tenant reassignment
      const { companyId: _, ...bodyData } = req.body;
      const data = insertCategorySchema.partial().parse(bodyData);
      const category = await storage.updateCategory(req.params.id, companyId, data);
      if (!category) {
        return res.status(404).json({ error: "Category not found" });
      }
      await cache.del(CacheKeys.categories(companyId));
      res.json(category);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/categories/:id", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      await storage.deleteCategory(req.params.id, companyId);
      await cache.del(CacheKeys.categories(companyId));
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/categories/reorder", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { categoryOrders } = req.body;
      if (!Array.isArray(categoryOrders)) {
        return res.status(400).json({ error: "categoryOrders must be an array" });
      }
      await storage.reorderCategories(req.companyId!, categoryOrders);
      await cache.del(CacheKeys.categories(req.companyId!));
      res.status(200).json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ VENDORS ============
  app.get("/api/vendors", requireAuth, async (req, res) => {
    const companyId = (req as any).companyId;
    const cacheKey = CacheKeys.vendors(companyId);
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    
    const vendors = await storage.getVendors(companyId);
    await cache.set(cacheKey, vendors, CacheTTL.USER); // 1800s - vendors change more frequently
    res.json(vendors);
  });

  app.get("/api/vendors/:id", requireAuth, async (req, res) => {
    const companyId = (req as any).companyId;
    const vendor = await storage.getVendor(req.params.id, companyId);
    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }
    res.json(vendor);
  });

  app.post("/api/vendors", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      
      // Ensure user has a company context
      if (!companyId) {
        return res.status(400).json({ error: "Company context required to create vendors" });
      }
      
      // Ensure companyId comes from authenticated context, not request body
      const { companyId: _, ...bodyData } = req.body;
      const data = insertVendorSchema.parse({
        ...bodyData,
        companyId,
      });
      const vendor = await storage.createVendor(data);
      await cache.del(CacheKeys.vendors(companyId));
      res.status(201).json(vendor);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/vendors/:id", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      // Verify vendor belongs to current company before updating
      const existing = await storage.getVendor(req.params.id, companyId);
      if (!existing) {
        return res.status(404).json({ error: "Vendor not found" });
      }
      
      // Don't allow changing companyId
      const { companyId: _, ...bodyData } = req.body;
      const data = insertVendorSchema.partial().parse(bodyData);
      const vendor = await storage.updateVendor(req.params.id, data);
      await cache.del(CacheKeys.vendors(companyId));
      res.json(vendor);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/vendors/:id", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      // Verify vendor belongs to current company before deleting
      const existing = await storage.getVendor(req.params.id, companyId);
      if (!existing) {
        return res.status(404).json({ error: "Vendor not found" });
      }
      
      // Protect "Misc Grocery" vendor from deletion
      const isMiscGrocery = existing.name?.toLowerCase().includes('misc grocery') || false;
      if (isMiscGrocery) {
        return res.status(400).json({ 
          error: "Cannot delete Misc Grocery vendor. This is a system vendor used for unit-based ordering." 
        });
      }
      
      // Check if vendor has any purchase orders
      const purchaseOrders = await storage.getPurchaseOrders(companyId);
      const vendorPOs = purchaseOrders.filter(po => po.vendorId === req.params.id);
      
      if (vendorPOs.length > 0) {
        return res.status(400).json({ 
          error: "Cannot delete vendor with purchase orders. Please deactivate the vendor instead." 
        });
      }
      
      // Check if vendor has any vendor items (products)
      const vendorItems = await storage.getVendorItems(req.params.id, companyId);
      
      if (vendorItems.length > 0) {
        return res.status(400).json({ 
          error: "Cannot delete vendor with products. Please deactivate the vendor instead." 
        });
      }
      
      await storage.deleteVendor(req.params.id);
      await cache.del(CacheKeys.vendors(companyId));
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
        innerPack: p.innerPack,
        price: p.price,
        gtin: p.upc,
        category: p.categoryCode,
        brandName: p.brandName,
      }));

      await storage.createOrderGuideLinesBatch(lines);

      // Get vendor to update vendor_items
      const companyId = (req as any).companyId;
      const vendors = await storage.getVendors(companyId);
      // Note: vendors table doesn't have a 'key' field - this line may need updating
      const vendor = vendors.find((v: any) => v.key === vendorKey);
      
      if (vendor) {
        // Update vendor_items: create if missing, update if exists
        for (const product of orderGuide.products) {
          // Check if vendor item already exists
          const existingItems = await storage.getVendorItems(vendor.id, companyId);
          const existingItem = existingItems.find(vi => vi.vendorSku === product.vendorSku);
          
          if (existingItem) {
            // Update existing vendor item with latest price and sizes
            await storage.updateVendorItem(existingItem.id, {
              lastPrice: product.price || existingItem.lastPrice,
              caseSize: product.caseSize || existingItem.caseSize,
              innerPackSize: product.innerPack,
            });
          }
          // Note: Creating new vendor_items requires inventoryItemId which we don't have from CSV
          // This would be done through a separate mapping process
        }
      }

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
  app.get("/api/inventory-items", requireAuth, async (req, res) => {
    const locationId = req.query.location_id as string | undefined;
    const storeId = req.query.store_id as string | undefined;
    const companyId = (req as any).companyId as string;
    
    // Security check BEFORE cache lookup
    if (storeId) {
      const store = await storage.getCompanyStore(storeId);
      if (!store || store.companyId !== companyId) {
        return res.status(403).json({ error: "Access denied to this store" });
      }
    }
    
    // Try cache lookup with filter params
    const cacheKey = CacheKeys.inventoryList(companyId, storeId, locationId);
    const cached = await cache.get<EnrichedInventoryItem[]>(cacheKey);
    if (cached) {
      cacheLog(`HIT inventory list (${companyId}, store=${storeId || '*'}, location=${locationId || '*'})`);
      return res.json(cached);
    }
    cacheLog(`MISS inventory list (${companyId}, store=${storeId || '*'}, location=${locationId || '*'})`);
    
    // Cache miss - fetch from database
    const items = await storage.getInventoryItems(locationId, storeId, companyId);
    
    // Enrich using Phase 1 caches
    const locations = await cache.getOrSet(
      CacheKeys.locations(companyId),
      () => storage.getStorageLocations(companyId),
      CacheTTL.LOCATIONS
    );
    const units = await cache.getOrSet(
      CacheKeys.units(),
      () => storage.getUnits(),
      CacheTTL.UNITS
    );
    const categories = await cache.getOrSet(
      CacheKeys.categories(companyId),
      () => storage.getCategories(companyId),
      CacheTTL.CATEGORIES
    );
    
    // Fetch all item locations in one batched query
    const itemIds = items.map(item => item.id);
    const itemLocationsMap = await storage.getInventoryItemLocationsBatch(itemIds);
    
    const enriched: EnrichedInventoryItem[] = items.map((item) => {
      const unit = units.find((u) => u.id === item.unitId);
      const category = item.categoryId ? categories.find((c) => c.id === item.categoryId) : null;
      
      // Get all locations for this item from the batch result
      const itemLocationRecords = itemLocationsMap.get(item.id) || [];
      const itemLocations = itemLocationRecords
        .map(il => {
          const loc = locations.find(l => l.id === il.storageLocationId);
          return loc ? {
            id: loc.id,
            name: loc.name,
            isPrimary: il.isPrimary === 1,
          } : null;
        })
        .filter((l): l is { id: string; name: string; isPrimary: boolean } => l !== null)
        .sort((a, b) => {
          // Primary location first
          if (a.isPrimary && !b.isPrimary) return -1;
          if (!a.isPrimary && b.isPrimary) return 1;
          return a.name.localeCompare(b.name);
        });
      
      return {
        id: item.id,
        name: item.name,
        categoryId: item.categoryId,
        category: category?.name || null,
        pluSku: item.pluSku,
        pricePerUnit: item.pricePerUnit,
        avgCostPerUnit: item.avgCostPerUnit || item.pricePerUnit,
        unitId: item.unitId,
        caseSize: item.caseSize,
        yieldPercent: item.yieldPercent,
        imageUrl: item.imageUrl,
        parLevel: item.parLevel,
        reorderLevel: item.reorderLevel,
        storageLocationId: item.storageLocationId,
        onHandQty: item.onHandQty,
        active: item.active,
        locations: itemLocations,
        unit: unit || { id: item.unitId, name: '', abbreviation: '' },
      };
    });
    
    // Store in cache
    await cache.set(cacheKey, enriched, CacheTTL.INVENTORY_ITEMS);
    
    res.json(enriched);
  });

  app.get("/api/inventory-items/aggregated", async (req, res) => {
    const aggregated = await storage.getInventoryItemsAggregated();
    res.json(aggregated);
  });

  app.get("/api/inventory-items/:id", requireAuth, async (req, res) => {
    const itemId = req.params.id;
    const companyId = (req as any).companyId as string;
    
    // Try cache lookup
    const cacheKey = CacheKeys.inventoryItem(companyId, itemId);
    const cached = await cache.get(cacheKey);
    if (cached) {
      cacheLog(`HIT inventory item (${companyId}, ${itemId})`);
      return res.json(cached);
    }
    cacheLog(`MISS inventory item (${companyId}, ${itemId})`);
    
    // Cache miss - fetch from database
    const item = await storage.getInventoryItem(itemId);
    if (!item) {
      return res.status(404).json({ error: "Inventory item not found" });
    }
    
    // Security check - verify company ownership
    if (item.companyId !== companyId) {
      return res.status(403).json({ error: "Access denied to this inventory item" });
    }
    
    // Store in cache
    await cache.set(cacheKey, item, CacheTTL.INVENTORY_ITEMS);
    
    res.json(item);
  });

  app.get("/api/inventory-items/:id/vendor-prices", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const inventoryItemId = req.params.id;
      
      const item = await storage.getInventoryItem(inventoryItemId);
      if (!item) {
        return res.status(404).json({ error: "Inventory item not found" });
      }
      
      if (item.companyId !== companyId) {
        return res.status(403).json({ error: "Access denied to this inventory item" });
      }
      
      const allVendorItems = await db
        .select()
        .from(vendorItems)
        .where(eq(vendorItems.inventoryItemId, inventoryItemId));
      
      const vendors = await storage.getVendors(companyId);
      const units = await storage.getUnits();
      
      const vendorPrices = allVendorItems
        .filter(vi => vi.lastPrice != null)
        .map(vi => {
          const vendor = vendors.find(v => v.id === vi.vendorId);
          const unit = units.find(u => u.id === vi.purchaseUnitId);
          
          const unitPrice = vi.lastPrice;
          const caseSize = vi.caseSize || 1;
          const casePrice = unitPrice * caseSize;
          
          return {
            vendorId: vi.vendorId,
            vendorName: vendor?.name || 'Unknown',
            vendorSku: vi.vendorSku,
            casePrice: casePrice,
            unitPrice: unitPrice,
            caseSize: caseSize,
            unitName: unit?.name || '',
            lastUpdated: vi.updatedAt,
          };
        })
        .sort((a, b) => a.casePrice - b.casePrice);
      
      res.json({
        inventoryItemId,
        inventoryItemName: item.name,
        vendorPrices,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/inventory-items", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const { locationIds, storeIds, ...itemData } = req.body;
      
      // Add companyId from authenticated context
      const dataWithCompany = {
        ...itemData,
        companyId,
      };
      
      const data = insertInventoryItemSchema.parse(dataWithCompany);
      
      // Validate storeIds
      if (!storeIds || !Array.isArray(storeIds) || storeIds.length === 0) {
        return res.status(400).json({ error: "At least one store location is required" });
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
      
      const item = await storage.createInventoryItem(data);
      
      // Set locations if provided
      if (locationIds && Array.isArray(locationIds) && locationIds.length > 0) {
        await storage.setInventoryItemLocations(item.id, locationIds, data.storageLocationId);
      }
      
      // Create store_inventory_items records for each selected store
      for (const storeId of storeIds) {
        await storage.createStoreInventoryItem({
          companyId: req.companyId,
          storeId,
          inventoryItemId: item.id,
          primaryLocationId: data.storageLocationId,
          onHandQty: 0,
          active: 1,
          parLevel: data.parLevel || null,
          reorderLevel: data.reorderLevel || null,
        });
      }
      
      // Invalidate cache after creation
      await cacheInvalidator.invalidateInventory(companyId, item.id);
      cacheLog(`INVALIDATE inventory after create (${companyId}, ${item.id})`);
      
      res.status(201).json(item);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/inventory-items/:id", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const { locationIds, storeId, ...updateData } = req.body;
      const updates = insertInventoryItemSchema.partial().parse(updateData);
      
      // Fetch current item to verify company ownership
      const currentItem = await storage.getInventoryItem(req.params.id);
      if (!currentItem) {
        return res.status(404).json({ error: "Inventory item not found" });
      }
      
      // Check if user is global admin
      const user = await storage.getUser(req.user!.id);
      const isGlobalAdmin = user?.role === "global_admin";
      
      // Global admins can edit items from any company, others must own the item
      if (!isGlobalAdmin && currentItem.companyId !== companyId) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      // Handle store-specific active status updates
      if (storeId && updates.active !== undefined) {
        // Verify store belongs to the item's company
        const store = await storage.getCompanyStore(storeId);
        if (!store || store.companyId !== currentItem.companyId) {
          return res.status(403).json({ error: "Access denied" });
        }
        await storage.updateStoreInventoryItemActive(storeId, req.params.id, updates.active);
        // Remove active from updates to avoid updating global field
        delete updates.active;
      }
      
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
      
      // Only update inventory item if there are actual field updates
      let item;
      if (Object.keys(updates).length > 0) {
        // Check if price is changing
        if (updates.pricePerUnit !== undefined && updates.pricePerUnit !== currentItem.pricePerUnit) {
          // Create price history record
          await storage.createInventoryItemPriceHistory({
            inventoryItemId: req.params.id,
            pricePerUnit: updates.pricePerUnit,
            effectiveAt: new Date(),
            note: 'Price updated via inventory item edit',
          });
        }
        
        item = await storage.updateInventoryItem(req.params.id, updates);
        if (!item) {
          return res.status(404).json({ error: "Inventory item not found" });
        }
      } else {
        // If only updating locations, use current item
        item = currentItem;
      }
      
      // Update locations if provided
      if (locationIds && Array.isArray(locationIds) && locationIds.length > 0) {
        // Get current primary location from inventory_item_locations
        const currentLocations = await storage.getInventoryItemLocations(req.params.id);
        const currentPrimary = currentLocations.find(loc => loc.isPrimary === 1)?.storageLocationId;
        
        // Keep existing primary if still in the new list, otherwise use first location
        const primaryLocationId = currentPrimary && locationIds.includes(currentPrimary)
          ? currentPrimary
          : locationIds[0];
        
        await storage.setInventoryItemLocations(req.params.id, locationIds, primaryLocationId);
      }
      
      // If price or yield changed, recalculate costs for all affected recipes (including nested dependencies)
      const priceChanged = updates.pricePerUnit !== undefined && updates.pricePerUnit !== currentItem.pricePerUnit;
      const yieldChanged = updates.yieldPercent !== undefined && updates.yieldPercent !== currentItem.yieldPercent;
      
      if (priceChanged || yieldChanged) {
        const affectedRecipeIds = await findAffectedRecipesByInventoryItem(req.params.id, currentItem.companyId);
        // Recalculate in topological order (children before parents) to ensure accuracy
        for (const recipeId of affectedRecipeIds) {
          const newCost = await calculateRecipeCost(recipeId);
          await storage.updateRecipe(recipeId, { computedCost: newCost });
        }
        // Invalidate recipe caches since recipe costs changed
        await cacheInvalidator.invalidateRecipes(currentItem.companyId);
      }
      
      // Invalidate inventory cache after update
      await cacheInvalidator.invalidateInventory(currentItem.companyId, req.params.id);
      cacheLog(`INVALIDATE inventory after update (${currentItem.companyId}, ${req.params.id})`);
      
      res.json(item);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/inventory-items/:id/locations", async (req, res) => {
    const locations = await storage.getInventoryItemLocations(req.params.id);
    res.json(locations);
  });

  app.get("/api/inventory-items/:id/vendor-items", requireAuth, async (req, res) => {
    const companyId = (req as any).companyId;
    const vendorItems = await storage.getVendorItemsByInventoryItem(req.params.id);
    const vendors = await storage.getVendors(companyId);
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

  app.get("/api/inventory-items/:id/stores", requireAuth, async (req, res) => {
    const companyId = (req as any).companyId;
    const storeAssociations = await storage.getInventoryItemStores(req.params.id);
    
    // Fetch all company stores to enrich the response
    const allStores = await storage.getCompanyStores(companyId);
    
    res.json({
      associations: storeAssociations,
      allStores,
    });
  });

  app.post("/api/inventory-items/:id/stores", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const { storeIds } = req.body;
      
      if (!Array.isArray(storeIds)) {
        return res.status(400).json({ error: "storeIds must be an array" });
      }

      // Verify the inventory item belongs to this company
      const item = await storage.getInventoryItem(req.params.id);
      if (!item || item.companyId !== companyId) {
        return res.status(404).json({ error: "Inventory item not found" });
      }

      // Get current store associations
      const currentAssociations = await storage.getInventoryItemStores(req.params.id);
      const currentStoreIds = currentAssociations.map(a => a.storeId);

      // Find stores to add and remove
      const storesToAdd = storeIds.filter(id => !currentStoreIds.includes(id));
      const storesToRemove = currentStoreIds.filter(id => !storeIds.includes(id));

      // Verify all stores belong to this company
      const allStores = await storage.getCompanyStores(companyId);
      const validStoreIds = allStores.map(s => s.id);
      const invalidStores = storeIds.filter(id => !validStoreIds.includes(id));
      
      if (invalidStores.length > 0) {
        return res.status(400).json({ error: "Invalid store IDs" });
      }

      // Remove store associations
      for (const storeId of storesToRemove) {
        await storage.removeStoreInventoryItem(storeId, req.params.id);
      }

      // Add new store associations
      for (const storeId of storesToAdd) {
        await storage.createStoreInventoryItem({
          companyId: req.companyId,
          storeId,
          inventoryItemId: req.params.id,
          primaryLocationId: item.storageLocationId,
          onHandQty: 0,
          active: 1,
          parLevel: item.parLevel || null,
          reorderLevel: item.reorderLevel || null,
        });
      }

      // Return updated associations
      const updatedAssociations = await storage.getInventoryItemStores(req.params.id);
      res.json(updatedAssociations);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ VENDOR ITEMS ============
  app.get("/api/vendor-items", requireAuth, async (req, res) => {
    const companyId = (req as any).companyId;
    const vendorId = req.query.vendor_id as string | undefined;
    const storeId = req.query.store_id as string | undefined;
    const vendorItems = await storage.getVendorItems(vendorId, companyId, storeId);
    const inventoryItems = await storage.getInventoryItems(undefined, undefined, companyId);
    const units = await storage.getUnits();
    const categories = await storage.getCategories();
    
    const enriched = vendorItems.map((vi) => {
      const item = inventoryItems.find((i) => i.id === vi.inventoryItemId);
      const unit = units.find((u) => u.id === vi.purchaseUnitId);
      const category = item?.categoryId ? categories.find((c) => c.id === item.categoryId) : null;
      return {
        ...vi,
        inventoryItemName: item?.name || "",
        purchaseUnitName: unit?.name || "",
        categoryId: item?.categoryId || null,
        categoryName: category?.name || null,
        inventoryItem: item ? {
          id: item.id,
          name: item.name,
          categoryId: item.categoryId,
          storageLocationId: item.storageLocationId,
          caseSize: item.caseSize,
          pricePerUnit: item.pricePerUnit,
        } : undefined,
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
  app.get("/api/recipes", requireAuth, async (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    const companyId = (req as any).companyId;
    
    // Try to get from cache first
    const cacheKey = `recipes:costs:${companyId}`;
    const cached = await cache.get<any[]>(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    
    // Calculate costs with preloaded data for efficiency
    const recipes = await storage.getRecipes(companyId);
    const units = await storage.getUnits();
    const inventoryItems = await storage.getInventoryItems(undefined, undefined, companyId);
    
    // Preload all recipe components in bulk (parallel instead of sequential)
    const componentPromises = recipes.map(async (recipe) => ({
      recipeId: recipe.id,
      components: await storage.getRecipeComponents(recipe.id)
    }));
    const componentResults = await Promise.all(componentPromises);
    const allComponents = new Map<string, RecipeComponent[]>(
      componentResults.map(r => [r.recipeId, r.components])
    );
    
    // Create recipe map for quick lookup
    const recipeMap = new Map(recipes.map(r => [r.id, r]));
    
    // Prepare preloaded data
    const preloadedData = {
      recipes: recipeMap,
      components: allComponents,
      units,
      inventoryItems
    };
    
    // Calculate all recipe costs with shared memo
    const memo = new Map<string, number>();
    const recipesWithCosts = await Promise.all(
      recipes.map(async (recipe) => {
        const cost = await calculateRecipeCost(recipe.id, preloadedData, memo);
        return {
          ...recipe,
          computedCost: cost  // Overwrite computedCost with fresh calculated value
        };
      })
    );
    
    // Cache for 5 minutes (300 seconds)
    await cache.set(cacheKey, recipesWithCosts, 300);
    
    res.json(recipesWithCosts);
  });

  app.get("/api/recipes/:id", requireAuth, async (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    const recipe = await storage.getRecipe(req.params.id, (req as any).companyId);
    if (!recipe) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    const components = await storage.getRecipeComponents(req.params.id);
    const units = await storage.getUnits();
    const inventoryItems = await storage.getInventoryItems((req as any).companyId);
    const recipes = await storage.getRecipes((req as any).companyId);

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

  app.post("/api/recipes", requireAuth, async (req, res) => {
    try {
      const data = insertRecipeSchema.parse(req.body);
      const companyId = (req as any).companyId!;
      const recipe = await storage.createRecipe({ ...data, companyId });
      
      // Invalidate recipe caches (including costs cache)
      await cacheInvalidator.invalidateRecipes(companyId);
      
      res.status(201).json(recipe);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/recipes/:id", requireAuth, async (req, res) => {
    try {
      const recipe = await storage.getRecipe(req.params.id, (req as any).companyId);
      if (!recipe) {
        return res.status(404).json({ error: "Recipe not found" });
      }

      // Validate using partial schema
      const updateSchema = insertRecipeSchema.partial();
      const validatedData = updateSchema.parse(req.body);

      const updateData = {
        name: validatedData.name !== undefined ? validatedData.name : recipe.name,
        yieldQty: validatedData.yieldQty !== undefined ? validatedData.yieldQty : recipe.yieldQty,
        yieldUnitId: validatedData.yieldUnitId || recipe.yieldUnitId,
        computedCost: validatedData.computedCost !== undefined ? validatedData.computedCost : recipe.computedCost,
        canBeIngredient: validatedData.canBeIngredient !== undefined ? validatedData.canBeIngredient : recipe.canBeIngredient,
      };

      await storage.updateRecipe(req.params.id, updateData);
      
      // Invalidate recipe caches (including costs cache)
      await cacheInvalidator.invalidateRecipes((req as any).companyId, req.params.id);
      
      const updated = await storage.getRecipe(req.params.id, (req as any).companyId);
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/recipes/:id/components", requireAuth, async (req, res) => {
    try {
      // Verify recipe belongs to user's company
      const recipe = await storage.getRecipe(req.params.id, (req as any).companyId);
      if (!recipe) {
        return res.status(404).json({ error: "Recipe not found" });
      }

      const data = insertRecipeComponentSchema.parse(req.body);
      
      // Verify component reference belongs to same company
      if (data.componentType === "inventory_item") {
        const item = await storage.getInventoryItem(data.componentId, (req as any).companyId);
        if (!item) {
          return res.status(404).json({ error: "Inventory item not found" });
        }
      } else if (data.componentType === "recipe") {
        const subRecipe = await storage.getRecipe(data.componentId, (req as any).companyId);
        if (!subRecipe) {
          return res.status(404).json({ error: "Sub-recipe not found" });
        }
      }

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
  app.get("/api/recipe-components/:recipeId", requireAuth, async (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    // Verify recipe belongs to user's company
    const recipe = await storage.getRecipe(req.params.recipeId, (req as any).companyId);
    if (!recipe) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    const components = await storage.getRecipeComponents(req.params.recipeId);
    const units = await storage.getUnits();
    const inventoryItems = await storage.getInventoryItems((req as any).companyId);
    const recipes = await storage.getRecipes((req as any).companyId);

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

  app.post("/api/recipe-components", requireAuth, async (req, res) => {
    try {
      const data = insertRecipeComponentSchema.parse(req.body);
      
      // Verify recipe belongs to user's company
      const recipe = await storage.getRecipe(data.recipeId, (req as any).companyId);
      if (!recipe) {
        return res.status(404).json({ error: "Recipe not found" });
      }

      // Verify component reference belongs to same company
      if (data.componentType === "inventory_item") {
        const item = await storage.getInventoryItem(data.componentId, (req as any).companyId);
        if (!item) {
          return res.status(404).json({ error: "Inventory item not found" });
        }
      } else if (data.componentType === "recipe") {
        const subRecipe = await storage.getRecipe(data.componentId, (req as any).companyId);
        if (!subRecipe) {
          return res.status(404).json({ error: "Sub-recipe not found" });
        }
      }

      const component = await storage.createRecipeComponent(data);
      
      const updatedCost = await calculateRecipeCost(data.recipeId);
      await storage.updateRecipe(data.recipeId, { computedCost: updatedCost });
      
      // Invalidate recipe caches (including costs cache)
      await cacheInvalidator.invalidateRecipes((req as any).companyId, data.recipeId);
      
      res.status(201).json(component);
    } catch (error: any) {
      console.error("Recipe component creation error:", error);
      console.error("Request body:", req.body);
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/recipe-components/:id", requireAuth, async (req, res) => {
    try {
      const component = await storage.getRecipeComponent(req.params.id);
      if (!component) {
        return res.status(404).json({ error: "Component not found" });
      }

      // Verify recipe belongs to user's company
      const recipe = await storage.getRecipe(component.recipeId, (req as any).companyId);
      if (!recipe) {
        return res.status(404).json({ error: "Recipe not found" });
      }

      // If componentId is being updated, verify new component belongs to same company
      if (req.body.componentId && req.body.componentId !== component.componentId) {
        if (component.componentType === "inventory_item") {
          const item = await storage.getInventoryItem(req.body.componentId, (req as any).companyId);
          if (!item) {
            return res.status(404).json({ error: "Inventory item not found" });
          }
        } else if (component.componentType === "recipe") {
          const subRecipe = await storage.getRecipe(req.body.componentId, (req as any).companyId);
          if (!subRecipe) {
            return res.status(404).json({ error: "Sub-recipe not found" });
          }
        }
      }

      const updateData = {
        qty: req.body.qty !== undefined ? req.body.qty : component.qty,
        unitId: req.body.unitId || component.unitId,
        sortOrder: req.body.sortOrder !== undefined ? req.body.sortOrder : component.sortOrder,
      };

      await storage.updateRecipeComponent(req.params.id, updateData);
      
      const updatedCost = await calculateRecipeCost(component.recipeId);
      await storage.updateRecipe(component.recipeId, { computedCost: updatedCost });
      
      // Invalidate recipe caches (including costs cache)
      await cacheInvalidator.invalidateRecipes((req as any).companyId, component.recipeId);
      
      const updated = await storage.getRecipeComponent(req.params.id);
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/recipe-components/:id", requireAuth, async (req, res) => {
    try {
      const component = await storage.getRecipeComponent(req.params.id);
      if (!component) {
        return res.status(404).json({ error: "Component not found" });
      }

      // Verify recipe belongs to user's company
      const recipe = await storage.getRecipe(component.recipeId, (req as any).companyId);
      if (!recipe) {
        return res.status(404).json({ error: "Recipe not found" });
      }

      const recipeId = component.recipeId;
      await storage.deleteRecipeComponent(req.params.id);
      
      const updatedCost = await calculateRecipeCost(recipeId);
      await storage.updateRecipe(recipeId, { computedCost: updatedCost });
      
      // Invalidate recipe caches (including costs cache)
      await cacheInvalidator.invalidateRecipes((req as any).companyId, recipeId);
      
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ STORE RECIPES ============
  // Get store assignments for a recipe
  app.get("/api/store-recipes/:recipeId", requireAuth, async (req, res) => {
    try {
      const { recipeId } = req.params;
      const companyId = req.companyId!;

      // Verify the recipe belongs to the user's company
      const recipe = await storage.getRecipe(recipeId, companyId);
      if (!recipe) {
        return res.status(404).json({ error: "Recipe not found" });
      }

      const assignments = await db.select().from(storeRecipes).where(
        eq(storeRecipes.recipeId, recipeId)
      );

      res.json(assignments);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Assign recipe to a store
  app.post("/api/store-recipes/:recipeId/:storeId", requireAuth, async (req, res) => {
    try {
      const { recipeId, storeId } = req.params;
      const companyId = req.companyId!;

      // Verify the recipe belongs to the user's company
      const recipe = await storage.getRecipe(recipeId, companyId);
      if (!recipe) {
        return res.status(404).json({ error: "Recipe not found" });
      }

      // Verify the store belongs to the user's company
      const [store] = await db.select().from(companyStores).where(
        and(
          eq(companyStores.id, storeId),
          eq(companyStores.companyId, companyId)
        )
      );

      if (!store) {
        return res.status(404).json({ error: "Store not found" });
      }

      // Check if assignment already exists
      const [existing] = await db.select().from(storeRecipes).where(
        and(
          eq(storeRecipes.recipeId, recipeId),
          eq(storeRecipes.storeId, storeId)
        )
      );

      if (existing) {
        return res.json(existing);
      }

      // Create new assignment
      const [assignment] = await db.insert(storeRecipes).values({
        companyId,
        storeId,
        recipeId,
        active: 1,
      }).returning();

      res.status(201).json(assignment);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Remove recipe from a store
  app.delete("/api/store-recipes/:recipeId/:storeId", requireAuth, async (req, res) => {
    try {
      const { recipeId, storeId } = req.params;
      const companyId = req.companyId!;

      // Verify the recipe belongs to the user's company
      const recipe = await storage.getRecipe(recipeId, companyId);
      if (!recipe) {
        return res.status(404).json({ error: "Recipe not found" });
      }

      await db.delete(storeRecipes).where(
        and(
          eq(storeRecipes.recipeId, recipeId),
          eq(storeRecipes.storeId, storeId)
        )
      );

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
  app.get("/api/inventory", requireAuth, async (req, res) => {
    const locationId = req.query.location_id as string | undefined;
    const items = await storage.getInventoryItems(locationId);
    
    const locations = await storage.getStorageLocations(req.companyId!);
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
    const companyId = req.query.companyId as string | undefined;
    const storeId = req.query.storeId as string | undefined;
    const storageLocationId = req.query.storageLocationId as string | undefined;
    const counts = await storage.getInventoryCounts(companyId, storeId, storageLocationId);
    
    // Enrich counts with store information
    // Get unique company IDs from counts to fetch all relevant stores
    const companyIds = [...new Set(counts.map(c => c.companyId))];
    const allStores = await Promise.all(
      companyIds.map(id => storage.getCompanyStores(id))
    );
    const storesMap = new Map(allStores.flat().map(s => [s.id, s]));
    
    const enrichedCounts = counts.map(count => {
      const store = storesMap.get(count.storeId);
      return {
        ...count,
        storeName: store?.name || 'Unknown Store',
      };
    });
    
    res.json(enrichedCounts);
  });

  app.get("/api/inventory-counts/:id", requireAuth, async (req, res) => {
    const count = await storage.getInventoryCount(req.params.id);
    if (!count) {
      return res.status(404).json({ error: "Count not found" });
    }
    
    const user = (req as any).user;
    
    // Determine if this is the latest count for the store
    const allCounts = await storage.getInventoryCounts(count.companyId, count.storeId);
    const sortedCounts = allCounts.sort((a, b) => 
      new Date(b.countDate).getTime() - new Date(a.countDate).getTime()
    );
    const isLatest = sortedCounts.length > 0 && sortedCounts[0].id === count.id;
    
    // Check if user has admin permissions (can edit historical data)
    const isAdmin = user.role === "global_admin" || user.role === "company_admin";
    
    res.json({
      ...count,
      isLatest,
      canEdit: isAdmin || isLatest, // Admins can always edit, non-admins can only edit latest
    });
  });

  app.get("/api/inventory-count-lines/:countId", async (req, res) => {
    const lines = await storage.getInventoryCountLines(req.params.countId);
    
    // Get the count to find which company this is for (CRITICAL: do this first for multi-tenant isolation)
    const count = await storage.getInventoryCount(req.params.countId);
    const companyId = count?.companyId;
    
    if (!companyId) {
      return res.status(400).json({ error: "Count has no associated company" });
    }
    
    // Fetch data filtered by company for multi-tenant safety
    const units = await storage.getUnits();
    const inventoryItems = await storage.getInventoryItems(undefined, undefined, companyId);
    const categories = await storage.getCategories(companyId);
    const storageLocations = await storage.getStorageLocations(companyId);
    
    const enriched = lines.map(line => {
      const unit = units.find(u => u.id === line.unitId);
      const item = inventoryItems.find(i => i.id === line.inventoryItemId);
      const category = item?.categoryId ? categories.find(c => c.id === item.categoryId) : null;
      const storageLocation = storageLocations.find(sl => sl.id === line.storageLocationId);
      
      const enrichedItem = item ? {
        ...item,
        category: category?.name || null,
        lastCost: item.pricePerUnit * item.caseSize,
        storageLocationId: line.storageLocationId, // Use the location from the count line
        storageLocationName: storageLocation?.name || null
      } : null;
      
      return {
        ...line,
        unitName: unit?.name || "unit",
        unitAbbreviation: unit?.abbreviation || "unit",
        inventoryItem: enrichedItem,
        storageLocationName: storageLocation?.name || null
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
      unitName: unit?.name || "unit",
      unitAbbreviation: unit?.abbreviation || "unit"
    };
    
    res.json(enriched);
  });

  app.post("/api/inventory-count-lines", requireAuth, async (req, res) => {
    try {
      const lineData = insertInventoryCountLineSchema.parse(req.body);

      const count = await storage.getInventoryCount(lineData.inventoryCountId);
      if (!count) {
        return res.status(404).json({ error: "Count not found" });
      }

      const user = (req as any).user;
      
      // Determine if this is the latest count for the store
      const allCounts = await storage.getInventoryCounts(count.companyId, count.storeId);
      const sortedCounts = allCounts.sort((a, b) => 
        new Date(b.countDate).getTime() - new Date(a.countDate).getTime()
      );
      const isLatest = sortedCounts.length > 0 && sortedCounts[0].id === count.id;
      
      // Check if user has permission to edit (admin or latest session)
      const isAdmin = user.role === "global_admin" || user.role === "company_admin";
      const canEdit = isAdmin || isLatest;
      
      if (!canEdit) {
        return res.status(403).json({ 
          error: "Cannot edit historical inventory sessions. Only administrators can modify historical data." 
        });
      }

      const line = await storage.createInventoryCountLine(lineData);

      // Note: Inventory counts record what was counted, they don't update inventory levels
      // Inventory adjustments should be done separately if needed

      res.status(201).json(line);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/inventory-count-lines/:id", requireAuth, async (req, res) => {
    try {
      const lineData = insertInventoryCountLineSchema.partial().parse(req.body);
      const existingLine = await storage.getInventoryCountLine(req.params.id);
      
      if (!existingLine) {
        return res.status(404).json({ error: "Count line not found" });
      }

      // Get the count session to check permissions
      const count = await storage.getInventoryCount(existingLine.inventoryCountId);
      if (!count) {
        return res.status(404).json({ error: "Count session not found" });
      }

      const user = (req as any).user;
      
      // Determine if this is the latest count for the store
      const allCounts = await storage.getInventoryCounts(count.companyId, count.storeId);
      const sortedCounts = allCounts.sort((a, b) => 
        new Date(b.countDate).getTime() - new Date(a.countDate).getTime()
      );
      const isLatest = sortedCounts.length > 0 && sortedCounts[0].id === count.id;
      
      // Check if user has permission to edit (admin or latest session)
      const isAdmin = user.role === "global_admin" || user.role === "company_admin";
      const canEdit = isAdmin || isLatest;
      
      if (!canEdit) {
        return res.status(403).json({ 
          error: "Cannot edit historical inventory sessions. Only administrators can modify historical data." 
        });
      }

      // Server-side validation and qty recalculation for case counting
      const updates: any = { ...lineData };
      
      // Validate case counting fields
      if (updates.caseQty != null || updates.looseUnits != null) {
        const caseQty = updates.caseQty ?? 0;
        const looseUnits = updates.looseUnits ?? 0;
        
        if (caseQty < 0) {
          return res.status(400).json({ error: "Case quantity cannot be negative" });
        }
        if (looseUnits < 0) {
          return res.status(400).json({ error: "Loose units cannot be negative" });
        }
        
        // Recalculate qty from case counts (server-side integrity check)
        // Get inventory item to retrieve case size
        const item = await storage.getInventoryItem(existingLine.inventoryItemId);
        if (item) {
          const caseSize = item.caseSize || 0;
          updates.qty = (caseQty * caseSize) + looseUnits;
        }
      } else if (updates.qty != null) {
        // Regular qty update - clear case counting fields
        if (updates.qty < 0) {
          return res.status(400).json({ error: "Quantity cannot be negative" });
        }
        updates.caseQty = null;
        updates.looseUnits = null;
      }

      const updatedLine = await storage.updateInventoryCountLine(req.params.id, updates);

      // Note: Inventory counts record what was counted, they don't update inventory levels
      // Inventory adjustments should be done separately if needed

      res.json(updatedLine);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/inventory-count-lines/:id", requireAuth, async (req, res) => {
    try {
      const line = await storage.getInventoryCountLine(req.params.id);
      
      if (!line) {
        return res.status(404).json({ error: "Count line not found" });
      }

      // Get the count session to check permissions
      const count = await storage.getInventoryCount(line.inventoryCountId);
      if (!count) {
        return res.status(404).json({ error: "Count session not found" });
      }

      const user = (req as any).user;
      
      // Determine if this is the latest count for the store
      const allCounts = await storage.getInventoryCounts(count.companyId, count.storeId);
      const sortedCounts = allCounts.sort((a, b) => 
        new Date(b.countDate).getTime() - new Date(a.countDate).getTime()
      );
      const isLatest = sortedCounts.length > 0 && sortedCounts[0].id === count.id;
      
      // Check if user has permission to edit (admin or latest session)
      const isAdmin = user.role === "global_admin" || user.role === "company_admin";
      const canEdit = isAdmin || isLatest;
      
      if (!canEdit) {
        return res.status(403).json({ 
          error: "Cannot edit historical inventory sessions. Only administrators can modify historical data." 
        });
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

      // Auto-populate count lines for GLOBALLY ACTIVE inventory items associated with THIS STORE
      // Query database directly to get items where BOTH global active AND store-active = 1
      const activeItemsQuery = await db
        .select({
          inventoryItem: inventoryItems,
        })
        .from(inventoryItems)
        .innerJoin(
          storeInventoryItems,
          and(
            eq(storeInventoryItems.inventoryItemId, inventoryItems.id),
            eq(storeInventoryItems.storeId, count.storeId)
          )
        )
        .where(
          and(
            eq(inventoryItems.companyId, count.companyId),
            eq(inventoryItems.active, 1), // GLOBAL active
            eq(storeInventoryItems.active, 1) // STORE active
          )
        );
      
      const activeItems = activeItemsQuery.map(row => row.inventoryItem);

      // Batch fetch storage locations for all items, filtering by company
      const itemIds = activeItems.map(item => item.id);
      
      // Query storage locations with company filter
      const itemLocationsQuery = await db
        .select({
          inventoryItemId: inventoryItemLocations.inventoryItemId,
          storageLocationId: inventoryItemLocations.storageLocationId,
          isPrimary: inventoryItemLocations.isPrimary,
        })
        .from(inventoryItemLocations)
        .innerJoin(
          storageLocations,
          eq(inventoryItemLocations.storageLocationId, storageLocations.id)
        )
        .where(
          and(
            inArray(inventoryItemLocations.inventoryItemId, itemIds),
            eq(storageLocations.companyId, count.companyId) // Only locations from this company
          )
        );

      // Group by inventory item ID
      const itemLocationsMap = new Map<string, typeof itemLocationsQuery>();
      for (const location of itemLocationsQuery) {
        const existing = itemLocationsMap.get(location.inventoryItemId) || [];
        existing.push(location);
        itemLocationsMap.set(location.inventoryItemId, existing);
      }

      // Create count lines for EACH storage location per item
      for (const item of activeItems) {
        const locations = itemLocationsMap.get(item.id) || [];
        
        // If item has no assigned locations, skip it (shouldn't happen for properly configured items)
        if (locations.length === 0) continue;

        // Create one line per location where this item is stored
        for (const location of locations) {
          const lineData = {
            inventoryCountId: count.id,
            inventoryItemId: item.id,
            storageLocationId: location.storageLocationId,
            qty: 0,
            unitId: item.unitId,
            unitCost: item.pricePerUnit, // Snapshot the current price
            userId: countInput.userId,
          };

          await storage.createInventoryCountLine(lineData);
        }
      }

      res.status(201).json(count);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/inventory-counts/:id", requireAuth, async (req, res) => {
    try {
      const count = await storage.getInventoryCount(req.params.id);
      if (!count) {
        return res.status(404).json({ error: "Count session not found" });
      }

      const user = (req as any).user;
      
      // Determine if this is the latest count for the store
      const allCounts = await storage.getInventoryCounts(count.companyId, count.storeId);
      const sortedCounts = allCounts.sort((a, b) => 
        new Date(b.countDate).getTime() - new Date(a.countDate).getTime()
      );
      const isLatest = sortedCounts.length > 0 && sortedCounts[0].id === count.id;
      
      // Check if user has permission to delete (admin or latest session)
      const isAdmin = user.role === "global_admin" || user.role === "company_admin";
      const canDelete = isAdmin || isLatest;
      
      if (!canDelete) {
        return res.status(403).json({ 
          error: "Cannot delete historical inventory sessions. Only administrators can delete historical data." 
        });
      }

      await storage.deleteInventoryCount(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Apply inventory count to update on-hand quantities
  app.post("/api/inventory-counts/:id/apply", requireAuth, async (req, res) => {
    try {
      const count = await storage.getInventoryCount(req.params.id);
      if (!count) {
        return res.status(404).json({ error: "Count session not found" });
      }

      // Validate company ownership
      if (count.companyId !== (req as any).companyId) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Check if already applied
      if ((count as any).applied === 1) {
        return res.status(400).json({ error: "This inventory count has already been applied" });
      }

      const user = (req as any).user;
      const lines = await storage.getInventoryCountLines(count.id);

      if (lines.length === 0) {
        return res.status(400).json({ error: "Cannot apply empty inventory count" });
      }

      // Group lines by inventory item (sum quantities across storage locations)
      const itemTotals = new Map<string, number>();
      for (const line of lines) {
        const currentTotal = itemTotals.get(line.inventoryItemId) || 0;
        itemTotals.set(line.inventoryItemId, currentTotal + line.qty);
      }

      // Wrap inventory updates in transaction for atomicity
      // Prevents partial updates if operation fails mid-way under concurrent access
      await withTransaction(async (tx) => {
        // Update on-hand quantities for each item
        for (const [inventoryItemId, totalQty] of itemTotals.entries()) {
          // Check if store inventory record exists (with explicit companyId filter for tenant isolation)
          const [existingStoreItem] = await tx
            .select()
            .from(storeInventoryItems)
            .where(
              and(
                eq(storeInventoryItems.companyId, count.companyId), // Explicit tenant guard
                eq(storeInventoryItems.storeId, count.storeId),
                eq(storeInventoryItems.inventoryItemId, inventoryItemId)
              )
            )
            .limit(1);
          
          if (existingStoreItem) {
            // Update existing record with explicit companyId filter for security
            await tx
              .update(storeInventoryItems)
              .set({ 
                onHandQty: totalQty,
                updatedAt: new Date()
              })
              .where(
                and(
                  eq(storeInventoryItems.companyId, count.companyId), // Explicit tenant guard
                  eq(storeInventoryItems.storeId, count.storeId),
                  eq(storeInventoryItems.inventoryItemId, inventoryItemId)
                )
              );
          } else {
            // Create new store inventory item with counted quantity
            await tx.insert(storeInventoryItems).values({
              companyId: count.companyId,
              storeId: count.storeId,
              inventoryItemId: inventoryItemId,
              onHandQty: totalQty,
              active: 1
            });
          }
        }

        // Mark count as applied and lock it (make read-only) with explicit companyId filter
        await tx
          .update(inventoryCounts)
          .set({ 
            applied: 1,
            appliedAt: new Date(),
            appliedBy: user.id,
            canEdit: 0 // Lock the count from further edits
          })
          .where(
            and(
              eq(inventoryCounts.id, count.id),
              eq(inventoryCounts.companyId, count.companyId) // Explicit tenant guard
            )
          );
      });

      const updatedCount = await storage.getInventoryCount(count.id);
      res.json(updatedCount);
    } catch (error: any) {
      console.error("Apply inventory count error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Unlock inventory count session (admin only)
  app.patch("/api/inventory-counts/:id/unlock", requireAuth, async (req, res) => {
    try {
      const count = await storage.getInventoryCount(req.params.id);
      if (!count) {
        return res.status(404).json({ error: "Count session not found" });
      }

      // Validate company ownership
      if (count.companyId !== (req as any).companyId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const user = (req as any).user;
      const isAdmin = user.role === "global_admin" || user.role === "company_admin";

      if (!isAdmin) {
        return res.status(403).json({ error: "Only administrators can unlock inventory count sessions" });
      }

      // Check if already unlocked
      if ((count as any).applied === 0) {
        return res.status(400).json({ error: "This inventory count is already unlocked" });
      }

      // Unlock the count session
      await db
        .update(inventoryCounts)
        .set({ 
          applied: 0,
          appliedAt: null,
          appliedBy: null,
        })
        .where(eq(inventoryCounts.id, count.id));

      const updatedCount = await storage.getInventoryCount(count.id);
      res.json(updatedCount);
    } catch (error: any) {
      console.error("Unlock inventory count error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Lock inventory count session (admin only)
  app.patch("/api/inventory-counts/:id/lock", requireAuth, async (req, res) => {
    try {
      const count = await storage.getInventoryCount(req.params.id);
      if (!count) {
        return res.status(404).json({ error: "Count session not found" });
      }

      // Validate company ownership
      if (count.companyId !== (req as any).companyId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const user = (req as any).user;
      const isAdmin = user.role === "global_admin" || user.role === "company_admin";

      if (!isAdmin) {
        return res.status(403).json({ error: "Only administrators can lock inventory count sessions" });
      }

      // Check if already locked
      if ((count as any).applied === 1) {
        return res.status(400).json({ error: "This inventory count is already locked" });
      }

      const lines = await storage.getInventoryCountLines(count.id);
      if (lines.length === 0) {
        return res.status(400).json({ error: "Cannot lock empty inventory count" });
      }

      // Lock the count session
      await db
        .update(inventoryCounts)
        .set({ 
          applied: 1,
          appliedAt: new Date(),
          appliedBy: user.id,
        })
        .where(eq(inventoryCounts.id, count.id));

      const updatedCount = await storage.getInventoryCount(count.id);
      res.json(updatedCount);
    } catch (error: any) {
      console.error("Lock inventory count error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get previous inventory count session (for comparison)
  app.get("/api/inventory-counts/:id/previous-lines", async (req, res) => {
    try {
      const currentCountId = req.params.id;
      const currentCount = await storage.getInventoryCount(currentCountId);
      
      if (!currentCount) {
        return res.status(404).json({ error: "Count not found" });
      }

      // Get counts from the same company and store, and find the one immediately before this one
      // Use countDate (official inventory date) not countedAt (session creation time)
      const allCounts = await storage.getInventoryCounts(currentCount.companyId, currentCount.storeId);
      const previousCount = allCounts
        .filter(c => new Date(c.countDate) < new Date(currentCount.countDate))
        .sort((a, b) => new Date(b.countDate).getTime() - new Date(a.countDate).getTime())[0];

      if (!previousCount) {
        return res.json({ previousCountId: null, lines: [] }); // No previous count exists
      }

      // Get the previous count's lines
      const previousLines = await storage.getInventoryCountLines(previousCount.id);
      
      res.json({ previousCountId: previousCount.id, lines: previousLines });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Get item usage between latest two inventory counts for a store
  app.get("/api/stores/:storeId/usage", requireAuth, async (req, res) => {
    try {
      const storeId = req.params.storeId;
      const companyId = (req as any).companyId;
      
      // Get store to verify it exists and belongs to the company
      const store = await storage.getCompanyStore(storeId);
      if (!store) {
        return res.status(404).json({ error: "Store not found" });
      }
      
      if (store.companyId !== companyId) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Get all counts for this store, sorted by count date descending
      const allCounts = await storage.getInventoryCounts(companyId, storeId);
      const sortedCounts = allCounts.sort((a, b) => 
        new Date(b.countDate).getTime() - new Date(a.countDate).getTime()
      );

      if (sortedCounts.length < 2) {
        // Need at least two counts to calculate usage
        return res.json([]);
      }

      const currentCount = sortedCounts[0];
      const previousCount = sortedCounts[1];

      // Calculate usage between the two counts
      const usageData = await storage.getItemUsageBetweenCounts(
        storeId,
        previousCount.id,
        currentCount.id
      );

      res.json(usageData);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============ UNIFIED ORDERS (Purchase + Transfer) ============
  app.get("/api/orders/unified", requireAuth, async (req, res) => {
    try {
      const companyId = req.companyId!;
      const storeId = req.query.storeId as string | undefined;
      const status = req.query.status as string | undefined;
      
      // Fetch both purchase orders and transfer orders
      const [purchaseOrders, transferOrders, vendors, stores, allReceipts] = await Promise.all([
        storage.getPurchaseOrders(companyId, storeId),
        storage.getTransferOrders(companyId, storeId),
        storage.getVendors(companyId),
        storage.getCompanyStores(companyId),
        storage.getReceipts(companyId)
      ]);
      
      // Build a map of purchase order ID to latest receipt completion timestamp
      const poCompletionMap = new Map<string, string>();
      for (const receipt of allReceipts) {
        if (receipt.status === "completed" && receipt.purchaseOrderId && receipt.receivedAt) {
          const existing = poCompletionMap.get(receipt.purchaseOrderId);
          if (!existing || new Date(receipt.receivedAt) > new Date(existing)) {
            poCompletionMap.set(receipt.purchaseOrderId, receipt.receivedAt);
          }
        }
      }
      
      // Transform purchase orders
      const poPromises = purchaseOrders.map(async (po) => {
        const vendor = vendors.find(v => v.id === po.vendorId);
        const store = stores.find(s => s.id === po.storeId);
        const lines = await storage.getPOLines(po.id);
        const lineCount = lines.length;
        const totalAmount = lines.reduce((sum, line) => sum + (line.orderedQty * line.priceEach), 0);
        
        // For received purchase orders, get completion timestamp from map
        const completedAt = po.status === "received" ? (poCompletionMap.get(po.id) || null) : null;
        
        return {
          id: po.id,
          type: "purchase" as const,
          status: po.status,
          createdAt: po.createdAt,
          expectedDate: po.expectedDate,
          completedAt: completedAt,
          vendorName: vendor?.name || "Unknown",
          fromStore: vendor?.name, // Vendor as "source" for purchase orders
          toStore: store?.name, // Receiving store
          storeId: po.storeId, // Store ID for filtering
          lineCount,
          totalAmount,
        };
      });
      
      // Transform transfer orders
      const toPromises = transferOrders.map(async (to) => {
        const fromStore = stores.find(s => s.id === to.fromStoreId);
        const toStore = stores.find(s => s.id === to.toStoreId);
        const lines = await storage.getTransferOrderLines(to.id);
        const lineCount = lines.length;
        
        // Calculate approximate total (items may not have prices, so this is best effort)
        const inventoryItems = await storage.getInventoryItems(undefined, undefined, companyId);
        let totalAmount = 0;
        for (const line of lines) {
          const item = inventoryItems.find(i => i.id === line.inventoryItemId);
          if (item && item.pricePerUnit) {
            totalAmount += line.requestedQty * item.pricePerUnit;
          }
        }
        
        return {
          id: to.id,
          type: "transfer" as const,
          status: to.status,
          createdAt: to.createdAt,
          expectedDate: to.expectedDate,
          completedAt: to.completedAt || null,
          vendorName: `${fromStore?.name || "Unknown"} → ${toStore?.name || "Unknown"}`,
          fromStore: fromStore?.name,
          toStore: toStore?.name,
          fromStoreId: to.fromStoreId, // Store IDs for filtering
          toStoreId: to.toStoreId,
          lineCount,
          totalAmount,
        };
      });
      
      // Wait for all enrichment
      const enrichedPOs = await Promise.all(poPromises);
      const enrichedTOs = await Promise.all(toPromises);
      
      // Combine and filter by status if provided
      let unified = [...enrichedPOs, ...enrichedTOs];
      if (status) {
        unified = unified.filter(order => order.status === status);
      }
      
      // Sort by created date descending (newest first)
      unified.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      res.json(unified);
    } catch (error: any) {
      console.error("Unified orders error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============ PURCHASE ORDERS ============
  app.get("/api/purchase-orders", requireAuth, async (req, res) => {
    const companyId = (req as any).companyId;
    const storeId = req.query.storeId as string | undefined;
    
    const orders = await storage.getPurchaseOrders(companyId, storeId);
    const vendors = await storage.getVendors(companyId);
    
    const enriched = await Promise.all(orders.map(async (po) => {
      const vendor = vendors.find((v) => v.id === po.vendorId);
      const lines = await storage.getPOLines(po.id);
      const lineCount = lines.length;
      const totalAmount = lines.reduce((sum, line) => sum + (line.orderedQty * line.priceEach), 0);
      
      // For received orders, calculate actual received amount from receipts
      let receivedAmount = 0;
      if (po.status === "received") {
        const allReceipts = await storage.getReceipts(companyId);
        const poReceipts = allReceipts.filter(r => r.purchaseOrderId === po.id && r.status === "completed");
        
        for (const receipt of poReceipts) {
          const receiptLines = await storage.getReceiptLinesByReceiptId(receipt.id);
          receivedAmount += receiptLines.reduce((sum, line) => sum + (line.receivedQty * line.priceEach), 0);
        }
      }
      
      return {
        ...po,
        vendorName: vendor?.name || "Unknown",
        lineCount,
        totalAmount,
        receivedAmount,
      };
    }));
    
    // Sort by created date descending (newest first)
    enriched.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    res.json(enriched);
  });

  app.get("/api/purchase-orders/:id", requireAuth, async (req, res) => {
    const companyId = (req as any).companyId;
    const po = await storage.getPurchaseOrder(req.params.id, companyId);
    if (!po) {
      return res.status(404).json({ error: "Purchase order not found" });
    }

    const lines = await storage.getPOLines(req.params.id);
    const vendorItems = await storage.getVendorItems(undefined, companyId);
    const inventoryItems = await storage.getInventoryItems(undefined, undefined, companyId);
    const units = await storage.getUnits();

    const enrichedLines = lines.map((line) => {
      const vi = vendorItems.find((vi) => vi.id === line.vendorItemId);
      const item = inventoryItems.find((i) => i.id === vi?.inventoryItemId);
      const unit = units.find((u) => u.id === line.unitId);
      
      // Use the original PO price (priceEach) - this is the price per unit when ordered
      const pricePerUnit = line.priceEach;
      const caseSize = item?.caseSize || 1;
      
      return {
        ...line,
        inventoryItemId: vi?.inventoryItemId,
        itemName: item?.name || "Unknown",
        vendorSku: vi?.vendorSku || "",
        unitName: unit?.name || "",
        caseQuantity: line.caseQuantity,
        pricePerUnit: pricePerUnit, // Use PO line price (price per unit when ordered)
        caseSize: caseSize, // Need this to calculate totals
      };
    });

    res.json({
      ...po,
      lines: enrichedLines,
    });
  });

  app.post("/api/purchase-orders", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const { lines, ...poData } = req.body;
      
      // Add companyId from authenticated context
      const poInput = insertPurchaseOrderSchema.parse({
        ...poData,
        companyId,
      });
      const po = await storage.createPurchaseOrder(poInput);

      if (lines && Array.isArray(lines)) {
        for (const line of lines) {
          let vendorItemId = line.vendorItemId;
          
          // Check if this is a misc grocery order with inventoryItemId instead
          if (line.inventoryItemId) {
            // Check if vendor item already exists for this vendor and inventory item
            const vendorItems = await storage.getVendorItems(po.vendorId);
            const existingVendorItem = vendorItems.find(
              vi => vi.inventoryItemId === line.inventoryItemId
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

  app.patch("/api/purchase-orders/:id", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const po = await storage.getPurchaseOrder(req.params.id, companyId);
      if (!po) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      const { lines, ...poData } = req.body;
      
      // Validate and update the purchase order
      const validatedData = insertPurchaseOrderSchema.partial().parse(poData);
      
      await storage.updatePurchaseOrder(req.params.id, validatedData);

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
            const vendorItems = await storage.getVendorItems(po.vendorId, companyId);
            const existingVendorItem = vendorItems.find(
              vi => vi.inventoryItemId === line.inventoryItemId
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

      const updatedPO = await storage.getPurchaseOrder(req.params.id, companyId);
      res.json(updatedPO);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/purchase-orders/:id", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const po = await storage.getPurchaseOrder(req.params.id, companyId);
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
  app.get("/api/receipts", requireAuth, async (req, res) => {
    const receipts = await storage.getReceipts(req.companyId!);
    res.json(receipts);
  });

  // Get receipts for a specific purchase order with line details
  app.get("/api/purchase-orders/:poId/receipts", requireAuth, async (req, res) => {
    try {
      const { poId } = req.params;
      const allReceipts = await storage.getReceipts(req.companyId!);
      const poReceipts = allReceipts.filter(r => r.purchaseOrderId === poId);
      
      // Fetch lines and item details for each receipt
      const receiptsWithLines = await Promise.all(
        poReceipts.map(async (receipt) => {
          const lines = await storage.getReceiptLinesByReceiptId(receipt.id);
          
          // Get vendor items to fetch item names and details
          const vendorItems = await storage.getVendorItems(undefined, req.companyId!);
          const inventoryItems = await storage.getInventoryItems(req.companyId!);
          const units = await storage.getUnits();
          
          // Enrich lines with item details
          const enrichedLines = lines.map(line => {
            const vendorItem = vendorItems.find(vi => vi.id === line.vendorItemId);
            const inventoryItem = inventoryItems.find(ii => ii.id === vendorItem?.inventoryItemId);
            const unit = units.find(u => u.id === line.unitId);
            
            return {
              ...line,
              itemName: inventoryItem?.name || vendorItem?.name || "Unknown Item",
              vendorSku: vendorItem?.vendorSku || null,
              unitName: unit?.name || "unit",
            };
          });
          
          return {
            ...receipt,
            lines: enrichedLines,
          };
        })
      );
      
      res.json(receiptsWithLines);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Get or create draft receipt for a purchase order
  app.get("/api/receipts/draft/:poId", requireAuth, async (req, res) => {
    try {
      const { poId } = req.params;
      const { receiptId } = req.query;
      
      const existingReceipts = await storage.getReceipts(req.companyId!);
      
      // If receiptId is provided, load that specific receipt
      if (receiptId && typeof receiptId === 'string') {
        const specificReceipt = existingReceipts.find(r => r.id === receiptId && r.purchaseOrderId === poId);
        if (specificReceipt) {
          const lines = await storage.getReceiptLinesByReceiptId(specificReceipt.id);
          return res.json({ receipt: specificReceipt, lines });
        }
      }
      
      // Otherwise, check if any receipt already exists for this PO (draft or completed)
      const poReceipts = existingReceipts.filter(r => r.purchaseOrderId === poId);
      
      // Prefer completed receipt over draft if both exist
      const existingReceipt = poReceipts.find(r => r.status === "completed") || poReceipts[0];
      
      if (existingReceipt) {
        // Get lines for this receipt (works for both draft and completed)
        const lines = await storage.getReceiptLinesByReceiptId(existingReceipt.id);
        res.json({ receipt: existingReceipt, lines });
      } else {
        // Get the purchase order to extract storeId and companyId
        const po = await storage.getPurchaseOrder(poId, req.companyId!);
        if (!po) {
          return res.status(404).json({ error: "Purchase order not found" });
        }
        
        // Create new draft receipt only if no receipt exists
        const newReceipt = await storage.createReceipt({
          companyId: po.companyId,
          storeId: po.storeId,
          purchaseOrderId: poId,
          status: "draft",
        });
        res.json({ receipt: newReceipt, lines: [] });
      }
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Save or update a receipt line
  app.post("/api/receipt-lines", async (req, res) => {
    try {
      const lineData = insertReceiptLineSchema.parse(req.body);
      
      // Check if line already exists for this receipt and vendor item
      const existingLines = await storage.getReceiptLinesByReceiptId(lineData.receiptId);
      const existingLine = existingLines.find(l => l.vendorItemId === lineData.vendorItemId);
      
      if (existingLine) {
        // Update existing line
        await storage.updateReceiptLine(existingLine.id, {
          receivedQty: lineData.receivedQty,
          priceEach: lineData.pricePerUnit || lineData.priceEach, // Support both for backwards compatibility
        });
        res.json({ ...existingLine, ...lineData });
      } else {
        // Create new line - convert pricePerUnit to priceEach if needed
        const dataToSave = lineData.pricePerUnit 
          ? { ...lineData, priceEach: lineData.pricePerUnit }
          : lineData;
        const newLine = await storage.createReceiptLine(dataToSave);
        res.status(201).json(newLine);
      }
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Update receipt storage location
  app.patch("/api/receipts/:id/storage-location", async (req, res) => {
    try {
      const { storageLocationId } = req.body;
      await storage.updateReceipt(req.params.id, { storageLocationId });
      const receipt = await storage.getReceipt(req.params.id);
      res.json(receipt);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Reopen completed receipt for corrections
  app.patch("/api/receipts/:id/reopen", async (req, res) => {
    try {
      const receipt = await storage.getReceipt(req.params.id);
      if (!receipt) {
        return res.status(404).json({ error: "Receipt not found" });
      }
      
      if (receipt.status !== "completed") {
        return res.status(400).json({ error: "Receipt is not completed" });
      }

      await storage.updateReceipt(receipt.id, { status: "draft" });
      const updatedReceipt = await storage.getReceipt(receipt.id);
      res.json(updatedReceipt);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Complete receiving - finalize draft receipt
  app.patch("/api/receipts/:id/complete", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const receipt = await storage.getReceipt(req.params.id);
      if (!receipt) {
        return res.status(404).json({ error: "Receipt not found" });
      }
      
      // Validate company ownership
      if (receipt.companyId !== companyId) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      if (receipt.status !== "draft") {
        return res.status(400).json({ error: "Receipt is not in draft status" });
      }

      const lines = await storage.getReceiptLinesByReceiptId(receipt.id);
      const vendorItems = await storage.getVendorItems(undefined, companyId);

      // Wrap all receipt completion operations in transaction for atomicity
      // Prevents partial updates to pricing, inventory, and status under concurrent access
      await withTransaction(async (tx) => {
        // Update inventory and pricing for each line
        for (const line of lines) {
          const vi = vendorItems.find((vi) => vi.id === line.vendorItemId);
          if (vi) {
            // Get inventory item with explicit companyId filter
            const [item] = await tx
              .select()
              .from(inventoryItems)
              .where(
                and(
                  eq(inventoryItems.id, vi.inventoryItemId),
                  eq(inventoryItems.companyId, companyId) // Explicit tenant guard
                )
              )
              .limit(1);
              
            if (item) {
              // line.priceEach is already the unit price (per lb, oz, etc), not the case price
              const newPricePerUnit = line.priceEach;
              
              // Get company-wide on-hand quantity across all stores for WAC calculation
              const allStoresForItem = await tx
                .select()
                .from(storeInventoryItems)
                .where(
                  and(
                    eq(storeInventoryItems.inventoryItemId, vi.inventoryItemId),
                    eq(storeInventoryItems.companyId, companyId) // Explicit tenant guard
                  )
                );
              
              const totalCompanyQty = allStoresForItem.reduce((sum, si) => sum + (si.onHandQty || 0), 0);
              
              // Calculate weighted average cost using company-wide quantities
              const currentAvgCost = item.avgCostPerUnit || item.pricePerUnit;
              const totalCurrentValue = totalCompanyQty * currentAvgCost;
              const totalReceivedValue = line.receivedQty * newPricePerUnit;
              const totalQty = totalCompanyQty + line.receivedQty;
              const newAvgCostPerUnit = totalQty > 0 
                ? (totalCurrentValue + totalReceivedValue) / totalQty 
                : newPricePerUnit;
              
              // Track price history if price changed
              if (newPricePerUnit !== item.pricePerUnit) {
                await tx.insert(inventoryItemPriceHistory).values({
                  inventoryItemId: vi.inventoryItemId,
                  pricePerUnit: newPricePerUnit,
                  effectiveAt: new Date(),
                  vendorItemId: vi.id,
                  note: `Price updated via receiving (Last: $${newPricePerUnit.toFixed(4)}, WAC: $${newAvgCostPerUnit.toFixed(4)})`,
                });
              }
              
              // Update both last cost and weighted average cost with explicit companyId filter
              await tx
                .update(inventoryItems)
                .set({ 
                  pricePerUnit: newPricePerUnit,
                  avgCostPerUnit: newAvgCostPerUnit,
                  updatedAt: new Date()
                })
                .where(
                  and(
                    eq(inventoryItems.id, vi.inventoryItemId),
                    eq(inventoryItems.companyId, companyId) // Explicit tenant guard
                  )
                );
              
              // Update on-hand quantity at the store level with explicit companyId filter
              const [existingStoreItem] = await tx
                .select()
                .from(storeInventoryItems)
                .where(
                  and(
                    eq(storeInventoryItems.companyId, companyId), // Explicit tenant guard
                    eq(storeInventoryItems.storeId, receipt.storeId),
                    eq(storeInventoryItems.inventoryItemId, vi.inventoryItemId)
                  )
                )
                .limit(1);
              
              if (existingStoreItem) {
                await tx
                  .update(storeInventoryItems)
                  .set({ 
                    onHandQty: existingStoreItem.onHandQty + line.receivedQty,
                    updatedAt: new Date()
                  })
                  .where(
                    and(
                      eq(storeInventoryItems.companyId, companyId), // Explicit tenant guard
                      eq(storeInventoryItems.storeId, receipt.storeId),
                      eq(storeInventoryItems.inventoryItemId, vi.inventoryItemId)
                    )
                  );
              } else {
                await tx.insert(storeInventoryItems).values({
                  companyId: companyId,
                  storeId: receipt.storeId,
                  inventoryItemId: vi.inventoryItemId,
                  onHandQty: line.receivedQty,
                  active: 1
                });
              }
            }
          }
        }

        // Mark receipt as completed with explicit companyId filter
        await tx
          .update(receipts)
          .set({ 
            status: "completed",
            updatedAt: new Date()
          })
          .where(
            and(
              eq(receipts.id, receipt.id),
              eq(receipts.companyId, companyId) // Explicit tenant guard
            )
          );
        
        // Mark PO as received with explicit companyId filter
        await tx
          .update(purchaseOrders)
          .set({ 
            status: "received",
            updatedAt: new Date()
          })
          .where(
            and(
              eq(purchaseOrders.id, receipt.purchaseOrderId),
              eq(purchaseOrders.companyId, companyId) // Explicit tenant guard
            )
          );
      });

      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/receipts", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const { lines, storageLocationId, ...receiptData } = req.body;
      const receiptInput = insertReceiptSchema.parse(receiptData);
      const receipt = await storage.createReceipt(receiptInput);

      if (lines && Array.isArray(lines)) {
        const vendorItems = await storage.getVendorItems(undefined, companyId);

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
              // lineData.priceEach is already the unit price (per lb, oz, etc), not the case price
              const pricePerUnit = lineData.priceEach;
              
              // Track price history if price changed
              if (pricePerUnit !== item.pricePerUnit) {
                await storage.createInventoryItemPriceHistory({
                  inventoryItemId: vi.inventoryItemId,
                  pricePerUnit,
                  effectiveAt: new Date(),
                  vendorItemId: vi.id,
                  note: 'Price updated via receiving',
                });
              }
              
              // Update price per unit on the company-level catalog
              await storage.updateInventoryItem(vi.inventoryItemId, {
                pricePerUnit,
              });
              
              // Update on-hand quantity at the store level
              await storage.updateStoreInventoryItemQuantity(
                receipt.storeId,
                vi.inventoryItemId,
                lineData.receivedQty
              );
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
  app.get("/api/menu-items", requireAuth, async (req, res) => {
    const companyId = req.companyId;
    const items = await db.select().from(menuItems).where(eq(menuItems.companyId, companyId!));
    res.json(items);
  });

  app.post("/api/menu-items", requireAuth, async (req, res) => {
    try {
      // Parse without companyId, then add it from session
      const data = insertMenuItemSchema.omit({ companyId: true }).parse(req.body);
      const item = await storage.createMenuItem({ ...data, companyId: req.companyId! });
      res.status(201).json(item);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/menu-items/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const companyId = req.companyId!;
      
      // Verify menu item belongs to company
      const existingItem = await db.select().from(menuItems)
        .where(and(eq(menuItems.id, id), eq(menuItems.companyId, companyId)))
        .limit(1);
      
      if (existingItem.length === 0) {
        return res.status(404).json({ error: "Menu item not found" });
      }

      // Update menu item
      const [updated] = await db.update(menuItems)
        .set(req.body)
        .where(eq(menuItems.id, id))
        .returning();
      
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Upload and parse POS menu CSV
  app.post("/api/menu-items/import-csv", requireAuth, async (req, res) => {
    try {
      const { csvContent } = req.body;
      
      if (!csvContent) {
        return res.status(400).json({ error: "CSV content is required" });
      }

      const { parsePosMenuCsv } = await import("./utils/pos-csv-parser");
      const parseResult = parsePosMenuCsv(csvContent);
      
      console.log('[CSV Parse] Returning result:', JSON.stringify(parseResult, null, 2));
      res.json(parseResult);
    } catch (error: any) {
      console.error("[CSV Import Error]", error);
      res.status(400).json({ error: error.message });
    }
  });

  // Bulk create menu items from parsed CSV data
  app.post("/api/menu-items/bulk-create", requireAuth, async (req, res) => {
    try {
      const { items, storeId } = req.body;
      const companyId = req.companyId!;

      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: "Items array is required" });
      }

      if (!storeId) {
        return res.status(400).json({ error: "Store ID is required" });
      }

      // SECURITY: Validate store belongs to authenticated company
      const accessibleStoreIds = await getAccessibleStores(req.user!, req.companyId);
      console.log('[Bulk Create] Requested storeId:', storeId);
      console.log('[Bulk Create] Accessible store IDs:', accessibleStoreIds);
      const storeIsAccessible = accessibleStoreIds.includes(storeId);
      
      if (!storeIsAccessible) {
        console.error('[Bulk Create] Store not accessible! Requested:', storeId, 'User has access to:', accessibleStoreIds);
        return res.status(403).json({ 
          error: "Access denied: Store not found or does not belong to your company" 
        });
      }

      // Create menu items
      const createdItems = [];
      for (const item of items) {
        let recipeId = null;

        // Create placeholder recipe for recipe items
        if (item.isRecipeItem) {
          try {
            recipeId = await createPlaceholderRecipe(companyId, item.name, storeId);
            console.log(`[Placeholder Recipe] Created for "${item.name}" with ID: ${recipeId}`);
          } catch (error: any) {
            console.error(`[Placeholder Recipe Error] Failed to create for "${item.name}":`, error.message);
            // Continue without recipe - it will be null
          }
        }

        const menuItemData = {
          companyId,
          name: item.name,
          department: item.department || null,
          category: item.category || null,
          size: item.size || null,
          pluSku: item.pluSku,
          recipeId, // Link the placeholder recipe
          isRecipeItem: item.isRecipeItem ? 1 : 0,
          active: 1,
        };

        const [created] = await db.insert(menuItems).values(menuItemData).returning();
        createdItems.push(created);

        // Assign to store (now validated to belong to company)
        await db.insert(storeMenuItems).values({
          companyId,
          storeId,
          menuItemId: created.id,
          active: 1,
        });
      }

      res.status(201).json({
        created: createdItems.length,
        items: createdItems,
      });
    } catch (error: any) {
      console.error("[Bulk Create Error]", error);
      res.status(400).json({ error: error.message });
    }
  });

  // Clean up menu item SKUs (remove pipes, create abbreviations)
  app.post("/api/menu-items/cleanup-skus", requireAuth, async (req, res) => {
    try {
      const result = await cleanupMenuItemSKUs();
      res.json(result);
    } catch (error: any) {
      console.error("[SKU Cleanup Error]", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============ STORE MENU ITEMS ============
  // Get store assignments for a menu item
  app.get("/api/store-menu-items/:menuItemId", requireAuth, async (req, res) => {
    try {
      const { menuItemId } = req.params;
      const companyId = req.companyId!;

      // Verify the menu item belongs to the user's company
      const [menuItem] = await db.select().from(menuItems).where(
        and(
          eq(menuItems.id, menuItemId),
          eq(menuItems.companyId, companyId)
        )
      );

      if (!menuItem) {
        return res.status(404).json({ error: "Menu item not found" });
      }

      const assignments = await db.select().from(storeMenuItems).where(
        eq(storeMenuItems.menuItemId, menuItemId)
      );

      res.json(assignments);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Assign menu item to a store
  app.post("/api/store-menu-items/:menuItemId/:storeId", requireAuth, async (req, res) => {
    try {
      const { menuItemId, storeId } = req.params;
      const companyId = req.companyId!;

      // Verify the menu item belongs to the user's company
      const [menuItem] = await db.select().from(menuItems).where(
        and(
          eq(menuItems.id, menuItemId),
          eq(menuItems.companyId, companyId)
        )
      );

      if (!menuItem) {
        return res.status(404).json({ error: "Menu item not found" });
      }

      // Verify the store belongs to the user's company
      const [store] = await db.select().from(companyStores).where(
        and(
          eq(companyStores.id, storeId),
          eq(companyStores.companyId, companyId)
        )
      );

      if (!store) {
        return res.status(404).json({ error: "Store not found" });
      }

      // Check if assignment already exists
      const [existing] = await db.select().from(storeMenuItems).where(
        and(
          eq(storeMenuItems.menuItemId, menuItemId),
          eq(storeMenuItems.storeId, storeId)
        )
      );

      if (existing) {
        return res.json(existing);
      }

      // Create new assignment
      const [assignment] = await db.insert(storeMenuItems).values({
        companyId,
        storeId,
        menuItemId,
        active: 1,
      }).returning();

      res.status(201).json(assignment);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Remove menu item from a store
  app.delete("/api/store-menu-items/:menuItemId/:storeId", requireAuth, async (req, res) => {
    try {
      const { menuItemId, storeId } = req.params;
      const companyId = req.companyId!;

      // Verify the menu item belongs to the user's company
      const [menuItem] = await db.select().from(menuItems).where(
        and(
          eq(menuItems.id, menuItemId),
          eq(menuItems.companyId, companyId)
        )
      );

      if (!menuItem) {
        return res.status(404).json({ error: "Menu item not found" });
      }

      await db.delete(storeMenuItems).where(
        and(
          eq(storeMenuItems.menuItemId, menuItemId),
          eq(storeMenuItems.storeId, storeId)
        )
      );

      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ VARIANCE REPORT ============
  app.get("/api/reports/variance", async (req, res) => {
    try {
      const startDate = req.query.start ? new Date(req.query.start as string) : undefined;
      const endDate = req.query.end ? new Date(req.query.end as string) : undefined;
      const companyId = req.query.companyId as string | undefined;
      const storeId = req.query.storeId as string | undefined;

      const theoreticalUsage = await calculateTheoreticalUsage(startDate, endDate);
      const actualUsage = await calculateActualUsage(startDate, endDate, companyId, storeId);

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
  app.get("/api/waste", requireAuth, async (req, res) => {
    const storeId = req.query.storeId as string | undefined;
    const wasteType = req.query.wasteType as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    
    // Get accessible stores for the user
    const accessibleStoreIds = await getAccessibleStores(req.user!, req.companyId);
    
    const wasteLogs = await storage.getWasteLogs(req.companyId!);
    
    // Filter to only show waste from stores the user has access to
    let filtered = wasteLogs.filter(log => accessibleStoreIds.includes(log.storeId));
    
    // Further filter by specific storeId if provided
    if (storeId) {
      // Verify user has access to the requested store
      if (!accessibleStoreIds.includes(storeId)) {
        return res.status(403).json({ error: "Access denied to this store" });
      }
      filtered = filtered.filter(log => log.storeId === storeId);
    }
    
    if (wasteType) {
      filtered = filtered.filter(log => log.wasteType === wasteType);
    }
    
    // Filter by date range
    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      filtered = filtered.filter(log => new Date(log.wastedAt) >= start);
    }
    
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filtered = filtered.filter(log => new Date(log.wastedAt) <= end);
    }
    
    res.json(filtered);
  });

  app.post("/api/waste", requireAuth, async (req, res) => {
    try {
      const data = createWasteLogSchema.parse(req.body);
      
      // Verify user has access to the selected store
      const accessibleStoreIds = await getAccessibleStores(req.user!, req.companyId);
      if (!accessibleStoreIds.includes(data.storeId)) {
        return res.status(403).json({ error: "Access denied to this store" });
      }
      
      if (data.wasteType === 'inventory') {
        // Inventory waste: direct inventory reduction
        if (!data.inventoryItemId) {
          return res.status(400).json({ error: "Inventory item ID is required for inventory waste" });
        }
        
        // Get inventory items for the company (pass companyId as 3rd parameter)
        const inventoryItems = await storage.getInventoryItems(undefined, undefined, req.companyId!);
        const item = inventoryItems.find(i => i.id === data.inventoryItemId);
        
        if (!item) {
          return res.status(404).json({ error: "Inventory item not found" });
        }
        
        // Calculate value
        const totalValue = data.qty * (item.pricePerUnit || 0);
        
        // Create waste log with calculated value
        const wasteLog = await storage.createWasteLog({
          ...data,
          companyId: req.companyId!,
          totalValue,
          loggedBy: req.user!.id,
        });
        
        res.status(201).json(wasteLog);
        
      } else if (data.wasteType === 'menu_item') {
        // Menu item waste: calculate from recipe
        if (!data.menuItemId) {
          return res.status(400).json({ error: "Menu item ID is required for menu item waste" });
        }
        
        const menuItems = await storage.getMenuItems(req.companyId!);
        const menuItem = menuItems.find(m => m.id === data.menuItemId);
        
        if (!menuItem || !menuItem.recipeId) {
          return res.status(404).json({ error: "Menu item or recipe not found" });
        }
        
        const recipes = await storage.getRecipes(req.companyId!);
        const recipe = recipes.find(r => r.id === menuItem.recipeId);
        
        if (!recipe) {
          return res.status(404).json({ error: "Recipe not found" });
        }
        
        // Calculate total value (recipe cost × quantity wasted)
        const totalValue = (recipe.computedCost || 0) * data.qty;
        
        // Create waste log
        const wasteLog = await storage.createWasteLog({
          ...data,
          companyId: req.companyId!,
          totalValue,
          loggedBy: req.user!.id,
        });
        
        res.status(201).json(wasteLog);
        
      } else {
        return res.status(400).json({ error: "Invalid waste type. Must be 'inventory' or 'menu_item'" });
      }
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/reports/waste-trends", requireAuth, async (req, res) => {
    const startDate = req.query.start ? new Date(req.query.start as string) : undefined;
    const endDate = req.query.end ? new Date(req.query.end as string) : undefined;
    
    // Get accessible stores for the user
    const accessibleStoreIds = await getAccessibleStores(req.user!, req.companyId);
    
    const wasteLogs = await storage.getWasteLogs(req.companyId!, undefined, undefined, startDate, endDate);
    
    // Filter to only show waste from stores the user has access to
    const filteredWasteLogs = wasteLogs.filter(log => accessibleStoreIds.includes(log.storeId));
    
    // Get inventory items for the company (pass companyId as 3rd parameter)
    const inventoryItems = await storage.getInventoryItems(undefined, undefined, req.companyId!);
    const trends: Record<string, any> = {};
    for (const wasteLog of filteredWasteLogs) {
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

  // ============ TRANSFER ORDERS ============
  app.get("/api/transfer-orders", requireAuth, async (req, res) => {
    const orders = await storage.getTransferOrders(req.companyId!);
    const stores = await storage.getCompanyStores(req.companyId!);
    
    const ordersWithDetails = orders.map(order => {
      const fromStore = stores.find(s => s.id === order.fromStoreId);
      const toStore = stores.find(s => s.id === order.toStoreId);
      return {
        ...order,
        fromStoreName: fromStore?.name || "Unknown",
        toStoreName: toStore?.name || "Unknown",
      };
    });
    
    res.json(ordersWithDetails);
  });

  app.get("/api/transfer-orders/:id", requireAuth, async (req, res) => {
    const order = await storage.getTransferOrder(req.params.id);
    if (!order) {
      return res.status(404).json({ error: "Transfer order not found" });
    }
    
    const lines = await storage.getTransferOrderLines(order.id);
    const stores = await storage.getCompanyStores(req.companyId!);
    const inventoryItems = await storage.getInventoryItems();
    const units = await storage.getUnits();
    
    const linesWithDetails = lines.map(line => {
      const item = inventoryItems.find(i => i.id === line.inventoryItemId);
      const unit = units.find(u => u.id === line.unitId);
      return {
        ...line,
        itemName: item?.name || "Unknown",
        unitName: unit?.name || "Unknown",
      };
    });
    
    const fromStore = stores.find(s => s.id === order.fromStoreId);
    const toStore = stores.find(s => s.id === order.toStoreId);
    
    res.json({
      ...order,
      fromStoreName: fromStore?.name || "Unknown",
      toStoreName: toStore?.name || "Unknown",
      lines: linesWithDetails,
    });
  });

  app.post("/api/transfer-orders", async (req, res) => {
    try {
      const { insertTransferOrderSchema } = await import("@shared/schema");
      const orderData = insertTransferOrderSchema.parse(req.body);
      const order = await storage.createTransferOrder(orderData);
      res.status(201).json(order);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/transfer-orders/:id", async (req, res) => {
    try {
      const order = await storage.getTransferOrder(req.params.id);
      if (!order) {
        return res.status(404).json({ error: "Transfer order not found" });
      }
      
      // Prevent modification of completed orders
      if (order.status === "completed") {
        return res.status(409).json({ error: "Cannot modify completed transfer order" });
      }
      
      // Only allow updating notes and expectedDate - not status or locations
      const allowedUpdates: Partial<{
        notes: string;
        expectedDate: Date;
      }> = {};
      
      if (req.body.notes !== undefined) allowedUpdates.notes = req.body.notes;
      if (req.body.expectedDate) allowedUpdates.expectedDate = new Date(req.body.expectedDate);
      
      const updated = await storage.updateTransferOrder(req.params.id, allowedUpdates);
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/transfer-orders/:id", async (req, res) => {
    try {
      const order = await storage.getTransferOrder(req.params.id);
      if (!order) {
        return res.status(404).json({ error: "Transfer order not found" });
      }
      
      // Prevent deletion of completed orders
      if (order.status === "completed") {
        return res.status(409).json({ error: "Cannot delete completed transfer order" });
      }
      
      await storage.deleteTransferOrder(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Transfer Order Lines
  app.get("/api/transfer-order-lines", async (req, res) => {
    try {
      const transferOrderId = req.query.transferOrderId as string;
      if (!transferOrderId) {
        return res.status(400).json({ error: "transferOrderId query parameter is required" });
      }
      const lines = await storage.getTransferOrderLines(transferOrderId);
      res.json(lines);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/transfer-order-lines", async (req, res) => {
    try {
      const { insertTransferOrderLineSchema } = await import("@shared/schema");
      const lineData = insertTransferOrderLineSchema.parse(req.body);
      const line = await storage.createTransferOrderLine(lineData);
      res.status(201).json(line);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/transfer-order-lines/:id", async (req, res) => {
    try {
      const line = await storage.updateTransferOrderLine(req.params.id, req.body);
      if (!line) {
        return res.status(404).json({ error: "Transfer order line not found" });
      }
      res.json(line);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/transfer-order-lines/:id", async (req, res) => {
    try {
      await storage.deleteTransferOrderLine(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Execute transfer (ship from source store)
  app.post("/api/transfer-orders/:id/execute", requireAuth, async (req, res) => {
    try {
      const order = await storage.getTransferOrder(req.params.id);
      if (!order) {
        return res.status(404).json({ error: "Transfer order not found" });
      }
      
      // Validate company ownership
      if (order.companyId !== req.companyId) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      if (order.status !== "pending") {
        return res.status(400).json({ error: "Transfer can only be executed from pending status" });
      }
      
      const lines = await storage.getTransferOrderLines(order.id);
      if (lines.length === 0) {
        return res.status(400).json({ error: "Transfer order has no items" });
      }
      
      // Validate inventory availability at source store
      const validationErrors: string[] = [];
      for (const line of lines) {
        const sourceInventory = await storage.getStoreInventoryItem(order.fromStoreId, line.inventoryItemId);
        const shippedQty = line.shippedQty || line.requestedQty;
        
        if (!sourceInventory) {
          const item = await storage.getInventoryItem(line.inventoryItemId);
          validationErrors.push(`${item?.name || 'Item'} not available at source store`);
          continue;
        }
        
        if (sourceInventory.onHandQty < shippedQty) {
          const item = await storage.getInventoryItem(line.inventoryItemId);
          validationErrors.push(
            `${item?.name || 'Item'}: insufficient inventory (available: ${sourceInventory.onHandQty}, needed: ${shippedQty})`
          );
        }
      }
      
      if (validationErrors.length > 0) {
        return res.status(400).json({ 
          error: "Inventory validation failed", 
          details: validationErrors 
        });
      }
      
      // Wrap transfer execution in transaction for atomicity
      // Prevents partial inventory updates under concurrent access
      await withTransaction(async (tx) => {
        // Process each line - reduce inventory at source with explicit companyId filter
        for (const line of lines) {
          const shippedQty = line.shippedQty || line.requestedQty;
          
          // Get current store inventory with explicit companyId filter
          const [existingStoreItem] = await tx
            .select()
            .from(storeInventoryItems)
            .where(
              and(
                eq(storeInventoryItems.companyId, order.companyId), // Explicit tenant guard
                eq(storeInventoryItems.storeId, order.fromStoreId),
                eq(storeInventoryItems.inventoryItemId, line.inventoryItemId)
              )
            )
            .limit(1);
          
          if (existingStoreItem) {
            await tx
              .update(storeInventoryItems)
              .set({ 
                onHandQty: existingStoreItem.onHandQty - shippedQty,
                updatedAt: new Date()
              })
              .where(
                and(
                  eq(storeInventoryItems.companyId, order.companyId), // Explicit tenant guard
                  eq(storeInventoryItems.storeId, order.fromStoreId),
                  eq(storeInventoryItems.inventoryItemId, line.inventoryItemId)
                )
              );
          }
        }
        
        // Update transfer order status to in_transit with explicit companyId filter
        await tx
          .update(transferOrders)
          .set({ 
            status: "in_transit",
            updatedAt: new Date()
          })
          .where(
            and(
              eq(transferOrders.id, order.id),
              eq(transferOrders.companyId, order.companyId) // Explicit tenant guard
            )
          );
      });
      
      const updatedOrder = await storage.getTransferOrder(order.id);
      res.json(updatedOrder);
    } catch (error: any) {
      console.error("Transfer execution error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Receive transfer (receive at destination store)
  app.post("/api/transfer-orders/:id/receive", requireAuth, async (req, res) => {
    try {
      const order = await storage.getTransferOrder(req.params.id);
      if (!order) {
        return res.status(404).json({ error: "Transfer order not found" });
      }
      
      // Validate company ownership
      if (order.companyId !== req.companyId) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      if (order.status !== "in_transit") {
        return res.status(400).json({ error: "Transfer must be in_transit to receive" });
      }
      
      const lines = await storage.getTransferOrderLines(order.id);
      
      // Wrap transfer receiving in transaction for atomicity
      // Prevents partial inventory updates under concurrent access
      await withTransaction(async (tx) => {
        // Process each line - increase inventory at destination with explicit companyId filter
        for (const line of lines) {
          const receivedQty = line.receivedQty || line.shippedQty || line.requestedQty;
          
          // Get destination store inventory with explicit companyId filter
          const [destinationInventory] = await tx
            .select()
            .from(storeInventoryItems)
            .where(
              and(
                eq(storeInventoryItems.companyId, order.companyId), // Explicit tenant guard
                eq(storeInventoryItems.storeId, order.toStoreId),
                eq(storeInventoryItems.inventoryItemId, line.inventoryItemId)
              )
            )
            .limit(1);
          
          if (destinationInventory) {
            // Update existing inventory with explicit companyId filter
            await tx
              .update(storeInventoryItems)
              .set({ 
                onHandQty: destinationInventory.onHandQty + receivedQty,
                updatedAt: new Date()
              })
              .where(
                and(
                  eq(storeInventoryItems.companyId, order.companyId), // Explicit tenant guard
                  eq(storeInventoryItems.storeId, order.toStoreId),
                  eq(storeInventoryItems.inventoryItemId, line.inventoryItemId)
                )
              );
          } else {
            // Create new store inventory item
            await tx.insert(storeInventoryItems).values({
              companyId: order.companyId,
              storeId: order.toStoreId,
              inventoryItemId: line.inventoryItemId,
              onHandQty: receivedQty,
              active: 1
            });
          }
        }
        
        // Update transfer order status to completed with explicit companyId filter
        await tx
          .update(transferOrders)
          .set({ 
            status: "completed",
            updatedAt: new Date()
          })
          .where(
            and(
              eq(transferOrders.id, order.id),
              eq(transferOrders.companyId, order.companyId) // Explicit tenant guard
            )
          );
      });
      
      const updatedOrder = await storage.getTransferOrder(order.id);
      res.json(updatedOrder);
    } catch (error: any) {
      console.error("Transfer receive error:", error);
      res.status(500).json({ error: error.message });
    }
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

  // ============ COMPANIES ============
  app.get("/api/companies", requireAuth, async (req, res) => {
    const user = await storage.getUser(req.user!.id);
    
    // Only global admins can list all companies
    if (user?.role !== "global_admin") {
      return res.status(403).json({ error: "Only global admins can access companies" });
    }
    
    const companies = await storage.getCompanies();
    res.json(companies);
  });

  app.get("/api/companies/:id", requireAuth, async (req, res) => {
    const company = await storage.getCompany(req.params.id);
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }
    res.json(company);
  });

  app.get("/api/companies/:id/stores", requireAuth, async (req, res) => {
    const stores = await storage.getCompanyStores(req.params.id);
    res.json(stores);
  });

  // Get accessible stores for current user (filtered by role and assignments)
  app.get("/api/stores/accessible", requireAuth, async (req, res) => {
    try {
      const currentUser = await storage.getUser(req.user!.id);
      if (!currentUser) {
        return res.status(401).json({ error: "User not found" });
      }

      // Get effective company ID from request context (already resolved by auth middleware)
      const effectiveCompanyId = (req as any).companyId;

      // Get accessible store IDs
      const storeIds = await getAccessibleStores(currentUser, effectiveCompanyId || undefined);
      
      // Fetch full store objects
      const stores = [];
      for (const storeId of storeIds) {
        const store = await storage.getCompanyStore(storeId);
        if (store) {
          stores.push(store);
        }
      }
      
      res.json(stores);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/companies", requireAuth, async (req, res) => {
    const user = await storage.getUser(req.user!.id);
    
    // Only global admins can create companies
    if (user?.role !== "global_admin") {
      return res.status(403).json({ error: "Only global admins can create companies" });
    }

    try {
      const data = insertCompanySchema.parse(req.body);
      const company = await storage.createCompany(data);
      
      // Create default "Misc Grocery" vendor for unit-based ordering
      await storage.createVendor({
        companyId: company.id,
        name: "Misc Grocery",
        orderGuideType: "manual",
      });
      
      // Create default storage locations for new company
      const defaultLocations = [
        { name: "Walk-In Cooler", sortOrder: 1 },
        { name: "Pantry", sortOrder: 2 },
        { name: "Drink Cooler", sortOrder: 3 },
        { name: "Walk-In Freezer", sortOrder: 4 },
        { name: "Prep Table", sortOrder: 5 },
        { name: "Front Counter", sortOrder: 6 },
      ];
      
      for (const location of defaultLocations) {
        await storage.createStorageLocation({
          companyId: company.id,
          ...location,
        });
      }
      
      res.status(201).json(company);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/companies/:id", requireAuth, async (req, res) => {
    const user = await storage.getUser(req.user!.id);
    
    // Only global admins can update companies
    if (user?.role !== "global_admin") {
      return res.status(403).json({ error: "Only global admins can update companies" });
    }

    try {
      const data = insertCompanySchema.partial().parse(req.body);
      const company = await storage.updateCompany(req.params.id, data);
      
      if (!company) {
        return res.status(404).json({ error: "Company not found" });
      }
      
      res.json(company);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * DELETE /api/admin/companies/:id/purge
   * 
   * Admin-only endpoint to purge all data for a company (DEVELOPMENT USE ONLY)
   * Proves multi-tenant isolation by deleting only target company data
   * 
   * Query params:
   *   ?dryRun=true - Show what would be deleted without actually deleting
   * 
   * Security:
   *   - Only available in development (NODE_ENV !== 'production')
   *   - Requires global_admin role
   */
  app.delete("/api/admin/companies/:id/purge", requireAuth, async (req, res) => {
    // Safety: Only allow in development environment
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ 
        error: "Company purge is disabled in production for safety" 
      });
    }

    const user = await storage.getUser(req.user!.id);
    
    // Only global admins can purge companies
    if (user?.role !== "global_admin") {
      return res.status(403).json({ error: "Only global admins can purge companies" });
    }

    const companyId = req.params.id;
    const dryRun = req.query.dryRun === 'true';

    try {
      // Verify company exists
      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ error: "Company not found" });
      }

      // Execute purge (or dry-run)
      const stats = await purgeCompanyData(companyId, dryRun);

      // Calculate summary
      const totalRows = stats.reduce((sum, s) => sum + s.rowsDeleted, 0);
      const tablesAffected = stats.filter(s => s.rowsDeleted > 0);

      res.json({
        success: true,
        dryRun,
        company: {
          id: company.id,
          name: company.name,
        },
        summary: {
          totalRowsDeleted: totalRows,
          tablesAffected: tablesAffected.length,
        },
        details: stats.filter(s => s.rowsDeleted > 0),
      });
    } catch (error: any) {
      console.error("Error purging company:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update company logo
  app.put("/api/companies/:id/logo", requireAuth, async (req, res) => {
    try {
      const { imageUrl } = z.object({
        imageUrl: z.string(),
      }).parse(req.body);

      const user = (req as any).user;
      const objectStorageService = new ObjectStorageService();
      
      // Set ACL policy for the uploaded logo (public visibility)
      const objectPath = await objectStorageService.trySetObjectEntityAclPolicy(
        imageUrl,
        {
          owner: user.id,
          visibility: "public",
        }
      );

      // Update company with the normalized object path
      const company = await storage.updateCompany(req.params.id, {
        logoImagePath: objectPath,
      });

      if (!company) {
        return res.status(404).json({ error: "Company not found" });
      }

      res.json({ objectPath });
    } catch (error: any) {
      console.error("Error updating company logo:", error);
      res.status(500).json({ error: "Failed to update logo" });
    }
  });

  app.post("/api/companies/:id/stores", requireAuth, async (req, res) => {
    const user = await storage.getUser(req.user!.id);
    
    // Only global admins can create stores
    if (user?.role !== "global_admin") {
      return res.status(403).json({ error: "Only global admins can create stores" });
    }

    try {
      const data = insertCompanyStoreSchema.parse({
        ...req.body,
        companyId: req.params.id,
      });
      const store = await storage.createCompanyStore(data);
      res.status(201).json(store);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/companies/:companyId/stores/:storeId", requireAuth, async (req, res) => {
    const user = await storage.getUser(req.user!.id);
    
    // Only global admins can update stores
    if (user?.role !== "global_admin") {
      return res.status(403).json({ error: "Only global admins can update stores" });
    }

    try {
      const data = insertCompanyStoreSchema.partial().parse(req.body);
      const store = await storage.updateCompanyStore(req.params.storeId, data);
      
      if (!store) {
        return res.status(404).json({ error: "Store not found" });
      }
      
      res.json(store);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Simplified store routes (used by frontend)
  app.get("/api/stores/:id", requireAuth, async (req, res) => {
    try {
      const store = await storage.getCompanyStore(req.params.id);
      if (!store) {
        return res.status(404).json({ error: "Store not found" });
      }
      res.json(store);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/stores/:id", requireAuth, async (req, res) => {
    const user = await storage.getUser(req.user!.id);
    
    // Only global admins can update stores
    if (user?.role !== "global_admin") {
      return res.status(403).json({ error: "Only global admins can update stores" });
    }

    try {
      const data = insertCompanyStoreSchema.partial().parse(req.body);
      const store = await storage.updateCompanyStore(req.params.id, data);
      
      if (!store) {
        return res.status(404).json({ error: "Store not found" });
      }
      
      res.json(store);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/stores/:id", requireAuth, async (req, res) => {
    const user = await storage.getUser(req.user!.id);
    
    // Only global admins can delete stores
    if (user?.role !== "global_admin") {
      return res.status(403).json({ error: "Only global admins can delete stores" });
    }

    try {
      await storage.deleteCompanyStore(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
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

  // Update company logo image
  app.put("/api/company-settings/logo", requireAuth, async (req, res) => {
    try {
      const { imageUrl } = z.object({
        imageUrl: z.string(),
      }).parse(req.body);

      const user = (req as any).user;
      const objectStorageService = new ObjectStorageService();
      
      // Set ACL policy for the uploaded logo (public visibility)
      const objectPath = await objectStorageService.trySetObjectEntityAclPolicy(
        imageUrl,
        {
          owner: user.id,
          visibility: "public",
        }
      );

      // Update company settings with the normalized object path
      const settings = await storage.updateCompanySettings({
        logoImagePath: objectPath,
      });

      res.json({ objectPath });
    } catch (error: any) {
      console.error("Error updating company logo:", error);
      res.status(500).json({ error: "Failed to update logo" });
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

  // ============ TFC (THEORETICAL FOOD COST) ROUTES ============
  // Configure multer for CSV file uploads
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB max
    },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
        cb(null, true);
      } else {
        cb(new Error('Only CSV files are allowed'));
      }
    },
  });

  app.post("/api/tfc/sales/upload", requireAuth, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const companyId = (req as any).companyId;
      if (!companyId) {
        return res.status(400).json({ message: "Company context required" });
      }

      // Parse CSV file
      const fileContent = req.file.buffer.toString('utf-8');
      const parsed = parseCSV(fileContent);

      if (parsed.errors.length > 0) {
        console.error('[TFC Upload] CSV validation failed:', parsed.errors);
        console.error('[TFC Upload] Stats:', parsed.stats);
        return res.status(400).json({
          message: "CSV validation failed",
          errors: parsed.errors,
          stats: parsed.stats,
        });
      }

      // Group sales by date and store
      const salesByDateStore = new Map<string, typeof parsed.rows>();
      for (const row of parsed.rows) {
        const key = `${row.date}|${row.store_code}`;
        if (!salesByDateStore.has(key)) {
          salesByDateStore.set(key, []);
        }
        salesByDateStore.get(key)!.push(row);
      }

      // Create sales upload batch for each date/store combination
      const theoreticalUsageService = new TheoreticalUsageService();
      const processedBatches = [];

      for (const [key, rows] of salesByDateStore) {
        const [dateStr, storeCode] = key.split('|');
        const salesDate = new Date(dateStr);

        // Find store by code
        const stores = await storage.getCompanyStores(companyId);
        console.log(`[TFC Upload] Looking for store code: "${storeCode}" in company ${companyId}`);
        console.log(`[TFC Upload] Available stores:`, stores.map(s => ({ id: s.id, code: s.code, name: s.name })));
        const store = stores.find(s => s.code === storeCode);

        if (!store) {
          console.error(`[TFC Upload] Store not found for code: "${storeCode}"`);
          console.error(`[TFC Upload] Store codes available:`, stores.map(s => s.code));
          return res.status(400).json({
            message: `Store not found for code: ${storeCode}. Available codes: ${stores.map(s => s.code).join(', ')}`,
          });
        }

        // Create sales upload batch
        const userId = (req as any).user?.id;
        const batch = await storage.createSalesUploadBatch({
          companyId,
          storeId: store.id,
          uploadedBy: userId,
          salesDate,
          fileName: req.file.originalname,
          status: "processing",
        });

        // Create daily sales records
        const salesRecords = [];
        for (const row of rows) {
          // Find menu item by PLU/SKU
          const menuItemsData = await storage.getMenuItems(companyId);
          const menuItem = menuItemsData.find(mi => mi.pluSku === row.plu_sku);

          if (!menuItem) {
            console.warn(`Menu item not found for SKU: ${row.plu_sku}`);
            continue;
          }

          const [salesRecord] = await storage.createDailyMenuItemSales([{
            companyId,
            storeId: store.id,
            menuItemId: menuItem.id,
            salesDate,
            qtySold: row.qty_sold,
            netSales: row.net_sales,
            daypartId: null, // TODO: Map daypart name to ID
            sourceBatchId: batch.id,
          }]);

          salesRecords.push(salesRecord);
        }

        // Calculate theoretical usage
        if (salesRecords.length > 0) {
          console.log('[TFC Upload] Starting theoretical usage calculation with', salesRecords.length, 'sales records');
          console.log('[TFC Upload] salesRecords is array?', Array.isArray(salesRecords));
          console.log('[TFC Upload] salesRecords[0] is:', salesRecords[0]);
          console.log('[TFC Upload] salesRecords[0] keys:', Object.keys(salesRecords[0]));
          
          await theoreticalUsageService.calculateTheoreticalUsage({
            companyId,
            storeId: store.id,
            salesDate,
            sourceBatchId: batch.id,
            salesData: salesRecords,
          });

          // Update batch status to completed
          await storage.updateSalesUploadBatchStatus(batch.id, companyId, "completed");
        } else {
          await storage.updateSalesUploadBatchStatus(batch.id, companyId, "failed");
        }

        processedBatches.push({
          batchId: batch.id,
          date: dateStr,
          store: store.name,
          recordCount: salesRecords.length,
        });
      }

      res.json({
        message: "CSV uploaded and processed successfully",
        recordCount: parsed.stats.validRows,
        batches: processedBatches,
      });

    } catch (error: any) {
      console.error("CSV upload error:", error);
      res.status(500).json({
        message: "Failed to process CSV file",
        error: error.message,
      });
    }
  });

  // Get theoretical usage runs (batch history)
  app.get("/api/tfc/usage-runs", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      if (!companyId) {
        return res.status(400).json({ message: "Company context required" });
      }

      const runs = await storage.getTheoreticalUsageRuns(companyId);
      res.json(runs);
    } catch (error: any) {
      console.error('Get usage runs error:', error);
      res.status(500).json({ message: "Failed to fetch usage runs" });
    }
  });

  // Get detailed theoretical usage for a specific run
  app.get("/api/tfc/usage-runs/:runId/details", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const { runId } = req.params;

      if (!companyId) {
        return res.status(400).json({ message: "Company context required" });
      }

      // Get the usage run
      const run = await storage.getTheoreticalUsageRun(runId, companyId);
      if (!run) {
        return res.status(404).json({ message: "Usage run not found" });
      }

      // Get usage lines
      const lines = await storage.getTheoreticalUsageLines(runId);

      // Batch fetch all inventory items and units to avoid N+1 queries
      const uniqueItemIds = [...new Set(lines.map(l => l.inventoryItemId))];
      const items = await Promise.all(
        uniqueItemIds.map(id => storage.getInventoryItem(id))
      );
      const itemsMap = new Map(items.filter(i => i !== undefined).map(i => [i!.id, i!]));

      const uniqueUnitIds = [...new Set(items.filter(i => i !== undefined).map(i => i!.unitId))];
      const units = await Promise.all(
        uniqueUnitIds.map(id => storage.getUnit(id))
      );
      const unitsMap = new Map(units.filter(u => u !== undefined).map(u => [u!.id, u!]));

      // Build detailed lines with parsed sourceMenuItems and batched data
      const detailedLines = lines.map((line) => {
        const item = itemsMap.get(line.inventoryItemId);
        const unit = item ? unitsMap.get(item.unitId) : null;
        
        // Parse sourceMenuItems JSON string
        let sourceMenuItems: Array<{
          menuItemId: string;
          menuItemName: string;
          qtySold: number;
        }> = [];
        
        try {
          sourceMenuItems = JSON.parse(line.sourceMenuItems);
        } catch (error) {
          console.error('Failed to parse sourceMenuItems:', error);
        }

        return {
          ...line,
          sourceMenuItems, // Now an array, not a string
          inventoryItem: item ? {
            id: item.id,
            name: item.name,
            unitId: item.unitId,
            unitName: unit?.name || '',
            unitAbbreviation: unit?.abbreviation || '',
            pricePerUnit: item.pricePerUnit,
            avgCostPerUnit: item.avgCostPerUnit,
          } : null,
        };
      });

      res.json({
        run,
        lines: detailedLines,
      });
    } catch (error: any) {
      console.error('Get usage details error:', error);
      res.status(500).json({ message: "Failed to fetch usage details" });
    }
  });

  // Get variance summaries for all count periods
  app.get("/api/tfc/variance/summaries", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const { storeId } = req.query;

      if (!companyId || !storeId) {
        return res.status(400).json({ 
          message: "Missing required parameter: storeId" 
        });
      }

      // CRITICAL: Verify store belongs to company (multi-tenant isolation)
      const store = await storage.getCompanyStore(storeId as string, companyId);
      if (!store) {
        return res.status(403).json({ message: "Store not found or access denied" });
      }

      // Get all applied counts for this store, sorted by count date descending
      const allCounts = await db.query.inventoryCounts.findMany({
        where: and(
          eq(inventoryCounts.companyId, companyId),
          eq(inventoryCounts.storeId, storeId as string),
          eq(inventoryCounts.applied, 1)
        ),
      });

      const sortedCounts = allCounts.sort((a, b) => 
        new Date(b.countDate).getTime() - new Date(a.countDate).getTime()
      );

      if (sortedCounts.length < 2) {
        // Need at least two counts to calculate variance
        return res.json([]);
      }

      // Calculate summaries for each count period (current count paired with its previous)
      const summaries = await Promise.all(
        sortedCounts.slice(0, -1).map(async (currentCount, index) => {
          const previousCount = sortedCounts[index + 1];

          // Get inventory count lines for current count to calculate total value
          const currentLines = await db.query.inventoryCountLines.findMany({
            where: eq(inventoryCountLines.inventoryCountId, currentCount.id),
          });

          const inventoryValue = currentLines.reduce((sum, line) => {
            return sum + (line.qty * (line.unitCost || 0));
          }, 0);

          // Get sales data between the two count dates
          const salesData = await db
            .select()
            .from(dailyMenuItemSales)
            .where(
              and(
                eq(dailyMenuItemSales.companyId, companyId),
                eq(dailyMenuItemSales.storeId, storeId as string),
                gte(dailyMenuItemSales.salesDate, previousCount.countDate),
                lte(dailyMenuItemSales.salesDate, currentCount.countDate)
              )
            );

          const totalSales = salesData.reduce((sum, sale) => sum + sale.netSales, 0);

          // Get theoretical usage from stored runs
          const theoreticalUsageMap = new Map<string, { qty: number; cost: number }>();
          
          const theoreticalRuns = await db
            .select()
            .from(theoreticalUsageRuns)
            .where(
              and(
                eq(theoreticalUsageRuns.companyId, companyId),
                eq(theoreticalUsageRuns.storeId, storeId as string),
                gte(theoreticalUsageRuns.salesDate, previousCount.countDate),
                lte(theoreticalUsageRuns.salesDate, currentCount.countDate)
              )
            );

          if (theoreticalRuns.length > 0) {
            const runIds = theoreticalRuns.map(r => r.id);
            
            const theoreticalLines = await db
              .select()
              .from(theoreticalUsageLines)
              .where(inArray(theoreticalUsageLines.runId, runIds));

            for (const line of theoreticalLines) {
              const existing = theoreticalUsageMap.get(line.inventoryItemId);
              if (existing) {
                existing.qty += line.requiredQtyBaseUnit;
                existing.cost += line.costAtSale;
              } else {
                theoreticalUsageMap.set(line.inventoryItemId, {
                  qty: line.requiredQtyBaseUnit,
                  cost: line.costAtSale,
                });
              }
            }
          }

          // Get actual usage
          const actualUsageData = await storage.getItemUsageBetweenCounts(
            storeId as string,
            previousCount.id,
            currentCount.id
          );

          // Calculate variance
          const allItemIds = new Set([
            ...actualUsageData.map(a => a.inventoryItemId),
            ...Array.from(theoreticalUsageMap.keys()),
          ]);

          let totalVarianceCost = 0;
          let totalTheoreticalCost = 0;

          for (const itemId of allItemIds) {
            const actualData = actualUsageData.find(a => a.inventoryItemId === itemId);
            const theoreticalData = theoreticalUsageMap.get(itemId);

            const actualUsage = actualData?.usage || 0;
            const theoreticalUsage = theoreticalData?.qty || 0;
            const pricePerUnit = actualData?.pricePerUnit || 0;

            const varianceUnits = actualUsage - theoreticalUsage;
            const varianceCost = varianceUnits * pricePerUnit;
            const theoreticalCost = theoreticalUsage * pricePerUnit;

            totalVarianceCost += varianceCost;
            totalTheoreticalCost += theoreticalCost;
          }

          const totalVariancePercent = totalTheoreticalCost > 0 
            ? (totalVarianceCost / totalTheoreticalCost) * 100 
            : 0;

          return {
            currentCountId: currentCount.id,
            previousCountId: previousCount.id,
            inventoryDate: currentCount.countDate,
            inventoryValue,
            totalSales,
            totalVarianceCost,
            totalVariancePercent,
            daySpan: Math.ceil(
              (new Date(currentCount.countDate).getTime() - new Date(previousCount.countDate).getTime()) / (1000 * 60 * 60 * 24)
            ),
          };
        })
      );

      res.json(summaries);
    } catch (error: any) {
      console.error('Get variance summaries error:', error);
      res.status(500).json({ message: "Failed to fetch variance summaries", error: error.message });
    }
  });

  // Get variance report between two inventory counts
  app.get("/api/tfc/variance", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const { previousCountId, currentCountId, storeId, categoryId, search } = req.query;

      if (!companyId || !previousCountId || !currentCountId || !storeId) {
        return res.status(400).json({ 
          message: "Missing required parameters: previousCountId, currentCountId, storeId" 
        });
      }

      // CRITICAL: Verify store belongs to company (multi-tenant isolation)
      const store = await storage.getCompanyStore(storeId as string, companyId);
      if (!store) {
        return res.status(403).json({ message: "Store not found or access denied" });
      }

      // Validate counts exist, belong to the same company, and belong to the validated store
      const previousCount = await db.query.inventoryCounts.findFirst({
        where: and(
          eq(inventoryCounts.id, previousCountId as string),
          eq(inventoryCounts.companyId, companyId),
          eq(inventoryCounts.storeId, storeId as string)
        ),
      });

      const currentCount = await db.query.inventoryCounts.findFirst({
        where: and(
          eq(inventoryCounts.id, currentCountId as string),
          eq(inventoryCounts.companyId, companyId),
          eq(inventoryCounts.storeId, storeId as string)
        ),
      });

      if (!previousCount || !currentCount) {
        return res.status(404).json({ message: "One or both inventory counts not found or do not belong to this store" });
      }

      if (new Date(previousCount.countDate) >= new Date(currentCount.countDate)) {
        return res.status(400).json({ message: "Previous count must be earlier than current count" });
      }

      // Calculate day span between counts
      const daySpan = Math.ceil(
        (new Date(currentCount.countDate).getTime() - new Date(previousCount.countDate).getTime()) / (1000 * 60 * 60 * 24)
      );

      // Get actual usage from existing function
      const actualUsageData = await storage.getItemUsageBetweenCounts(
        storeId as string,
        previousCountId as string,
        currentCountId as string
      );

      // Get sales data between the two count dates
      const salesData = await db
        .select()
        .from(dailyMenuItemSales)
        .where(
          and(
            eq(dailyMenuItemSales.companyId, companyId),
            eq(dailyMenuItemSales.storeId, storeId as string),
            gte(dailyMenuItemSales.salesDate, previousCount.countDate),
            lte(dailyMenuItemSales.salesDate, currentCount.countDate)
          )
        );

      // Calculate sales totals
      const totalItemsSold = salesData.reduce((sum, sale) => sum + sale.qtySold, 0);
      const totalNetSales = salesData.reduce((sum, sale) => sum + sale.netSales, 0);

      // Get theoretical usage from stored runs (already converted to inventory item units)
      const theoreticalUsageMap = new Map<string, { qty: number; cost: number }>();
      
      // Initialize map outside if block for use later in response assembly
      const inventoryItemsMap = new Map<string, any>();
      
      // Fetch theoretical usage runs for this date range
      const theoreticalRuns = await db
        .select()
        .from(theoreticalUsageRuns)
        .where(
          and(
            eq(theoreticalUsageRuns.companyId, companyId),
            eq(theoreticalUsageRuns.storeId, storeId as string),
            gte(theoreticalUsageRuns.salesDate, previousCount.countDate),
            lte(theoreticalUsageRuns.salesDate, currentCount.countDate)
          )
        );

      if (theoreticalRuns.length > 0) {
        const runIds = theoreticalRuns.map(r => r.id);
        
        // Fetch all theoretical usage lines for these runs
        const theoreticalLines = await db
          .select()
          .from(theoreticalUsageLines)
          .where(inArray(theoreticalUsageLines.runId, runIds));

        // Aggregate theoretical usage by inventory item (accumulate across multiple runs)
        for (const line of theoreticalLines) {
          const existing = theoreticalUsageMap.get(line.inventoryItemId);
          if (existing) {
            existing.qty += line.requiredQtyBaseUnit;
            existing.cost += line.costAtSale;
          } else {
            theoreticalUsageMap.set(line.inventoryItemId, {
              qty: line.requiredQtyBaseUnit,
              cost: line.costAtSale,
            });
          }
        }
      }

      // Combine actual and theoretical usage
      const allItemIds = new Set([
        ...actualUsageData.map(a => a.inventoryItemId),
        ...Array.from(theoreticalUsageMap.keys()),
      ]);

      // Batch-fetch any additional inventory items not already in the map (from actual usage data)
      const additionalItemIds = Array.from(allItemIds).filter(id => !inventoryItemsMap.has(id));
      if (additionalItemIds.length > 0) {
        const additionalItems = await Promise.all(
          additionalItemIds.map(id => storage.getInventoryItem(id))
        );
        additionalItems.forEach(item => {
          if (item) inventoryItemsMap.set(item.id, item);
        });
      }

      let varianceItems = Array.from(allItemIds).map(itemId => {
        const actualData = actualUsageData.find(a => a.inventoryItemId === itemId);
        const theoreticalData = theoreticalUsageMap.get(itemId);

        // Get inventory item for fallback name
        const item = inventoryItemsMap.get(itemId);

        const actualUsage = actualData?.usage || 0;
        const theoreticalUsage = theoreticalData?.qty || 0;
        
        const varianceUnits = actualUsage - theoreticalUsage;
        const pricePerUnit = actualData?.pricePerUnit || 0;
        const varianceCost = varianceUnits * pricePerUnit;
        const variancePercent = theoreticalUsage > 0 ? (varianceUnits / theoreticalUsage) * 100 : 0;

        return {
          inventoryItemId: itemId,
          inventoryItemName: actualData?.inventoryItemName || item?.name || 'Unknown',
          category: actualData?.category,
          previousQty: actualData?.previousQty || 0,
          receivedQty: actualData?.receivedQty || 0,
          currentQty: actualData?.currentQty || 0,
          actualUsage,
          theoreticalUsage,
          varianceUnits,
          varianceCost,
          variancePercent,
          unitName: actualData?.unitName || '',
          pricePerUnit,
        };
      });

      // Apply filters
      if (categoryId) {
        varianceItems = varianceItems.filter(item => item.category === categoryId);
      }

      if (search) {
        const searchLower = (search as string).toLowerCase();
        varianceItems = varianceItems.filter(item =>
          item.inventoryItemName.toLowerCase().includes(searchLower)
        );
      }

      // Calculate summary stats
      const summary = {
        totalVarianceCost: varianceItems.reduce((sum, item) => sum + item.varianceCost, 0),
        positiveVarianceCost: varianceItems.filter(i => i.varianceCost > 0).reduce((sum, item) => sum + item.varianceCost, 0),
        negativeVarianceCost: varianceItems.filter(i => i.varianceCost < 0).reduce((sum, item) => sum + Math.abs(item.varianceCost), 0),
        totalTheoreticalCost: varianceItems.reduce((sum, item) => sum + (item.theoreticalUsage * item.pricePerUnit), 0),
        totalActualCost: varianceItems.reduce((sum, item) => sum + (item.actualUsage * item.pricePerUnit), 0),
      };

      // Group by category
      const categories = new Map<string, typeof varianceItems>();
      varianceItems.forEach(item => {
        const categoryKey = item.category || 'Uncategorized';
        if (!categories.has(categoryKey)) {
          categories.set(categoryKey, []);
        }
        categories.get(categoryKey)!.push(item);
      });

      const groupedItems = Array.from(categories.entries()).map(([categoryId, items]) => ({
        categoryId,
        categoryName: categoryId, // Will be enriched on frontend
        items,
      }));

      // Get purchase orders delivered during this period
      // Use expected delivery date (when inventory arrived) rather than received date (when entered into system)
      // For orders without an expectedDate, use the receipt's receivedAt as fallback
      const allReceivedOrders = await db.query.purchaseOrders.findMany({
        where: and(
          eq(purchaseOrders.companyId, companyId),
          eq(purchaseOrders.storeId, storeId as string),
          eq(purchaseOrders.status, 'received')
        ),
      });

      // Get receipts for these orders to use as fallback date
      const receiptsForOrders = allReceivedOrders.length > 0
        ? await db.query.receipts.findMany({
            where: and(
              eq(receipts.companyId, companyId),
              eq(receipts.storeId, storeId as string),
              inArray(receipts.purchaseOrderId, allReceivedOrders.map(po => po.id)),
              inArray(receipts.status, ['locked', 'completed'])
            ),
          })
        : [];

      // Build a map of purchaseOrderId to latest receipt date for efficient lookups
      const receiptDateMap = new Map<string, Date>();
      receiptsForOrders.forEach(receipt => {
        const existingDate = receiptDateMap.get(receipt.purchaseOrderId);
        const currentDate = new Date(receipt.receivedAt);
        if (!existingDate || currentDate > existingDate) {
          receiptDateMap.set(receipt.purchaseOrderId, currentDate);
        }
      });

      // Hoist date objects outside the filter loop
      const startDate = new Date(previousCount.countDate);
      const endDate = new Date(currentCount.countDate);

      // Filter orders by date range (using expectedDate if available, otherwise receipt receivedAt)
      const deliveredOrders = allReceivedOrders.filter(po => {
        // Use expectedDate if available
        if (po.expectedDate) {
          const expectedDate = new Date(po.expectedDate);
          return expectedDate >= startDate && expectedDate <= endDate;
        }
        
        // Fallback to receipt receivedAt if no expectedDate
        const receiptDate = receiptDateMap.get(po.id);
        if (receiptDate) {
          return receiptDate >= startDate && receiptDate <= endDate;
        }
        
        return false; // Exclude if no date available
      }).sort((a, b) => {
        const dateA = a.expectedDate ? new Date(a.expectedDate) : receiptDateMap.get(a.id) || new Date(0);
        const dateB = b.expectedDate ? new Date(b.expectedDate) : receiptDateMap.get(b.id) || new Date(0);
        return dateA.getTime() - dateB.getTime();
      });

      // Fetch vendor information for purchase orders
      const vendorIds = [...new Set(deliveredOrders.map(po => po.vendorId))];
      const vendors = vendorIds.length > 0
        ? await Promise.all(vendorIds.map(id => storage.getVendor(id)))
        : [];
      const vendorMap = new Map(vendors.filter(v => v).map(v => [v!.id, v!.name]));

      res.json({
        previousCountId,
        currentCountId,
        daySpan,
        previousCountDate: previousCount.countDate,
        currentCountDate: currentCount.countDate,
        summary,
        categories: groupedItems,
        items: varianceItems, // Flat list for convenience
        purchaseOrders: deliveredOrders.map(po => {
          // Use expectedDate if available, otherwise fall back to receipt receivedAt from map
          let deliveryDate = '';
          if (po.expectedDate) {
            deliveryDate = po.expectedDate.toISOString().split('T')[0];
          } else {
            const receiptDate = receiptDateMap.get(po.id);
            if (receiptDate) {
              deliveryDate = receiptDate.toISOString().split('T')[0];
            }
          }
          
          return {
            id: po.id,
            orderNumber: po.id.substring(0, 8), // Use first 8 chars of UUID as order number
            vendorId: po.vendorId,
            vendorName: vendorMap.get(po.vendorId) || 'Unknown Vendor',
            expectedDate: deliveryDate,
          };
        }),
        salesSummary: {
          totalItemsSold,
          totalNetSales,
        },
      });

    } catch (error: any) {
      console.error('Variance calculation error:', error);
      res.status(500).json({ message: "Failed to calculate variance", error: error.message });
    }
  });

  // Get theoretical usage detail for a specific ingredient
  app.get("/api/tfc/variance/theoretical-detail", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const { previousCountId, currentCountId, storeId, inventoryItemId } = req.query;

      if (!companyId || !previousCountId || !currentCountId || !storeId || !inventoryItemId) {
        return res.status(400).json({ 
          message: "Missing required parameters: previousCountId, currentCountId, storeId, inventoryItemId" 
        });
      }

      // CRITICAL: Verify store belongs to company (multi-tenant isolation)
      const store = await storage.getCompanyStore(storeId as string, companyId);
      if (!store) {
        return res.status(403).json({ message: "Store not found or access denied" });
      }

      // Validate counts exist, belong to the same company, and belong to the validated store
      const previousCount = await db.query.inventoryCounts.findFirst({
        where: and(
          eq(inventoryCounts.id, previousCountId as string),
          eq(inventoryCounts.companyId, companyId),
          eq(inventoryCounts.storeId, storeId as string)
        ),
      });

      const currentCount = await db.query.inventoryCounts.findFirst({
        where: and(
          eq(inventoryCounts.id, currentCountId as string),
          eq(inventoryCounts.companyId, companyId),
          eq(inventoryCounts.storeId, storeId as string)
        ),
      });

      if (!previousCount || !currentCount) {
        return res.status(404).json({ message: "One or both inventory counts not found or do not belong to this store" });
      }

      // Get theoretical usage runs for the date range
      const runs = await storage.getTheoreticalUsageRuns(
        companyId,
        storeId as string,
        new Date(previousCount.countDate),
        new Date(currentCount.countDate)
      );

      if (runs.length === 0) {
        return res.json({
          summary: {
            inventoryItemId: inventoryItemId as string,
            totalQty: 0,
            totalCost: 0,
            unitName: '',
          },
          menuItems: [],
        });
      }

      // Get theoretical usage lines for these runs and this inventory item
      const runIds = runs.map(r => r.id);
      const lines = await storage.getTheoreticalUsageLinesForRuns(
        runIds,
        inventoryItemId as string
      );

      if (lines.length === 0) {
        return res.json({
          summary: {
            inventoryItemId: inventoryItemId as string,
            totalQty: 0,
            totalCost: 0,
            unitName: '',
          },
          menuItems: [],
        });
      }

      // Aggregate sourceMenuItems across all lines
      interface MenuItemContribution {
        menuItemId: string;
        menuItemName: string;
        qtySold: number;
        theoreticalQty: number;
        cost: number;
      }

      const menuItemMap = new Map<string, MenuItemContribution>();

      for (const line of lines) {
        const sourceMenuItems = JSON.parse(line.sourceMenuItems) as Array<{
          menuItemId: string;
          menuItemName: string;
          qtySold: number;
        }>;

        for (const source of sourceMenuItems) {
          const existing = menuItemMap.get(source.menuItemId);
          if (existing) {
            existing.qtySold += source.qtySold;
          } else {
            menuItemMap.set(source.menuItemId, {
              menuItemId: source.menuItemId,
              menuItemName: source.menuItemName,
              qtySold: source.qtySold,
              theoreticalQty: 0,
              cost: 0,
            });
          }
        }
      }

      // Calculate theoretical qty and cost per menu item
      // For each menu item, determine its share of the total theoretical usage
      const totalQty = lines.reduce((sum, line) => sum + line.requiredQtyBaseUnit, 0);
      const totalCost = lines.reduce((sum, line) => sum + line.costAtSale, 0);
      const totalQtySold = Array.from(menuItemMap.values()).reduce((sum, mi) => sum + mi.qtySold, 0);

      // Get inventory item details for unit info
      const inventoryItem = await storage.getInventoryItem(inventoryItemId as string);
      const unit = inventoryItem ? await storage.getUnit(inventoryItem.unitId) : null;

      // Distribute theoretical qty proportionally to qty sold
      for (const menuItem of menuItemMap.values()) {
        const proportion = totalQtySold > 0 ? menuItem.qtySold / totalQtySold : 0;
        menuItem.theoreticalQty = totalQty * proportion;
        menuItem.cost = totalCost * proportion;
      }

      res.json({
        summary: {
          inventoryItemId: inventoryItemId as string,
          inventoryItemName: inventoryItem?.name || 'Unknown',
          totalQty, // Now in macro units
          totalCost,
          unitName: unit?.name || '',
          unitAbbreviation: unit?.abbreviation || '',
        },
        menuItems: Array.from(menuItemMap.values()).sort((a, b) => 
          b.qtySold - a.qtySold // Sort by qty sold descending
        ),
      });

    } catch (error: any) {
      console.error('Theoretical detail error:', error);
      res.status(500).json({ message: "Failed to fetch theoretical usage detail", error: error.message });
    }
  });

  // ============ QUICKBOOKS INTEGRATION ============

  // Helper function to create signed OAuth state parameter
  const createSignedState = (data: any): string => {
    const payload = Buffer.from(JSON.stringify(data)).toString("base64");
    const signature = crypto
      .createHmac("sha256", process.env.SESSION_SECRET || "fallback-secret")
      .update(payload)
      .digest("hex");
    return `${payload}.${signature}`;
  };

  // Helper function to verify and decode signed state parameter
  const verifySignedState = (signedState: string): any => {
    const [payload, signature] = signedState.split(".");
    if (!payload || !signature) {
      throw new Error("Invalid state format");
    }

    const expectedSignature = crypto
      .createHmac("sha256", process.env.SESSION_SECRET || "fallback-secret")
      .update(payload)
      .digest("hex");

    if (signature !== expectedSignature) {
      throw new Error("State signature verification failed");
    }

    return JSON.parse(Buffer.from(payload, "base64").toString());
  };

  // GET /api/quickbooks/connect - Initiate OAuth flow
  app.get("/api/quickbooks/connect", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId; // Get from req, not req.user
      const { storeId } = req.query; // Optional: if provided, creates store-level connection
      
      if (!companyId) {
        return res.status(400).json({ error: "No company selected. Please select a company first." });
      }

      // Validate storeId if provided
      if (storeId && typeof storeId !== "string") {
        return res.status(400).json({ error: "Invalid storeId parameter" });
      }

      // Verify store ownership if storeId provided
      if (storeId) {
        const store = await storage.getCompanyStore(storeId);
        if (!store || store.companyId !== companyId) {
          return res.status(403).json({ error: "Access denied to this store" });
        }
      }

      const oauthClient = createOAuthClient();

      // Create signed state parameter to prevent tampering
      const stateData = {
        companyId,
        storeId: storeId || null,
        userId: req.user!.id,
        timestamp: Date.now(),
      };
      const state = createSignedState(stateData);

      const authUri = oauthClient.authorizeUri({
        scope: [OAuthClient.scopes.Accounting],
        state,
      });

      res.redirect(authUri);
    } catch (error: any) {
      console.error("QuickBooks connect error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/quickbooks/callback - Handle OAuth callback
  app.get("/api/quickbooks/callback", async (req, res) => {
    try {
      const { state } = req.query;

      if (!state || typeof state !== "string") {
        return res.status(400).send("Missing state parameter");
      }

      // Verify and decode state parameter
      let stateData: any;
      try {
        stateData = verifySignedState(state);
      } catch (error) {
        console.error("State verification failed:", error);
        return res.redirect("/settings?qb_error=state_invalid");
      }

      const { companyId, storeId, timestamp } = stateData;

      // Prevent replay attacks - reject states older than 1 hour
      if (Date.now() - timestamp > 60 * 60 * 1000) {
        return res.redirect("/settings?qb_error=state_expired");
      }

      // Additional security check: verify store still belongs to company
      if (storeId) {
        const store = await storage.getCompanyStore(storeId);
        if (!store || store.companyId !== companyId) {
          return res.redirect("/settings?qb_error=invalid_store");
        }
      }

      const oauthClient = createOAuthClient();
      const authResponse = await oauthClient.createToken(req.url);
      const token = authResponse.getJson();

      // Store tokens in database (TODO: Encrypt tokens at rest)
      const accessTokenExpiresAt = new Date(Date.now() + token.expires_in * 1000);
      const refreshTokenExpiresAt = new Date(Date.now() + token.x_refresh_token_expires_in * 1000);

      await storage.createQuickBooksConnection({
        companyId,
        storeId: storeId || null,
        realmId: authResponse.token.realmId,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
      });

      // Redirect to settings page with success message
      const redirectPath = storeId 
        ? `/settings?storeId=${storeId}&qb_connected=true`
        : `/settings?qb_connected=true`;
      
      res.redirect(redirectPath);
    } catch (error: any) {
      console.error("QuickBooks callback error:", error);
      res.redirect("/settings?qb_error=true");
    }
  });

  // GET /api/quickbooks/status - Get connection status
  app.get("/api/quickbooks/status", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId; // Get from req, not req.user
      const { storeId } = req.query;
      
      if (!companyId) {
        return res.json({ connected: false });
      }

      // Verify store ownership if storeId provided
      if (storeId && typeof storeId === "string") {
        const store = await storage.getCompanyStore(storeId);
        if (!store || store.companyId !== companyId) {
          return res.status(403).json({ error: "Access denied to this store" });
        }
      }

      const connection = await getActiveConnection(
        companyId,
        storeId as string | undefined
      );

      if (!connection) {
        return res.json({ connected: false });
      }

      res.json({
        connected: true,
        connectionLevel: connection.storeId ? "store" : "company",
        storeId: connection.storeId,
        lastSyncedAt: connection.lastSyncedAt,
        expiresAt: connection.accessTokenExpiresAt,
      });
    } catch (error: any) {
      console.error("QuickBooks status error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/quickbooks/disconnect - Disconnect QuickBooks
  app.post("/api/quickbooks/disconnect", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.user!;
      const { storeId } = req.body; // Optional: disconnect specific store

      // Verify store ownership if storeId provided
      if (storeId) {
        const store = await storage.getCompanyStore(storeId);
        if (!store || store.companyId !== companyId) {
          return res.status(403).json({ error: "Access denied to this store" });
        }
      }

      await storage.disconnectQuickBooks(companyId, storeId);

      res.json({ success: true, message: "QuickBooks disconnected successfully" });
    } catch (error: any) {
      console.error("QuickBooks disconnect error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/quickbooks/refresh-token - Manually refresh access token
  // Restricted to global admins and company admins for security
  app.post("/api/quickbooks/refresh-token", requireAuth, async (req, res) => {
    try {
      const user = req.user!;
      const companyId = (req as any).companyId;

      if (!companyId) {
        return res.status(400).json({ error: "No company selected" });
      }

      // Validate request payload
      const refreshTokenSchema = z.object({
        storeId: z.string().optional(),
      });
      const { storeId } = refreshTokenSchema.parse(req.body);

      // Security: Only allow global admins or company admins to manually refresh tokens
      if (user.role !== "global_admin" && user.role !== "company_admin") {
        return res.status(403).json({ error: "Only admins can manually refresh QuickBooks tokens" });
      }

      // Verify store ownership if storeId provided
      if (storeId) {
        const store = await storage.getCompanyStore(storeId);
        if (!store || store.companyId !== companyId) {
          return res.status(403).json({ error: "Access denied to this store" });
        }
      }

      // Get connection to check if it exists
      const connection = await storage.getQuickBooksConnection(companyId, storeId);
      if (!connection) {
        return res.status(404).json({ error: "QuickBooks connection not found" });
      }

      // Force a token refresh by calling the service directly
      const { refreshTokenIfNeeded } = await import("./services/quickbooks");
      await refreshTokenIfNeeded(companyId, storeId || null);

      res.json({ success: true, message: "Token refresh completed successfully" });
    } catch (error: any) {
      console.error("Manual QuickBooks token refresh error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/quickbooks/vendors - Fetch vendors from QuickBooks
  app.get("/api/quickbooks/vendors", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const { storeId } = req.query;

      if (!companyId) {
        return res.status(400).json({ error: "No company selected" });
      }

      // Verify store ownership if storeId provided
      if (storeId && typeof storeId === "string") {
        const store = await storage.getCompanyStore(storeId);
        if (!store || store.companyId !== companyId) {
          return res.status(403).json({ error: "Access denied to this store" });
        }
      }

      const { fetchQuickBooksVendors } = await import("./services/quickbooks");
      const vendors = await fetchQuickBooksVendors(companyId, storeId as string | undefined);
      
      res.json(vendors);
    } catch (error: any) {
      console.error("QuickBooks fetch vendors error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/quickbooks/vendors/mappings - Get all vendor mappings
  app.get("/api/quickbooks/vendors/mappings", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.user!;

      const mappings = await storage.getQuickBooksVendorMappings(companyId);
      res.json(mappings);
    } catch (error: any) {
      console.error("QuickBooks vendor mappings error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/quickbooks/vendors/mappings - Create vendor mapping
  app.post("/api/quickbooks/vendors/mappings", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.user!;

      const validatedData = insertQuickBooksVendorMappingSchema.parse({
        ...req.body,
        companyId,
      });

      const mapping = await storage.createQuickBooksVendorMapping(validatedData);
      res.json(mapping);
    } catch (error: any) {
      console.error("QuickBooks create vendor mapping error:", error);
      res.status(400).json({ error: error.message });
    }
  });

  // DELETE /api/quickbooks/vendors/mappings/:id - Delete vendor mapping
  app.delete("/api/quickbooks/vendors/mappings/:id", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.user!;
      const { id } = req.params;

      await storage.deleteQuickBooksVendorMapping(id, companyId);
      res.json({ success: true, message: "Vendor mapping deleted successfully" });
    } catch (error: any) {
      console.error("QuickBooks delete vendor mapping error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/quickbooks/vendors/preview - Preview QB vendors for import
  app.get("/api/quickbooks/vendors/preview", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const { storeId } = req.query;

      if (!companyId) {
        return res.status(400).json({ error: "No company selected" });
      }

      // Verify store ownership if storeId provided
      if (storeId && typeof storeId === "string") {
        const store = await storage.getCompanyStore(storeId);
        if (!store || store.companyId !== companyId) {
          return res.status(403).json({ error: "Access denied to this store" });
        }
      }

      const { previewQuickBooksVendors } = await import("./services/quickbooks");
      const preview = await previewQuickBooksVendors(companyId, storeId as string | undefined);
      
      res.json(preview);
    } catch (error: any) {
      console.error("QuickBooks vendor preview error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/quickbooks/vendors/sync - Sync selected QB vendors to FoodCost Pro
  app.post("/api/quickbooks/vendors/sync", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const { selectedVendorIds, storeId } = req.body;

      if (!companyId) {
        return res.status(400).json({ error: "No company selected" });
      }

      if (!Array.isArray(selectedVendorIds) || selectedVendorIds.length === 0) {
        return res.status(400).json({ error: "No vendors selected for import" });
      }

      // Verify store ownership if storeId provided
      if (storeId) {
        const store = await storage.getCompanyStore(storeId);
        if (!store || store.companyId !== companyId) {
          return res.status(403).json({ error: "Access denied to this store" });
        }
      }

      const { syncVendorsFromQuickBooks } = await import("./services/quickbooks");
      const result = await syncVendorsFromQuickBooks(companyId, selectedVendorIds, storeId);
      
      res.json(result);
    } catch (error: any) {
      console.error("QuickBooks vendor sync error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/quickbooks/sync-logs - Get sync logs
  app.get("/api/quickbooks/sync-logs", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.user!;
      const { syncStatus } = req.query;

      const logs = await storage.getQuickBooksSyncLogs(
        companyId,
        syncStatus as string | undefined
      );
      
      res.json(logs);
    } catch (error: any) {
      console.error("QuickBooks sync logs error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

// ============ HELPER FUNCTIONS ============

/**
 * Create a placeholder recipe for a menu item during CSV import onboarding.
 * The placeholder recipe contains 1 oz of a "Placeholder Ingredient" inventory item
 * and is flagged as isPlaceholder = 1 for easy identification.
 */
async function createPlaceholderRecipe(companyId: string, menuItemName: string, storeId: string): Promise<string> {
  const units = await storage.getUnits();
  const ounceUnit = units.find(u => u.name === 'ounce (weight)');
  const poundUnit = units.find(u => u.name === 'pound');
  const yieldUnitId = ounceUnit?.id || poundUnit?.id;
  
  if (!yieldUnitId) {
    throw new Error('No weight unit found for placeholder recipe');
  }

  // Find or create "Placeholder Ingredient" inventory item for this company
  let placeholderItem = await db.query.inventoryItems.findFirst({
    where: and(
      eq(inventoryItems.companyId, companyId),
      eq(inventoryItems.name, 'Placeholder Ingredient')
    ),
  });

  if (!placeholderItem) {
    // Create placeholder ingredient
    const [created] = await db.insert(inventoryItems).values({
      companyId,
      name: 'Placeholder Ingredient',
      unitId: yieldUnitId,
      pricePerUnit: 0.01, // $0.01 per oz
      yieldPercent: 100,
      caseSize: 1,
      active: 1,
    }).returning();
    placeholderItem = created;

    // Assign to the store
    await db.insert(storeInventoryItems).values({
      companyId,
      storeId,
      inventoryItemId: placeholderItem.id,
      onHandQty: 0,
      active: 1,
    });
  }

  // Create placeholder recipe
  const recipe = await storage.createRecipe({
    companyId,
    name: `[Placeholder] ${menuItemName}`,
    yieldQty: 1,
    yieldUnitId,
    computedCost: 0.01,
    canBeIngredient: 0,
    isPlaceholder: 1, // Flag as placeholder
  });

  // Add 1 oz of placeholder ingredient
  await storage.createRecipeComponent({
    recipeId: recipe.id,
    componentType: 'inventory_item',
    componentId: placeholderItem.id,
    qty: 1,
    unitId: yieldUnitId,
    sortOrder: 0,
  });

  return recipe.id;
}

async function calculateComponentCost(comp: any): Promise<number> {
  const units = await storage.getUnits();
  const inventoryItems = await storage.getInventoryItems();
  const unitConversions = await storage.getUnitConversions();

  if (comp.componentType === "inventory_item") {
    const item = inventoryItems.find((i) => i.id === comp.componentId);
    if (!item) return 0;

    const compUnit = units.find((u) => u.id === comp.unitId);
    const itemUnit = units.find((u) => u.id === item.unitId);
    
    if (!compUnit || !itemUnit) return 0;

    // Convert component quantity to inventory item's base unit
    let convertedQty = comp.qty;
    
    if (comp.unitId === item.unitId) {
      // Same unit, no conversion needed
      convertedQty = comp.qty;
    } else {
      // Try direct conversion
      const directConversion = unitConversions.find(
        c => c.fromUnitId === comp.unitId && c.toUnitId === item.unitId
      );
      
      if (directConversion) {
        convertedQty = comp.qty * directConversion.conversionFactor;
      } else {
        // Try reverse conversion
        const reverseConversion = unitConversions.find(
          c => c.fromUnitId === item.unitId && c.toUnitId === comp.unitId
        );
        
        if (reverseConversion) {
          convertedQty = comp.qty / reverseConversion.conversionFactor;
        } else if (compUnit.kind === itemUnit.kind) {
          // Use base unit ratios (grams for weight, milliliters for volume)
          convertedQty = (comp.qty * compUnit.toBaseRatio) / itemUnit.toBaseRatio;
        } else {
          // Incompatible unit types (e.g., weight vs count) - cannot convert
          console.warn(`[Recipe Cost] Cannot convert ${compUnit.name} to ${itemUnit.name} - incompatible unit types`);
          return 0;
        }
      }
    }

    return convertedQty * item.pricePerUnit;
    
  } else if (comp.componentType === "recipe") {
    const subRecipe = await storage.getRecipe(comp.componentId);
    if (subRecipe) {
      const subRecipeCost = await calculateRecipeCost(comp.componentId);
      const subRecipeYieldUnit = units.find(u => u.id === subRecipe.yieldUnitId);
      const subRecipeYieldQty = subRecipeYieldUnit ? subRecipe.yieldQty * subRecipeYieldUnit.toBaseRatio : subRecipe.yieldQty;
      const costPerUnit = subRecipeYieldQty > 0 ? subRecipeCost / subRecipeYieldQty : 0;
      
      const compUnit = units.find((u) => u.id === comp.unitId);
      const qty = compUnit ? comp.qty * compUnit.toBaseRatio : comp.qty;
      
      return qty * costPerUnit;
    }
  }
  
  return 0;
}

/**
 * Find all recipes affected by an inventory item change, including nested dependencies.
 * Returns recipe IDs in topological order (children before parents) for proper recalculation.
 */
async function findAffectedRecipesByInventoryItem(inventoryItemId: string, companyId: string): Promise<string[]> {
  const allRecipes = await storage.getRecipes(companyId);
  
  // Build component maps for all recipes upfront
  const recipeComponents = new Map<string, any[]>();
  for (const recipe of allRecipes) {
    const components = await storage.getRecipeComponents(recipe.id);
    recipeComponents.set(recipe.id, components);
  }
  
  // Build dependency graph: recipeId -> parent recipe IDs that use it as a component
  const recipeToParents = new Map<string, Set<string>>();
  const recipeToChildren = new Map<string, Set<string>>();
  
  for (const recipe of allRecipes) {
    const components = recipeComponents.get(recipe.id) || [];
    for (const comp of components) {
      if (comp.componentType === 'recipe') {
        if (!recipeToParents.has(comp.componentId)) {
          recipeToParents.set(comp.componentId, new Set());
        }
        recipeToParents.get(comp.componentId)!.add(recipe.id);
        
        if (!recipeToChildren.has(recipe.id)) {
          recipeToChildren.set(recipe.id, new Set());
        }
        recipeToChildren.get(recipe.id)!.add(comp.componentId);
      }
    }
  }
  
  // Find recipes that directly use the inventory item
  const affectedRecipes = new Set<string>();
  for (const recipe of allRecipes) {
    const components = recipeComponents.get(recipe.id) || [];
    const usesItem = components.some(c => c.componentType === 'inventory_item' && c.componentId === inventoryItemId);
    if (usesItem) {
      affectedRecipes.add(recipe.id);
    }
  }
  
  // Find all parent recipes (transitive closure)
  const toProcess = Array.from(affectedRecipes);
  while (toProcess.length > 0) {
    const recipeId = toProcess.pop()!;
    const parents = recipeToParents.get(recipeId);
    if (parents) {
      for (const parentId of parents) {
        if (!affectedRecipes.has(parentId)) {
          affectedRecipes.add(parentId);
          toProcess.push(parentId);
        }
      }
    }
  }
  
  // Topological sort: children before parents
  const sorted: string[] = [];
  const visited = new Set<string>();
  
  function visit(recipeId: string) {
    if (visited.has(recipeId)) return;
    visited.add(recipeId);
    
    // Visit child recipes first (recipes this recipe depends on)
    const children = recipeToChildren.get(recipeId);
    if (children) {
      for (const childId of children) {
        if (affectedRecipes.has(childId) && !visited.has(childId)) {
          visit(childId);
        }
      }
    }
    
    // Add this recipe after all its children
    sorted.push(recipeId);
  }
  
  // Sort all affected recipes
  for (const recipeId of affectedRecipes) {
    if (!visited.has(recipeId)) {
      visit(recipeId);
    }
  }
  
  return sorted;
}

// Optimized version with preloaded data and memoization
async function calculateRecipeCost(
  recipeId: string,
  preloadedData?: {
    recipes?: Map<string, Recipe>;
    components?: Map<string, RecipeComponent[]>;
    units?: Unit[];
    inventoryItems?: InventoryItem[];
  },
  memo?: Map<string, number>
): Promise<number> {
  // Check memo first to avoid redundant calculations
  if (memo?.has(recipeId)) {
    return memo.get(recipeId)!;
  }

  // Get recipe first to extract companyId for multi-tenant safety
  const recipe = preloadedData?.recipes?.get(recipeId) || await storage.getRecipe(recipeId);
  if (!recipe) {
    return 0;
  }

  // Get preloaded data or fetch with companyId for multi-tenant isolation
  const units = preloadedData?.units || await storage.getUnits();
  const inventoryItems = preloadedData?.inventoryItems || await storage.getInventoryItems(undefined, undefined, recipe.companyId);
  const components = preloadedData?.components?.get(recipeId) || await storage.getRecipeComponents(recipeId);
  
  let totalCost = 0;

  for (const comp of components) {
    const unit = units.find((u) => u.id === comp.unitId);
    const qty = unit ? comp.qty * unit.toBaseRatio : comp.qty;

    if (comp.componentType === "inventory_item") {
      const item = inventoryItems.find((i) => i.id === comp.componentId);
      if (item) {
        // Convert item's pricePerUnit to price per base unit
        const itemUnit = units.find((u) => u.id === item.unitId);
        const itemPricePerBaseUnit = itemUnit ? item.pricePerUnit / itemUnit.toBaseRatio : item.pricePerUnit;
        // Adjust for yield percentage to get effective cost (e.g., $3/lb at 70% yield = $4.29/lb effective)
        const yieldFactor = item.yieldPercent / 100;
        const effectiveCost = yieldFactor > 0 ? itemPricePerBaseUnit / yieldFactor : itemPricePerBaseUnit;
        totalCost += qty * effectiveCost;
      }
    } else if (comp.componentType === "recipe") {
      const subRecipe = preloadedData?.recipes?.get(comp.componentId) || await storage.getRecipe(comp.componentId);
      if (subRecipe) {
        const subRecipeCost = await calculateRecipeCost(comp.componentId, preloadedData, memo);
        // Convert sub-recipe's yield to cost per unit, then scale by quantity needed
        const subRecipeYieldUnit = units.find(u => u.id === subRecipe.yieldUnitId);
        const subRecipeYieldQty = subRecipeYieldUnit ? subRecipe.yieldQty * subRecipeYieldUnit.toBaseRatio : subRecipe.yieldQty;
        const costPerUnit = subRecipeYieldQty > 0 ? subRecipeCost / subRecipeYieldQty : 0;
        totalCost += qty * costPerUnit;
      }
    }
  }

  // Store in memo before returning
  if (memo) {
    memo.set(recipeId, totalCost);
  }

  return totalCost;
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
        // Convert item's pricePerUnit to price per base unit
        const itemUnit = units.find((u) => u.id === item.unitId);
        const itemPricePerBaseUnit = itemUnit ? item.pricePerUnit / itemUnit.toBaseRatio : item.pricePerUnit;
        // Adjust for yield percentage to get effective cost
        const yieldFactor = item.yieldPercent / 100;
        const effectiveCost = yieldFactor > 0 ? itemPricePerBaseUnit / yieldFactor : itemPricePerBaseUnit;
        totalCostContribution += qty * effectiveCost;
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
  endDate?: Date,
  companyId?: string,
  storeId?: string
): Promise<Record<string, number>> {
  const counts = await storage.getInventoryCounts(companyId, storeId);
  const receipts = await storage.getReceipts(companyId);
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
      const vendorItems = await storage.getVendorItems(undefined, companyId);
      
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
