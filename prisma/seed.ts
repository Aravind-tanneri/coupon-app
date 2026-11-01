import {
  PrismaClient,
  AdminRole,
  MealType,
  CouponStatus,
  OrderStatus,
  ReimbursementStatus,
  PaymentMethod,
  FeedbackCategory,
  FeedbackStatus,
  NotificationChannel,
  NotificationStatus,
} from "@prisma/client";
import crypto from "crypto";
import { hashPassword } from "../backend/src/lib/crypto.js";
import { parseDateIST, formatDateIST } from "../backend/src/lib/dates-ist.js";
import { generateToken, hashToken, generateShortCode } from "../backend/src/lib/tokens.js";

const prisma = new PrismaClient();

// Helper to encrypt payout details for demo claims
function encryptDemoPayout(plaintext: string): string {
  const ALGORITHM = "aes-256-gcm";
  const IV_LENGTH = 12;
  const secret = process.env.PAYOUT_ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef";
  const key = crypto.createHash("sha256").update(secret).digest();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

async function main(): Promise<void> {
  console.log("==================================================");
  console.log("🚀 Starting Campus Mess Comprehensive Demo Seeder");
  console.log("==================================================");

  // ----------------------------------------------------
  // 1. Messes (Akshaya & Kamadhenu)
  // ----------------------------------------------------
  const akshaya = await prisma.mess.upsert({
    where: { code: "AKSHAYA" },
    update: { name: "Akshaya Mess", active: true },
    create: {
      code: "AKSHAYA",
      name: "Akshaya Mess",
      active: true,
    },
  });

  const kamadhenu = await prisma.mess.upsert({
    where: { code: "KAMADHENU" },
    update: { name: "Kamadhenu Mess", active: true },
    create: {
      code: "KAMADHENU",
      name: "Kamadhenu Mess",
      active: true,
    },
  });
  console.log(`✓ Messes seeded: ${akshaya.name} (${akshaya.code}) & ${kamadhenu.name} (${kamadhenu.code})`);

  // ----------------------------------------------------
  // 2. Admin Users & Mess Staff
  // ----------------------------------------------------
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

  const messManager = await prisma.adminUser.upsert({
    where: { email: "manager@campus.edu" },
    update: {
      role: AdminRole.ADMIN,
      name: "Rajesh Sharma (Catering Manager)",
      passwordHash: staffPasswordHash,
      messId: akshaya.id,
      active: true,
    },
    create: {
      email: "manager@campus.edu",
      name: "Rajesh Sharma (Catering Manager)",
      role: AdminRole.ADMIN,
      passwordHash: staffPasswordHash,
      messId: akshaya.id,
      active: true,
    },
  });
  console.log(`✓ Admin users seeded: ${superAdmin.email}, ${counterStaff.email}, ${messManager.email}`);

  // ----------------------------------------------------
  // 3. Settings (Meal Windows)
  // ----------------------------------------------------
  await prisma.setting.upsert({
    where: {
      messId_key: {
        messId: akshaya.id,
        key: "mealWindows",
      },
    },
    update: {
      value: {
        BREAKFAST: { start: "07:00", end: "10:30" },
        LUNCH: { start: "12:00", end: "15:00" },
        SNACKS: { start: "16:30", end: "18:30" },
        DINNER: { start: "19:00", end: "22:30" },
        SPECIAL_DINNER: { start: "19:00", end: "22:30" },
      },
    },
    create: {
      messId: akshaya.id,
      key: "mealWindows",
      value: {
        BREAKFAST: { start: "07:00", end: "10:30" },
        LUNCH: { start: "12:00", end: "15:00" },
        SNACKS: { start: "16:30", end: "18:30" },
        DINNER: { start: "19:00", end: "22:30" },
        SPECIAL_DINNER: { start: "19:00", end: "22:30" },
      },
    },
  });

  // ----------------------------------------------------
  // 4. Reimbursement Policies
  // ----------------------------------------------------
  let akshayaPolicy = await prisma.reimbursementPolicy.findFirst({
    where: { messId: akshaya.id, effectiveUntil: null },
  });

  if (!akshayaPolicy) {
    akshayaPolicy = await prisma.reimbursementPolicy.create({
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
  }

  let kamadhenuPolicy = await prisma.reimbursementPolicy.findFirst({
    where: { messId: kamadhenu.id, effectiveUntil: null },
  });

  if (!kamadhenuPolicy) {
    kamadhenuPolicy = await prisma.reimbursementPolicy.create({
      data: {
        messId: kamadhenu.id,
        dailyRatePaise: 13100,
        minAbsenceDays: 4,
        effectiveFrom: parseDateIST("2026-01-01"),
        claimDeadlineDays: 30,
        documentRequired: false,
        createdById: superAdmin.id,
      },
    });
  }
  console.log(`✓ Active Reimbursement Policies seeded: ₹${akshayaPolicy.dailyRatePaise / 100}/day`);

  // ----------------------------------------------------
  // 5. Coupon Products
  // ----------------------------------------------------
  const productConfigs = [
    { code: "EXTRA_BREAKFAST", mealType: MealType.BREAKFAST, pricePaise: 3000, dailyCap: 60, messId: akshaya.id },
    { code: "EXTRA_LUNCH", mealType: MealType.LUNCH, pricePaise: 5000, dailyCap: 120, messId: akshaya.id },
    { code: "EXTRA_SNACKS", mealType: MealType.SNACKS, pricePaise: 2500, dailyCap: 80, messId: akshaya.id },
    { code: "EXTRA_DINNER", mealType: MealType.DINNER, pricePaise: 5000, dailyCap: 120, messId: akshaya.id },
    { code: "SPECIAL_DINNER", mealType: MealType.SPECIAL_DINNER, pricePaise: 8000, dailyCap: 150, messId: akshaya.id },
    { code: "EXTRA_LUNCH", mealType: MealType.LUNCH, pricePaise: 5000, dailyCap: 100, messId: kamadhenu.id },
    { code: "EXTRA_DINNER", mealType: MealType.DINNER, pricePaise: 5000, dailyCap: 100, messId: kamadhenu.id },

    // Add-On Dishes & Special Curries
    { code: "EGG_BURJI", mealType: MealType.DINNER, pricePaise: 2500, dailyCap: 100, messId: akshaya.id },
    { code: "EGG_CURRY", mealType: MealType.DINNER, pricePaise: 3000, dailyCap: 100, messId: akshaya.id },
    { code: "PANEER_CURRY", mealType: MealType.DINNER, pricePaise: 4500, dailyCap: 100, messId: akshaya.id },
    { code: "CHICKEN_CURRY", mealType: MealType.DINNER, pricePaise: 5500, dailyCap: 100, messId: akshaya.id },

    { code: "EGG_BURJI", mealType: MealType.DINNER, pricePaise: 2500, dailyCap: 100, messId: kamadhenu.id },
    { code: "EGG_CURRY", mealType: MealType.DINNER, pricePaise: 3000, dailyCap: 100, messId: kamadhenu.id },
    { code: "PANEER_CURRY", mealType: MealType.DINNER, pricePaise: 4500, dailyCap: 100, messId: kamadhenu.id },
    { code: "CHICKEN_CURRY", mealType: MealType.DINNER, pricePaise: 5500, dailyCap: 100, messId: kamadhenu.id },
  ];

  const productMap = new Map<string, any>();
  for (const prod of productConfigs) {
    const p = await prisma.couponProduct.upsert({
      where: {
        messId_code: {
          messId: prod.messId,
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
        messId: prod.messId,
        code: prod.code,
        mealType: prod.mealType,
        pricePaise: prod.pricePaise,
        active: true,
        dailyCap: prod.dailyCap,
      },
    });
    productMap.set(`${prod.messId}:${prod.code}`, p);
  }
  console.log(`✓ Coupon products seeded for Akshaya & Kamadhenu messes`);

  // ----------------------------------------------------
  // 6. Comprehensive Student Roster (24 students)
  // ----------------------------------------------------
  const sampleStudents = [
    { rollNo: "2024CS001", name: "Aarav Sharma", email: "aarav.cs24@campus.edu", department: "Computer Science", phone: "+919876500001" },
    { rollNo: "2024CS002", name: "Bhavna Patel", email: "bhavna.cs24@campus.edu", department: "Computer Science", phone: "+919876500002" },
    { rollNo: "2024CS003", name: "Chirag Verma", email: "chirag.cs24@campus.edu", department: "Computer Science", phone: "+919876500003" },
    { rollNo: "2024CS004", name: "Ritu Banerjee", email: "ritu.cs24@campus.edu", department: "Computer Science", phone: "+919876500004" },
    { rollNo: "2024CS005", name: "Rohan Kapoor", email: "rohan.cs24@campus.edu", department: "Computer Science", phone: null },
    { rollNo: "2024EC001", name: "Deepa Nair", email: "deepa.ec24@campus.edu", department: "Electronics & Communication", phone: "+919876500006" },
    { rollNo: "2024EC002", name: "Eshwar Reddy", email: "eshwar.ec24@campus.edu", department: "Electronics & Communication", phone: "+919876500007" },
    { rollNo: "2024EC003", name: "Fatima Sheikh", email: "fatima.ec24@campus.edu", department: "Electronics & Communication", phone: "+919876500008" },
    { rollNo: "2024EC004", name: "Sneha Kulkarni", email: "sneha.ec24@campus.edu", department: "Electronics & Communication", phone: "+919876500009" },
    { rollNo: "2024ME001", name: "Gautham Krishna", email: "gautham.me24@campus.edu", department: "Mechanical Engineering", phone: "+919876500010" },
    { rollNo: "2024ME002", name: "Harini Iyer", email: "harini.me24@campus.edu", department: "Mechanical Engineering", phone: "+919876500011" },
    { rollNo: "2024ME003", name: "Ishaan Mukherjee", email: "ishaan.me24@campus.edu", department: "Mechanical Engineering", phone: "+919876500012" },
    { rollNo: "2024ME004", name: "Tarun Pillai", email: "tarun.me24@campus.edu", department: "Mechanical Engineering", phone: null },
    { rollNo: "2024CE001", name: "Jyothi Rao", email: "jyothi.ce24@campus.edu", department: "Civil Engineering", phone: "+919876500014" },
    { rollNo: "2024CE002", name: "Karthik Venkatesh", email: "karthik.ce24@campus.edu", department: "Civil Engineering", phone: "+919876500015" },
    { rollNo: "2024CE003", name: "Uma Maheshwari", email: "uma.ce24@campus.edu", department: "Civil Engineering", phone: null },
    { rollNo: "2024EE001", name: "Lavanya Sundaram", email: "lavanya.ee24@campus.edu", department: "Electrical Engineering", phone: "+919876500017" },
    { rollNo: "2024EE002", name: "Mohammed Zeeshan", email: "zeeshan.ee24@campus.edu", department: "Electrical Engineering", phone: "+919876500018" },
    { rollNo: "2024EE003", name: "Nandini Sen", email: "nandini.ee24@campus.edu", department: "Electrical Engineering", phone: "+919876500019" },
    { rollNo: "2024EE004", name: "Varun Gupta", email: "varun.ee24@campus.edu", department: "Electrical Engineering", phone: null },
    { rollNo: "2024AI001", name: "Omkar Deshmukh", email: "omkar.ai24@campus.edu", department: "Artificial Intelligence", phone: "+919876500021" },
    { rollNo: "2024AI002", name: "Pooja Hegde", email: "pooja.ai24@campus.edu", department: "Artificial Intelligence", phone: "+919876500022" },
    { rollNo: "2024AI003", name: "Pranav Joshi", email: "pranav.ai24@campus.edu", department: "Artificial Intelligence", phone: "+919876500023" },
    { rollNo: "2024AI004", name: "Yashasvi Roy", email: "yashasvi.ai24@campus.edu", department: "Artificial Intelligence", phone: null },
  ];

  const studentsList: any[] = [];
  for (const s of sampleStudents) {
    const student = await prisma.student.upsert({
      where: { rollNo: s.rollNo },
      update: {
        name: s.name,
        email: s.email,
        department: s.department,
        messId: akshaya.id,
        active: true,
      },
      create: {
        rollNo: s.rollNo,
        name: s.name,
        email: s.email,
        department: s.department,
        messId: akshaya.id,
        active: true,
      },
    });
    studentsList.push(student);

    if (s.phone) {
      await prisma.whatsAppIdentity.upsert({
        where: { phoneE164: s.phone },
        update: {
          studentId: student.id,
          status: "ACTIVE",
          verifiedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
        create: {
          studentId: student.id,
          phoneE164: s.phone,
          status: "ACTIVE",
          verifiedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      });
    }
  }
  console.log(`✓ ${studentsList.length} students seeded with active and pending WhatsApp identities`);

  // ----------------------------------------------------
  // 7. Seed Official Weekly Mess Menu (Only if needed)
  // ----------------------------------------------------
  const existingMenusCount = await prisma.menu.count({ where: { messId: akshaya.id } });
  if (existingMenusCount < 20) {
    console.log("Seeding weekly mess menu...");
    interface MenuItemSeed {
      name: string;
      isVeg: boolean;
    }
    interface MealSlotSeed {
      mealType: MealType;
      notes: string;
      items: MenuItemSeed[];
    }

    const WEEKLY_MENU_TEMPLATE: Record<number, MealSlotSeed[]> = {
      1: [
        {
          mealType: MealType.BREAKFAST,
          notes: "Daily standard: Bread, Butter, Jam, Sprouts, Tea/Coffee/Milk, Egg/Banana",
          items: [
            { name: "Idly", isVeg: true },
            { name: "Vada", isVeg: true },
            { name: "White Chutney", isVeg: true },
            { name: "Sambar", isVeg: true },
            { name: "Boiled Egg (1 no)", isVeg: false },
            { name: "Fresh Banana", isVeg: true },
          ],
        },
        {
          mealType: MealType.LUNCH,
          notes: "Daily base: Rice, Roti, Sambar, Veg Salad, Curd & Fryums",
          items: [
            { name: "Tomato Rice", isVeg: true },
            { name: "Meal Maker Curry", isVeg: true },
            { name: "Masoor Dal", isVeg: true },
            { name: "Motichoor Laddu", isVeg: true },
            { name: "Steamed Rice & Roti", isVeg: true },
            { name: "Fresh Curd (100g)", isVeg: true },
          ],
        },
        {
          mealType: MealType.SNACKS,
          notes: "Evening Snacks",
          items: [
            { name: "Veg Puff", isVeg: true },
            { name: "Tea / Coffee / Milk", isVeg: true },
          ],
        },
        {
          mealType: MealType.DINNER,
          notes: "Daily base: Rice, Roti, Rasam, Curd",
          items: [
            { name: "Bendi with Boondi Curry", isVeg: true },
            { name: "Totakura Dal", isVeg: true },
            { name: "Steamed Rice & Roti", isVeg: true },
            { name: "Rasam & Fresh Curd", isVeg: true },
          ],
        },
      ],
      0: [
        {
          mealType: MealType.BREAKFAST,
          notes: "Sunday Special Breakfast",
          items: [
            { name: "Masala Dosa", isVeg: true },
            { name: "Sambar & Chutney", isVeg: true },
            { name: "Tea / Coffee / Milk", isVeg: true },
            { name: "Boiled Egg", isVeg: false },
          ],
        },
        {
          mealType: MealType.LUNCH,
          notes: "Sunday Grand Feast",
          items: [
            { name: "Chicken Biryani (Non-Veg)", isVeg: false },
            { name: "Paneer Biryani (Veg)", isVeg: true },
            { name: "Mirchi ka Salan & Raitha", isVeg: true },
            { name: "Gulab Jamun", isVeg: true },
            { name: "Steamed Rice & Dal", isVeg: true },
          ],
        },
        {
          mealType: MealType.SNACKS,
          notes: "Evening Snacks",
          items: [
            { name: "Samosa with Mint Chutney", isVeg: true },
            { name: "Masala Chai", isVeg: true },
          ],
        },
        {
          mealType: MealType.DINNER,
          notes: "Sunday Light Dinner",
          items: [
            { name: "Steamed Rice & Chapati", isVeg: true },
            { name: "Aloo Gobi Curry", isVeg: true },
            { name: "Tomato Dal & Rasam", isVeg: true },
            { name: "Butterscotch Ice Cream", isVeg: true },
          ],
        },
      ],
    };

    const startDate = new Date(Date.UTC(2026, 9, 26, 0, 0, 0, 0));
    for (let i = 0; i < 21; i++) {
      const curDate = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      const dayOfWeek = curDate.getUTCDay();
      const slots = WEEKLY_MENU_TEMPLATE[dayOfWeek] || WEEKLY_MENU_TEMPLATE[1]!;

      for (const slot of slots) {
        const menu = await prisma.menu.upsert({
          where: {
            messId_date_mealType: {
              messId: akshaya.id,
              date: curDate,
              mealType: slot.mealType,
            },
          },
          update: { notes: slot.notes, createdById: superAdmin.id },
          create: {
            messId: akshaya.id,
            date: curDate,
            mealType: slot.mealType,
            notes: slot.notes,
            createdById: superAdmin.id,
          },
        });

        await prisma.menuItem.deleteMany({ where: { menuId: menu.id } });
        await prisma.menuItem.createMany({
          data: slot.items.map((item, idx) => ({
            menuId: menu.id,
            name: item.name,
            isVeg: item.isVeg,
            sortOrder: idx + 1,
          })),
        });
      }
    }
    console.log(`✓ Seeded menu slots across calendar dates`);
  } else {
    console.log(`✓ Menu already seeded (${existingMenusCount} slots exist)`);
  }

  // ----------------------------------------------------
  // 8. Coupons, Orders & Redemptions (Live Demo Telemetry)
  // ----------------------------------------------------
  console.log("Seeding rich coupons, orders, and redemptions...");

  const todayStr = "2026-11-01";
  const todayDate = parseDateIST(todayStr);
  const yesterdayStr = "2026-10-31";
  const yesterdayDate = parseDateIST(yesterdayStr);
  const tomorrowStr = "2026-11-02";
  const tomorrowDate = parseDateIST(tomorrowStr);
  const twoDaysAgoStr = "2026-10-30";
  const twoDaysAgoDate = parseDateIST(twoDaysAgoStr);

  const prodLunch = productMap.get(`${akshaya.id}:EXTRA_LUNCH`);
  const prodDinner = productMap.get(`${akshaya.id}:EXTRA_DINNER`);
  const prodBreakfast = productMap.get(`${akshaya.id}:EXTRA_BREAKFAST`);
  const prodSnacks = productMap.get(`${akshaya.id}:EXTRA_SNACKS`);
  const prodSpecial = productMap.get(`${akshaya.id}:SPECIAL_DINNER`);

  interface CouponSpec {
    studentIdx: number;
    product: any;
    mealType: MealType;
    date: Date;
    status: CouponStatus;
    shortCode: string;
    redeemedMinutesAgo?: number;
    revokedReason?: string;
  }

  const couponSpecs: CouponSpec[] = [
    // Today: REDEEMED (Breakfast earlier today)
    { studentIdx: 0, product: prodBreakfast, mealType: MealType.BREAKFAST, date: todayDate, status: CouponStatus.REDEEMED, shortCode: "BREK8120", redeemedMinutesAgo: 450 },
    { studentIdx: 1, product: prodBreakfast, mealType: MealType.BREAKFAST, date: todayDate, status: CouponStatus.REDEEMED, shortCode: "BREK8121", redeemedMinutesAgo: 440 },
    { studentIdx: 2, product: prodBreakfast, mealType: MealType.BREAKFAST, date: todayDate, status: CouponStatus.REDEEMED, shortCode: "BREK8122", redeemedMinutesAgo: 430 },
    { studentIdx: 3, product: prodBreakfast, mealType: MealType.BREAKFAST, date: todayDate, status: CouponStatus.REDEEMED, shortCode: "BREK8123", redeemedMinutesAgo: 410 },

    // Today: REDEEMED (Lunch earlier today)
    { studentIdx: 4, product: prodLunch, mealType: MealType.LUNCH, date: todayDate, status: CouponStatus.REDEEMED, shortCode: "TRAY5011", redeemedMinutesAgo: 180 },
    { studentIdx: 5, product: prodLunch, mealType: MealType.LUNCH, date: todayDate, status: CouponStatus.REDEEMED, shortCode: "TRAY5012", redeemedMinutesAgo: 165 },
    { studentIdx: 6, product: prodLunch, mealType: MealType.LUNCH, date: todayDate, status: CouponStatus.REDEEMED, shortCode: "TRAY5013", redeemedMinutesAgo: 150 },
    { studentIdx: 7, product: prodLunch, mealType: MealType.LUNCH, date: todayDate, status: CouponStatus.REDEEMED, shortCode: "TRAY5014", redeemedMinutesAgo: 140 },
    { studentIdx: 8, product: prodLunch, mealType: MealType.LUNCH, date: todayDate, status: CouponStatus.REDEEMED, shortCode: "TRAY5015", redeemedMinutesAgo: 130 },
    { studentIdx: 9, product: prodLunch, mealType: MealType.LUNCH, date: todayDate, status: CouponStatus.REDEEMED, shortCode: "TRAY5016", redeemedMinutesAgo: 110 },

    // Today: REDEEMED (Snacks)
    { studentIdx: 10, product: prodSnacks, mealType: MealType.SNACKS, date: todayDate, status: CouponStatus.REDEEMED, shortCode: "SNAK3301", redeemedMinutesAgo: 45 },
    { studentIdx: 11, product: prodSnacks, mealType: MealType.SNACKS, date: todayDate, status: CouponStatus.REDEEMED, shortCode: "SNAK3302", redeemedMinutesAgo: 35 },
    { studentIdx: 12, product: prodSnacks, mealType: MealType.SNACKS, date: todayDate, status: CouponStatus.REDEEMED, shortCode: "SNAK3303", redeemedMinutesAgo: 20 },

    // Today: ACTIVE (Ready to be scanned and redeemed live during the demo! Unambiguous Crockford Base32)
    { studentIdx: 0, product: prodLunch, mealType: MealType.LUNCH, date: todayDate, status: CouponStatus.ACTIVE, shortCode: "TRAY8421" },
    { studentIdx: 1, product: prodLunch, mealType: MealType.LUNCH, date: todayDate, status: CouponStatus.ACTIVE, shortCode: "TRAY9923" },
    { studentIdx: 2, product: prodDinner, mealType: MealType.DINNER, date: todayDate, status: CouponStatus.ACTIVE, shortCode: "EVEN7741" },
    { studentIdx: 3, product: prodDinner, mealType: MealType.DINNER, date: todayDate, status: CouponStatus.ACTIVE, shortCode: "EVEN7742" },
    { studentIdx: 4, product: prodDinner, mealType: MealType.DINNER, date: todayDate, status: CouponStatus.ACTIVE, shortCode: "EVEN7743" },
    { studentIdx: 5, product: prodDinner, mealType: MealType.DINNER, date: todayDate, status: CouponStatus.ACTIVE, shortCode: "EVEN7744" },
    { studentIdx: 6, product: prodSpecial, mealType: MealType.SPECIAL_DINNER, date: todayDate, status: CouponStatus.ACTIVE, shortCode: "SPEC1001" },
    { studentIdx: 7, product: prodSpecial, mealType: MealType.SPECIAL_DINNER, date: todayDate, status: CouponStatus.ACTIVE, shortCode: "SPEC1002" },

    // Tomorrow: ACTIVE (Advance purchases)
    { studentIdx: 8, product: prodLunch, mealType: MealType.LUNCH, date: tomorrowDate, status: CouponStatus.ACTIVE, shortCode: "TRAY2001" },
    { studentIdx: 9, product: prodLunch, mealType: MealType.LUNCH, date: tomorrowDate, status: CouponStatus.ACTIVE, shortCode: "TRAY2002" },
    { studentIdx: 10, product: prodDinner, mealType: MealType.DINNER, date: tomorrowDate, status: CouponStatus.ACTIVE, shortCode: "EVEN2003" },
    { studentIdx: 11, product: prodDinner, mealType: MealType.DINNER, date: tomorrowDate, status: CouponStatus.ACTIVE, shortCode: "EVEN2004" },
    { studentIdx: 12, product: prodSpecial, mealType: MealType.SPECIAL_DINNER, date: tomorrowDate, status: CouponStatus.ACTIVE, shortCode: "SPEC2005" },

    // Yesterday & Past Days: REDEEMED
    { studentIdx: 13, product: prodLunch, mealType: MealType.LUNCH, date: yesterdayDate, status: CouponStatus.REDEEMED, shortCode: "TRAY1091", redeemedMinutesAgo: 1440 + 120 },
    { studentIdx: 14, product: prodDinner, mealType: MealType.DINNER, date: yesterdayDate, status: CouponStatus.REDEEMED, shortCode: "EVEN1092", redeemedMinutesAgo: 1440 + 30 },
    { studentIdx: 15, product: prodLunch, mealType: MealType.LUNCH, date: twoDaysAgoDate, status: CouponStatus.REDEEMED, shortCode: "TRAY1081", redeemedMinutesAgo: 2880 + 100 },
    { studentIdx: 16, product: prodDinner, mealType: MealType.DINNER, date: twoDaysAgoDate, status: CouponStatus.REDEEMED, shortCode: "EVEN1082", redeemedMinutesAgo: 2880 + 50 },

    // Past Days: EXPIRED & REVOKED
    { studentIdx: 17, product: prodBreakfast, mealType: MealType.BREAKFAST, date: twoDaysAgoDate, status: CouponStatus.EXPIRED, shortCode: "BREK1071" },
    { studentIdx: 18, product: prodLunch, mealType: MealType.LUNCH, date: twoDaysAgoDate, status: CouponStatus.EXPIRED, shortCode: "TRAY1072" },
    { studentIdx: 19, product: prodDinner, mealType: MealType.DINNER, date: yesterdayDate, status: CouponStatus.REVOKED, shortCode: "EVEN9991", revokedReason: "Order cancelled by student" },
    { studentIdx: 20, product: prodLunch, mealType: MealType.LUNCH, date: yesterdayDate, status: CouponStatus.REVOKED, shortCode: "TRAY9992", revokedReason: "Duplicate transaction refund" },
  ];

  let couponsCreated = 0;
  for (const spec of couponSpecs) {
    const student = studentsList[spec.studentIdx % studentsList.length];
    const rawToken = generateToken(16);
    const tokenHash = hashToken(rawToken);

    // Create or find matching CouponOrder
    const orderIdempotency = `order_seed_${spec.shortCode}`;
    const order = await prisma.couponOrder.upsert({
      where: {
        studentId_idempotencyKey: {
          studentId: student.id,
          idempotencyKey: orderIdempotency,
        },
      },
      update: {},
      create: {
        studentId: student.id,
        productId: spec.product.id,
        validDate: spec.date,
        amountPaise: spec.product.pricePaise,
        status: OrderStatus.PAID,
        razorpayOrderId: `order_${spec.shortCode.replace("-", "_")}`,
        razorpayPaymentId: `pay_${spec.shortCode.replace("-", "_")}`,
        orderToken: generateToken(24),
        expiresAt: new Date(spec.date.getTime() + 24 * 60 * 60 * 1000),
        idempotencyKey: orderIdempotency,
      },
    });

    const couponExpiry = new Date(spec.date.getTime() + 24 * 60 * 60 * 1000 - 1);
    const redeemedAt = spec.redeemedMinutesAgo
      ? new Date(Date.now() - spec.redeemedMinutesAgo * 60 * 1000)
      : null;

    const coupon = await prisma.coupon.upsert({
      where: { shortCode: spec.shortCode },
      update: {
        status: spec.status,
        redeemedAt,
        redeemedById: redeemedAt ? counterStaff.id : null,
      },
      create: {
        messId: akshaya.id,
        studentId: student.id,
        productId: spec.product.id,
        mealType: spec.mealType,
        validDate: spec.date,
        source: "PURCHASE",
        status: spec.status,
        tokenHash,
        shortCode: spec.shortCode,
        orderId: order.id,
        expiresAt: couponExpiry,
        redeemedAt,
        redeemedById: redeemedAt ? counterStaff.id : null,
        revokedAt: spec.status === CouponStatus.REVOKED ? new Date() : null,
        revokedById: spec.status === CouponStatus.REVOKED ? superAdmin.id : null,
      },
    });

    if (spec.status === CouponStatus.REDEEMED && redeemedAt) {
      await prisma.couponRedemption.upsert({
        where: { couponId: coupon.id },
        update: { at: redeemedAt },
        create: {
          couponId: coupon.id,
          staffId: counterStaff.id,
          at: redeemedAt,
        },
      });
    }

    couponsCreated++;
  }
  console.log(`✓ Seeded ${couponsCreated} coupons across breakfast, lunch, snacks, and dinner`);

  // ----------------------------------------------------
  // 9. Gift Batches & Items
  // ----------------------------------------------------
  console.log("Seeding Gift Batches and complimentary coupons...");
  const batch1Key = "batch_sports_meet_2026";
  const existingBatch1 = await prisma.giftBatch.findUnique({ where: { idempotencyKey: batch1Key } });

  if (!existingBatch1) {
    const batch1 = await prisma.giftBatch.create({
      data: {
        messId: akshaya.id,
        createdById: superAdmin.id,
        mealDate: todayDate,
        message: "Complimentary Banquet for Inter-Hostel Cricket Champions 🏆",
        idempotencyKey: batch1Key,
        status: "COMPLETED",
      },
    });

    const luckyStudents = studentsList.slice(0, 6);
    for (let i = 0; i < luckyStudents.length; i++) {
      const st = luckyStudents[i];
      const code = `GFTSP00${i + 1}`;
      const rawToken = generateToken(16);
      const isRedeemed = i < 3;
      const redeemedAt = isRedeemed ? new Date(Date.now() - (60 + i * 20) * 60 * 1000) : null;

      const giftCoupon = await prisma.coupon.create({
        data: {
          messId: akshaya.id,
          studentId: st.id,
          productId: prodSpecial.id,
          mealType: MealType.SPECIAL_DINNER,
          validDate: todayDate,
          source: "ADMIN_GIFT",
          status: isRedeemed ? CouponStatus.REDEEMED : CouponStatus.ACTIVE,
          tokenHash: hashToken(rawToken),
          shortCode: code,
          expiresAt: new Date(todayDate.getTime() + 24 * 60 * 60 * 1000 - 1),
          redeemedAt,
          redeemedById: isRedeemed ? counterStaff.id : null,
        },
      });

      if (isRedeemed && redeemedAt) {
        await prisma.couponRedemption.create({
          data: {
            couponId: giftCoupon.id,
            staffId: counterStaff.id,
            at: redeemedAt,
          },
        });
      }

      await prisma.giftItem.create({
        data: {
          batchId: batch1.id,
          studentId: st.id,
          couponId: giftCoupon.id,
          emailStatus: NotificationStatus.SENT,
          whatsappStatus: NotificationStatus.DELIVERED,
        },
      });
    }
  }

  const batch2Key = "batch_diwali_welfare_2026";
  const existingBatch2 = await prisma.giftBatch.findUnique({ where: { idempotencyKey: batch2Key } });
  if (!existingBatch2) {
    const batch2 = await prisma.giftBatch.create({
      data: {
        messId: akshaya.id,
        createdById: superAdmin.id,
        mealDate: tomorrowDate,
        message: "Diwali Student Welfare Special Festive Dinner 🪔",
        idempotencyKey: batch2Key,
        status: "COMPLETED",
      },
    });

    const welfareStudents = studentsList.slice(6, 14);
    for (let i = 0; i < welfareStudents.length; i++) {
      const st = welfareStudents[i];
      const code = `GFTDW00${i + 1}`;
      const rawToken = generateToken(16);

      const giftCoupon = await prisma.coupon.create({
        data: {
          messId: akshaya.id,
          studentId: st.id,
          productId: prodSpecial.id,
          mealType: MealType.SPECIAL_DINNER,
          validDate: tomorrowDate,
          source: "ADMIN_GIFT",
          status: CouponStatus.ACTIVE,
          tokenHash: hashToken(rawToken),
          shortCode: code,
          expiresAt: new Date(tomorrowDate.getTime() + 24 * 60 * 60 * 1000 - 1),
        },
      });

      await prisma.giftItem.create({
        data: {
          batchId: batch2.id,
          studentId: st.id,
          couponId: giftCoupon.id,
          emailStatus: NotificationStatus.SENT,
          whatsappStatus: NotificationStatus.DELIVERED,
        },
      });
    }
  }
  console.log(`✓ Gift batches and special dinner coupons seeded`);

  // ----------------------------------------------------
  // 10. Reimbursement Claims (Active & Historical)
  // ----------------------------------------------------
  console.log("Seeding realistic Reimbursement claims and payments...");
  const existingClaimsCount = await prisma.reimbursementRequest.count({ where: { messId: akshaya.id } });

  if (existingClaimsCount < 10) {
    const claimSpecs = [
      // SUBMITTED (Pending review)
      {
        studentIdx: 0,
        ref: "REIMB-2026-001",
        startStr: "2026-10-20",
        endStr: "2026-10-27",
        counted: 6,
        reason: "Participated in ACM-ICPC Regional Programming Contest at IIT Kanpur",
        status: ReimbursementStatus.SUBMITTED,
      },
      {
        studentIdx: 1,
        ref: "REIMB-2026-002",
        startStr: "2026-10-18",
        endStr: "2026-10-26",
        counted: 7,
        reason: "Diwali vacation leave at hometown with family",
        status: ReimbursementStatus.SUBMITTED,
      },
      {
        studentIdx: 2,
        ref: "REIMB-2026-003",
        startStr: "2026-10-22",
        endStr: "2026-10-28",
        counted: 5,
        reason: "Attended sister's wedding ceremony in Hyderabad",
        status: ReimbursementStatus.SUBMITTED,
      },
      // UNDER_REVIEW (Being checked by admin)
      {
        studentIdx: 3,
        ref: "REIMB-2026-004",
        startStr: "2026-10-10",
        endStr: "2026-10-20",
        counted: 9,
        reason: "Medical leave for viral fever recovery certified by campus health center",
        status: ReimbursementStatus.UNDER_REVIEW,
      },
      {
        studentIdx: 4,
        ref: "REIMB-2026-005",
        startStr: "2026-10-12",
        endStr: "2026-10-18",
        counted: 5,
        reason: "Represented university in Inter-NIT Athletic Tournament in Surathkal",
        status: ReimbursementStatus.UNDER_REVIEW,
      },
      // APPROVED (Awaiting disbursement)
      {
        studentIdx: 5,
        ref: "REIMB-2026-006",
        startStr: "2026-10-05",
        endStr: "2026-10-15",
        counted: 9,
        reason: "Attended IEEE Conference and presented technical paper",
        status: ReimbursementStatus.APPROVED,
        approvedDays: 9,
      },
      {
        studentIdx: 6,
        ref: "REIMB-2026-007",
        startStr: "2026-10-01",
        endStr: "2026-10-08",
        counted: 6,
        reason: "Family emergency travel to Chennai",
        status: ReimbursementStatus.APPROVED,
        approvedDays: 6,
      },
      // PAID (Fully settled with UPI payment records)
      {
        studentIdx: 7,
        ref: "REIMB-2026-008",
        startStr: "2026-09-15",
        endStr: "2026-09-24",
        counted: 8,
        reason: "Semester recess and mid-term break travel",
        status: ReimbursementStatus.PAID,
        approvedDays: 8,
        upiRef: "UPI-ICICI-928174921",
      },
      {
        studentIdx: 8,
        ref: "REIMB-2026-009",
        startStr: "2026-09-10",
        endStr: "2026-09-17",
        counted: 6,
        reason: "Off-campus placement drive technical interviews in Bengaluru",
        status: ReimbursementStatus.PAID,
        approvedDays: 6,
        upiRef: "UPI-HDFC-381928471",
      },
      {
        studentIdx: 9,
        ref: "REIMB-2026-010",
        startStr: "2026-09-01",
        endStr: "2026-09-12",
        counted: 10,
        reason: "Summer research internship completion at IISc",
        status: ReimbursementStatus.PAID,
        approvedDays: 10,
        upiRef: "UPI-SBI-771294812",
      },
      // INFO_REQUESTED & REJECTED
      {
        studentIdx: 10,
        ref: "REIMB-2026-011",
        startStr: "2026-10-15",
        endStr: "2026-10-21",
        counted: 5,
        reason: "Industrial training visit",
        status: ReimbursementStatus.INFO_REQUESTED,
      },
      {
        studentIdx: 11,
        ref: "REIMB-2026-012",
        startStr: "2026-10-02",
        endStr: "2026-10-05",
        counted: 2,
        reason: "Weekend home visit",
        status: ReimbursementStatus.REJECTED,
        rejectionReason: "Absence duration was 2 days, strictly less than policy threshold of 4 days.",
      },
    ];

    for (const spec of claimSpecs) {
      const student = studentsList[spec.studentIdx];
      const rate = 13100; // ₹131/day
      const claimedAmount = spec.counted * rate;
      const approvedAmount = spec.approvedDays ? spec.approvedDays * rate : null;

      const startDate = parseDateIST(spec.startStr);
      const endDate = parseDateIST(spec.endStr);

      const claim = await prisma.reimbursementRequest.upsert({
        where: { publicRef: spec.ref },
        update: {},
        create: {
          publicRef: spec.ref,
          messId: akshaya.id,
          studentId: student.id,
          startDate,
          endDate,
          countedDays: spec.counted,
          rateAtClaimPaise: rate,
          claimedAmountPaise: claimedAmount,
          approvedAmountPaise: approvedAmount,
          status: spec.status,
          reason: spec.reason,
          rejectionReason: spec.rejectionReason,
          reviewedById: spec.status !== ReimbursementStatus.SUBMITTED ? superAdmin.id : null,
          encryptedPayout: encryptDemoPayout(`${student.rollNo.toLowerCase()}@okhdfcbank`),
          studentSnapshot: {
            name: student.name,
            rollNo: student.rollNo,
            department: student.department,
            messCode: akshaya.code,
          },
          calculationBreakdown: {
            startDate: spec.startStr,
            endDate: spec.endStr,
            departureDateExcluded: spec.startStr,
            returnDateExcluded: spec.endStr,
            countedDays: spec.counted,
            rateAtClaimPaise: rate,
            claimablePaise: claimedAmount,
            segments: [
              {
                policyId: akshayaPolicy.id,
                dailyRatePaise: rate,
                days: spec.counted,
                fromDate: spec.startStr,
                toDate: spec.endStr,
                amountPaise: claimedAmount,
              },
            ],
          },
        },
      });

      // Status history entry
      await prisma.reimbursementStatusHistory.create({
        data: {
          requestId: claim.id,
          fromStatus: null,
          toStatus: spec.status,
          actorType: "ADMIN",
          actorId: superAdmin.id,
          remarks: `Initial status seed: ${spec.status}`,
          approvedAmountPaise: approvedAmount,
        },
      });

      // Record payment if PAID
      if (spec.status === ReimbursementStatus.PAID && spec.upiRef && approvedAmount) {
        await prisma.reimbursementPayment.upsert({
          where: {
            requestId_reference: {
              requestId: claim.id,
              reference: spec.upiRef,
            },
          },
          update: {},
          create: {
            requestId: claim.id,
            amountPaise: approvedAmount,
            method: PaymentMethod.UPI,
            reference: spec.upiRef,
            paidAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
            recordedById: superAdmin.id,
            note: "Disbursed via campus bank integration",
          },
        });
      }
    }
    console.log(`✓ Seeded ${claimSpecs.length} reimbursement requests with calculation breakdowns and history`);
  } else {
    console.log(`✓ Reimbursement claims already present (${existingClaimsCount} records)`);
  }

  // ----------------------------------------------------
  // 11. Student Feedback Telemetry (24 entries)
  // ----------------------------------------------------
  console.log("Seeding student feedback and dining satisfaction reviews...");
  const feedbackList = [
    { cat: FeedbackCategory.FOOD_QUALITY, rating: 5, meal: MealType.LUNCH, msg: "The Sunday chicken biryani and gulab jamun feast was absolutely delicious! Great preparation.", status: FeedbackStatus.RESOLVED, note: "Thank you for the compliment; conveyed to head chef." },
    { cat: FeedbackCategory.FOOD_QUALITY, rating: 4, meal: MealType.DINNER, msg: "Hot chapatis served during dinner were very soft and fresh. Appreciate the attentive counter staff.", status: FeedbackStatus.RESOLVED, note: "Appreciated; staff acknowledged." },
    { cat: FeedbackCategory.FOOD_QUALITY, rating: 2, meal: MealType.LUNCH, msg: "Masoor dal was a bit too watery today. Would prefer thicker consistency like last week.", status: FeedbackStatus.REVIEWED, note: "Discussed with chef to calibrate water ratio." },
    { cat: FeedbackCategory.FOOD_QUALITY, rating: 5, meal: MealType.BREAKFAST, msg: "Vada and white chutney combination on Monday was super crisp and warm. Outstanding!", status: FeedbackStatus.NEW, anon: true },
    { cat: FeedbackCategory.FOOD_QUALITY, rating: 4, meal: MealType.SNACKS, msg: "Veg puff was fresh and crispy. Tea was served piping hot.", status: FeedbackStatus.NEW },
    { cat: FeedbackCategory.FOOD_QUALITY, rating: 1, meal: MealType.LUNCH, msg: "Sambar had too much tamarind sourness today. Please balance with jaggery and spices.", status: FeedbackStatus.REVIEWED, note: "Head cook notified of spice balance." },
    { cat: FeedbackCategory.FOOD_QUALITY, rating: 5, meal: MealType.DINNER, msg: "Loved the butterscotch ice cream scoop with dinner. Perfect sweet finish!", status: FeedbackStatus.RESOLVED, note: "Glad you enjoyed the dessert." },
    { cat: FeedbackCategory.FOOD_QUALITY, rating: 3, meal: MealType.DINNER, msg: "Rasam was somewhat peppery. Curd quantity was good.", status: FeedbackStatus.NEW, anon: true },

    { cat: FeedbackCategory.MENU, rating: 5, meal: MealType.DINNER, msg: "Gobi paratha for Tuesday dinner was a wonderful addition to the menu cycle.", status: FeedbackStatus.RESOLVED, note: "Parathas retained in regular rotation." },
    { cat: FeedbackCategory.MENU, rating: 4, meal: MealType.LUNCH, msg: "Can we please have curd rice on Friday afternoons in addition to steamed rice?", status: FeedbackStatus.REVIEWED, note: "Submitted to mess committee for approval." },
    { cat: FeedbackCategory.MENU, rating: 3, meal: MealType.BREAKFAST, msg: "Would be great if we could add sprouts or boiled eggs on all weekdays.", status: FeedbackStatus.NEW, anon: true },
    { cat: FeedbackCategory.MENU, rating: 4, meal: MealType.SNACKS, msg: "Requesting samosa or kachori once a week instead of only puff.", status: FeedbackStatus.NEW },
    { cat: FeedbackCategory.MENU, rating: 5, meal: MealType.DINNER, msg: "Paneer butter masala option for vegetarians on Sunday feast was exceptional.", status: FeedbackStatus.RESOLVED, note: "Thank you for the review." },

    { cat: FeedbackCategory.SERVICE, rating: 5, meal: MealType.LUNCH, msg: "QR coupon scanning at counter 1 was blazing fast today! Cleared the queue in under 3 minutes.", status: FeedbackStatus.RESOLVED, note: "Digital coupon system performing smoothly." },
    { cat: FeedbackCategory.SERVICE, rating: 4, meal: MealType.BREAKFAST, msg: "Staff was very courteous and promptly refilled the hot milk container.", status: FeedbackStatus.RESOLVED, note: "Staff commended during morning briefing." },
    { cat: FeedbackCategory.SERVICE, rating: 2, meal: MealType.LUNCH, msg: "Water cooler on the left side was running low on cold water around 1:30 PM.", status: FeedbackStatus.RESOLVED, note: "Secondary chiller unit activated." },
    { cat: FeedbackCategory.SERVICE, rating: 3, meal: MealType.DINNER, msg: "Handwash soap dispenser near the front exit was empty during rush hour.", status: FeedbackStatus.REVIEWED, note: "Housekeeping team instructed on hourly check." },
    { cat: FeedbackCategory.SERVICE, rating: 5, meal: MealType.LUNCH, msg: "Mess hall cleanliness has improved noticeably this semester. Very hygienic dining tables.", status: FeedbackStatus.NEW },

    { cat: FeedbackCategory.OTHER, rating: 5, meal: null, msg: "The new WhatsApp chatbot and online reimbursement claim portal is super convenient! Saved hours.", status: FeedbackStatus.RESOLVED, note: "Delighted to hear! We keep improving." },
    { cat: FeedbackCategory.OTHER, rating: 4, meal: null, msg: "Great initiative with complimentary gift coupons for tournament winners. High morale boost.", status: FeedbackStatus.RESOLVED, note: "Recognition programs will continue." },
    { cat: FeedbackCategory.OTHER, rating: 5, meal: null, msg: "Smooth experience purchasing extra lunch pass on Razorpay. Instant pass generation.", status: FeedbackStatus.NEW, anon: true },
    { cat: FeedbackCategory.OTHER, rating: 4, meal: null, msg: "Lighting and ceiling fans in dining section C were all fixed. Much cooler atmosphere.", status: FeedbackStatus.NEW },
  ];

  let feedbackCount = 0;
  for (let i = 0; i < feedbackList.length; i++) {
    const item = feedbackList[i];
    const student = studentsList[i % studentsList.length];

    await prisma.feedback.create({
      data: {
        messId: akshaya.id,
        studentId: student.id,
        category: item.cat,
        rating: item.rating,
        mealType: item.meal,
        message: item.msg,
        status: item.status,
        adminNote: item.note || null,
        isAnonymous: Boolean(item.anon),
        createdAt: new Date(Date.now() - (i * 5 + 2) * 60 * 60 * 1000), // Staggered over last few days
      },
    });
    feedbackCount++;
  }
  console.log(`✓ Seeded ${feedbackCount} realistic student feedback reviews and analytics entries`);

  // ----------------------------------------------------
  // 12. Audit Logs (Admin Audit Trail)
  // ----------------------------------------------------
  console.log("Seeding system audit trail logs...");
  const auditEntries = [
    { action: "ADMIN_LOGIN", entityType: "AdminUser", entityId: superAdmin.id, after: { email: superAdmin.email, role: "SUPER_ADMIN" } },
    { action: "POLICY_UPDATED", entityType: "ReimbursementPolicy", entityId: akshayaPolicy.id, after: { dailyRatePaise: 13100, minDays: 4 } },
    { action: "COUPON_PRODUCT_CREATED", entityType: "CouponProduct", entityId: prodSpecial.id, after: { code: "SPECIAL_DINNER", pricePaise: 8000 } },
    { action: "REIMBURSEMENT_APPROVED", entityType: "ReimbursementRequest", entityId: "REIMB-2026-006", after: { approvedAmountPaise: 117900 } },
    { action: "REIMBURSEMENT_PAYMENT_RECORDED", entityType: "ReimbursementPayment", entityId: "PAY-UPI-001", after: { method: "UPI", amountPaise: 104800 } },
    { action: "GIFT_BATCH_ISSUED", entityType: "GiftBatch", entityId: "BATCH-SPORTS", after: { totalStudents: 6, mealType: "SPECIAL_DINNER" } },
    { action: "STUDENT_ROSTER_IMPORTED", entityType: "Student", entityId: "ROSTER-2026", after: { importedCount: 24, mess: "AKSHAYA" } },
    { action: "COUPON_REDEEMED", entityType: "Coupon", entityId: "TRAY5011", after: { mealType: "LUNCH", studentRoll: "2024CS004" } },
  ];

  for (let i = 0; i < auditEntries.length; i++) {
    const a = auditEntries[i];
    await prisma.auditLog.create({
      data: {
        actorType: "ADMIN",
        actorId: superAdmin.id,
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        after: a.after,
        ip: "127.0.0.1",
        at: new Date(Date.now() - (i * 3 + 1) * 3600 * 1000),
      },
    });
  }
  console.log(`✓ Seeded ${auditEntries.length} immutable audit logs`);

  console.log("==================================================");
  console.log("🎉 Database Seed Completed Successfully!");
  console.log("==================================================");
  console.log("Super Admin Login: admin@campus.edu / SuperAdminPassword123!");
  console.log("Mess Staff Login:  staff@campus.edu / StaffPassword123!");
  console.log("Quick Redeem Short Codes: TRAY8421, TRAY9923, EVEN7741, SPEC1001");
  console.log("==================================================");
}

main()
  .catch((e) => {
    console.error("Database seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
