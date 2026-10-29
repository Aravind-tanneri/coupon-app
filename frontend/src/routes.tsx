import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { RequireAuth } from "./components/auth/RequireAuth";
import { RequirePermission } from "./components/auth/RequirePermission";
import { DashboardLayout } from "./components/layout/DashboardLayout";

import { LoginPage } from "./pages/LoginPage";
import { StudentPurchasePage } from "./pages/StudentPurchasePage";
import { DashboardPage } from "./pages/DashboardPage";
import { MenusPage } from "./pages/MenusPage";
import { CouponsPage } from "./pages/CouponsPage";
import { RedemptionsPage } from "./pages/RedemptionsPage";
import { FeedbackPage } from "./pages/FeedbackPage";
import { ReimbursementsPage } from "./pages/ReimbursementsPage";
import { GiftsPage } from "./pages/GiftsPage";
import { StudentsPage } from "./pages/StudentsPage";
import { UsersPage } from "./pages/UsersPage";
import { AuditPage } from "./pages/AuditPage";
import { SettingsPage } from "./pages/SettingsPage";

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/buy" element={<StudentPurchasePage />} />

      {/* Protected Routes inside App Shell Layout */}
      <Route
        path="/"
        element={
          <RequireAuth>
            <DashboardLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />

        <Route
          path="menus"
          element={
            <RequirePermission permission="menu:view">
              <MenusPage />
            </RequirePermission>
          }
        />

        <Route
          path="coupons"
          element={
            <RequirePermission permission="coupon:view">
              <CouponsPage />
            </RequirePermission>
          }
        />

        <Route
          path="redemptions"
          element={
            <RequirePermission permission="redemption:view">
              <RedemptionsPage />
            </RequirePermission>
          }
        />

        <Route
          path="feedback"
          element={
            <RequirePermission permission="feedback:view">
              <FeedbackPage />
            </RequirePermission>
          }
        />

        <Route
          path="reimbursements"
          element={
            <RequirePermission permission="reimbursement:view">
              <ReimbursementsPage />
            </RequirePermission>
          }
        />

        <Route
          path="gifts"
          element={
            <RequirePermission permission="gift:view">
              <GiftsPage />
            </RequirePermission>
          }
        />

        <Route
          path="students"
          element={
            <RequirePermission permission="student:view">
              <StudentsPage />
            </RequirePermission>
          }
        />

        <Route
          path="users"
          element={
            <RequirePermission permission="user:manage">
              <UsersPage />
            </RequirePermission>
          }
        />

        <Route
          path="audit"
          element={
            <RequirePermission permission="audit:view">
              <AuditPage />
            </RequirePermission>
          }
        />

        <Route
          path="settings"
          element={
            <RequirePermission permission="settings:manage">
              <SettingsPage />
            </RequirePermission>
          }
        />
      </Route>

      {/* Catch-all redirect to Dashboard */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};
