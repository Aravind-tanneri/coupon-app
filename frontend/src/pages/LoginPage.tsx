import React, { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { ApiClientError } from "../lib/api";
import {
  Utensils,
  Lock,
  Mail,
  AlertCircle,
  Sparkles,
  CheckCircle2,
  ShieldCheck,
  QrCode,
} from "lucide-react";
import { ResetPasswordModal } from "../components/auth/ResetPasswordModal";

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const handleSubmit = async (
    e?: React.FormEvent,
    overrideEmail?: string,
    overridePass?: string,
  ) => {
    if (e) e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setLoading(true);

    const loginEmail = overrideEmail ?? email;
    const loginPass = overridePass ?? password;

    try {
      await login(loginEmail, loginPass);
      const redirect = searchParams.get("redirect") || "/";
      navigate(redirect, { replace: true });
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError("An unexpected error occurred. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemoLogin = async (demoEmail: string, demoPassword: string) => {
    setEmail(demoEmail);
    setPassword(demoPassword);
    await handleSubmit(undefined, demoEmail, demoPassword);
  };

  const handleFillCredentials = (demoEmail: string, demoPassword: string) => {
    setEmail(demoEmail);
    setPassword(demoPassword);
    setError(null);
    setSuccessMessage(`Credentials for ${demoEmail} populated in the form.`);
  };

  const handlePasswordResetSuccess = ({
    email: resetEmail,
    newPassword: resetPassword,
  }: {
    email: string;
    newPassword: string;
  }) => {
    setEmail(resetEmail);
    setPassword(resetPassword);
    setError(null);
    setSuccessMessage(
      "Password reset successful! You can now sign in with your updated credentials.",
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="w-12 h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center mx-auto shadow-md">
          <Utensils className="w-6 h-6" />
        </div>
        <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">
          Campus Mess System
        </h2>
        <p className="mt-1 text-sm text-slate-500">Admin portal & staff operational console</p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-sm border border-slate-200 sm:rounded-xl sm:px-10">
          {/* Error Banner */}
          {error && (
            <div className="mb-6 p-4 rounded-lg bg-rose-50 border border-rose-200 flex items-start gap-3 text-rose-800 text-sm">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">{error}</div>
            </div>
          )}

          {/* Success Banner */}
          {successMessage && (
            <div className="mb-6 p-4 rounded-lg bg-emerald-50 border border-emerald-200 flex items-start gap-3 text-emerald-800 text-sm">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="flex-1">{successMessage}</div>
            </div>
          )}

          <form onSubmit={(e) => handleSubmit(e)} className="space-y-5">
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-semibold text-slate-700 uppercase tracking-wider"
              >
                Email Address
              </label>
              <div className="mt-1.5 relative rounded-lg shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@campus.edu"
                  className="block w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label
                  htmlFor="password"
                  className="block text-xs font-semibold text-slate-700 uppercase tracking-wider"
                >
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => setIsResetModalOpen(true)}
                  className="text-xs font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
                >
                  Forgot password?
                </button>
              </div>
              <div className="mt-1.5 relative rounded-lg shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="block w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center items-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:opacity-50 transition-colors"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  "Sign in to Console"
                )}
              </button>
            </div>
          </form>

          {/* Quick Demo Login Presets */}
          <div className="mt-6 pt-5 border-t border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                One-Click Demo Login
              </span>
              <span className="text-[10px] font-medium bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200">
                Evaluation Mode
              </span>
            </div>

            <div className="space-y-2.5">
              {/* Super Admin Preset */}
              <div className="p-3 bg-slate-50 hover:bg-emerald-50/50 rounded-xl border border-slate-200 hover:border-emerald-200 transition-all">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-800">Super Admin</div>
                      <div className="text-[11px] text-slate-500 font-mono">admin@campus.edu</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        handleFillCredentials("admin@campus.edu", "SuperAdminPassword123!")
                      }
                      className="px-2 py-1 text-[11px] font-medium text-slate-600 bg-white hover:bg-slate-100 rounded-md border border-slate-200 transition-colors"
                      title="Populate credentials in form"
                    >
                      Fill
                    </button>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() =>
                        handleQuickDemoLogin("admin@campus.edu", "SuperAdminPassword123!")
                      }
                      className="px-2.5 py-1 text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md shadow-sm transition-colors disabled:opacity-50"
                    >
                      ⚡ Login
                    </button>
                  </div>
                </div>
              </div>

              {/* Counter Staff Preset */}
              <div className="p-3 bg-slate-50 hover:bg-sky-50/50 rounded-xl border border-slate-200 hover:border-sky-200 transition-all">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center">
                      <QrCode className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-800">Counter Staff</div>
                      <div className="text-[11px] text-slate-500 font-mono">staff@campus.edu</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleFillCredentials("staff@campus.edu", "StaffPassword123!")}
                      className="px-2 py-1 text-[11px] font-medium text-slate-600 bg-white hover:bg-slate-100 rounded-md border border-slate-200 transition-colors"
                      title="Populate credentials in form"
                    >
                      Fill
                    </button>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => handleQuickDemoLogin("staff@campus.edu", "StaffPassword123!")}
                      className="px-2.5 py-1 text-[11px] font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-md shadow-sm transition-colors disabled:opacity-50"
                    >
                      ⚡ Login
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-100 text-center">
            <p className="text-[11px] text-slate-400">
              Protected by multi-tier rate limiting and CSPRNG session tokens.
            </p>
          </div>
        </div>
      </div>

      {/* Password Reset Modal */}
      <ResetPasswordModal
        isOpen={isResetModalOpen}
        onClose={() => setIsResetModalOpen(false)}
        initialEmail={email || "admin@campus.edu"}
        onSuccess={handlePasswordResetSuccess}
      />
    </div>
  );
};
