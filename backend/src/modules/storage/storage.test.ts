import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateMediaFile, MAX_FILE_SIZE_BYTES } from "./file-validator.js";
import { StorageService } from "./storage.service.js";
import { FakeStorageProvider } from "./fake-storage.provider.js";
import { prisma } from "../../lib/prisma.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    reimbursementRequest: {
      findUnique: vi.fn(),
    },
    reimbursementDocument: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../audit/audit.service.js", () => ({
  auditService: {
    log: vi.fn(),
  },
}));

describe("Phase 19: Reimbursement Documents & Storage Security (§25)", () => {
  let fakeStorage: FakeStorageProvider;
  let service: StorageService;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeStorage = new FakeStorageProvider();
    service = new StorageService(fakeStorage);
  });

  describe("File Validation Pipeline & Magic Bytes (§25)", () => {
    it("accepts valid JPEG buffer starting with FF D8 FF", () => {
      const validJpeg = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00,
        0x60, 0xff, 0xda, 0x00, 0x00, 0xff, 0xd9,
      ]);

      const result = validateMediaFile(validJpeg, "image/jpeg", "leave_slip.jpg");
      expect(result.mime).toBe("image/jpeg");
      expect(result.extension).toBe("jpg");
      expect(result.sha256).toBeDefined();
    });

    it("accepts valid PNG buffer starting with 89 50 4E 47", () => {
      const validPng = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52,
      ]);

      const result = validateMediaFile(validPng, "image/png", "medical.png");
      expect(result.mime).toBe("image/png");
      expect(result.extension).toBe("png");
    });

    it("accepts valid PDF buffer starting with %PDF (25 50 44 46)", () => {
      const validPdf = Buffer.from(
        "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\n0 1\n0000000000 65535 f\ntrailer\n<< /Root 1 0 R >>\n%%EOF",
      );

      const result = validateMediaFile(validPdf, "application/pdf", "ticket.pdf");
      expect(result.mime).toBe("application/pdf");
      expect(result.extension).toBe("pdf");
    });

    it("rejects malicious file disguised as image (e.g. renamed .exe or script)", () => {
      // Windows PE executable header: MZ (0x4D 0x5A)
      const fakeExe = Buffer.from([
        0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0xff, 0xff, 0x00,
        0x00,
      ]);

      expect(() => validateMediaFile(fakeExe, "image/jpeg", "slip.jpg")).toThrow(BadRequestError);
    });

    it("rejects file exceeding 5 MB limit", () => {
      const oversized = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1024);
      oversized[0] = 0xff;
      oversized[1] = 0xd8;
      oversized[2] = 0xff;

      expect(() => validateMediaFile(oversized, "image/jpeg", "huge.jpg")).toThrow(BadRequestError);
    });

    it("rejects PDF containing embedded JavaScript", () => {
      const maliciousPdf = Buffer.from(
        "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Names << /JavaScript 2 0 R >> >>\nendobj\n%%EOF",
      );

      expect(() => validateMediaFile(maliciousPdf, "application/pdf", "receipt.pdf")).toThrow(
        BadRequestError,
      );
    });
  });

  describe("Storage Service & Immutability (§25)", () => {
    const validJpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00,
      0x60, 0xff, 0xda, 0x00, 0x00, 0xff, 0xd9,
    ]);

    it("attaches document with randomized UUID storage key (never original filename)", async () => {
      vi.mocked(prisma.reimbursementRequest.findUnique).mockResolvedValue({
        id: "claim-123",
        status: "DRAFT",
        documents: [],
      } as never);

      vi.mocked(prisma.reimbursementDocument.create).mockResolvedValue({
        id: "doc-1",
        requestId: "claim-123",
        storageKey: "reimb/claim-123/uuid.jpg",
        originalName: "my_personal_leave_slip.jpg",
      } as never);

      await service.attachReimbursementDocument(
        "claim-123",
        validJpeg,
        "image/jpeg",
        "my_personal_leave_slip.jpg",
      );

      // Verify created in DB
      expect(prisma.reimbursementDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            requestId: "claim-123",
            storageKey: expect.stringMatching(/^reimb\/claim-123\/[a-f0-9-]+\.jpg$/),
          }),
        }),
      );
    });

    it("enforces maximum 3 documents per claim", async () => {
      vi.mocked(prisma.reimbursementRequest.findUnique).mockResolvedValue({
        id: "claim-123",
        status: "DRAFT",
        documents: [{ id: "d1" }, { id: "d2" }, { id: "d3" }],
      } as never);

      await expect(
        service.attachReimbursementDocument("claim-123", validJpeg, "image/jpeg", "fourth.jpg"),
      ).rejects.toThrow(BadRequestError);
    });

    it("rejects attaching document when claim is already SUBMITTED or APPROVED", async () => {
      vi.mocked(prisma.reimbursementRequest.findUnique).mockResolvedValue({
        id: "claim-123",
        status: "SUBMITTED", // Immutable after submission
        documents: [],
      } as never);

      await expect(
        service.attachReimbursementDocument("claim-123", validJpeg, "image/jpeg", "late.jpg"),
      ).rejects.toThrow(BadRequestError);
    });
  });

  describe("Admin Signed URL Viewer & Audit (§19.5, §25)", () => {
    it("generates 60-second temporary signed URL and records audit entry", async () => {
      vi.mocked(prisma.reimbursementDocument.findUnique).mockResolvedValue({
        id: "doc-abc",
        storageKey: "reimb/claim-1/file.pdf",
        originalName: "slip.pdf",
        mime: "application/pdf",
        scanStatus: "CLEAN",
        request: {
          id: "claim-1",
          publicRef: "CLM-2026-0001",
          messId: "akshaya",
        },
      } as never);

      const result = await service.getSignedDocumentUrl("doc-abc", "admin-1", "127.0.0.1");

      expect(result.expiresInSeconds).toBe(60);
      expect(result.url).toContain("https://fake-storage.local/reimb/claim-1/file.pdf");
    });

    it("blocks viewing documents that failed malware scan or are pending", async () => {
      vi.mocked(prisma.reimbursementDocument.findUnique).mockResolvedValue({
        id: "doc-infected",
        storageKey: "reimb/claim-1/virus.pdf",
        scanStatus: "INFECTED",
        request: { id: "claim-1" },
      } as never);

      await expect(service.getSignedDocumentUrl("doc-infected", "admin-1")).rejects.toThrow(
        BadRequestError,
      );
    });

    it("throws NotFoundError when document does not exist", async () => {
      vi.mocked(prisma.reimbursementDocument.findUnique).mockResolvedValue(null);

      await expect(service.getSignedDocumentUrl("unknown", "admin-1")).rejects.toThrow(
        NotFoundError,
      );
    });
  });
});
