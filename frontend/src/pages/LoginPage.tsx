import React, { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuth } from "../contexts/AuthContext";
import { ApiClientError } from "../lib/api";
import { Utensils, Lock, Mail, Sparkles, ShieldCheck, QrCode } from "lucide-react";
import { ResetPasswordModal } from "../components/auth/ResetPasswordModal";
import gdscLogo from "../assets/gdsc-logo.jpg";

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    setLoading(true);

    const loginEmail = overrideEmail ?? email;
    const loginPass = overridePass ?? password;

    try {
      await login(loginEmail, loginPass);
      toast.success("Signed in successfully!");
      const redirect = searchParams.get("redirect") || "/";
      navigate(redirect, { replace: true });
    } catch (err) {
      if (err instanceof ApiClientError) {
        toast.error(err.message);
      } else {
        toast.error("An unexpected error occurred. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleFillCredentials = (demoEmail: string, demoPassword: string) => {
    setEmail(demoEmail);
    setPassword(demoPassword);
    toast.success(`Credentials populated for ${demoEmail}`);
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
    toast.success("Password reset successful! You can now sign in.");
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

          {/* Demo Accounts Presets */}
          <div className="mt-6 pt-5 border-t border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                Demo Accounts
              </span>
            </div>

            <div className="space-y-2.5">
              {/* Primary Demo Card: Aravind Tanneri */}
              <button
                type="button"
                onClick={() =>
                  handleFillCredentials("tanneriaravind2007@gmail.com", "SuperAdminPassword123!")
                }
                className="w-full text-left p-3 bg-emerald-50/70 hover:bg-emerald-100/70 rounded-xl border border-emerald-300 transition-all flex items-center justify-between group cursor-pointer"
                title="Click to populate credentials for tanneriaravind2007@gmail.com"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-emerald-950 group-hover:text-emerald-900">
                      Super Admin (Demo)
                    </div>
                    <div className="text-[11px] text-emerald-700 font-mono">
                      tanneriaravind2007@gmail.com
                    </div>
                  </div>
                </div>
                <span className="text-[11px] font-semibold text-emerald-700 group-hover:text-emerald-900">
                  Auto-fill &rarr;
                </span>
              </button>

              {/* Super Admin Preset Card */}
              <button
                type="button"
                onClick={() => handleFillCredentials("admin@campus.edu", "SuperAdminPassword123!")}
                className="w-full text-left p-3 bg-slate-50 hover:bg-emerald-50/60 rounded-xl border border-slate-200 hover:border-emerald-300 transition-all flex items-center justify-between group cursor-pointer"
                title="Click to populate Super Admin credentials"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-slate-200 text-slate-700 flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-800 group-hover:text-emerald-900">
                      Super Admin
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">admin@campus.edu</div>
                  </div>
                </div>
                <span className="text-[11px] font-medium text-slate-400 group-hover:text-emerald-600">
                  Auto-fill &rarr;
                </span>
              </button>

              {/* Counter Staff Preset Card */}
              <button
                type="button"
                onClick={() => handleFillCredentials("staff@campus.edu", "StaffPassword123!")}
                className="w-full text-left p-3 bg-slate-50 hover:bg-sky-50/60 rounded-xl border border-slate-200 hover:border-sky-300 transition-all flex items-center justify-between group cursor-pointer"
                title="Click to populate Counter Staff credentials"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
                    <QrCode className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-800 group-hover:text-sky-900">
                      Counter Staff
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">staff@campus.edu</div>
                  </div>
                </div>
                <span className="text-[11px] font-medium text-slate-400 group-hover:text-sky-600">
                  Auto-fill &rarr;
                </span>
              </button>
            </div>
          </div>

          {/* GDSC & @SolveWithAI Branding */}
          <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-center gap-2 text-xs">
            <img src={gdscLogo} alt="GDSC NIT AP" className="w-5 h-5 rounded object-contain" />
            <span className="font-semibold text-slate-700">GDSC NIT AP</span>
            <span className="text-slate-300">•</span>
            <span className="font-bold text-emerald-600">@SolveWithAI</span>
          </div>
        </div>
      </div>

      {/* Password Reset Modal */}
      <ResetPasswordModal
        isOpen={isResetModalOpen}
        onClose={() => setIsResetModalOpen(false)}
        initialEmail={email || "tanneriaravind2007@gmail.com"}
        onSuccess={handlePasswordResetSuccess}
      />
    </div>
  );
};
