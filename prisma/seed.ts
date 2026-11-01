import { PrismaClient, AdminRole, MealType } from "@prisma/client";
import { hashPassword } from "../backend/src/lib/crypto.js";
import { parseDateIST } from "../backend/src/lib/dates-ist.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log("Starting database seed...");

  // 1. Seed Akshaya Mess (Multi-mess schema ready; Akshaya is live in v1)
  const akshaya = await prisma.mess.upsert({
    where: { code: "AKSHAYA" },
    update: { name: "Akshaya Mess", active: true },
    create: {
      code: "AKSHAYA",
      name: "Akshaya Mess",
      active: true,
    },
  });
  console.log(`✓ Mess seeded: ${akshaya.name} (${akshaya.code})`);

  // 2. Seed SUPER_ADMIN
  const rawAdminPassword = process.env.SUPER_ADMIN_PASSWORD || "SuperAdminPassword123!";
  const passwordHash = await hashPassword(rawAdminPassword);
  const superAdmin = await prisma.adminUser.upsert({
    where: { email: "admin@campus.edu" },
    update: {
      role: AdminRole.SUPER_ADMIN,
      name: "Campus Mess Super Admin",
      passwordHash,
      messId: akshaya.id,
      active: true,
    },
    create: {
      email: "admin@campus.edu",
      name: "Campus Mess Super Admin",
      role: AdminRole.SUPER_ADMIN,
      passwordHash,
      messId: akshaya.id,
      active: true,
    },
  });
  console.log(`✓ Super Admin seeded: ${superAdmin.email}`);

  // 2b. Seed MESS_STAFF for counter operations
  const rawStaffPassword = process.env.STAFF_PASSWORD || "StaffPassword123!";
  const staffPasswordHash = await hashPassword(rawStaffPassword);
  const counterStaff = await prisma.adminUser.upsert({
    where: { email: "staff@campus.edu" },
    update: {
      role: AdminRole.MESS_STAFF,
      name: "Akshaya Counter Staff",
      passwordHash: staffPasswordHash,
      messId: akshaya.id,
      active: true,
    },
    create: {
      email: "staff@campus.edu",
      name: "Akshaya Counter Staff",
      role: AdminRole.MESS_STAFF,
      passwordHash: staffPasswordHash,
      messId: akshaya.id,
      active: true,
    },
  });
  console.log(`✓ Mess Staff seeded: ${counterStaff.email}`);

  // 3. Seed Reimbursement Policy (₹131/day, min 4 days)
  const existingPolicy = await prisma.reimbursementPolicy.findFirst({
    where: { messId: akshaya.id, effectiveUntil: null },
  });

  if (!existingPolicy) {
    const policy = await prisma.reimbursementPolicy.create({
      data: {
        messId: akshaya.id,
        dailyRatePaise: 13100, // ₹131 in paise
        minAbsenceDays: 4,
        effectiveFrom: parseDateIST("2026-01-01"),
        claimDeadlineDays: 30,
        documentRequired: false,
        createdById: superAdmin.id,
      },
    });
    console.log(`✓ Reimbursement Policy seeded: ₹${policy.dailyRatePaise / 100}/day`);
  } else {
    console.log(`✓ Active Reimbursement Policy already exists for ${akshaya.code}`);
  }

  // 4. Seed Coupon Products (EXTRA_LUNCH, EXTRA_DINNER)
  const products = [
    {
      code: "EXTRA_LUNCH",
      mealType: MealType.LUNCH,
      pricePaise: 5000, // ₹50
      dailyCap: 100,
    },
    {
      code: "EXTRA_DINNER",
      mealType: MealType.DINNER,
      pricePaise: 5000, // ₹50
      dailyCap: 100,
    },
  ];

  for (const prod of products) {
    const p = await prisma.couponProduct.upsert({
      where: {
        messId_code: {
          messId: akshaya.id,
          code: prod.code,
        },
      },
      update: {
        pricePaise: prod.pricePaise,
        mealType: prod.mealType,
        active: true,
        dailyCap: prod.dailyCap,
      },
      create: {
        messId: akshaya.id,
        code: prod.code,
        mealType: prod.mealType,
        pricePaise: prod.pricePaise,
        active: true,
        dailyCap: prod.dailyCap,
      },
    });
    console.log(`✓ Coupon product seeded: ${p.code} (₹${p.pricePaise / 100})`);
  }

  // 5. Dev-only Sample Students (never in production)
  if (process.env.NODE_ENV !== "production") {
    const sampleStudents = [
      {
        rollNo: "2024CS001",
        name: "Aarav Sharma",
        email: "aarav.cs24@campus.edu",
        department: "Computer Science",
      },
      {
        rollNo: "2024EC002",
        name: "Bhavna Patel",
        email: "bhavna.ec24@campus.edu",
        department: "Electronics & Communication",
      },
      {
        rollNo: "2024ME003",
        name: "Chirag Verma",
        email: "chirag.me24@campus.edu",
        department: "Mechanical Engineering",
      },
    ];

    for (const student of sampleStudents) {
      await prisma.student.upsert({
        where: { rollNo: student.rollNo },
        update: {
          name: student.name,
          email: student.email,
          department: student.department,
          messId: akshaya.id,
          active: true,
        },
        create: {
          rollNo: student.rollNo,
          name: student.name,
          email: student.email,
          department: student.department,
          messId: akshaya.id,
          active: true,
        },
      });
    }
    console.log(`✓ ${sampleStudents.length} sample students seeded for development`);
  }

  console.log("Database seed completed successfully.");
}

main()
  .catch((e) => {
    console.error("Database seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
