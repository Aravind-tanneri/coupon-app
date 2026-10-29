import { describe, it, expect, vi, beforeEach } from "vitest";
import { reimbursementWorkflow } from "./reimbursement.workflow.js";
import { reimbursementService } from "../../reimbursements/reimbursement.service.js";
import { prisma } from "../../../lib/prisma.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    conversation: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    student: {
      findUnique: vi.fn(),
    },
    reimbursementPolicy: {
      findFirst: vi.fn(),
    },
    reimbursementRequest: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../../storage/storage.service.js", () => ({
  storageService: {
    attachReimbursementDocument: vi.fn(),
  },
}));

vi.mock("../whatsapp.service.js", () => ({
  whatsAppService: {
    getProvider: vi.fn(() => ({
      downloadMedia: vi.fn().mockResolvedValue({
        data: Buffer.from("fake-file"),
        mimeType: "image/jpeg",
      }),
    })),
  },
}));

vi.mock("../../reimbursements/reimbursement.service.js", () => ({
  reimbursementService: {
    calculateForStudent: vi.fn(),
    saveDraft: vi.fn(),
    submitClaim: vi.fn(),
  },
}));

describe("Phase 16: WhatsApp Reimbursement Workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("startOrResume (§16.1)", () => {
    it("creates fresh conversation at AWAITING_START_DATE when no active session exists", async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.conversation.create).mockResolvedValue({
        id: "conv-1",
        identityId: "ident-1",
        workflow: "REIMBURSEMENT",
        step: "AWAITING_START_DATE",
        data: {},
        version: 1,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 1800000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const reply = await reimbursementWorkflow.startOrResume("ident-1", "stud-1");

      expect(reply.text).toContain("Absence Reimbursement Claim");
      expect(reply.text).toContain("departure date");
      expect(reply.buttons).toEqual([{ id: "REIMB_CANCEL", title: "Cancel" }]);
      expect(prisma.conversation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            identityId: "ident-1",
            step: "AWAITING_START_DATE",
            workflow: "REIMBURSEMENT",
          }),
        }),
      );
    });

    it("advances directly to AWAITING_END_DATE if initial start date was provided", async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(null);

      const reply = await reimbursementWorkflow.startOrResume("ident-1", "stud-1", "2026-10-10");

      expect(reply.text).toContain("Absence Return Date");
      expect(reply.text).toContain("10 Oct 2026");
      expect(prisma.conversation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            step: "AWAITING_END_DATE",
            data: { startDate: "2026-10-10" },
          }),
        }),
      );
    });
  });

  describe("Guided Step Machine (§16.1 - §16.4)", () => {
    it("AWAITING_START_DATE: rejects invalid date input", async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        id: "conv-1",
        identityId: "ident-1",
        workflow: "REIMBURSEMENT",
        step: "AWAITING_START_DATE",
        data: {},
        version: 1,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 1800000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const reply = await reimbursementWorkflow.handleInbound("ident-1", "stud-1", {
        text: "random gibberish",
      });

      expect(reply.text).toContain("Invalid Date Format");
      expect(reply.buttons).toEqual([{ id: "REIMB_CANCEL", title: "Cancel" }]);
    });

    it("AWAITING_START_DATE -> AWAITING_END_DATE: parses valid date and advances", async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        id: "conv-1",
        identityId: "ident-1",
        workflow: "REIMBURSEMENT",
        step: "AWAITING_START_DATE",
        data: {},
        version: 1,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 1800000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const reply = await reimbursementWorkflow.handleInbound("ident-1", "stud-1", {
        text: "10 Oct 2026",
      });

      expect(reply.text).toContain("Absence Return Date");
      expect(reply.text).toContain("10 Oct 2026");
      expect(prisma.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            step: "AWAITING_END_DATE",
            data: { startDate: "2026-10-10" },
          }),
        }),
      );
    });

    it("AWAITING_END_DATE: returns clear explanation if calculation is ineligible", async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        id: "conv-1",
        identityId: "ident-1",
        workflow: "REIMBURSEMENT",
        step: "AWAITING_END_DATE",
        data: { startDate: "2026-10-10" },
        version: 2,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 1800000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(reimbursementService.calculateForStudent).mockResolvedValue({
        eligible: false,
        reason: "MIN_DAYS_NOT_MET",
        message: "Absence period must be greater than 4 counted days.",
        countedDays: 2,
        claimablePaise: 0,
        rateAtClaimPaise: 13100,
        segments: [],
      });

      const reply = await reimbursementWorkflow.handleInbound("ident-1", "stud-1", {
        text: "13 Oct 2026",
      });

      expect(reply.text).toContain("Claim Not Eligible");
      expect(reply.text).toContain("greater than 4 counted days");
      expect(reply.buttons).toEqual([
        { id: "REIMB_START", title: "Start Over" },
        { id: "REIMB_CANCEL", title: "Cancel" },
      ]);
    });

    it("AWAITING_END_DATE -> SHOW_CALCULATION: renders calculation template on eligible dates", async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        id: "conv-1",
        identityId: "ident-1",
        workflow: "REIMBURSEMENT",
        step: "AWAITING_END_DATE",
        data: { startDate: "2026-10-10" },
        version: 2,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 1800000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(reimbursementService.calculateForStudent).mockResolvedValue({
        eligible: true,
        countedDays: 6,
        claimablePaise: 78600,
        rateAtClaimPaise: 13100,
        segments: [],
      });

      vi.mocked(reimbursementService.saveDraft).mockResolvedValue({
        id: "draft-claim-1",
      } as never);

      const reply = await reimbursementWorkflow.handleInbound("ident-1", "stud-1", {
        text: "17 Oct 2026",
      });

      // Assert §3 template
      expect(reply.text).toContain("CLAIM CALCULATION");
      expect(reply.text).toContain("Away: 10 Oct 2026 – 17 Oct 2026");
      expect(reply.text).toContain("Days counted: 6 (departure and return days excluded)");
      expect(reply.text).toContain("Rate: ₹131/day");
      expect(reply.text).toContain("Estimated claim: ₹786.00");
      expect(reply.buttons).toEqual([
        { id: "REIMB_CONTINUE", title: "Continue" },
        { id: "REIMB_CANCEL", title: "Cancel" },
      ]);
    });

    it("SHOW_CALCULATION -> AWAITING_REASON on continue", async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        id: "conv-1",
        identityId: "ident-1",
        workflow: "REIMBURSEMENT",
        step: "SHOW_CALCULATION",
        data: {
          startDate: "2026-10-10",
          endDate: "2026-10-17",
          countedDays: 6,
          rateAtClaimPaise: 13100,
          claimablePaise: 78600,
          draftClaimId: "draft-1",
        },
        version: 3,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 1800000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const reply = await reimbursementWorkflow.handleInbound("ident-1", "stud-1", {
        actionId: "REIMB_CONTINUE",
      });

      expect(reply.text).toContain("Reason for Absence");
      expect(reply.buttons).toEqual([{ id: "REIMB_CANCEL", title: "Cancel" }]);
    });

    it("AWAITING_REASON -> AWAITING_PAYOUT_DETAILS: collects reason and advances", async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        id: "conv-1",
        identityId: "ident-1",
        workflow: "REIMBURSEMENT",
        step: "AWAITING_REASON",
        data: {
          startDate: "2026-10-10",
          endDate: "2026-10-17",
          countedDays: 6,
          rateAtClaimPaise: 13100,
          claimablePaise: 78600,
          draftClaimId: "draft-1",
        },
        version: 4,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 1800000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const reply = await reimbursementWorkflow.handleInbound("ident-1", "stud-1", {
        text: "Attending annual IEEE technical conference in Delhi",
      });

      expect(reply.text).toContain("Payout Details");
      expect(reply.text).toContain("UPI ID");
    });

    it("AWAITING_PAYOUT_DETAILS -> AWAITING_DOCUMENT: stores payout and prompts for supporting documentation", async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        id: "conv-1",
        identityId: "ident-1",
        workflow: "REIMBURSEMENT",
        step: "AWAITING_PAYOUT_DETAILS",
        data: {
          startDate: "2026-10-10",
          endDate: "2026-10-17",
          countedDays: 6,
          rateAtClaimPaise: 13100,
          claimablePaise: 78600,
          reason: "IEEE Conference",
          draftClaimId: "draft-1",
        },
        version: 5,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 1800000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(prisma.student.findUnique).mockResolvedValue({
        id: "stud-1",
        messId: "akshaya",
      } as never);

      vi.mocked(prisma.reimbursementPolicy.findFirst).mockResolvedValue({
        id: "pol-1",
        messId: "akshaya",
        documentRequired: false,
      } as never);

      const reply = await reimbursementWorkflow.handleInbound("ident-1", "stud-1", {
        text: "rahul@okaxis",
      });

      expect(reply.text).toContain("Supporting Documentation");
      expect(reply.buttons).toEqual([
        { id: "REIMB_SKIP_DOCS", title: "Skip Documents" },
        { id: "REIMB_CANCEL", title: "Cancel" },
      ]);
    });

    it("AWAITING_DOCUMENT: ingests uploaded media, attaches document and prompts for more or completion", async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        id: "conv-1",
        identityId: "ident-1",
        workflow: "REIMBURSEMENT",
        step: "AWAITING_DOCUMENT",
        data: {
          draftClaimId: "draft-1",
          documentCount: 0,
          documentRequired: true,
        },
        version: 6,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 1800000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const reply = await reimbursementWorkflow.handleInbound("ident-1", "stud-1", {
        media: {
          mediaId: "media-123",
          mimeType: "image/jpeg",
          filename: "ticket.jpg",
        },
      });

      expect(reply.text).toContain("Document #1 Uploaded Successfully");
      expect(reply.buttons).toEqual([
        { id: "REIMB_DOCS_DONE", title: "Continue" },
        { id: "REIMB_CANCEL", title: "Cancel" },
      ]);
    });

    it("AWAITING_DOCUMENT -> AWAITING_CONFIRMATION: advances on skip documents and displays review screen with server nonce", async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        id: "conv-1",
        identityId: "ident-1",
        workflow: "REIMBURSEMENT",
        step: "AWAITING_DOCUMENT",
        data: {
          startDate: "2026-10-10",
          endDate: "2026-10-17",
          countedDays: 6,
          rateAtClaimPaise: 13100,
          claimablePaise: 78600,
          reason: "IEEE Conference",
          payoutDetails: "rahul@okaxis",
          documentRequired: false,
          draftClaimId: "draft-1",
        },
        version: 6,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 1800000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(prisma.student.findUnique).mockResolvedValue({
        id: "stud-1",
        name: "Rahul Sharma",
        rollNo: "2024CS001",
        department: "CSE",
        messId: "akshaya",
        email: "rahul@institution.edu",
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        mess: { id: "akshaya", code: "AKSHAYA", name: "Akshaya", active: true },
      } as never);

      const reply = await reimbursementWorkflow.handleInbound("ident-1", "stud-1", {
        actionId: "REIMB_SKIP_DOCS",
      });

      // Assert §3 Review screen
      expect(reply.text).toContain("REVIEW YOUR CLAIM");
      expect(reply.text).toContain("Away: 10 Oct 2026 – 17 Oct 2026");
      expect(reply.text).toContain("Days counted: 6");
      expect(reply.text).toContain("Claimed amount: ₹786.00");
      expect(reply.text).toContain("Department: CSE");
      expect(reply.text).toContain("Roll No: 2024CS001");
      expect(reply.text).toContain("Mess: Akshaya");
      expect(reply.text).toContain("Payout: ****axis"); // Masked payout check

      // Nonce button check
      expect(reply.buttons?.[0]?.id).toMatch(/^REIMB_SUBMIT:[a-f0-9]+$/);
      expect(reply.buttons?.[0]?.title).toBe("Submit Claim");
    });
  });

  describe("Submission Security and Nonce Verification (§16.5)", () => {
    it("CRITICAL AC: a typed 'yes' or 'submit' does NOT submit claim and offers button again", async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        id: "conv-1",
        identityId: "ident-1",
        workflow: "REIMBURSEMENT",
        step: "AWAITING_CONFIRMATION",
        data: {
          startDate: "2026-10-10",
          endDate: "2026-10-17",
          nonce: "submit:abc123nonce",
          draftClaimId: "draft-1",
        },
        version: 6,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 1800000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const reply = await reimbursementWorkflow.handleInbound("ident-1", "stud-1", {
        text: "yes please submit my claim",
      });

      // Verification: service MUST NOT be called!
      expect(reimbursementService.submitClaim).not.toHaveBeenCalled();
      expect(reply.text).toContain("Confirmation Required");
      expect(reply.text).toContain("tap the *Submit Claim* button below");
      expect(reply.buttons?.[0]?.id).toBe("REIMB_SUBMIT:abc123nonce");
    });

    it("submits claim successfully when server-issued nonce button is tapped", async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        id: "conv-1",
        identityId: "ident-1",
        workflow: "REIMBURSEMENT",
        step: "AWAITING_CONFIRMATION",
        data: {
          startDate: "2026-10-10",
          endDate: "2026-10-17",
          nonce: "submit:validNonce99",
          draftClaimId: "draft-1",
        },
        version: 6,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 1800000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(reimbursementService.submitClaim).mockResolvedValue({
        id: "claim-1",
        publicRef: "CLM-2026-88741",
        claimedAmountPaise: 78600,
        status: "SUBMITTED",
      } as never);

      const reply = await reimbursementWorkflow.handleInbound("ident-1", "stud-1", {
        actionId: "REIMB_SUBMIT:validNonce99",
      });

      expect(reimbursementService.submitClaim).toHaveBeenCalledWith("stud-1", "draft-1");
      expect(reply.text).toContain("Claim Submitted Successfully");
      expect(reply.text).toContain("CLM-2026-88741");
      expect(reply.text).toContain("₹786.00");
      expect(prisma.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "COMPLETED",
            step: "SUBMITTED",
          }),
        }),
      );
    });

    it("rejects replayed or invalid nonce submission", async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        id: "conv-1",
        identityId: "ident-1",
        workflow: "REIMBURSEMENT",
        step: "AWAITING_CONFIRMATION",
        data: {
          startDate: "2026-10-10",
          endDate: "2026-10-17",
          nonce: "submit:validNonce99",
          draftClaimId: "draft-1",
        },
        version: 6,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 1800000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const reply = await reimbursementWorkflow.handleInbound("ident-1", "stud-1", {
        actionId: "REIMB_SUBMIT:staleOrFakeNonce",
      });

      expect(reimbursementService.submitClaim).not.toHaveBeenCalled();
      expect(reply.text).toContain("expired or has already been used");
    });
  });

  describe("My Claims & Information Request Tracking (§16.6)", () => {
    it("displays submitted claims with status badges and highlights info requests", async () => {
      vi.mocked(prisma.reimbursementRequest.findMany).mockResolvedValue([
        {
          id: "c-1",
          publicRef: "CLM-2026-0001",
          startDate: new Date("2026-10-10"),
          endDate: new Date("2026-10-17"),
          claimedAmountPaise: 78600,
          status: "INFO_REQUESTED",
          rejectionReason: "Please upload warden signed leave slip",
        } as never,
        {
          id: "c-2",
          publicRef: "CLM-2026-0002",
          startDate: new Date("2026-09-01"),
          endDate: new Date("2026-09-08"),
          claimedAmountPaise: 78600,
          status: "PAID",
          rejectionReason: null,
        } as never,
      ]);

      const reply = await reimbursementWorkflow.listMyClaims("stud-1");

      expect(reply.text).toContain("My Reimbursement Claims");
      expect(reply.text).toContain("CLM-2026-0001");
      expect(reply.text).toContain("Action Required");
      expect(reply.text).toContain("warden signed leave slip");
      expect(reply.text).toContain("CLM-2026-0002");
      expect(reply.text).toContain("Paid");
    });
  });
});
