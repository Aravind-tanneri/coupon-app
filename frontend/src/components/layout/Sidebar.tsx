import React from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import {
  LayoutDashboard,
  UtensilsCrossed,
  Ticket,
  QrCode,
  MessageSquare,
  Receipt,
  Gift,
  Users,
  ShieldCheck,
  History,
  Settings,
  LogOut,
  X,
} from "lucide-react";

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
  roleRequired?: "SUPER_ADMIN";
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/menus", label: "Menu Planner", icon: UtensilsCrossed, permission: "menu:view" },
  { to: "/coupons", label: "Coupons", icon: Ticket, permission: "coupon:view" },
  { to: "/redemptions", label: "Redemptions", icon: QrCode, permission: "redemption:view" },
  { to: "/feedback", label: "Feedback", icon: MessageSquare, permission: "feedback:view" },
  {
    to: "/reimbursements",
    label: "Reimbursements",
    icon: Receipt,
    permission: "reimbursement:view",
  },
  { to: "/gifts", label: "Gifts", icon: Gift, permission: "gift:view" },
  { to: "/students", label: "Student Roster", icon: Users, permission: "student:view" },
  { to: "/users", label: "Admin & Staff", icon: ShieldCheck, roleRequired: "SUPER_ADMIN" },
  { to: "/audit", label: "Audit Log", icon: History, roleRequired: "SUPER_ADMIN" },
  { to: "/settings", label: "Settings", icon: Settings, roleRequired: "SUPER_ADMIN" },
];

export const Sidebar: React.FC<SidebarProps> = ({ mobileOpen, onMobileClose }) => {
  const { user, logout, can } = useAuth();

  const filteredNavItems = NAV_ITEMS.filter((item) => {
    if (!user) return false;
    if (item.roleRequired && user.role !== item.roleRequired) return false;
    if (item.permission && !can(item.permission)) return false;
    return true;
  });

  return (
    <>
      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm lg:hidden"
          onClick={onMobileClose}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-slate-900 text-slate-300 flex flex-col transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static lg:z-auto ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand Header */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500 text-white flex items-center justify-center font-bold text-sm shadow-sm">
              CM
            </div>
            <div>
              <h1 className="font-semibold text-white tracking-tight text-sm">Campus Mess</h1>
              <span className="text-[10px] text-emerald-400 font-mono uppercase tracking-wider block">
                {user?.role.replace("_", " ") || "STAFF"}
              </span>
            </div>
          </div>
          <button
            onClick={onMobileClose}
            className="lg:hidden p-1 rounded-lg text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mess Scoping Notice */}
        <div className="px-4 py-2.5 bg-slate-800/50 border-b border-slate-800 text-xs">
          <span className="text-slate-400">Context: </span>
          <span className="font-medium text-emerald-400">
            {user?.role === "SUPER_ADMIN" ? "All Messes (Global)" : "Assigned Mess"}
          </span>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {filteredNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                onClick={onMobileClose}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-white hover:bg-slate-800/70"
                  }`
                }
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* User Profile Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/80">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-white truncate">{user?.name}</p>
              <p className="text-[11px] text-slate-400 truncate">{user?.email}</p>
            </div>
            <button
              onClick={() => logout()}
              title="Sign Out"
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors focus:outline-none"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
