import React from "react";
import { Ticket } from "lucide-react";

export const CouponsPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Coupon Inventory & Catalog
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Configure coupon products, meal pricing in paise, and review active issuance.
        </p>
      </div>
      <div className="p-8 bg-white border border-slate-200 rounded-xl text-center text-slate-500">
        <Ticket className="w-10 h-10 text-slate-400 mx-auto mb-2" />
        <p className="font-medium text-slate-700">Coupon engine ready for Phase 6</p>
      </div>
    </div>
  );
};
