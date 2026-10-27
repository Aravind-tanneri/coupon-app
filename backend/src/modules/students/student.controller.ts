import { Request, Response } from "express";
import { studentService } from "./student.service.js";
import { StudentListQuerySchema, StudentRosterImportOptionsSchema } from "./student.schemas.js";
import { BadRequestError, UnauthorizedError } from "../../lib/errors.js";

export class StudentController {
  async importRoster(req: Request, res: Response) {
    if (!req.adminUser) {
      throw new UnauthorizedError();
    }

    let csvContent = "";

    // If uploaded via multipart/form-data
    if (req.file && req.file.buffer) {
      csvContent = req.file.buffer.toString("utf-8");
    } else if (typeof req.body?.csvContent === "string") {
      csvContent = req.body.csvContent;
    } else if (typeof req.body === "string") {
      csvContent = req.body;
    }

    if (!csvContent || csvContent.trim().length === 0) {
      throw new BadRequestError("No CSV content provided. Upload a file or provide csvContent.");
    }

    const options = StudentRosterImportOptionsSchema.parse({
      dryRun: req.query.dryRun ?? req.body?.dryRun,
      defaultMessId: req.query.defaultMessId ?? req.body?.defaultMessId,
    });

    const result = await studentService.importRoster(csvContent, {
      dryRun: options.dryRun,
      defaultMessId: options.defaultMessId,
      actorId: req.adminUser.id,
      actorMessId: req.adminUser.messId,
      ip: req.ip,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  }

  async list(req: Request, res: Response) {
    if (!req.adminUser) {
      throw new UnauthorizedError();
    }

    const query = StudentListQuerySchema.parse(req.query);

    // If user is restricted to a mess and not super admin, enforce their messId
    if (req.adminUser.role !== "SUPER_ADMIN" && req.adminUser.messId) {
      query.messId = req.adminUser.messId;
    }

    const result = await studentService.listStudents(query);

    res.status(200).json({
      success: true,
      data: result,
    });
  }

  async getById(req: Request, res: Response) {
    if (!req.adminUser) {
      throw new UnauthorizedError();
    }

    const idParam = req.params.id;
    const id = Array.isArray(idParam) ? idParam[0] : idParam;
    if (!id) {
      throw new BadRequestError("Student ID is required");
    }

    const student = await studentService.getStudentById(id);

    // Mess boundary check
    if (
      req.adminUser.role !== "SUPER_ADMIN" &&
      req.adminUser.messId &&
      student.mess.id !== req.adminUser.messId
    ) {
      throw new UnauthorizedError("You do not have access to students of this mess");
    }

    res.status(200).json({
      success: true,
      data: student,
    });
  }

  async resetWhatsApp(req: Request, res: Response) {
    if (!req.adminUser) {
      throw new UnauthorizedError();
    }

    const idParam = req.params.id;
    const id = Array.isArray(idParam) ? idParam[0] : idParam;
    if (!id) {
      throw new BadRequestError("Student ID is required");
    }

    // Check access first
    const student = await studentService.getStudentById(id);
    if (
      req.adminUser.role !== "SUPER_ADMIN" &&
      req.adminUser.messId &&
      student.mess.id !== req.adminUser.messId
    ) {
      throw new UnauthorizedError("You do not have access to students of this mess");
    }

    const result = await studentService.resetWhatsAppIdentity(id, req.adminUser.id, req.ip);

    res.status(200).json({
      success: true,
      data: result,
    });
  }
}

export const studentController = new StudentController();
