import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseCsv, maskPhone, StudentService } from "./student.service.js";
import { prisma } from "../../lib/prisma.js";
import { BadRequestError } from "../../lib/errors.js";

// Mock prisma and auditService
vi.mock("../../lib/prisma.js", () => {
  return {
    prisma: {
      mess: {
        findMany: vi.fn(),
      },
      student: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        count: vi.fn(),
        upsert: vi.fn(),
      },
      whatsAppIdentity: {
        deleteMany: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn((ops) => Promise.all(ops)),
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

describe("CSV Parser (RFC 4180)", () => {
  it("parses standard CSV with headers and trimmed fields", () => {
    const csv = `roll_number, name, email, department, mess
CS101, Alice Smith, alice@example.com, Computer Science, Akshaya
CS102, Bob Jones, bob@example.com, Electrical, Akshaya`;

    const { headers, rows } = parseCsv(csv);
    expect(headers).toEqual(["rollNo", "name", "email", "department", "mess"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.data).toEqual({
      rollNo: "CS101",
      name: "Alice Smith",
      email: "alice@example.com",
      department: "Computer Science",
      mess: "Akshaya",
    });
    expect(rows[1]!.lineNumber).toBe(3);
  });

  it("handles CRLF line breaks and Windows formatting", () => {
    const csv =
      "rollNo,name,email,department\r\nCS101,Alice,a@ex.com,CS\r\nCS102,Bob,b@ex.com,EC\r\n";
    const { rows } = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.data["rollNo"]).toBe("CS101");
    expect(rows[1]!.data["rollNo"]).toBe("CS102");
  });

  it("handles quoted fields containing embedded commas and escaped quotes", () => {
    const csv = `roll,student_name,email,dept
CS101,"Doe, John",jdoe@ex.com,"CS, Systems"
CS102,"He said ""Hello""",b@ex.com,EC`;

    const { rows } = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.data["name"]).toBe("Doe, John");
    expect(rows[0]!.data["department"]).toBe("CS, Systems");
    expect(rows[1]!.data["name"]).toBe('He said "Hello"');
  });

  it("ignores UTF-8 BOM", () => {
    const csv = `\uFEFFroll,name,email,department\nCS101,Alice,a@ex.com,CS`;
    const { headers, rows } = parseCsv(csv);
    expect(headers[0]).toBe("rollNo");
    expect(rows).toHaveLength(1);
  });

  it("handles empty lines gracefully", () => {
    const csv = `roll,name,email,department\n\nCS101,Alice,a@ex.com,CS\n\n`;
    const { rows } = parseCsv(csv);
    expect(rows).toHaveLength(1);
  });
});

describe("maskPhone utility", () => {
  it("masks phone numbers correctly", () => {
    expect(maskPhone("+919876543210")).toBe("+919****210");
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone("123")).toBe("***");
  });
});

describe("StudentService.importRoster", () => {
  let service: StudentService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new StudentService();

    // Default mock messes
    vi.mocked(prisma.mess.findMany).mockResolvedValue([
      {
        id: "mess-akshaya",
        code: "AKSHAYA",
        name: "Akshaya Mess",
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "mess-annapoorna",
        code: "ANNAPOORNA",
        name: "Annapoorna Mess",
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
  });

  it("throws BadRequestError if CSV is empty or only headers", async () => {
    await expect(
      service.importRoster("roll,name,email,department", {
        actorId: "admin-1",
      }),
    ).rejects.toThrow(BadRequestError);
  });

  it("throws BadRequestError if required headers are missing", async () => {
    await expect(
      service.importRoster("roll,name\nCS101,Alice", {
        actorId: "admin-1",
      }),
    ).rejects.toThrow(/Missing required columns/);
  });

  it("detects duplicate rolls and invalid emails within CSV", async () => {
    vi.mocked(prisma.student.findMany).mockResolvedValue([]);

    const csv = `roll,name,email,department
CS101,Alice,alice@example.com,CS
CS101,Alice Duplicate,alice2@example.com,CS
CS102,Bob,not-an-email,EC`;

    const result = await service.importRoster(csv, {
      actorId: "admin-1",
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.validRows).toBe(1);
    expect(result.invalidRows).toBe(2);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          line: 3,
          rollNo: "CS101",
          error: expect.stringContaining("Duplicate roll number"),
        }),
        expect.objectContaining({
          line: 4,
          rollNo: "CS102",
          error: expect.stringContaining("Invalid email"),
        }),
      ]),
    );
  });

  it("rejects unknown mess names", async () => {
    vi.mocked(prisma.student.findMany).mockResolvedValue([]);

    const csv = `roll,name,email,department,mess
CS101,Alice,alice@example.com,CS,NonExistentMess`;

    const result = await service.importRoster(csv, {
      actorId: "admin-1",
      dryRun: true,
    });

    expect(result.validRows).toBe(0);
    expect(result.invalidRows).toBe(1);
    expect(result.errors[0]?.error).toContain("Unknown mess 'NonExistentMess'");
  });

  it("performs dry run without writing to database", async () => {
    vi.mocked(prisma.student.findMany).mockResolvedValue([]);

    const csv = `roll,name,email,department,mess
CS101,Alice,alice@example.com,CS,Akshaya
CS102,Bob,bob@example.com,EC,Annapoorna`;

    const result = await service.importRoster(csv, {
      actorId: "admin-1",
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.totalRows).toBe(2);
    expect(result.validRows).toBe(2);
    expect(result.invalidRows).toBe(0);
    expect(result.createdCount).toBe(2);
    expect(result.preview).toHaveLength(2);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("executes live import with upsert and audit logging", async () => {
    vi.mocked(prisma.student.findMany).mockResolvedValue([
      { rollNo: "CS101", id: "existing-student-1" } as unknown as import("@prisma/client").Student,
    ]);

    const csv = `roll,name,email,department,mess
CS101,Alice Updated,alice@example.com,CS,Akshaya
CS102,Bob New,bob@example.com,EC,Akshaya`;

    const result = await service.importRoster(csv, {
      actorId: "admin-1",
      dryRun: false,
    });

    expect(result.dryRun).toBe(false);
    expect(result.validRows).toBe(2);
    expect(result.createdCount).toBe(1);
    expect(result.updatedCount).toBe(1);
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});

describe("StudentService.resetWhatsAppIdentity", () => {
  it("removes WhatsApp identity and logs audit event", async () => {
    const service = new StudentService();

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
      whatsappIdentities: [
        {
          id: "wa-1",
          studentId: "student-1",
          phoneE164: "+919876543210",
          status: "ACTIVE",
          verifiedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    } as unknown as import("@prisma/client").Student & {
      whatsappIdentities: import("@prisma/client").WhatsAppIdentity[];
    });

    vi.mocked(prisma.whatsAppIdentity.deleteMany).mockResolvedValue({ count: 1 });

    const result = await service.resetWhatsAppIdentity("student-1", "admin-1", "127.0.0.1");
    expect(result.success).toBe(true);
    expect(result.unlinkedCount).toBe(1);
    expect(prisma.whatsAppIdentity.deleteMany).toHaveBeenCalledWith({
      where: { studentId: "student-1" },
    });
  });
});
