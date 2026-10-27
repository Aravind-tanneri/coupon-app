import React from "react";
import { QrCode } from "lucide-react";

export const RedemptionsPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Live Redemption Console
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Mess staff live QR / short code scanner with meal-window validation and anti-double-dip
          checks.
        </p>
      </div>
      <div className="p-8 bg-white border border-slate-200 rounded-xl text-center text-slate-500">
        <QrCode className="w-10 h-10 text-slate-400 mx-auto mb-2" />
        <p className="font-medium text-slate-700">Redemption scanner ready for Phase 7</p>
      </div>
    </div>
  );
};
