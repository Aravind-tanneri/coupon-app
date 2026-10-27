import React from "react";
import { Receipt } from "lucide-react";

export const ReimbursementsPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Reimbursement Claims</h1>
        <p className="text-sm text-slate-500 mt-1">
          Review, approve, and disburse student leave rebates based on active daily policy.
        </p>
      </div>
      <div className="p-8 bg-white border border-slate-200 rounded-xl text-center text-slate-500">
        <Receipt className="w-10 h-10 text-slate-400 mx-auto mb-2" />
        <p className="font-medium text-slate-700">Reimbursement pipeline ready for Phase 9</p>
      </div>
    </div>
  );
};
