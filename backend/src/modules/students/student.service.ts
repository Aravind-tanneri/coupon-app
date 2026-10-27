import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError, BadRequestError, NotFoundError } from "../../lib/errors.js";
import { auditService } from "../audit/audit.service.js";
import { StudentCsvRowSchema, StudentCsvRow, StudentListQuery } from "./student.schemas.js";

export interface CsvParseResult {
  headers: string[];
  rows: Array<{
    lineNumber: number;
    data: Record<string, string>;
  }>;
}

export interface ImportErrorDetail {
  line: number;
  rollNo?: string;
  error: string;
}

export interface ImportRosterResult {
  dryRun: boolean;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  createdCount: number;
  updatedCount: number;
  errors: ImportErrorDetail[];
  preview?: Array<{
    rollNo: string;
    name: string;
    email: string;
    department: string;
    messName: string;
    action: "CREATE" | "UPDATE";
  }>;
}

/**
 * Parses raw CSV content adhering to RFC 4180.
 * Handles quoted fields, embedded commas, escaped quotes, CRLF/LF, and BOM.
 */
export function parseCsv(text: string): CsvParseResult {
  const cleanText = text.replace(/^\uFEFF/, ""); // Remove UTF-8 BOM if present
  const lines: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  let i = 0;
  while (i < cleanText.length) {
    const char = cleanText[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < cleanText.length && cleanText[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === ",") {
        currentRow.push(currentField.trim());
        currentField = "";
        i++;
        continue;
      } else if (char === "\r") {
        if (i + 1 < cleanText.length && cleanText[i + 1] === "\n") {
          i++;
        }
        currentRow.push(currentField.trim());
        lines.push(currentRow);
        currentRow = [];
        currentField = "";
        i++;
        continue;
      } else if (char === "\n") {
        currentRow.push(currentField.trim());
        lines.push(currentRow);
        currentRow = [];
        currentField = "";
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    lines.push(currentRow);
  }

  // Filter out empty lines
  const nonEmptyLines = lines.filter((row) => row.some((field) => field.length > 0));

  if (nonEmptyLines.length === 0) {
    return { headers: [], rows: [] };
  }

  const rawHeaders = nonEmptyLines[0]!;
  const normalizedHeaders = rawHeaders.map((h) => normalizeHeaderName(h));

  const rows: CsvParseResult["rows"] = [];
  for (let idx = 1; idx < nonEmptyLines.length; idx++) {
    const lineNum = idx + 1; // 1-indexed (header is line 1)
    const rawRow = nonEmptyLines[idx]!;
    const rowData: Record<string, string> = {};

    normalizedHeaders.forEach((header, colIdx) => {
      rowData[header] = rawRow[colIdx] ?? "";
    });

    rows.push({
      lineNumber: lineNum,
      data: rowData,
    });
  }

  return {
    headers: normalizedHeaders,
    rows,
  };
}

function normalizeHeaderName(header: string): string {
  const clean = header.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (clean === "rollnumber" || clean === "rollno" || clean === "roll") return "rollNo";
  if (clean === "studentname" || clean === "fullname" || clean === "name") return "name";
  if (clean === "email" || clean === "emailaddress") return "email";
  if (clean === "department" || clean === "dept" || clean === "branch") return "department";
  if (clean === "mess" || clean === "messname" || clean === "messcode") return "mess";
  return clean;
}

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/\s+/g, "");
  if (cleaned.length < 8) return "***";
  const start = cleaned.slice(0, 4);
  const end = cleaned.slice(-3);
  return `${start}****${end}`;
}

