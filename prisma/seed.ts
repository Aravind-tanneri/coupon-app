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

  // 6. Seed Official Weekly Mess Menu (Akshaya & Kamadhenu Mess)
  console.log("Seeding official weekly mess menu...");

  interface MenuItemSeed {
    name: string;
    isVeg: boolean;
  }

  interface MealSlotSeed {
    mealType: MealType;
    notes: string;
    items: MenuItemSeed[];
  }

  // Official Menu transcribed from NIT AP Akshaya & Kamadhenu Mess Document
  const WEEKLY_MENU_TEMPLATE: Record<number, MealSlotSeed[]> = {
    // 1: Monday
    1: [
      {
        mealType: MealType.BREAKFAST,
        notes: "Daily standard: Toasted Bread (5 slices), Butter (20g), Jam (20g), Sprouts (50g), Tea / Coffee / Milk (200ml), Boiled Egg (1 no) / Banana (Big size)",
        items: [
          { name: "Idly", isVeg: true },
          { name: "Vada", isVeg: true },
          { name: "White Chutney", isVeg: true },
          { name: "Sambar", isVeg: true },
          { name: "Toasted Bread (5 slices) with Butter & Jam", isVeg: true },
          { name: "Sprouts (50g)", isVeg: true },
          { name: "Tea / Coffee / Milk (200ml)", isVeg: true },
          { name: "Boiled Egg (1 no)", isVeg: false },
          { name: "Banana (Big size)", isVeg: true },
        ],
      },
      {
        mealType: MealType.LUNCH,
        notes: "Daily base: Rice, Roti, Sambar, Veg Salad (Carrot + Cucumber + Beetroot), Curd (100g), Fryums & Gongura Pickle",
        items: [
          { name: "Tomato Rice", isVeg: true },
          { name: "Raitha", isVeg: true },
          { name: "Tomato Meal Maker Curry", isVeg: true },
          { name: "Masoor Dal", isVeg: true },
          { name: "Motichoor Laddu", isVeg: true },
          { name: "Steamed Rice & Roti", isVeg: true },
          { name: "Sambar", isVeg: true },
          { name: "Veg Salad (Carrot + Cucumber + Beetroot)", isVeg: true },
          { name: "Fresh Curd (100g)", isVeg: true },
          { name: "Fryums & Gongura Pickle", isVeg: true },
        ],
      },
      {
        mealType: MealType.SNACKS,
        notes: "Evening Snacks & Hot Beverages",
        items: [
          { name: "Veg Puff", isVeg: true },
          { name: "Tea / Coffee / Milk", isVeg: true },
        ],
      },
      {
        mealType: MealType.DINNER,
        notes: "Daily base: Rice, Roti, Rasam, Curd (100g) & Pickle",
        items: [
          { name: "Bendi with Boondi Curry", isVeg: true },
          { name: "Totakura Dal (50% ratio)", isVeg: true },
          { name: "Steamed Rice & Roti", isVeg: true },
          { name: "Rasam", isVeg: true },
          { name: "Fresh Curd (100g) & Pickle", isVeg: true },
          { name: "Banana", isVeg: true },
        ],
      },
    ],
    // 2: Tuesday
    2: [
      {
        mealType: MealType.BREAKFAST,
        notes: "Daily standard: Toasted Bread (5 slices), Butter (20g), Jam (20g), Sprouts (50g), Tea / Coffee / Milk (200ml), Boiled Egg (1 no) / Banana (Big size)",
        items: [
          { name: "Set Dosa", isVeg: true },
          { name: "White Chutney", isVeg: true },
          { name: "Poppula Podi", isVeg: true },
          { name: "Toasted Bread (5 slices) with Butter & Jam", isVeg: true },
          { name: "Sprouts (50g)", isVeg: true },
          { name: "Tea / Coffee / Milk (200ml)", isVeg: true },
          { name: "Boiled Egg (1 no)", isVeg: false },
          { name: "Banana (Big size)", isVeg: true },
        ],
      },
      {
        mealType: MealType.LUNCH,
        notes: "Daily base: Rice, Roti, Sambar, Veg Salad, Curd (100g), Fryums & Brinjal Tomato Pickle",
        items: [
          { name: "Bendi Curry", isVeg: true },
          { name: "Tomato Dal", isVeg: true },
          { name: "Gulab Jamun", isVeg: true },
          { name: "Steamed Rice & Roti", isVeg: true },
          { name: "Sambar", isVeg: true },
          { name: "Veg Salad (Carrot + Cucumber + Beetroot)", isVeg: true },
          { name: "Fresh Curd (100g)", isVeg: true },
          { name: "Fryums & Brinjal Tomato Pickle", isVeg: true },
        ],
      },
      {
        mealType: MealType.SNACKS,
        notes: "Evening Snacks & Hot Beverages",
        items: [
          { name: "Onion Pakoda", isVeg: true },
          { name: "Tea / Coffee / Milk", isVeg: true },
        ],
      },
      {
        mealType: MealType.DINNER,
        notes: "Daily base: Rice, Roti, Rasam, Curd (100g) & Pickle",
        items: [
          { name: "Gobi + Aloo Paratha", isVeg: true },
          { name: "Chole Masala Curry", isVeg: true },
          { name: "Gongura Dal (50% ratio)", isVeg: true },
          { name: "Steamed Rice & Roti", isVeg: true },
          { name: "Rasam", isVeg: true },
          { name: "Fresh Curd (100g) & Pickle", isVeg: true },
          { name: "Papaya (2 slices)", isVeg: true },
        ],
      },
    ],
    // 3: Wednesday
    3: [
      {
        mealType: MealType.BREAKFAST,
        notes: "Daily standard: Toasted Bread (5 slices), Butter (20g), Jam (20g), Sprouts (50g), Tea / Coffee / Milk (200ml), Boiled Egg (1 no) / Banana (Big size)",
        items: [
          { name: "Bisibele Bath", isVeg: true },
          { name: "Sambar", isVeg: true },
          { name: "Toasted Bread (5 slices) with Butter & Jam", isVeg: true },
          { name: "Sprouts (50g)", isVeg: true },
          { name: "Tea / Coffee / Milk (200ml)", isVeg: true },
          { name: "Boiled Egg (1 no)", isVeg: false },
          { name: "Banana (Big size)", isVeg: true },
        ],
      },
      {
        mealType: MealType.LUNCH,
        notes: "Daily base: Rice, Roti, Sambar, Veg Salad, Curd (100g), Fryums & Gongura Coconut Pickle",
        items: [
          { name: "Gobhi + Mutter Curry", isVeg: true },
          { name: "Moong Dal", isVeg: true },
          { name: "Madatha Khaja", isVeg: true },
          { name: "Steamed Rice & Roti", isVeg: true },
          { name: "Sambar", isVeg: true },
          { name: "Veg Salad (Carrot + Cucumber + Beetroot)", isVeg: true },
          { name: "Fresh Curd (100g)", isVeg: true },
          { name: "Fryums & Gongura Coconut Pickle", isVeg: true },
        ],
      },
      {
        mealType: MealType.SNACKS,
        notes: "Evening Snacks & Hot Beverages",
        items: [
          { name: "Aloo Samosa (Big size - 1 no) with Mirchi & Sauce", isVeg: true },
          { name: "Tea / Coffee / Milk", isVeg: true },
        ],
      },
      {
        mealType: MealType.DINNER,
        notes: "Special Dinner: Chicken Curry (Non-Veg) / Mutter Paneer Curry (Veg), Ice Cream & Guava",
        items: [
          { name: "Veg Pulav & Raitha", isVeg: true },
          { name: "Mutter Paneer Curry (Veg)", isVeg: true },
          { name: "Chicken Curry (Non-Veg) with Lemon & Onion slices", isVeg: false },
          { name: "Sorakaya Dal", isVeg: true },
          { name: "Steamed Rice & Roti", isVeg: true },
          { name: "Rasam", isVeg: true },
          { name: "Fresh Curd (100g) & Pickle", isVeg: true },
          { name: "Guava (100g)", isVeg: true },
          { name: "Vanilla Ice Cream (2 scoops)", isVeg: true },
        ],
      },
    ],
    // 4: Thursday
    4: [
      {
        mealType: MealType.BREAKFAST,
        notes: "Daily standard: Toasted Bread (5 slices), Butter (20g), Jam (20g), Sprouts (50g), Tea / Coffee / Milk (200ml), Boiled Egg (1 no) / Banana (Big size)",
        items: [
          { name: "Wheat Ravva (Red) Upma / Semiya Upma", isVeg: true },
          { name: "Poha with Black Chana", isVeg: true },
          { name: "Toasted Bread (5 slices) with Butter & Jam", isVeg: true },
          { name: "Sprouts (50g)", isVeg: true },
          { name: "Tea / Coffee / Milk (200ml)", isVeg: true },
          { name: "Boiled Egg (1 no)", isVeg: false },
          { name: "Banana (Big size)", isVeg: true },
        ],
      },
      {
        mealType: MealType.LUNCH,
        notes: "Daily base: Rice, Roti, Sambar, Veg Salad, Curd (100g), Fryums & Tomato Pickle",
        items: [
          { name: "Chole Masala Curry", isVeg: true },
          { name: "Masoor Dal", isVeg: true },
          { name: "Semiya Kheer", isVeg: true },
          { name: "Steamed Rice & Roti", isVeg: true },
          { name: "Sambar", isVeg: true },
          { name: "Veg Salad (Carrot + Cucumber + Beetroot)", isVeg: true },
          { name: "Fresh Curd (100g)", isVeg: true },
          { name: "Fryums & Tomato Pickle", isVeg: true },
        ],
      },
      {
        mealType: MealType.SNACKS,
        notes: "Evening Snacks & Hot Beverages",
        items: [
          { name: "Cake (1 pc big) / Cream Bun", isVeg: true },
          { name: "Tea / Coffee / Milk", isVeg: true },
        ],
      },
      {
        mealType: MealType.DINNER,
        notes: "Daily base: Rice, Roti, Rasam, Curd (100g) & Pickle",
        items: [
          { name: "Veg Biryani with Raitha", isVeg: true },
          { name: "White Kidney Beans Curry", isVeg: true },
          { name: "Dosakaya & Tomato Dal", isVeg: true },
          { name: "Steamed Rice & Roti", isVeg: true },
          { name: "Rasam", isVeg: true },
          { name: "Fresh Curd (100g) & Pickle", isVeg: true },
          { name: "Banana", isVeg: true },
        ],
      },
    ],
    // 5: Friday
    5: [
      {
        mealType: MealType.BREAKFAST,
        notes: "Daily standard: Toasted Bread (5 slices), Butter (20g), Jam (20g), Sprouts (50g), Banana (Big size - no egg on Friday), Tea / Coffee / Milk (200ml)",
        items: [
          { name: "Poori + Aloo Chole Curry (50% each ratio)", isVeg: true },
          { name: "Toasted Bread (5 slices) with Butter & Jam", isVeg: true },
          { name: "Sprouts (50g)", isVeg: true },
          { name: "Tea / Coffee / Milk (200ml)", isVeg: true },
          { name: "Banana (Big size)", isVeg: true },
        ],
      },
      {
        mealType: MealType.LUNCH,
        notes: "Special Friday Lunch: Biryani, Kadai Paneer / Egg Bhurji (2 eggs), Jaggery Jalebi",
        items: [
          { name: "Biryani with Raitha", isVeg: true },
          { name: "Kadai Paneer (1 cup) (Veg)", isVeg: true },
          { name: "Egg Bhurji / Masala Fried Egg (2 eggs) (Non-Veg)", isVeg: false },
          { name: "Toor Dal", isVeg: true },
          { name: "Jaggery Jalebi", isVeg: true },
          { name: "Steamed Rice & Roti", isVeg: true },
          { name: "Sambar", isVeg: true },
          { name: "Veg Salad (Carrot + Cucumber + Beetroot)", isVeg: true },
          { name: "Fresh Curd (100g)", isVeg: true },
          { name: "Fryums & Dondakaya Tomato Pickle", isVeg: true },
        ],
      },
      {
        mealType: MealType.SNACKS,
        notes: "Evening Snacks & Hot Beverages",
        items: [
          { name: "Pani Puri (8 nos)", isVeg: true },
          { name: "Tea / Coffee / Milk", isVeg: true },
        ],
      },
      {
        mealType: MealType.DINNER,
        notes: "Daily base: Rice, Roti, Rasam, Curd (100g) & Pickle",
        items: [
          { name: "Aloo Deep Fry", isVeg: true },
          { name: "Tomato Dal (50% ratio)", isVeg: true },
          { name: "Steamed Rice & Roti", isVeg: true },
          { name: "Rasam", isVeg: true },
          { name: "Fresh Curd (100g) & Pickle", isVeg: true },
          { name: "Seasonal Fruit (1 no)", isVeg: true },
        ],
      },
    ],
    // 6: Saturday
    6: [
      {
        mealType: MealType.BREAKFAST,
        notes: "Daily standard: Toasted Bread (5 slices), Butter (20g), Jam (20g), Sprouts (50g), Tea / Coffee / Milk (200ml), Boiled Egg (1 no) / Banana (Big size)",
        items: [
          { name: "Masala Dosa (masala with aloo & onion of equal ratio)", isVeg: true },
          { name: "White Chutney", isVeg: true },
          { name: "Toasted Bread (5 slices) with Butter & Jam", isVeg: true },
          { name: "Sprouts (50g)", isVeg: true },
          { name: "Tea / Coffee / Milk (200ml)", isVeg: true },
          { name: "Boiled Egg (1 no)", isVeg: false },
          { name: "Banana (Big size)", isVeg: true },
        ],
      },
      {
        mealType: MealType.LUNCH,
        notes: "Saturday Feast: Mudda Pappu, Aavakaya & Ghee, Carrot Halwa",
        items: [
          { name: "Tomato Khadi Pakodi", isVeg: true },
          { name: "Mudda Pappu + Aavakaya Pickle + Pure Ghee", isVeg: true },
          { name: "Carrot Halwa", isVeg: true },
          { name: "Steamed Rice & Roti", isVeg: true },
          { name: "Sambar", isVeg: true },
          { name: "Veg Salad (Carrot + Cucumber + Beetroot)", isVeg: true },
          { name: "Fresh Curd (100g)", isVeg: true },
          { name: "Roasted Papad (1 no)", isVeg: true },
        ],
      },
      {
        mealType: MealType.SNACKS,
        notes: "Evening Snacks & Hot Beverages",
        items: [
          { name: "Pav Bhaji (1 pav)", isVeg: true },
          { name: "Tea / Coffee / Milk", isVeg: true },
        ],
      },
      {
        mealType: MealType.DINNER,
        notes: "Daily base: Rice, Roti, Rasam, Curd (100g) & Pickle",
        items: [
          { name: "Jeera Rice & Dal Fry", isVeg: true },
          { name: "Veg Kofta Curry", isVeg: true },
          { name: "Palak Dal (50% ratio)", isVeg: true },
          { name: "Steamed Rice & Roti", isVeg: true },
          { name: "Rasam", isVeg: true },
          { name: "Fresh Curd (100g) & Pickle", isVeg: true },
          { name: "Papaya (2 slices) / Banana / Guava", isVeg: true },
        ],
      },
    ],
    // 0: Sunday
    0: [
      {
        mealType: MealType.BREAKFAST,
        notes: "Daily standard: Toasted Bread (5 slices), Butter (20g), Jam (20g), Sprouts (50g), Tea / Coffee / Milk (200ml), Boiled Egg (1 no) / Banana (Big size)",
        items: [
          { name: "Aloo Paratha", isVeg: true },
          { name: "Fresh Curd", isVeg: true },
          { name: "Tomato Sauce / Tomato Chutney", isVeg: true },
          { name: "Toasted Bread (5 slices) with Butter & Jam", isVeg: true },
          { name: "Sprouts (50g)", isVeg: true },
          { name: "Tea / Coffee / Milk (200ml)", isVeg: true },
          { name: "Boiled Egg (1 no)", isVeg: false },
          { name: "Banana (Big size)", isVeg: true },
        ],
      },
      {
        mealType: MealType.LUNCH,
        notes: "Sunday Special Lunch: Pulav / Bagara Rice, Chekkara Pongali / Double Ka Meetha",
        items: [
          { name: "Plain Pulav / Bagara Rice", isVeg: true },
          { name: "Mutter Curry", isVeg: true },
          { name: "Tomato Dal", isVeg: true },
          { name: "Chekkara Pongali / Double Ka Meetha", isVeg: true },
          { name: "Steamed Rice & Roti", isVeg: true },
          { name: "Sambar", isVeg: true },
          { name: "Veg Salad (Carrot + Cucumber + Beetroot)", isVeg: true },
          { name: "Fresh Curd (100g)", isVeg: true },
          { name: "Fryums & Anapakaya Tomato Pickle", isVeg: true },
        ],
      },
      {
        mealType: MealType.SNACKS,
        notes: "Evening Snacks & Hot Beverages",
        items: [
          { name: "Punugulu with White Chutney", isVeg: true },
          { name: "Tea / Coffee / Milk", isVeg: true },
        ],
      },
      {
        mealType: MealType.DINNER,
        notes: "Sunday Grand Feast: Chicken Curry (Non-Veg) / Paneer Butter Masala (Veg), Butterscotch Ice Cream",
        items: [
          { name: "Bagara Rice", isVeg: true },
          { name: "Paneer Butter Masala (Veg)", isVeg: true },
          { name: "Chicken Curry (Non-Veg) with Lemon & Onion slices", isVeg: false },
          { name: "Dal Tadka", isVeg: true },
          { name: "Steamed Rice & Roti", isVeg: true },
          { name: "Rasam", isVeg: true },
          { name: "Fresh Curd (100g) & Pickle", isVeg: true },
          { name: "Guava (100g)", isVeg: true },
          { name: "Butterscotch Ice Cream (2 scoops)", isVeg: true },
        ],
      },
    ],
  };

  // Seed 4-week window (28 days) centered around today (2026-10-26 Monday to 2026-11-22 Sunday)
  const startDate = new Date(Date.UTC(2026, 9, 26, 0, 0, 0, 0)); // Oct 26, 2026
  const totalDays = 28;
  const days = Array.from({ length: totalDays }, (_, i) => {
    return new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
  });

  let seededSlotsCount = 0;
  const BATCH_SIZE = 4;

  for (let i = 0; i < days.length; i += BATCH_SIZE) {
    const batch = days.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (currentDate) => {
        const dayOfWeek = currentDate.getUTCDay();
        const slots = WEEKLY_MENU_TEMPLATE[dayOfWeek] || [];

        for (const slot of slots) {
          const menu = await prisma.menu.upsert({
            where: {
              messId_date_mealType: {
                messId: akshaya.id,
                date: currentDate,
                mealType: slot.mealType,
              },
            },
            update: {
              notes: slot.notes,
              createdById: superAdmin.id,
            },
            create: {
              messId: akshaya.id,
              date: currentDate,
              mealType: slot.mealType,
              notes: slot.notes,
              createdById: superAdmin.id,
            },
          });

          await prisma.menuItem.deleteMany({
            where: { menuId: menu.id },
          });

          await prisma.menuItem.createMany({
            data: slot.items.map((item, idx) => ({
              menuId: menu.id,
              name: item.name,
              isVeg: item.isVeg,
              sortOrder: idx + 1,
            })),
          });

          seededSlotsCount++;
        }
      })
    );
  }

  console.log(`✓ Seeded ${seededSlotsCount} meal slots across 4 weeks with official NIT AP Akshaya & Kamadhenu Mess menu`);

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
