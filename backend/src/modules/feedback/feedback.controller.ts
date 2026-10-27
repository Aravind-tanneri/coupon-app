import { Request, Response } from "express";
import { feedbackService } from "./feedback.service.js";
import {
  SubmitFeedbackSchema,
  FeedbackListQuerySchema,
  UpdateFeedbackStatusSchema,
} from "./feedback.schemas.js";
import { BadRequestError, UnauthorizedError } from "../../lib/errors.js";

export class FeedbackController {
  async submit(req: Request, res: Response) {
    const input = SubmitFeedbackSchema.parse(req.body);
    const feedback = await feedbackService.submitFeedback(input);

    res.status(201).json({
      success: true,
      data: feedback,
    });
  }

  async list(req: Request, res: Response) {
    if (!req.adminUser) {
      throw new UnauthorizedError();
    }

    const query = FeedbackListQuerySchema.parse(req.query);

    if (req.adminUser.role !== "SUPER_ADMIN" && req.adminUser.messId) {
      query.messId = req.adminUser.messId;
    }

    const result = await feedbackService.listFeedback(query);

    res.status(200).json({
      success: true,
      data: result,
    });
  }

  async getAnalytics(req: Request, res: Response) {
    if (!req.adminUser) {
      throw new UnauthorizedError();
    }

    let targetMessId = req.query.messId as string | undefined;
    if (req.adminUser.role !== "SUPER_ADMIN" && req.adminUser.messId) {
      targetMessId = req.adminUser.messId;
    }

    const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;

    const result = await feedbackService.getFeedbackAnalytics(targetMessId, days);

    res.status(200).json({
      success: true,
      data: result,
    });
  }

  async updateStatus(req: Request, res: Response) {
    if (!req.adminUser) {
      throw new UnauthorizedError();
    }

    const idParam = req.params.id;
    const id = Array.isArray(idParam) ? idParam[0] : idParam;
    if (!id) {
      throw new BadRequestError("Feedback ID is required");
    }

    const input = UpdateFeedbackStatusSchema.parse(req.body);

    const updated = await feedbackService.updateStatus(id, input, req.adminUser.id, req.ip);

    res.status(200).json({
      success: true,
      data: updated,
    });
  }
}

export const feedbackController = new FeedbackController();
