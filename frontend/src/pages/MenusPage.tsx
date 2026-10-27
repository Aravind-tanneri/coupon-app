import React from "react";
import { UtensilsCrossed } from "lucide-react";

export const MenusPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Weekly Menu Planner</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage 7-day cyclical menus, meal items, and vegetarian / non-vegetarian designations.
        </p>
      </div>
      <div className="p-8 bg-white border border-slate-200 rounded-xl text-center text-slate-500">
        <UtensilsCrossed className="w-10 h-10 text-slate-400 mx-auto mb-2" />
        <p className="font-medium text-slate-700">Menu planner ready for Phase 5</p>
      </div>
    </div>
  );
};
