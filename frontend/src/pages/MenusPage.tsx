import React, { useState, useEffect, useCallback } from "react";
import { api, ApiClientError } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../components/common/Toast";
import { Modal } from "../components/common/Modal";
import { ConfirmDialog } from "../components/common/ConfirmDialog";
import { ChevronLeft, ChevronRight, Plus, Trash2, Copy, Check } from "lucide-react";

type MealType = "BREAKFAST" | "LUNCH" | "SNACKS" | "DINNER";

const MEAL_TYPES: MealType[] = ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"];

const MEAL_LABELS: Record<MealType, string> = {
  BREAKFAST: "Breakfast",
  LUNCH: "Lunch",
  SNACKS: "Snacks",
  DINNER: "Dinner",
};

interface MenuItem {
  id?: string;
  name: string;
  isVeg: boolean;
  sortOrder: number;
}

interface MenuSlot {
  id: string;
  messId: string;
  date: string;
  mealType: MealType;
  notes: string | null;
  items: MenuItem[];
}

function getMondayOfCurrentWeek(d = new Date()): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatDateToIso(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const MenusPage: React.FC = () => {
  const { user, loading: authLoading, can } = useAuth();
  const toast = useToast();

  const [currentMonday, setCurrentMonday] = useState<Date>(() => getMondayOfCurrentWeek());
  const [menus, setMenus] = useState<MenuSlot[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Active slot editor modal state
  const [editingSlot, setEditingSlot] = useState<{
    date: string;
    mealType: MealType;
    notes: string;
    items: MenuItem[];
  } | null>(null);
  const [savingSlot, setSavingSlot] = useState<boolean>(false);

  // Copy week confirm dialog
  const [isCopyDialogOpen, setIsCopyDialogOpen] = useState<boolean>(false);
  const [copyingWeek, setCopyingWeek] = useState<boolean>(false);

  // Generate 7 days of the selected week
  const weekDays = Array.from({ length: 7 }).map((_, idx) => {
    const dayDate = new Date(currentMonday);
    dayDate.setDate(dayDate.getDate() + idx);
    const iso = formatDateToIso(dayDate);
    const dayName = dayDate.toLocaleDateString("en-IN", { weekday: "short" });
    const dayDisplay = dayDate.toLocaleDateString("en-IN", {
      month: "short",
      day: "numeric",
    });
    return { iso, dayName, dayDisplay, isToday: iso === formatDateToIso(new Date()) };
  });

  const startDateStr = weekDays[0]!.iso;
  const endDateStr = weekDays[6]!.iso;

  const fetchWeekMenus = useCallback(async () => {
    if (authLoading) return;
    setLoading(true);
    try {
      const data = await api.get<MenuSlot[]>("/menus", {
        startDate: startDateStr,
        endDate: endDateStr,
        messId: user?.messId || undefined,
      });
      setMenus(data);
    } catch (err) {
      if (err instanceof ApiClientError) {
        toast.error("Failed to load menus", err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [authLoading, startDateStr, endDateStr, user?.messId, toast]);

  useEffect(() => {
    fetchWeekMenus();
  }, [fetchWeekMenus]);

  const handlePrevWeek = () => {
    const next = new Date(currentMonday);
    next.setDate(next.getDate() - 7);
    setCurrentMonday(next);
  };

  const handleNextWeek = () => {
    const next = new Date(currentMonday);
    next.setDate(next.getDate() + 7);
    setCurrentMonday(next);
  };

  const handleCurrentWeek = () => {
    setCurrentMonday(getMondayOfCurrentWeek());
  };

  // Find slot data for specific date and meal
  const getSlot = (date: string, mealType: MealType): MenuSlot | undefined => {
    return menus.find((m) => m.date === date && m.mealType === mealType);
  };

  const openSlotEditor = (date: string, mealType: MealType) => {
    const existing = getSlot(date, mealType);
    setEditingSlot({
      date,
      mealType,
      notes: existing?.notes || "",
      items: existing?.items.length
        ? existing.items.map((i) => ({ ...i }))
        : [{ name: "", isVeg: true, sortOrder: 0 }],
    });
  };

  const handleSaveSlot = async () => {
    if (!editingSlot) return;

    // Filter out blank items
    const validItems = editingSlot.items
      .map((i) => ({ ...i, name: i.name.trim() }))
      .filter((i) => i.name.length > 0);

    if (validItems.length === 0) {
      toast.error("Validation Error", "Please provide at least one menu item.");
      return;
    }

    setSavingSlot(true);
    try {
      await api.post("/menus/slot", {
        messId: user?.messId || menus[0]?.messId || "default",
        date: editingSlot.date,
        mealType: editingSlot.mealType,
        notes: editingSlot.notes.trim() || undefined,
        items: validItems.map((item, idx) => ({
          name: item.name,
          isVeg: item.isVeg,
          sortOrder: idx,
        })),
      });

      toast.success(
        "Menu Slot Saved",
        `${MEAL_LABELS[editingSlot.mealType]} for ${editingSlot.date} updated successfully.`,
      );
      setEditingSlot(null);
      fetchWeekMenus();
    } catch (err) {
      if (err instanceof ApiClientError) {
        toast.error("Save Failed", err.message);
      }
    } finally {
      setSavingSlot(false);
    }
  };

  const handleCopyPreviousWeek = async () => {
    const prevMonday = new Date(currentMonday);
    prevMonday.setDate(prevMonday.getDate() - 7);

    setCopyingWeek(true);
    try {
      const result = await api.post<{ copiedSlotsCount: number }>("/menus/copy-week", {
        messId: user?.messId || menus[0]?.messId || "default",
        sourceStartDate: formatDateToIso(prevMonday),
        targetStartDate: startDateStr,
      });

      toast.success(
        "Week Menu Copied",
        `Successfully replicated ${result.copiedSlotsCount} meal slots from previous week.`,
      );
      setIsCopyDialogOpen(false);
      fetchWeekMenus();
    } catch (err) {
      if (err instanceof ApiClientError) {
        toast.error("Copy Failed", err.message);
      }
    } finally {
      setCopyingWeek(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header and Week Navigation */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Weekly Menu Planner</h1>
          <p className="text-sm text-slate-500 mt-1">
            Configure cyclical 7-day meal schedules, recipes, and dietary flags for students.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          {can("menu:edit") && (
            <button
              onClick={() => setIsCopyDialogOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors"
            >
              <Copy className="w-4 h-4 text-slate-500" />
              <span>Copy Last Week</span>
            </button>
          )}

          {/* Week Selector Controls */}
          <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
            <button
              onClick={handlePrevWeek}
              className="p-1 rounded text-slate-600 hover:bg-slate-100"
              aria-label="Previous week"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={handleCurrentWeek}
              className="px-3 py-1 text-xs font-semibold text-slate-700 hover:text-emerald-600"
            >
              {startDateStr} to {endDateStr}
            </button>
            <button
              onClick={handleNextWeek}
              className="p-1 rounded text-slate-600 hover:bg-slate-100"
              aria-label="Next week"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 7-Day Matrix Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full border-collapse min-w-[850px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="w-28 p-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Meal
              </th>
              {weekDays.map((d) => (
                <th
                  key={d.iso}
                  className={`p-3 text-center border-l border-slate-200 ${
                    d.isToday ? "bg-emerald-50/70" : ""
                  }`}
                >
                  <p
                    className={`text-xs font-bold uppercase tracking-wider ${
                      d.isToday ? "text-emerald-700" : "text-slate-600"
                    }`}
                  >
                    {d.dayName}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{d.dayDisplay}</p>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {MEAL_TYPES.map((mealType) => (
              <tr key={mealType} className="hover:bg-slate-50/30 transition-colors">
                <td className="p-3 align-top font-semibold text-xs text-slate-700 uppercase tracking-wider bg-slate-50/50">
                  {MEAL_LABELS[mealType]}
                </td>
                {weekDays.map((d) => {
                  const slot = getSlot(d.iso, mealType);
                  const canEdit = can("menu:edit");

                  return (
                    <td
                      key={`${d.iso}-${mealType}`}
                      className={`p-2.5 align-top border-l border-slate-200 text-xs transition-colors ${
                        d.isToday ? "bg-emerald-50/20" : ""
                      } ${canEdit ? "hover:bg-slate-100/60 cursor-pointer" : ""}`}
                      onClick={() => canEdit && openSlotEditor(d.iso, mealType)}
                    >
                      {loading ? (
                        <div className="space-y-1 animate-pulse">
                          <div className="h-3 bg-slate-200 rounded w-3/4" />
                          <div className="h-3 bg-slate-200 rounded w-1/2" />
                        </div>
                      ) : slot && slot.items.length > 0 ? (
                        <div className="space-y-1">
                          <ul className="space-y-0.5">
                            {slot.items.map((item) => (
                              <li key={item.id || item.name} className="flex items-center gap-1.5">
                                <span
                                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                    item.isVeg ? "bg-emerald-500" : "bg-rose-500"
                                  }`}
                                  title={item.isVeg ? "Vegetarian" : "Non-Vegetarian"}
                                />
                                <span className="text-slate-800 truncate font-medium">
                                  {item.name}
                                </span>
                              </li>
                            ))}
                          </ul>
                          {slot.notes && (
                            <p className="text-[10px] text-slate-400 italic mt-1 border-t border-slate-100 pt-1">
                              {slot.notes}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="h-14 flex items-center justify-center text-slate-300">
                          {canEdit ? (
                            <span className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-emerald-600">
                              <Plus className="w-3.5 h-3.5" />
                              <span>Add</span>
                            </span>
                          ) : (
                            <span className="text-[11px]">—</span>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Meal Slot Editor Modal */}
      {editingSlot && (
        <Modal
          isOpen={Boolean(editingSlot)}
          onClose={() => setEditingSlot(null)}
          title={`Edit ${MEAL_LABELS[editingSlot.mealType]} Menu`}
          description={`Date: ${editingSlot.date} IST`}
          maxWidth="md"
        >
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                  Menu Items
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setEditingSlot({
                      ...editingSlot,
                      items: [
                        ...editingSlot.items,
                        { name: "", isVeg: true, sortOrder: editingSlot.items.length },
                      ],
                    })
                  }
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:text-emerald-700"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Item</span>
                </button>
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {editingSlot.items.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={item.name}
                      onChange={(e) => {
                        const updated = [...editingSlot.items];
                        updated[idx]!.name = e.target.value;
                        setEditingSlot({ ...editingSlot, items: updated });
                      }}
                      placeholder={`Item ${idx + 1} (e.g. Masala Dosa)`}
                      className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />

                    {/* Veg / Non-veg toggle button */}
                    <button
                      type="button"
                      onClick={() => {
                        const updated = [...editingSlot.items];
                        updated[idx]!.isVeg = !updated[idx]!.isVeg;
                        setEditingSlot({ ...editingSlot, items: updated });
                      }}
                      title={item.isVeg ? "Click to set Non-Veg" : "Click to set Veg"}
                      className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors flex items-center gap-1 ${
                        item.isVeg
                          ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                          : "bg-rose-50 border-rose-300 text-rose-700"
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          item.isVeg ? "bg-emerald-500" : "bg-rose-500"
                        }`}
                      />
                      <span>{item.isVeg ? "Veg" : "Non-Veg"}</span>
                    </button>

                    {/* Remove item button */}
                    <button
                      type="button"
                      disabled={editingSlot.items.length === 1}
                      onClick={() => {
                        const updated = editingSlot.items.filter((_, i) => i !== idx);
                        setEditingSlot({ ...editingSlot, items: updated });
                      }}
                      className="p-1.5 rounded text-slate-400 hover:text-rose-600 disabled:opacity-30"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1">
                Slot Notes (Optional)
              </label>
              <textarea
                value={editingSlot.notes}
                onChange={(e) => setEditingSlot({ ...editingSlot, notes: e.target.value })}
                placeholder="e.g. Special festive sweet provided with meal."
                rows={2}
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {/* Modal actions */}
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEditingSlot(null)}
                className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 bg-white hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingSlot}
                onClick={handleSaveSlot}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
              >
                {savingSlot ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                <span>Save Slot</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Copy Week Confirmation Dialog */}
      <ConfirmDialog
        isOpen={isCopyDialogOpen}
        onClose={() => setIsCopyDialogOpen(false)}
        onConfirm={handleCopyPreviousWeek}
        title="Copy Menu from Previous Week"
        message={`Are you sure you want to replicate all 7 days of menus from the previous week into ${startDateStr} to ${endDateStr}? Any existing meal slots in this week will be overwritten.`}
        confirmLabel="Replicate Menu"
        loading={copyingWeek}
      />
    </div>
  );
};
