import { describe, it, expect, vi, beforeEach } from "vitest";
import { menuFormatter } from "./menu.formatter.js";
import { whatsAppRouter, StudentIdentityRecord } from "../router.js";
import { whatsAppService } from "../whatsapp.service.js";
import { FakeWhatsAppProvider } from "../fake-whatsapp.provider.js";
import { aiService } from "../../ai/ai.service.js";
import { prisma } from "../../../lib/prisma.js";

vi.mock("../../../lib/prisma.js", () => {
  return {
    prisma: {
      menu: {
        findMany: vi.fn(),
      },
      aiToolCallLog: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({ id: "log-1" }),
      },
    },
  };
});

describe("Phase 14: WhatsApp Menu Workflow (§14.1, §14.2, §14.3)", () => {
  let fakeProvider: FakeWhatsAppProvider;

  const mockIdentity: StudentIdentityRecord = {
    id: "ident-1",
    studentId: "stud-1",
    phoneE164: "+919876543210",
    status: "ACTIVE",
    student: {
      id: "stud-1",
      name: "Rahul Sharma",
      rollNo: "2024CS001",
      department: "CSE",
      messId: "akshaya",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fakeProvider = new FakeWhatsAppProvider();
    whatsAppService.setProvider(fakeProvider);
  });

  describe("Menu Formatter (§14.2)", () => {
    it("formats full daily menu with veg/non-veg badges and notes", () => {
      const formatted = menuFormatter.formatDailyMenu("2026-10-29", [
        {
          mealType: "BREAKFAST",
          notes: "Served with sambar and chutney",
          items: [
            { name: "Idli", isVeg: true },
            { name: "Medu Vada", isVeg: true },
          ],
        },
        {
          mealType: "LUNCH",
          notes: null,
          items: [
            { name: "Paneer Butter Masala", isVeg: true },
            { name: "Chicken Curry", isVeg: false },
            { name: "Steamed Rice", isVeg: true },
          ],
        },
      ]);

      expect(formatted).toContain("Campus Mess Menu — 2026-10-29");
      expect(formatted).toContain("BREAKFAST");
      expect(formatted).toContain("🟢 Idli");
      expect(formatted).toContain("🔴 Chicken Curry");
      expect(formatted).toContain("ℹ️ _Served with sambar and chutney_");
    });

    it("returns friendly message when menu is empty", () => {
      const formatted = menuFormatter.formatDailyMenu("2026-10-29", []);
      expect(formatted).toContain("Menu not published yet. Please check back later!");
    });

    it("formats a single meal window (e.g. Lunch)", () => {
      const formatted = menuFormatter.formatSingleMeal(
        "2026-10-29",
        "LUNCH",
        [
          { name: "Rajma Chawal", isVeg: true },
          { name: "Gulab Jamun", isVeg: true },
        ],
        "Special sweet included",
      );

      expect(formatted).toContain("LUNCH (2026-10-29)");
      expect(formatted).toContain("🟢 Rajma Chawal");
      expect(formatted).toContain("🟢 Gulab Jamun");
      expect(formatted).toContain("ℹ️ _Special sweet included_");
    });

    it("formats upcoming multi-day schedule", () => {
      const formatted = menuFormatter.formatUpcoming([
        { date: "2026-10-30", mealType: "LUNCH", items: ["Dal Makhani", "Jeera Rice"] },
        { date: "2026-10-30", mealType: "DINNER", items: ["Chole Bhature"] },
      ]);

      expect(formatted).toContain("Upcoming Mess Menus");
      expect(formatted).toContain("2026-10-30");
      expect(formatted).toContain("Dal Makhani, Jeera Rice");
    });

    it("caps long menus under WhatsApp limit (4000 chars)", () => {
      const massiveItems = Array.from({ length: 200 }, (_, i) => ({
        name: `Delicious Extravagant Dish Number ${i} With Long Recipe Name`,
        isVeg: true,
      }));

      const formatted = menuFormatter.formatDailyMenu("2026-10-29", [
        { mealType: "LUNCH", items: massiveItems },
      ]);

      expect(formatted.length).toBeLessThanOrEqual(4000);
      expect(formatted).toContain("[truncated]");
    });
  });

  describe("Interactive Button Routing (§14.1)", () => {
    it("handles MENU_TODAY button reply deterministically WITHOUT calling Gemini", async () => {
      const processMessageSpy = vi.spyOn(aiService, "processMessage");

      vi.mocked(prisma.menu.findMany).mockResolvedValue([
        {
          id: "m-1",
          messId: "akshaya",
          mealType: "LUNCH",
          date: new Date("2026-10-29"),
          items: [{ name: "Veg Pulao", isVeg: true }],
        } as never,
      ]);

      await whatsAppRouter.routeMessage(mockIdentity, {
        from: "+919876543210",
        id: "wamid.btn.1",
        timestamp: "1729000000",
        type: "interactive",
        interactive: {
          type: "button_reply",
          button_reply: { id: "MENU_TODAY", title: "Today's Menu" },
        },
      });

      // Gemini must NOT be called for button clicks (§14.1 AC)
      expect(processMessageSpy).not.toHaveBeenCalled();

      const sent = fakeProvider.getLastMessage();
      expect(sent?.to).toBe("+919876543210");
      expect(sent?.payload["text"]).toContain("Veg Pulao");
    });

    it("handles MENU_MAIN button reply by sending navigation buttons", async () => {
      await whatsAppRouter.routeMessage(mockIdentity, {
        from: "+919876543210",
        id: "wamid.btn.2",
        timestamp: "1729000000",
        type: "interactive",
        interactive: {
          type: "button_reply",
          button_reply: { id: "MENU_MAIN", title: "Menu" },
        },
      });

      const sent = fakeProvider.getLastMessage();
      expect(sent?.type).toBe("buttons");
      expect(sent?.payload["buttons"]).toEqual([
        { id: "MENU_TODAY", title: "Today's Menu" },
        { id: "MENU_TOMORROW", title: "Tomorrow's Menu" },
        { id: "MENU_UPCOMING", title: "Next 3 Days" },
      ]);
    });

    it("handles direct text keyword 'MENU'", async () => {
      await whatsAppRouter.routeMessage(mockIdentity, {
        from: "+919876543210",
        id: "wamid.txt.menu",
        timestamp: "1729000000",
        type: "text",
        text: { body: "MENU" },
      });

      const sent = fakeProvider.getLastMessage();
      expect(sent?.type).toBe("buttons");
      const buttons = sent?.payload["buttons"] as Array<{ id: string }>;
      expect(buttons[0]?.id).toBe("MENU_TODAY");
    });
  });

  describe("Natural Language Menu Queries (§14.3)", () => {
    it("routes 'what is for lunch today?' through Gemini to get_menu tool and formats response", async () => {
      vi.mocked(prisma.menu.findMany).mockResolvedValue([
        {
          id: "m-lunch",
          messId: "akshaya",
          mealType: "LUNCH",
          date: new Date("2026-10-29"),
          items: [{ name: "Chole Kulche", isVeg: true }],
        } as never,
      ]);

      await whatsAppRouter.routeMessage(mockIdentity, {
        from: "+919876543210",
        id: "wamid.nl.1",
        timestamp: "1729000000",
        type: "text",
        text: { body: "what is for lunch today?" },
      });

      const sent = fakeProvider.getLastMessage();
      expect(sent?.to).toBe("+919876543210");
      expect(sent?.payload["text"]).toContain("LUNCH");
      expect(sent?.payload["text"]).toContain("Chole Kulche");
    });
  });
});
