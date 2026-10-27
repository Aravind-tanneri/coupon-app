import React from "react";
import { ShieldCheck } from "lucide-react";

export const UsersPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Admin & Staff Management
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Super Admin console for inviting, role-assignment, and managing mess staff credentials.
        </p>
      </div>
      <div className="p-8 bg-white border border-slate-200 rounded-xl text-center text-slate-500">
        <ShieldCheck className="w-10 h-10 text-slate-400 mx-auto mb-2" />
        <p className="font-medium text-slate-700">User management active</p>
      </div>
    </div>
  );
};
