import { v2 as cloudinary } from "cloudinary";
import { StorageProvider, UploadResult } from "./storage.provider.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

/**
 * Cloudinary Storage Adapter for media and document bypass storage (§25).
 * Supports both CLOUDINARY_* prefixed and short (CLOUD_NAME, API_KEY, API_SECRET) env variables.
 */
export class CloudinaryStorageAdapter implements StorageProvider {
  private folder: string;
  private isConfigured: boolean;

  constructor(options?: {
    cloudName?: string;
    apiKey?: string;
    apiSecret?: string;
    folder?: string;
  }) {
    const cloud_name =
      options?.cloudName !== undefined
        ? options.cloudName
        : env.CLOUDINARY_CLOUD_NAME || env.CLOUD_NAME;
    const api_key =
      options?.apiKey !== undefined ? options.apiKey : env.CLOUDINARY_API_KEY || env.API_KEY;
    const api_secret =
      options?.apiSecret !== undefined
        ? options.apiSecret
        : env.CLOUDINARY_API_SECRET || env.API_SECRET;
    this.folder = options?.folder || env.CLOUDINARY_FOLDER || env.FOLDER_NAME || "coupon-app";

    this.isConfigured = Boolean(cloud_name && api_key && api_secret);

    if (this.isConfigured) {
      cloudinary.config({
        cloud_name,
        api_key,
        api_secret,
        secure: true,
      });
    }
  }

  async upload(key: string, buffer: Buffer, mime: string): Promise<UploadResult> {
    if (!this.isConfigured) {
      logger.info(
        { key, mime },
        "Cloudinary storage bypass active (unconfigured): simulated upload",
      );
      return { key, sizeBytes: buffer.length, mime };
    }

    const cleanKey = key.replace(/^[/\\]+/, "").replace(/\\/g, "/");
    const publicId = `${this.folder}/${cleanKey.replace(/\.[^/.]+$/, "")}`;

    return new Promise<UploadResult>((resolve) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          public_id: publicId,
          resource_type: "auto",
          overwrite: true,
        },
        (error, result) => {
          if (error || !result) {
            logger.error({ error, key }, "Cloudinary upload failed, using fallback bypass result");
            return resolve({ key, sizeBytes: buffer.length, mime });
          }
          logger.info(
            { publicId: result.public_id, key },
            "File uploaded to Cloudinary successfully",
          );
          resolve({
            key,
            sizeBytes: result.bytes || buffer.length,
            mime,
          });
        },
      );
      stream.end(buffer);
    });
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    if (!this.isConfigured) {
      const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
      return `https://fake-storage.local/${key}?expires=${expires}&bypass=cloudinary`;
    }

    const cleanKey = key.replace(/^[/\\]+/, "").replace(/\\/g, "/");
    const publicId = `${this.folder}/${cleanKey.replace(/\.[^/.]+$/, "")}`;
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;

    try {
      const url = cloudinary.url(publicId, {
        secure: true,
        sign_url: true,
        expires_at: expiresAt,
        resource_type: "auto",
      });
      return url;
    } catch (err) {
      logger.warn(
        { err, key },
        "Error generating Cloudinary signed URL, returning secure direct URL",
      );
      return cloudinary.url(publicId, { secure: true, resource_type: "auto" });
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.isConfigured) return;
    const cleanKey = key.replace(/^[/\\]+/, "").replace(/\\/g, "/");
    const publicId = `${this.folder}/${cleanKey.replace(/\.[^/.]+$/, "")}`;
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: "auto", invalidate: true });
    } catch (err) {
      logger.warn({ err, key }, "Cloudinary delete error ignored");
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!this.isConfigured) return true;
    const cleanKey = key.replace(/^[/\\]+/, "").replace(/\\/g, "/");
    const publicId = `${this.folder}/${cleanKey.replace(/\.[^/.]+$/, "")}`;
    try {
      const result = await cloudinary.api.resource(publicId, { resource_type: "auto" });
      return Boolean(result);
    } catch {
      return false;
    }
  }
}