export class StudentService {
  /**
   * Imports or previews a student roster from CSV content.
   */
  async importRoster(
    csvContent: string,
    options: {
      dryRun?: boolean;
      defaultMessId?: string;
      actorId: string;
      actorMessId?: string | null;
      ip?: string;
    },
  ): Promise<ImportRosterResult> {
    const isDryRun = options.dryRun ?? false;
    const { headers, rows } = parseCsv(csvContent);

    if (rows.length === 0) {
      throw new BadRequestError("CSV file is empty or contains only headers");
    }

    // Validate required headers
    const requiredHeaders = ["rollNo", "name", "email", "department"];
    const missingHeaders = requiredHeaders.filter((h) => !headers.includes(h));
    if (missingHeaders.length > 0) {
      throw new BadRequestError(
        `Missing required columns in CSV header: ${missingHeaders.join(", ")}`,
      );
    }

    // Pre-fetch all active messes to resolve mess codes/names
    const allMesses = await prisma.mess.findMany({
      where: { active: true },
      select: { id: true, code: true, name: true },
    });

    if (allMesses.length === 0) {
      throw new AppError(
        500,
        "NO_ACTIVE_MESS",
        "No active mess found in system to assign students to",
      );
    }

    const messByCodeOrName = new Map<string, { id: string; name: string }>();
    allMesses.forEach((m) => {
      messByCodeOrName.set(m.code.toLowerCase(), { id: m.id, name: m.name });
      messByCodeOrName.set(m.name.toLowerCase(), { id: m.id, name: m.name });
      messByCodeOrName.set(m.id, { id: m.id, name: m.name });
    });

    // Default fallback mess if not specified in CSV row
    let defaultMess = allMesses[0]!;
    if (options.defaultMessId) {
      const found = allMesses.find((m) => m.id === options.defaultMessId);
      if (found) defaultMess = found;
    } else if (options.actorMessId) {
      const found = allMesses.find((m) => m.id === options.actorMessId);
      if (found) defaultMess = found;
    }

    const errors: ImportErrorDetail[] = [];
    const validRows: Array<{
      line: number;
      data: StudentCsvRow;
      messId: string;
      messName: string;
    }> = [];

    const seenRollsInCsv = new Set<string>();
    const seenEmailsInCsv = new Set<string>();

    for (const row of rows) {
      // Validate schema
      const parseResult = StudentCsvRowSchema.safeParse({
        rollNo: row.data["rollNo"],
        name: row.data["name"],
        email: row.data["email"],
        department: row.data["department"],
        mess: row.data["mess"],
      });

      if (!parseResult.success) {
        errors.push({
          line: row.lineNumber,
          rollNo: row.data["rollNo"] || undefined,
          error: parseResult.error.issues.map((i) => i.message).join("; "),
        });
        continue;
      }

      const validData = parseResult.data;

      // Duplicate check within CSV
      if (seenRollsInCsv.has(validData.rollNo)) {
        errors.push({
          line: row.lineNumber,
          rollNo: validData.rollNo,
          error: `Duplicate roll number '${validData.rollNo}' in CSV`,
        });
        continue;
      }
      seenRollsInCsv.add(validData.rollNo);

      if (seenEmailsInCsv.has(validData.email)) {
        errors.push({
          line: row.lineNumber,
          rollNo: validData.rollNo,
          error: `Duplicate email '${validData.email}' in CSV`,
        });
        continue;
      }
      seenEmailsInCsv.add(validData.email);

      // Resolve Mess
      let assignedMessId = defaultMess.id;
      let assignedMessName = defaultMess.name;

      if (validData.mess) {
        const resolved = messByCodeOrName.get(validData.mess.toLowerCase());
        if (!resolved) {
          errors.push({
            line: row.lineNumber,
            rollNo: validData.rollNo,
            error: `Unknown mess '${validData.mess}'`,
          });
          continue;
        }
        assignedMessId = resolved.id;
        assignedMessName = resolved.name;
      }

      validRows.push({
        line: row.lineNumber,
        data: validData,
        messId: assignedMessId,
        messName: assignedMessName,
      });
    }

    // Check existing students to determine create vs update
    const existingStudents = await prisma.student.findMany({
      where: {
        rollNo: { in: Array.from(seenRollsInCsv) },
      },
      select: { rollNo: true, id: true },
    });
    const existingRolls = new Set(existingStudents.map((s) => s.rollNo));

    const preview = validRows.slice(0, 50).map((r) => ({
      rollNo: r.data.rollNo,
      name: r.data.name,
      email: r.data.email,
      department: r.data.department,
      messName: r.messName,
      action: (existingRolls.has(r.data.rollNo) ? "UPDATE" : "CREATE") as "CREATE" | "UPDATE",
    }));

    let createdCount = 0;
    let updatedCount = 0;

    validRows.forEach((r) => {
      if (existingRolls.has(r.data.rollNo)) {
        updatedCount++;
      } else {
        createdCount++;
      }
    });

    if (!isDryRun && validRows.length > 0) {
      // Execute in transactions
      await prisma.$transaction(
        validRows.map((r) =>
          prisma.student.upsert({
            where: { rollNo: r.data.rollNo },
            update: {
              name: r.data.name,
              email: r.data.email,
              department: r.data.department,
              messId: r.messId,
              active: true,
            },
            create: {
              rollNo: r.data.rollNo,
              name: r.data.name,
              email: r.data.email,
              department: r.data.department,
              messId: r.messId,
              active: true,
            },
          }),
        ),
      );

      // Audit log
      await auditService.log({
        actorType: "ADMIN",
        actorId: options.actorId,
        action: "STUDENT_ROSTER_IMPORTED",
        entityType: "Student",
        entityId: "roster-import",
        after: {
          totalRows: rows.length,
          validRows: validRows.length,
          createdCount,
          updatedCount,
          errorCount: errors.length,
          messId: options.actorMessId || defaultMess.id,
        },
        ip: options.ip,
      });
    }

    return {
      dryRun: isDryRun,
      totalRows: rows.length,
      validRows: validRows.length,
      invalidRows: errors.length,
      createdCount,
      updatedCount,
      errors,
      preview: isDryRun ? preview : undefined,
    };
  }

