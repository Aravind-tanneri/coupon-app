import React from "react";
import { Gift } from "lucide-react";

export const GiftsPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Admin Gift Batches</h1>
        <p className="text-sm text-slate-500 mt-1">
          Issue complimentary coupons for campus events, guests, and special festivals.
        </p>
      </div>
      <div className="p-8 bg-white border border-slate-200 rounded-xl text-center text-slate-500">
        <Gift className="w-10 h-10 text-slate-400 mx-auto mb-2" />
        <p className="font-medium text-slate-700">Gift issuance system ready for Phase 10</p>
      </div>
    </div>
  );
};
