import { Request, Response } from "express";
import { reimbursementService } from "./reimbursement.service.js";
import { policyService } from "./policy.service.js";
import {
  CreatePolicySchema,
  CalculateClaimQuerySchema,
  ApproveClaimSchema,
  RejectClaimSchema,
  RequestInfoSchema,
  RecordPaymentSchema,
  ClaimListQuerySchema,
} from "./reimbursement.schemas.js";
import { UnauthorizedError, BadRequestError } from "../../lib/errors.js";

export class ReimbursementController {
  // Policy Management
  async listPolicies(req: Request, res: Response) {
    if (!req.adminUser) throw new UnauthorizedError();
    const messId = (req.query.messId as string) || req.adminUser.messId || "default";

    const policies = await policyService.listPolicies(messId);
    res.status(200).json({ success: true, data: policies });
  }

  async createPolicy(req: Request, res: Response) {
    if (!req.adminUser) throw new UnauthorizedError();
    const input = CreatePolicySchema.parse(req.body);

    const policy = await policyService.createPolicy(input, req.adminUser.id, req.ip);
    res.status(201).json({ success: true, data: policy });
  }

  // Pure Calculation Preview
  async calculate(req: Request, res: Response) {
    const query = CalculateClaimQuerySchema.parse(req.query);
    const studentId = query.studentId || (req.adminUser?.id ?? "preview");

    const result = await reimbursementService.calculateForStudent(
      studentId,
      query.startDate,
      query.endDate,
    );

    res.status(200).json({ success: true, data: result });
  }

  // Claim Review & Workflow
  async listClaims(req: Request, res: Response) {
    if (!req.adminUser) throw new UnauthorizedError();
    const query = ClaimListQuerySchema.parse(req.query);

    if (req.adminUser.role !== "SUPER_ADMIN" && req.adminUser.messId) {
      query.messId = req.adminUser.messId;
    }

    const result = await reimbursementService.listClaims(query);
    res.status(200).json({ success: true, data: result });
  }

  async getStats(req: Request, res: Response) {
    if (!req.adminUser) throw new UnauthorizedError();
    let messId = req.query.messId as string | undefined;
    if (req.adminUser.role !== "SUPER_ADMIN" && req.adminUser.messId) {
      messId = req.adminUser.messId;
    }

    const stats = await reimbursementService.getStats(messId);
    res.status(200).json({ success: true, data: stats });
  }

  async getClaim(req: Request, res: Response) {
    if (!req.adminUser) throw new UnauthorizedError();
    const idParam = req.params.id;
    const id = Array.isArray(idParam) ? idParam[0] : idParam;
    if (!id) throw new BadRequestError("Claim ID is required");

    const messId =
      req.adminUser.role === "SUPER_ADMIN" ? undefined : (req.adminUser.messId ?? undefined);
    const claim = await reimbursementService.getClaim(id, messId);

    res.status(200).json({ success: true, data: claim });
  }

  async startReview(req: Request, res: Response) {
    if (!req.adminUser) throw new UnauthorizedError();
    const idParam = req.params.id;
    const id = Array.isArray(idParam) ? idParam[0] : idParam;
    if (!id) throw new BadRequestError("Claim ID is required");

    const version = req.body.version ? Number(req.body.version) : undefined;
    const result = await reimbursementService.startReview(id, req.adminUser.id, version, req.ip);

    res.status(200).json({ success: true, data: result });
  }

  async approve(req: Request, res: Response) {
    if (!req.adminUser) throw new UnauthorizedError();
    const idParam = req.params.id;
    const id = Array.isArray(idParam) ? idParam[0] : idParam;
    if (!id) throw new BadRequestError("Claim ID is required");

    const input = ApproveClaimSchema.parse(req.body);
    const messId =
      req.adminUser.role === "SUPER_ADMIN" ? undefined : (req.adminUser.messId ?? undefined);

    const result = await reimbursementService.approveClaim(
      id,
      req.adminUser.id,
      input,
      messId,
      req.ip,
    );
    res.status(200).json({ success: true, data: result });
  }

  async reject(req: Request, res: Response) {
    if (!req.adminUser) throw new UnauthorizedError();
    const idParam = req.params.id;
    const id = Array.isArray(idParam) ? idParam[0] : idParam;
    if (!id) throw new BadRequestError("Claim ID is required");

    const input = RejectClaimSchema.parse(req.body);
    const messId =
      req.adminUser.role === "SUPER_ADMIN" ? undefined : (req.adminUser.messId ?? undefined);

    const result = await reimbursementService.rejectClaim(
      id,
      req.adminUser.id,
      input,
      messId,
      req.ip,
    );
    res.status(200).json({ success: true, data: result });
  }

  async requestInfo(req: Request, res: Response) {
    if (!req.adminUser) throw new UnauthorizedError();
    const idParam = req.params.id;
    const id = Array.isArray(idParam) ? idParam[0] : idParam;
    if (!id) throw new BadRequestError("Claim ID is required");

    const input = RequestInfoSchema.parse(req.body);
    const messId =
      req.adminUser.role === "SUPER_ADMIN" ? undefined : (req.adminUser.messId ?? undefined);

    const result = await reimbursementService.requestInfo(
      id,
      req.adminUser.id,
      input,
      messId,
      req.ip,
    );
    res.status(200).json({ success: true, data: result });
  }

  async recordPayment(req: Request, res: Response) {
    if (!req.adminUser) throw new UnauthorizedError();
    const idParam = req.params.id;
    const id = Array.isArray(idParam) ? idParam[0] : idParam;
    if (!id) throw new BadRequestError("Claim ID is required");

    const input = RecordPaymentSchema.parse(req.body);
    const messId =
      req.adminUser.role === "SUPER_ADMIN" ? undefined : (req.adminUser.messId ?? undefined);

    const result = await reimbursementService.recordPayment(
      id,
      req.adminUser.id,
      input,
      messId,
      req.ip,
    );
    res.status(201).json({ success: true, data: result });
  }
}

export const reimbursementController = new ReimbursementController();
