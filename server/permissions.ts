import type { User } from "@shared/schema";
import { storage } from "./storage";

/**
 * Permission helper utilities for role-based access control
 */

export type UserRole = "global_admin" | "company_admin" | "store_manager" | "store_user";

/**
 * Check if user is a global admin
 */
export function isGlobalAdmin(user: User): boolean {
  return user.role === "global_admin";
}

/**
 * Check if user is a company admin
 */
export function isCompanyAdmin(user: User): boolean {
  return user.role === "company_admin";
}

/**
 * Check if user is a store manager
 */
export function isStoreManager(user: User): boolean {
  return user.role === "store_manager";
}

/**
 * Check if user is a store user
 */
export function isStoreUser(user: User): boolean {
  return user.role === "store_user";
}

/**
 * Check if user has company-wide access (global_admin or company_admin for the specified company)
 */
export function hasCompanyAccess(user: User, companyId: string): boolean {
  // Global admins have access to all companies
  if (isGlobalAdmin(user)) {
    return true;
  }
  
  // Company admins have access only to their company
  if (isCompanyAdmin(user)) {
    return user.companyId === companyId;
  }
  
  return false;
}

/**
 * Check if user can access a specific store
 */
export async function canAccessStore(user: User, storeId: string): Promise<boolean> {
  // Global admins can access all stores
  if (isGlobalAdmin(user)) {
    return true;
  }
  
  // Get the store to check company ownership
  const store = await storage.getCompanyStore(storeId);
  if (!store) {
    return false;
  }
  
  // Company admins can access all stores in their company
  if (isCompanyAdmin(user) && user.companyId === store.companyId) {
    return true;
  }
  
  // Store managers and users can only access their assigned stores
  if (isStoreManager(user) || isStoreUser(user)) {
    const userStores = await storage.getUserStores(user.id);
    return userStores.some(us => us.storeId === storeId);
  }
  
  return false;
}

/**
 * Get list of store IDs that a user can access
 */
export async function getAccessibleStores(user: User, companyId?: string): Promise<string[]> {
  // Global admins can access all stores (optionally filtered by company)
  if (isGlobalAdmin(user)) {
    if (companyId) {
      const stores = await storage.getCompanyStores(companyId);
      return stores.map(s => s.id);
    }
    // Return all stores across all companies
    const allCompanies = await storage.getCompanies();
    const allStores: string[] = [];
    for (const company of allCompanies) {
      const stores = await storage.getCompanyStores(company.id);
      allStores.push(...stores.map(s => s.id));
    }
    return allStores;
  }
  
  // Company admins can access all stores in their company
  if (isCompanyAdmin(user) && user.companyId) {
    const stores = await storage.getCompanyStores(user.companyId);
    return stores.map(s => s.id);
  }
  
  // Store managers and users can only access their assigned stores
  if ((isStoreManager(user) || isStoreUser(user)) && user.companyId) {
    const userStores = await storage.getUserStores(user.id);
    // Filter by company if specified
    if (companyId && user.companyId !== companyId) {
      return [];
    }
    return userStores.map(us => us.storeId);
  }
  
  return [];
}

/**
 * Check if user can manage other users (create/edit/delete)
 */
export function canManageUsers(user: User, targetCompanyId?: string): boolean {
  // Global admins can manage all users
  if (isGlobalAdmin(user)) {
    return true;
  }
  
  // Company admins can manage users in their company
  if (isCompanyAdmin(user) && targetCompanyId) {
    return user.companyId === targetCompanyId;
  }
  
  return false;
}

/**
 * Check if a user can be assigned to a store
 */
export async function canAssignUserToStore(user: User, targetUserId: string, storeId: string): Promise<boolean> {
  const targetUser = await storage.getUser(targetUserId);
  if (!targetUser) {
    return false;
  }
  
  // Global admins can assign anyone to any store
  if (isGlobalAdmin(user)) {
    return true;
  }
  
  // Company admins can assign users in their company to stores in their company
  if (isCompanyAdmin(user) && user.companyId) {
    const store = await storage.getCompanyStore(storeId);
    return (
      targetUser.companyId === user.companyId &&
      store?.companyId === user.companyId
    );
  }
  
  return false;
}

/**
 * Get the effective company ID for a user (considering selectedCompanyId for global admins)
 */
export function getEffectiveCompanyId(user: User, selectedCompanyId?: string | null): string | null {
  // For global admins, use selectedCompanyId from session
  if (isGlobalAdmin(user)) {
    return selectedCompanyId || null;
  }
  
  // For all other users, use their assigned companyId
  return user.companyId || null;
}
