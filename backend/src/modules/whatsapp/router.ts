import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../config/logger.js";
import { whatsAppService } from "./whatsapp.service.js";
import { menuFormatter } from "./workflows/menu.formatter.js";
import { aiService } from "../ai/ai.service.js";
import { getTodayISTString, parseDateIST, addDaysIST, formatDateIST } from "../../lib/dates-ist.js";
import { InjectedStudentContext } from "../ai/gemini.types.js";

export interface RoutedMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
}

export interface StudentIdentityRecord {
  id: string;
  studentId: string;
  phoneE164: string;
  status: string;
  student: {
    id: string;
    name: string;
    rollNo: string;
    department: string;
    messId: string;
  };
}

export class WhatsAppRouter {
  /**
   * Routes inbound message from verified student identity (§14.1).
   */
  async routeMessage(
    identity: StudentIdentityRecord,
    message: RoutedMessage,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? prisma;
    const phone = identity.phoneE164;
    const student = identity.student;
    const todayIST = getTodayISTString();

    const context: InjectedStudentContext = {
      studentId: student.id,
      messId: student.messId,
      rollNo: student.rollNo,
      studentName: student.name,
      todayIST,
    };

    // 1. Check for Interactive Button / List Replies (§14.1)
    // CRITICAL AC: Gemini is NOT called for interactive replies!
    const interactiveId =
      message.interactive?.button_reply?.id || message.interactive?.list_reply?.id;

    if (interactiveId) {
      logger.info(
        { phone, interactiveId },
        "Routing interactive button/list callback deterministically",
      );
      await this.handleInteractiveAction(interactiveId, context, phone, db);
      return;
    }

    // 2. Free-text message processing
    const rawText = (message.text?.body || "").trim();
    const upperText = rawText.toUpperCase();

    // Direct keyword overrides (deterministic shortcuts)
    if (upperText === "MENU" || upperText === "FOOD") {
      await this.sendMenuHub(phone);
      return;
    }
    if (upperText === "TODAY" || upperText === "TODAY'S MENU") {
      await this.sendTodayMenu(context, phone, db);
      return;
    }
    if (upperText === "TOMORROW" || upperText === "TOMORROW'S MENU") {
      await this.sendTomorrowMenu(context, phone, db);
      return;
    }
    if (upperText === "HELP" || upperText === "COMMANDS") {
      await this.sendHelpMessage(phone);
      return;
    }

    // 3. Natural Language Processing via Gemini & Tool Execution (§8, §14.3)
    logger.info({ phone, rawText }, "Processing free-text message through Gemini NLP pipeline");
    const aiResult = await aiService.processMessage(rawText, context, "DEFAULT");

    if (aiResult.fallback || !aiResult.toolResult) {
      if (aiResult.fallbackMenu) {
        await whatsAppService
          .getProvider()
          .sendButtons(
            phone,
            aiResult.replyText ?? aiResult.fallbackMenu.bodyText,
            aiResult.fallbackMenu.buttons,
          );
      } else {
        await whatsAppService
          .getProvider()
          .sendText(
            phone,
            aiResult.replyText ??
              "I can help you view menus, coupons, and reimbursements. Type MENU or HELP to start.",
          );
      }
      return;
    }

    // 4. Handle tool execution results with custom formatters (§14.2)
    const { toolName, result } = aiResult.toolResult;

    if (toolName === "get_menu" && result && typeof result === "object") {
      const data = result as {
        date: string;
        meals: Array<{
          mealType: string;
          notes?: string | null;
          items: Array<{ name: string; isVeg: boolean }>;
        }>;
      };

      // Check if user specifically asked for one meal (e.g., lunch)
      const requestedMeal = aiResult.classification?.entities.meal;
      if (requestedMeal) {
        const foundMeal = data.meals.find(
          (m) => m.mealType.toUpperCase() === requestedMeal.toUpperCase(),
        );
        const mealText = menuFormatter.formatSingleMeal(
          data.date,
          requestedMeal,
          foundMeal?.items ?? [],
          foundMeal?.notes,
        );
        await whatsAppService.getProvider().sendText(phone, mealText);
      } else {
        const menuText = menuFormatter.formatDailyMenu(data.date, data.meals);
        await whatsAppService.getProvider().sendText(phone, menuText);
      }
      return;
    }

    if (toolName === "list_upcoming_menus" && result && typeof result === "object") {
      const data = result as {
        schedule: Array<{ date: string; mealType: string; items: string[] }>;
      };
      const formatted = menuFormatter.formatUpcoming(data.schedule);
      await whatsAppService.getProvider().sendText(phone, formatted);
      return;
    }

    // Generic text reply for other tools
    await whatsAppService
      .getProvider()
      .sendText(phone, `Action completed: ${toolName}. Reply MENU to return to main options.`);
  }

