import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { ShieldAlert } from "lucide-react";

export interface RequirePermissionProps {
  permission: string;
  children: React.ReactElement;
}

export const RequirePermission: React.FC<RequirePermissionProps> = ({ permission, children }) => {
  const { can } = useAuth();

  if (!can(permission)) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 p-8 text-center shadow-sm">
          <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Access Restricted</h2>
          <p className="text-slate-500 text-sm mt-2">
            You do not have the required permission (
            <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded text-rose-700 font-mono">
              {permission}
            </code>
            ) to access this module.
          </p>
          <div className="mt-6">
            <Link
              to="/"
              className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              Return to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return children;
};
