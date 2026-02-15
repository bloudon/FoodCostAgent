import { Response } from "express";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

const UPLOAD_BASE_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
}

interface LocalFileMetadata {
  contentType: string;
  size: number;
  aclPolicy?: ObjectAclPolicy;
}

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function sanitizeCompanyId(companyId: string): string {
  return companyId.replace(/[^a-zA-Z0-9_-]/g, "");
}

function getCompanyDir(companyId: string): string {
  const sanitized = sanitizeCompanyId(companyId);
  if (!sanitized) throw new Error("Invalid company ID");
  return path.join(UPLOAD_BASE_DIR, sanitized);
}

function getMetadataPath(filePath: string): string {
  return filePath + ".meta.json";
}

function readMetadata(filePath: string): LocalFileMetadata | null {
  const metaPath = getMetadataPath(filePath);
  if (fs.existsSync(metaPath)) {
    try {
      return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    } catch {
      return null;
    }
  }
  return null;
}

function writeMetadata(filePath: string, metadata: LocalFileMetadata) {
  const metaPath = getMetadataPath(filePath);
  ensureDir(path.dirname(metaPath));
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}

export class LocalObjectStorageService {
  constructor() {
    ensureDir(UPLOAD_BASE_DIR);
  }

  validateCompanyAccess(filePath: string, companyId: string): boolean {
    const companyDir = getCompanyDir(companyId);
    const resolvedFile = path.resolve(filePath);
    const resolvedCompany = path.resolve(companyDir);
    return resolvedFile.startsWith(resolvedCompany + path.sep) || resolvedFile === resolvedCompany;
  }

  async uploadFile(
    companyId: string,
    fileBuffer: Buffer,
    contentType: string,
    visibility: "public" | "private" = "private",
    ownerId?: string
  ): Promise<string> {
    const sanitizedCompanyId = sanitizeCompanyId(companyId);
    const objectId = randomUUID();
    const ext = this.getExtensionFromMime(contentType);
    const fileName = `${objectId}${ext}`;
    const subDir = visibility === "public" ? "public" : "private";
    
    const dirPath = path.join(getCompanyDir(companyId), subDir);
    ensureDir(dirPath);
    
    const filePath = path.join(dirPath, fileName);
    fs.writeFileSync(filePath, fileBuffer);

    const metadata: LocalFileMetadata = {
      contentType,
      size: fileBuffer.length,
      aclPolicy: ownerId ? { owner: ownerId, visibility } : undefined,
    };
    writeMetadata(filePath, metadata);

    return `/objects/${sanitizedCompanyId}/${subDir}/${fileName}`;
  }

  async getFile(objectPath: string, companyId: string): Promise<{ filePath: string; metadata: LocalFileMetadata }> {
    const normalized = this.normalizeObjectPath(objectPath);
    const parts = normalized.split("/").filter(Boolean);

    if (parts[0] !== "objects" || parts.length < 4) {
      throw new ObjectNotFoundError();
    }

    const pathCompanyId = parts[1];
    if (sanitizeCompanyId(companyId) !== pathCompanyId) {
      throw new ObjectNotFoundError();
    }

    const subPath = parts.slice(2).join("/");
    const filePath = path.join(getCompanyDir(companyId), subPath);
    const resolvedPath = path.resolve(filePath);
    const resolvedBase = path.resolve(UPLOAD_BASE_DIR);
    if (!resolvedPath.startsWith(resolvedBase)) {
      throw new ObjectNotFoundError();
    }

    if (!fs.existsSync(filePath)) {
      throw new ObjectNotFoundError();
    }

    const metadata = readMetadata(filePath) || {
      contentType: this.getMimeFromPath(filePath),
      size: fs.statSync(filePath).size,
    };

    return { filePath, metadata };
  }