  /**
   * Deterministic Interactive Action Dispatcher (§14.1).
   */
  async handleInteractiveAction(
    actionId: string,
    context: InjectedStudentContext,
    phone: string,
    db: Prisma.TransactionClient | typeof prisma,
  ): Promise<void> {
    const [action] = actionId.split(":");

    switch (action) {
      case "MENU_MAIN":
        await this.sendMenuHub(phone);
        break;

      case "MENU_TODAY":
        await this.sendTodayMenu(context, phone, db);
        break;

      case "MENU_TOMORROW":
        await this.sendTomorrowMenu(context, phone, db);
        break;

      case "MENU_UPCOMING":
        await this.sendUpcomingMenus(context, phone, db);
        break;

      case "HELP":
        await this.sendHelpMessage(phone);
        break;

      default:
        await whatsAppService.getProvider().sendButtons(phone, "Select a service to proceed:", [
          { id: "MENU_TODAY", title: "Today's Menu" },
          { id: "MY_COUPONS", title: "My Coupons" },
          { id: "HELP", title: "Help & Commands" },
        ]);
        break;
    }
  }

  private async sendMenuHub(phone: string): Promise<void> {
    await whatsAppService.getProvider().sendButtons(
      phone,
      "🍽️ *Campus Mess Menu*\n\nSelect which menu you'd like to check:",
      [
        { id: "MENU_TODAY", title: "Today's Menu" },
        { id: "MENU_TOMORROW", title: "Tomorrow's Menu" },
        { id: "MENU_UPCOMING", title: "Next 3 Days" },
      ],
      { header: "Dining Hall", footer: "Tap a button to view" },
    );
  }

  private async sendTodayMenu(
    context: InjectedStudentContext,
    phone: string,
    db: Prisma.TransactionClient | typeof prisma,
  ): Promise<void> {
    const todayDate = parseDateIST(context.todayIST);
    const menus = await db.menu.findMany({
      where: {
        messId: context.messId,
        date: todayDate,
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
      orderBy: { mealType: "asc" },
    });

    const formatted = menuFormatter.formatDailyMenu(context.todayIST, menus);
    await whatsAppService.getProvider().sendText(phone, formatted);
  }

  private async sendTomorrowMenu(
    context: InjectedStudentContext,
    phone: string,
    db: Prisma.TransactionClient | typeof prisma,
  ): Promise<void> {
    const tomorrowDate = addDaysIST(parseDateIST(context.todayIST), 1);
    const tomorrowStr = formatDateIST(tomorrowDate);

    const menus = await db.menu.findMany({
      where: {
        messId: context.messId,
        date: tomorrowDate,
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
      orderBy: { mealType: "asc" },
    });

    const formatted = menuFormatter.formatDailyMenu(tomorrowStr, menus);
    await whatsAppService.getProvider().sendText(phone, formatted);
  }

  private async sendUpcomingMenus(
    context: InjectedStudentContext,
    phone: string,
    db: Prisma.TransactionClient | typeof prisma,
  ): Promise<void> {
    const startDate = parseDateIST(context.todayIST);
    const endDate = addDaysIST(startDate, 3);

    const menus = await db.menu.findMany({
      where: {
        messId: context.messId,
        date: { gte: startDate, lte: endDate },
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
      orderBy: [{ date: "asc" }, { mealType: "asc" }],
    });

    const schedule = menus.map((m) => ({
      date: formatDateIST(m.date),
      mealType: m.mealType,
      items: m.items.map((i) => i.name),
    }));

    const formatted = menuFormatter.formatUpcoming(schedule);
    await whatsAppService.getProvider().sendText(phone, formatted);
  }

  private async sendHelpMessage(phone: string): Promise<void> {
    const helpText = [
      "🤖 *Campus Mess Assistant Commands*\n",
      "• *MENU*: View menu options (today, tomorrow, upcoming)",
      "• *COUPONS*: View your meal passes or purchase extra tokens",
      "• *REIMBURSE*: Check absence policy and calculate rebates",
      "• *FEEDBACK*: Submit food quality and cleanliness remarks",
      "• *UNLINK*: Disconnect WhatsApp from your student ID",
      "\n_Tip: You can also ask questions naturally, e.g. 'what is for lunch today?' or 'show tomorrow's dinner'._",
    ].join("\n");

    await whatsAppService.getProvider().sendText(phone, helpText);
  }
}

export const whatsAppRouter = new WhatsAppRouter();