  /**
   * Paginated list of students with search, filter, and masked phone numbers.
   */
  async listStudents(query: StudentListQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.StudentWhereInput = {};

    if (query.active !== undefined) {
      where.active = query.active;
    }

    if (query.messId) {
      where.messId = query.messId;
    }

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { rollNo: { contains: term, mode: "insensitive" } },
        { name: { contains: term, mode: "insensitive" } },
        { email: { contains: term, mode: "insensitive" } },
        { department: { contains: term, mode: "insensitive" } },
      ];
    }

    const [total, students] = await Promise.all([
      prisma.student.count({ where }),
      prisma.student.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ rollNo: "asc" }],
        include: {
          mess: { select: { id: true, code: true, name: true } },
          whatsappIdentities: {
            where: { status: "ACTIVE" },
            select: { id: true, phoneE164: true, status: true, verifiedAt: true },
          },
        },
      }),
    ]);

    const items = students.map((s) => {
      const activeIdentity = s.whatsappIdentities[0];
      return {
        id: s.id,
        rollNo: s.rollNo,
        name: s.name,
        email: s.email,
        department: s.department,
        active: s.active,
        mess: s.mess,
        whatsappStatus: activeIdentity ? "LINKED" : "NOT_LINKED",
        whatsappPhoneMasked: maskPhone(activeIdentity?.phoneE164),
        whatsappVerifiedAt: activeIdentity?.verifiedAt ?? null,
        createdAt: s.createdAt,
      };
    });

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Fetches single student by ID with full details.
   */
  async getStudentById(id: string) {
    const student = await prisma.student.findUnique({
      where: { id },
      include: {
        mess: { select: { id: true, code: true, name: true } },
        whatsappIdentities: {
          select: { id: true, phoneE164: true, status: true, verifiedAt: true },
        },
      },
    });

    if (!student) {
      throw new NotFoundError(`Student with ID ${id} not found`);
    }

    const activeIdentity = student.whatsappIdentities.find((w) => w.status === "ACTIVE");

    return {
      id: student.id,
      rollNo: student.rollNo,
      name: student.name,
      email: student.email,
      department: student.department,
      active: student.active,
      mess: student.mess,
      whatsappStatus: activeIdentity ? "LINKED" : "NOT_LINKED",
      whatsappPhoneMasked: maskPhone(activeIdentity?.phoneE164),
      whatsappVerifiedAt: activeIdentity?.verifiedAt ?? null,
      createdAt: student.createdAt,
      updatedAt: student.updatedAt,
    };
  }

  /**
   * Resets (unlinks) a student's WhatsApp identity and records an audit log.
   */
  async resetWhatsAppIdentity(
    studentId: string,
    actorId: string,
    ip?: string,
  ): Promise<{ success: boolean; unlinkedCount: number }> {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: { whatsappIdentities: true },
    });

    if (!student) {
      throw new NotFoundError(`Student with ID ${studentId} not found`);
    }

    if (student.whatsappIdentities.length === 0) {
      return { success: true, unlinkedCount: 0 };
    }

    const deleted = await prisma.whatsAppIdentity.deleteMany({
      where: { studentId },
    });

    await auditService.log({
      actorType: "ADMIN",
      actorId,
      action: "STUDENT_WHATSAPP_RESET",
      entityType: "Student",
      entityId: studentId,
      after: {
        rollNo: student.rollNo,
        studentName: student.name,
        identitiesRemoved: deleted.count,
        messId: student.messId,
      },
      ip,
    });

    return { success: true, unlinkedCount: deleted.count };
  }
}

export const studentService = new StudentService();
