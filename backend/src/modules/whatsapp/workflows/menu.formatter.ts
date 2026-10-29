export interface MenuItemDTO {
  name: string;
  isVeg: boolean;
}

export interface MealMenuDTO {
  mealType: string;
  notes?: string | null;
  items: MenuItemDTO[];
}

export const MEAL_DISPLAY_NAMES: Record<string, { label: string; icon: string }> = {
  BREAKFAST: { label: "Breakfast", icon: "🍳" },
  LUNCH: { label: "Lunch", icon: "🍛" },
  SNACKS: { label: "Evening Snacks", icon: "☕" },
  DINNER: { label: "Dinner", icon: "🍽️" },
  SPECIAL_DINNER: { label: "Special Feast Dinner", icon: "🎉" },
};

export class MenuFormatter {
  /**
   * Formats full day menu across all meal windows (§14.2).
   */
  formatDailyMenu(dateStr: string, meals: MealMenuDTO[]): string {
    if (!meals || meals.length === 0) {
      return `📅 *Menu for ${dateStr}*\n\n_Menu not published yet. Please check back later!_`;
    }

    const sections: string[] = [`📅 *Campus Mess Menu — ${dateStr}*\n`];

    for (const meal of meals) {
      const meta = MEAL_DISPLAY_NAMES[meal.mealType] ?? {
        label: meal.mealType,
        icon: "🍴",
      };

      sections.push(`${meta.icon} *${meta.label.toUpperCase()}*`);

      if (meal.items.length === 0) {
        sections.push("  _Items being finalized_");
      } else {
        for (const item of meal.items) {
          const badge = item.isVeg ? "🟢" : "🔴";
          sections.push(`  ${badge} ${item.name}`);
        }
      }

      if (meal.notes) {
        sections.push(`  ℹ️ _${meal.notes}_`);
      }
      sections.push("");
    }

    const result = sections.join("\n").trim();
    return this.ensureWhatsAppLimit(result);
  }

  /**
   * Formats a single meal window (e.g. Lunch or Dinner).
   */
  formatSingleMeal(
    dateStr: string,
    mealType: string,
    items: MenuItemDTO[],
    notes?: string | null,
  ): string {
    const meta = MEAL_DISPLAY_NAMES[mealType] ?? {
      label: mealType,
      icon: "🍴",
    };

    if (!items || items.length === 0) {
      return `📅 *${meta.icon} ${meta.label} (${dateStr})*\n\n_Menu not published yet for this meal._`;
    }

    const lines: string[] = [`📅 *${meta.icon} ${meta.label.toUpperCase()} (${dateStr})*\n`];

    for (const item of items) {
      const badge = item.isVeg ? "🟢" : "🔴";
      lines.push(`  ${badge} ${item.name}`);
    }

    if (notes) {
      lines.push(`\nℹ️ _${notes}_`);
    }

    return this.ensureWhatsAppLimit(lines.join("\n").trim());
  }

  /**
   * Formats upcoming schedule summary (§14.2).
   */
  formatUpcoming(schedule: Array<{ date: string; mealType: string; items: string[] }>): string {
    if (!schedule || schedule.length === 0) {
      return "📅 *Upcoming Menus*\n\n_No upcoming menus published yet._";
    }

    const lines: string[] = ["📅 *Upcoming Mess Menus:*\n"];
    let currentDate = "";

    for (const entry of schedule) {
      if (entry.date !== currentDate) {
        currentDate = entry.date;
        lines.push(`\n📌 *${currentDate}*`);
      }
      const meta = MEAL_DISPLAY_NAMES[entry.mealType] ?? { label: entry.mealType, icon: "🍴" };
      const itemsPreview = entry.items.length > 0 ? entry.items.slice(0, 4).join(", ") : "Pending";
      lines.push(`• ${meta.icon} *${meta.label}*: ${itemsPreview}`);
    }

    return this.ensureWhatsAppLimit(lines.join("\n").trim());
  }

  /**
   * Enforces WhatsApp message character ceiling (4096 chars).
   */
  private ensureWhatsAppLimit(text: string): string {
    const MAX_CHARS = 4000;
    if (text.length <= MAX_CHARS) {
      return text;
    }
    return text.slice(0, MAX_CHARS - 20) + "\n\n_...[truncated]_";
  }
}

export const menuFormatter = new MenuFormatter();
