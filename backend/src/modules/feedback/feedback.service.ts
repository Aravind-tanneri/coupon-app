import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { NotFoundError } from "../../lib/errors.js";
import { auditService } from "../audit/audit.service.js";
import {
  SubmitFeedbackInput,
  FeedbackListQuery,
  UpdateFeedbackStatusInput,
} from "./feedback.schemas.js";

export class FeedbackService {
  /**
   * Records student feedback.
   */
  async submitFeedback(input: SubmitFeedbackInput) {
    const student = await prisma.student.findUnique({
      where: { id: input.studentId },
    });
    if (!student) {
      throw new NotFoundError(`Student with ID ${input.studentId} not found`);
    }

    const feedback = await prisma.feedback.create({
      data: {
        messId: input.messId,
        studentId: input.studentId,
        category: input.category,
        message: input.message,
        rating: input.rating,
        mealType: input.mealType,
        isAnonymous: input.isAnonymous,
        imageDocId: input.imageDocId,
        status: "NEW",
      },
    });

    return feedback;
  }

  /**
   * Paginated feedback list with multi-parameter filtering and anonymity handling.
   */
  async listFeedback(query: FeedbackListQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.FeedbackWhereInput = {};

    if (query.messId) where.messId = query.messId;
    if (query.status) where.status = query.status;
    if (query.category) where.category = query.category;
    if (query.rating) where.rating = query.rating;
    if (query.mealType) where.mealType = query.mealType;

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        where.createdAt.gte = new Date(`${query.startDate}T00:00:00.000Z`);
      }
      if (query.endDate) {
        where.createdAt.lte = new Date(`${query.endDate}T23:59:59.999Z`);
      }
    }

    const [total, items] = await Promise.all([
      prisma.feedback.count({ where }),
      prisma.feedback.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        include: {
          mess: { select: { id: true, code: true, name: true } },
          student: {
            select: { id: true, rollNo: true, name: true, department: true },
          },
        },
      }),
    ]);

    const formatted = items.map((f) => {
      const studentInfo = f.isAnonymous
        ? {
            id: "anonymous",
            rollNo: "ANONYMOUS",
            name: "Anonymous Student",
            department: "—",
          }
        : f.student;

      return {
        id: f.id,
        category: f.category,
        message: f.message,
        rating: f.rating,
        mealType: f.mealType,
        isAnonymous: f.isAnonymous,
        status: f.status,
        adminNote: f.adminNote,
        imageDocId: f.imageDocId,
        createdAt: f.createdAt,
        mess: f.mess,
        student: studentInfo,
      };
    });

    return {
      items: formatted,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Computes feedback analytics and aggregation math for metrics cards and charts.
   */
  async getFeedbackAnalytics(messId?: string, days = 30) {
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const where: Prisma.FeedbackWhereInput = {
      createdAt: { gte: sinceDate },
    };
    if (messId) {
      where.messId = messId;
    }

    const feedbacks = await prisma.feedback.findMany({
      where,
      select: {
        category: true,
        rating: true,
        mealType: true,
        status: true,
        createdAt: true,
      },
    });

    const totalCount = feedbacks.length;
    let sumRating = 0;
    let ratingCount = 0;

    const ratingDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const categoryDistribution: Record<string, number> = {};
    const mealDistribution: Record<string, number> = {};
    const statusDistribution: Record<string, number> = {
      NEW: 0,
      REVIEWED: 0,
      RESOLVED: 0,
    };

    feedbacks.forEach((f) => {
      // Rating math
      if (f.rating !== null && f.rating >= 1 && f.rating <= 5) {
        sumRating += f.rating;
        ratingCount++;
        ratingDistribution[f.rating] = (ratingDistribution[f.rating] || 0) + 1;
      }

      // Category counts
      categoryDistribution[f.category] = (categoryDistribution[f.category] || 0) + 1;

      // Meal counts
      if (f.mealType) {
        mealDistribution[f.mealType] = (mealDistribution[f.mealType] || 0) + 1;
      }

      // Status counts
      statusDistribution[f.status] = (statusDistribution[f.status] || 0) + 1;
    });

    const averageRating = ratingCount > 0 ? parseFloat((sumRating / ratingCount).toFixed(2)) : null;

    return {
      totalCount,
      ratingCount,
      averageRating,
      ratingDistribution,
      categoryDistribution,
      mealDistribution,
      statusDistribution,
      daysAnalyzed: days,
    };
  }

  /**
   * Updates feedback review status and administrative response note.
   */
  async updateStatus(id: string, input: UpdateFeedbackStatusInput, actorId: string, ip?: string) {
    const existing = await prisma.feedback.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundError(`Feedback with ID ${id} not found`);
    }

    const updated = await prisma.feedback.update({
      where: { id },
      data: {
        status: input.status,
        adminNote: input.adminNote,
      },
    });

    await auditService.log({
      actorType: "ADMIN",
      actorId,
      action: "FEEDBACK_STATUS_UPDATED",
      entityType: "Feedback",
      entityId: id,
      before: { status: existing.status, adminNote: existing.adminNote },
      after: { status: updated.status, adminNote: updated.adminNote },
      ip,
    });

    return updated;
  }
}

export const feedbackService = new FeedbackService();
