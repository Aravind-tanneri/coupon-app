import React from "react";
import { Settings } from "lucide-react";

export const SettingsPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">System & Mess Settings</h1>
        <p className="text-sm text-slate-500 mt-1">
          Global parameters, notification webhook configurations, and mess definitions.
        </p>
      </div>
      <div className="p-8 bg-white border border-slate-200 rounded-xl text-center text-slate-500">
        <Settings className="w-10 h-10 text-slate-400 mx-auto mb-2" />
        <p className="font-medium text-slate-700">Settings panel ready for Phase 12</p>
      </div>
    </div>
  );
};