  async getFilePublic(objectPath: string): Promise<{ filePath: string; metadata: LocalFileMetadata }> {
    const normalized = this.normalizeObjectPath(objectPath);
    const parts = normalized.split("/").filter(Boolean);

    if (parts[0] !== "objects" || parts.length < 4) {
      throw new ObjectNotFoundError();
    }

    const pathCompanyId = parts[1];
    const subDir = parts[2];

    if (subDir !== "public") {
      throw new ObjectNotFoundError();
    }

    const subPath = parts.slice(2).join("/");
    const filePath = path.join(getCompanyDir(pathCompanyId), subPath);
    const resolvedPath = path.resolve(filePath);
    const resolvedBase = path.resolve(UPLOAD_BASE_DIR);
    if (!resolvedPath.startsWith(resolvedBase)) {
      throw new ObjectNotFoundError();
    }

    if (!fs.existsSync(filePath)) {
      throw new ObjectNotFoundError();
    }

    const metadata = readMetadata(filePath) || {
      contentType: this.getMimeFromPath(filePath),
      size: fs.statSync(filePath).size,
    };

    return { filePath, metadata };
  }

  async downloadObject(filePath: string, metadata: LocalFileMetadata, res: Response, cacheTtlSec: number = 3600) {
    try {
      const isPublic = metadata.aclPolicy?.visibility === "public";
      res.set({
        "Content-Type": metadata.contentType || "application/octet-stream",
        "Content-Length": String(metadata.size),
        "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
      });

      const stream = fs.createReadStream(filePath);
      stream.on("error", (err: Error) => {
        console.error("Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        }
      });
      stream.pipe(res);
    } catch (error) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }

  async setAclPolicy(objectPath: string, companyId: string, aclPolicy: ObjectAclPolicy): Promise<string> {
    const { filePath, metadata } = await this.getFile(objectPath, companyId);
    metadata.aclPolicy = aclPolicy;
    writeMetadata(filePath, metadata);

    if (aclPolicy.visibility === "public" && objectPath.includes("/private/")) {
      const publicDir = path.join(getCompanyDir(companyId), "public");
      ensureDir(publicDir);
      const fileName = path.basename(filePath);
      const newFilePath = path.join(publicDir, fileName);
      fs.renameSync(filePath, newFilePath);
      const oldMetaPath = getMetadataPath(filePath);
      const newMetaPath = getMetadataPath(newFilePath);
      if (fs.existsSync(oldMetaPath)) {
        fs.renameSync(oldMetaPath, newMetaPath);
      }
      const sanitized = sanitizeCompanyId(companyId);
      return `/objects/${sanitized}/public/${fileName}`;
    }

    return objectPath;
  }

  canAccessObject(metadata: LocalFileMetadata, userId?: string): boolean {
    if (!metadata.aclPolicy) return true;
    if (metadata.aclPolicy.visibility === "public") return true;
    if (!userId) return false;
    if (metadata.aclPolicy.owner === userId) return true;
    return false;
  }

  async deleteFile(objectPath: string, companyId: string): Promise<void> {
    const { filePath } = await this.getFile(objectPath, companyId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    const metaPath = getMetadataPath(filePath);
    if (fs.existsSync(metaPath)) {
      fs.unlinkSync(metaPath);
    }
  }

  normalizeObjectPath(rawPath: string): string {
    if (rawPath.startsWith("https://storage.googleapis.com/")) {
      const url = new URL(rawPath);
      return url.pathname;
    }
    return rawPath;
  }

  private getExtensionFromMime(contentType: string): string {
    const mimeMap: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/jpg": ".jpg",
      "image/png": ".png",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "image/svg+xml": ".svg",
      "application/pdf": ".pdf",
      "text/csv": ".csv",
    };
    return mimeMap[contentType] || "";
  }

  private getMimeFromPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const extMap: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".pdf": "application/pdf",
      ".csv": "text/csv",
    };
    return extMap[ext] || "application/octet-stream";
  }
}

let isReplitEnvironment: boolean | null = null;

export async function detectEnvironment(): Promise<"replit" | "local"> {
  if (isReplitEnvironment !== null) {
    return isReplitEnvironment ? "replit" : "local";
  }

  try {
    const response = await fetch("http://127.0.0.1:1106/credential", {
      signal: AbortSignal.timeout(2000),
    });
    isReplitEnvironment = response.ok;
  } catch {
    isReplitEnvironment = false;
  }

  console.log(`[Storage] Environment detected: ${isReplitEnvironment ? "replit" : "local (VPS)"}`);
  return isReplitEnvironment ? "replit" : "local";
}
