import crypto from "crypto";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../config/logger.js";
import { NotFoundError, BadRequestError } from "../../lib/errors.js";
import { auditService } from "../audit/audit.service.js";
import { StorageProvider } from "./storage.provider.js";
import { FakeStorageProvider } from "./fake-storage.provider.js";
import { validateMediaFile } from "./file-validator.js";

export const MAX_DOCUMENTS_PER_CLAIM = 3; // Max 3 files per claim (§25)

export class StorageService {
  private provider: StorageProvider;

  constructor(provider?: StorageProvider) {
    this.provider = provider ?? new FakeStorageProvider();
  }

  setProvider(provider: StorageProvider) {
    this.provider = provider;
  }

  getProvider(): StorageProvider {
    return this.provider;
  }

  /**
   * Validates and attaches a document to a reimbursement request (§25).
   */
  async attachReimbursementDocument(
    requestId: string,
    rawBuffer: Buffer,
    declaredMime?: string,
    originalFilename?: string,
  ) {
    // 1. Verify claim exists
    const claim = await prisma.reimbursementRequest.findUnique({
      where: { id: requestId },
      include: { documents: true },
    });

    if (!claim) {
      throw new NotFoundError(`Reimbursement request ${requestId} not found`);
    }

    // 2. Check claim document count ceiling
    if (claim.documents.length >= MAX_DOCUMENTS_PER_CLAIM) {
      throw new BadRequestError(`Maximum ${MAX_DOCUMENTS_PER_CLAIM} documents allowed per claim`);
    }

    // 3. Immutability check (§25): Documents can only be added while DRAFT or INFO_REQUESTED
    if (claim.status !== "DRAFT" && claim.status !== "INFO_REQUESTED") {
      throw new BadRequestError(`Documents cannot be added to a claim in ${claim.status} status`);
    }

    // 4. Validate through security pipeline
    const validated = validateMediaFile(rawBuffer, declaredMime, originalFilename);

    // 5. Generate secure randomized storage key (never original filename §25)
    const fileId = crypto.randomUUID();
    const storageKey = `reimb/${claim.id}/${fileId}.${validated.extension}`;

    // 6. Upload to private bucket
    await this.provider.upload(storageKey, validated.buffer, validated.mime);

    // 7. Persist document record
    const sanitizedName = originalFilename
      ? originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_")
      : `document.${validated.extension}`;

    const doc = await prisma.reimbursementDocument.create({
      data: {
        requestId: claim.id,
        storageKey,
        mime: validated.mime,
        sizeBytes: validated.buffer.length,
        sha256: validated.sha256,
        originalName: sanitizedName,
        scanStatus: "CLEAN", // Default clean upon passing strict allowlist/magic-bytes
      },
    });

    logger.info(
      { requestId: claim.id, docId: doc.id, storageKey },
      "Attached reimbursement document securely",
    );

    return doc;
  }

  /**
   * Generates a 60-second temporary signed URL for admin viewing with audit log (§25, §19.5).
   */
  async getSignedDocumentUrl(docId: string, adminUserId: string, ip?: string) {
    const doc = await prisma.reimbursementDocument.findUnique({
      where: { id: docId },
      include: {
        request: { select: { id: true, publicRef: true, messId: true } },
      },
    });

    if (!doc) {
      throw new NotFoundError("Document not found");
    }

    if (doc.scanStatus === "INFECTED" || doc.scanStatus === "PENDING") {
      throw new BadRequestError(`Document cannot be viewed: scan status is ${doc.scanStatus}`);
    }

    // 60-second temporary signed URL (§25)
    const url = await this.provider.getSignedUrl(doc.storageKey, 60);

    // Record audit entry
    await auditService.log({
      actorType: "ADMIN",
      actorId: adminUserId,
      action: "DOCUMENT_VIEWED",
      entityType: "ReimbursementDocument",
      entityId: doc.id,
      after: {
        publicRef: doc.request.publicRef,
        storageKey: doc.storageKey,
      },
      ip,
    });

    return {
      url,
      expiresInSeconds: 60,
      mime: doc.mime,
      originalName: doc.originalName,
    };
  }
}

export const storageService = new StorageService();
