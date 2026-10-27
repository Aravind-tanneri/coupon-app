import { describe, it, expect, vi, beforeEach } from "vitest";
import { FeedbackService } from "./feedback.service.js";
import { prisma } from "../../lib/prisma.js";
import { NotFoundError } from "../../lib/errors.js";

vi.mock("../../lib/prisma.js", () => {
  return {
    prisma: {
      student: {
        findUnique: vi.fn(),
      },
      feedback: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        count: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

vi.mock("../audit/audit.service.js", () => {
  return {
    auditService: {
      log: vi.fn().mockResolvedValue({ id: "audit-1" }),
    },
  };
});

describe("FeedbackService", () => {
  let service: FeedbackService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FeedbackService();
  });

  describe("submitFeedback", () => {
    it("throws NotFoundError if student does not exist", async () => {
      vi.mocked(prisma.student.findUnique).mockResolvedValue(null);

      await expect(
        service.submitFeedback({
          messId: "mess-1",
          studentId: "unknown-student",
          category: "FOOD_QUALITY",
          message: "The food was cold.",
          rating: 2,
          isAnonymous: false,
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it("creates feedback with NEW status", async () => {
      vi.mocked(prisma.student.findUnique).mockResolvedValue({
        id: "student-1",
        rollNo: "CS101",
        name: "Alice",
        email: "alice@example.com",
        department: "CS",
        messId: "mess-1",
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(prisma.feedback.create).mockResolvedValue({
        id: "fb-1",
        messId: "mess-1",
        studentId: "student-1",
        category: "FOOD_QUALITY",
        message: "The food was fresh and warm.",
        rating: 5,
        mealType: "DINNER",
        isAnonymous: false,
        imageDocId: null,
        status: "NEW",
        adminNote: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.submitFeedback({
        messId: "mess-1",
        studentId: "student-1",
        category: "FOOD_QUALITY",
        message: "The food was fresh and warm.",
        rating: 5,
        mealType: "DINNER",
        isAnonymous: false,
      });

      expect(result.id).toBe("fb-1");
      expect(result.status).toBe("NEW");
      expect(result.rating).toBe(5);
    });
  });

  describe("getFeedbackAnalytics", () => {
    it("computes average rating and distribution accurately", async () => {
      vi.mocked(prisma.feedback.findMany).mockResolvedValue([
        {
          category: "FOOD_QUALITY",
          rating: 5,
          mealType: "LUNCH",
          status: "REVIEWED",
          createdAt: new Date(),
        },
        {
          category: "FOOD_QUALITY",
          rating: 4,
          mealType: "LUNCH",
          status: "NEW",
          createdAt: new Date(),
        },
        {
          category: "SERVICE",
          rating: 3,
          mealType: "BREAKFAST",
          status: "NEW",
          createdAt: new Date(),
        },
        {
          category: "OTHER",
          rating: null, // Unrated comment
          mealType: null,
          status: "NEW",
          createdAt: new Date(),
        },
      ] as unknown as import("@prisma/client").Feedback[]);

      const analytics = await service.getFeedbackAnalytics("mess-1", 30);

      expect(analytics.totalCount).toBe(4);
      expect(analytics.ratingCount).toBe(3);
      // (5 + 4 + 3) / 3 = 4.00
      expect(analytics.averageRating).toBe(4.0);
      expect(analytics.ratingDistribution[5]).toBe(1);
      expect(analytics.ratingDistribution[4]).toBe(1);
      expect(analytics.ratingDistribution[3]).toBe(1);
      expect(analytics.ratingDistribution[1]).toBe(0);
      expect(analytics.categoryDistribution["FOOD_QUALITY"]).toBe(2);
      expect(analytics.categoryDistribution["SERVICE"]).toBe(1);
      expect(analytics.statusDistribution["NEW"]).toBe(3);
      expect(analytics.statusDistribution["REVIEWED"]).toBe(1);
    });

    it("returns null average rating when no ratings exist", async () => {
      vi.mocked(prisma.feedback.findMany).mockResolvedValue([]);

      const analytics = await service.getFeedbackAnalytics("mess-1", 7);
      expect(analytics.totalCount).toBe(0);
      expect(analytics.averageRating).toBeNull();
    });
  });

  describe("listFeedback anonymity masking", () => {
    it("masks student identity when isAnonymous is true", async () => {
      vi.mocked(prisma.feedback.count).mockResolvedValue(1);
      vi.mocked(prisma.feedback.findMany).mockResolvedValue([
        {
          id: "fb-1",
          category: "MENU",
          message: "Please include fruits",
          rating: 4,
          mealType: "BREAKFAST",
          isAnonymous: true,
          status: "NEW",
          adminNote: null,
          imageDocId: null,
          createdAt: new Date(),
          mess: { id: "mess-1", code: "AKSHAYA", name: "Akshaya" },
          student: {
            id: "student-1",
            rollNo: "CS101",
            name: "John Doe",
            department: "Computer Science",
          },
        },
      ] as unknown as Array<
        import("@prisma/client").Feedback & {
          mess: { id: string; code: string; name: string };
          student: { id: string; rollNo: string; name: string; department: string };
        }
      >);

      const result = await service.listFeedback({ page: 1, pageSize: 10 });
      expect(result.items[0]!.student.name).toBe("Anonymous Student");
      expect(result.items[0]!.student.rollNo).toBe("ANONYMOUS");
    });
  });
});
