import { Router } from "express";
import multer from "multer";
import { studentController } from "./student.controller.js";
import { requireAuth } from "../../middleware/session.js";
import { requirePermission } from "../../middleware/permissions.js";
import { BadRequestError } from "../../lib/errors.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (_req, file, cb) => {
    // Accept text/csv, application/vnd.ms-excel, or files ending with .csv
    if (
      file.mimetype === "text/csv" ||
      file.mimetype === "application/vnd.ms-excel" ||
      file.mimetype === "text/plain" ||
      file.originalname.toLowerCase().endsWith(".csv")
    ) {
      cb(null, true);
    } else {
      cb(new BadRequestError("Only CSV files are allowed for roster import"));
    }
  },
});

export const studentRouter = Router();

// All student routes require authentication
studentRouter.use(requireAuth);

// Import CSV roster (supports file upload or raw csvContent)
studentRouter.post(
  "/import",
  requirePermission("student:import"),
  upload.single("file"),
  (req, res, next) => {
    studentController.importRoster(req, res).catch(next);
  },
);

// List students (with search, mess filter, pagination)
studentRouter.get("/", requirePermission("student:view"), (req, res, next) => {
  studentController.list(req, res).catch(next);
});

// Get single student details
studentRouter.get("/:id", requirePermission("student:view"), (req, res, next) => {
  studentController.getById(req, res).catch(next);
});

// Reset WhatsApp identity (unlinks active phone)
studentRouter.post(
  "/:id/reset-whatsapp",
  requirePermission("student:reset_whatsapp"),
  (req, res, next) => {
    studentController.resetWhatsApp(req, res).catch(next);
  },
);
