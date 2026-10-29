import { describe, it, expect, vi, beforeEach } from "vitest";
import { feedbackWorkflow } from "./feedback.workflow.js";
import { feedbackService } from "../../feedback/feedback.service.js";
import { prisma } from "../../../lib/prisma.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    feedback: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    conversation: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    announcement: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../../feedback/feedback.service.js", () => ({
  feedbackService: {
    submitFeedback: vi.fn(),
  },
}));

describe("Phase 17: WhatsApp Feedback & Announcements Workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("startFeedback & Daily Limit (§14, §17.1)", () => {
    it("blocks student from submitting if daily limit of 5 is reached", async () => {
      vi.mocked(prisma.feedback.count).mockResolvedValue(5);

      const reply = await feedbackWorkflow.startFeedback("ident-1", "stud-1", "akshaya");

      expect(reply.text).toContain("Daily Feedback Limit Reached");
      expect(reply.text).toContain("already submitted 5 feedback entries today");
      expect(prisma.conversation.create).not.toHaveBeenCalled();
    });

    it("stages free-text feedback draft WITHOUT auto-submitting (§17.2)", async () => {
      vi.mocked(prisma.feedback.count).mockResolvedValue(1);

      const reply = await feedbackWorkflow.startFeedback("ident-1", "stud-1", "akshaya", {
        category: "FOOD_QUALITY",
        message: "The paneer curry at lunch was salty and cold.",
        rating: 2,
      });

      // Verification: feedbackService must NOT have been called yet!
      expect(feedbackService.submitFeedback).not.toHaveBeenCalled();

      expect(reply.text).toContain("Stage Feedback Submission");
      expect(reply.text).toContain("Food Quality");
      expect(reply.text).toContain("⭐⭐");
      expect(reply.text).toContain("The paneer curry at lunch was salty and cold.");
      expect(reply.buttons).toEqual([
        { id: "FEEDBACK_SUBMIT", title: "Confirm & Submit" },
        { id: "FEEDBACK_CANCEL", title: "Cancel" },
      ]);

      expect(prisma.conversation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            step: "AWAITING_CONFIRMATION",
            workflow: "FEEDBACK",
          }),
        }),
      );
    });

    it("presents category selection menu when starting interactive feedback flow", async () => {
      vi.mocked(prisma.feedback.count).mockResolvedValue(0);

      const reply = await feedbackWorkflow.startFeedback("ident-1", "stud-1", "akshaya");

      expect(reply.text).toContain("Mess Feedback & Suggestions");
      expect(reply.buttons).toEqual([
        { id: "FB_CAT:FOOD_QUALITY", title: "Food Quality" },
        { id: "FB_CAT:MENU", title: "Menu Variety" },
        { id: "FB_CAT:SERVICE", title: "Service & Staff" },
      ]);
    });
  });

  describe("Guided Step Flow (§17.1)", () => {
    it("AWAITING_CATEGORY -> AWAITING_RATING: records category and requests rating", async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        id: "conv-1",
        identityId: "ident-1",
        workflow: "FEEDBACK",
        step: "AWAITING_CATEGORY",
        data: {},
        version: 1,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 1800000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const reply = await feedbackWorkflow.handleInbound("ident-1", "stud-1", "akshaya", {
        actionId: "FB_CAT:SERVICE",
      });

      expect(reply.text).toContain("Service & Hygiene");
      expect(reply.text).toContain("rate your overall experience");
      expect(reply.buttons).toEqual([
        { id: "FB_RATE:1", title: "⭐ 1 Star" },
        { id: "FB_RATE:3", title: "⭐⭐⭐ 3 Stars" },
        { id: "FB_RATE:5", title: "⭐⭐⭐⭐⭐ 5 Stars" },
      ]);
    });

    it("AWAITING_RATING -> AWAITING_MESSAGE: records rating and requests comments", async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        id: "conv-1",
        identityId: "ident-1",
        workflow: "FEEDBACK",
        step: "AWAITING_RATING",
        data: { category: "FOOD_QUALITY" },
        version: 2,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 1800000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const reply = await feedbackWorkflow.handleInbound("ident-1", "stud-1", "akshaya", {
        actionId: "FB_RATE:5",
      });

      expect(reply.text).toContain("Feedback Remarks");
      expect(reply.buttons).toEqual([{ id: "FEEDBACK_CANCEL", title: "Cancel" }]);
    });

    it("AWAITING_MESSAGE -> AWAITING_CONFIRMATION: displays review prompt with confirm button", async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        id: "conv-1",
        identityId: "ident-1",
        workflow: "FEEDBACK",
        step: "AWAITING_MESSAGE",
        data: { category: "FOOD_QUALITY", rating: 4 },
        version: 3,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 1800000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const reply = await feedbackWorkflow.handleInbound("ident-1", "stud-1", "akshaya", {
        text: "Special South Indian breakfast was exceptionally fresh and tasty.",
      });

      expect(reply.text).toContain("Review Feedback Before Submission");
      expect(reply.text).toContain("Food Quality");
      expect(reply.text).toContain("⭐⭐⭐⭐");
      expect(reply.text).toContain("Special South Indian breakfast was exceptionally fresh");
      expect(reply.buttons).toEqual([
        { id: "FEEDBACK_SUBMIT", title: "Confirm & Submit" },
        { id: "FEEDBACK_CANCEL", title: "Cancel" },
      ]);
    });

    it("AWAITING_CONFIRMATION: requires button click to finalize submission", async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        id: "conv-1",
        identityId: "ident-1",
        workflow: "FEEDBACK",
        step: "AWAITING_CONFIRMATION",
        data: {
          category: "FOOD_QUALITY",
          rating: 4,
          message: "Great breakfast today!",
        },
        version: 4,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 1800000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // 1. Text input does NOT submit
      const typedReply = await feedbackWorkflow.handleInbound("ident-1", "stud-1", "akshaya", {
        text: "yes please submit",
      });
      expect(feedbackService.submitFeedback).not.toHaveBeenCalled();
      expect(typedReply.text).toContain("Please tap *Confirm & Submit*");

      // 2. Button click SUBMITS
      const btnReply = await feedbackWorkflow.handleInbound("ident-1", "stud-1", "akshaya", {
        actionId: "FEEDBACK_SUBMIT",
      });

      expect(feedbackService.submitFeedback).toHaveBeenCalledWith({
        studentId: "stud-1",
        messId: "akshaya",
        category: "FOOD_QUALITY",
        rating: 4,
        message: "Great breakfast today!",
        isAnonymous: false,
      });

      expect(btnReply.text).toContain("Feedback Received");
      expect(prisma.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "COMPLETED",
            step: "SUBMITTED",
          }),
        }),
      );
    });
  });

  describe("Announcements (§17.3)", () => {
    it("formats active announcements with dates and preview", async () => {
      vi.mocked(prisma.announcement.findMany).mockResolvedValue([
        {
          id: "ann-1",
          messId: "akshaya",
          title: "Diwali Special Feast Dinner",
          body: "Special feast dinner will be served on 1st November starting at 7:30 PM.",
          publishAt: new Date("2026-10-28T10:00:00.000Z"),
          expiresAt: null,
          createdById: "admin-1",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const reply = await feedbackWorkflow.getAnnouncements("akshaya");

      expect(reply.text).toContain("Campus Mess Announcements");
      expect(reply.text).toContain("Diwali Special Feast Dinner");
      expect(reply.text).toContain("7:30 PM");
      expect(reply.buttons).toEqual([
        { id: "MENU_TODAY", title: "Today's Menu" },
        { id: "MENU_MAIN", title: "Main Menu" },
      ]);
    });

    it("returns friendly empty notice when no announcements are published", async () => {
      vi.mocked(prisma.announcement.findMany).mockResolvedValue([]);

      const reply = await feedbackWorkflow.getAnnouncements("akshaya");

      expect(reply.text).toContain("no active notices or announcements");
    });
  });
});
