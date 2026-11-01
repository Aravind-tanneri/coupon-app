import React, { useState, useEffect } from "react";
import {
  X,
  KeyRound,
  Mail,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import { api, ApiClientError } from "../../lib/api";

interface ResetPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialEmail?: string;
  onSuccess: (credentials: { email: string; newPassword: string }) => void;
}

type Step = "REQUEST" | "VERIFY" | "RESET" | "SUCCESS";

export const ResetPasswordModal: React.FC<ResetPasswordModalProps> = ({
  isOpen,
  onClose,
  initialEmail = "",
  onSuccess,
}) => {
  const [step, setStep] = useState<Step>("REQUEST");
  const [email, setEmail] = useState(initialEmail || "admin@campus.edu");
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [demoCode, setDemoCode] = useState("MESS-8492");
  const [countdown, setCountdown] = useState(30);
  const [resending, setResending] = useState(false);
  const [resendStatus, setResendStatus] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    if (step === "VERIFY" && countdown > 0) {
      timer = setInterval(() => {
        setCountdown((prev) => prev - 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [step, countdown]);

  if (!isOpen) return null;

  const handleSendToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResendStatus(null);
    if (!email || !email.includes("@")) {
      setError("Please enter a valid administrator email address.");
      return;
    }

    setLoading(true);
    try {
      // Call backend API if running; fallback seamlessly in demo mode
      const res = await api.post<{ demoToken?: string }>("/auth/forgot-password", { email });
      if (res.demoToken) {
        setDemoCode(res.demoToken);
      }
    } catch {
      // In mock/offline mode, keep default demo token
      setDemoCode("MESS-8492");
    } finally {
      setLoading(false);
      setCountdown(30);
      setStep("VERIFY");
    }
  };

  const handleResendOtp = async () => {
    if (countdown > 0 || resending) return;
    setResending(true);
    setError(null);
    setResendStatus(null);
    try {
      const res = await api.post<{ demoToken?: string }>("/auth/resend-otp", { email });
      if (res.demoToken) {
        setDemoCode(res.demoToken);
      }
      setResendStatus("A new verification code has been dispatched to your email.");
      setCountdown(30);
    } catch (err) {
      const msg =
        err instanceof ApiClientError ? err.message : "Failed to resend code. Please try again.";
      setError(msg);
    } finally {
      setResending(false);
    }
  };

  const handleVerifyToken = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleaned = token.trim().toUpperCase();
    if (!cleaned) {
      setError("Please enter the verification code.");
      return;
    }
    // Accept the demo code or any valid 6+ char token
    if (cleaned !== demoCode && cleaned.length < 6) {
      setError(`Invalid code. For demonstration, please use ${demoCode}`);
      return;
    }
    setStep("RESET");
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match. Please re-enter.");
      return;
    }

    setLoading(true);
    try {
      // Attempt backend update so database credentials are genuinely updated
      await api.post("/auth/reset-password", {
        email,
        token: token || demoCode,
        newPassword,
      });
    } catch (err) {
      // If user wasn't in db or offline, still succeed for mock workflow
      if (err instanceof ApiClientError && err.status === 400) {
        setError(err.message);
        setLoading(false);
        return;
      }
    } finally {
      setLoading(false);
    }

    setStep("SUCCESS");
  };

  const handleComplete = () => {
    onSuccess({ email, newPassword });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="relative bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 rounded-lg p-1 transition-colors"
          aria-label="Close reset modal"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Reset Password</h3>
            <p className="text-xs text-slate-500">Demo password recovery workflow</p>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 flex items-start gap-2 text-rose-800 text-xs">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="flex-1">{error}</div>
          </div>
        )}

        {/* Step 1: Request Token */}
        {step === "REQUEST" && (
          <form onSubmit={handleSendToken} className="space-y-4">
            <p className="text-sm text-slate-600">
              Enter your administrator email address. A mock authorization code will be generated
              for testing.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Admin Email
              </label>
              <div className="relative rounded-lg shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@campus.edu"
                  className="block w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:opacity-50 transition-colors"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <span>Generate Reset Token</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Step 2: Enter Token */}
        {step === "VERIFY" && (
          <form onSubmit={handleVerifyToken} className="space-y-4">
            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200">
              <div className="flex items-center justify-between text-xs font-semibold text-amber-900 mb-1">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-amber-600" />
                  Simulated Token Dispatched
                </span>
                <span className="px-2 py-0.5 bg-amber-200/60 rounded text-amber-800 font-mono">
                  {demoCode}
                </span>
              </div>
              <p className="text-xs text-amber-700">
                In demo mode, use the code above or click auto-fill to proceed.
              </p>
              <button
                type="button"
                onClick={() => setToken(demoCode)}
                className="mt-2 text-xs font-bold text-amber-800 underline hover:text-amber-900"
              >
                ⚡ Auto-fill Token ({demoCode})
              </button>
            </div>

            {resendStatus && (
              <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{resendStatus}</span>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Verification Code
                </label>
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={countdown > 0 || resending}
                  className="text-xs font-medium text-emerald-600 hover:text-emerald-700 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${resending ? "animate-spin" : ""}`} />
                  {resending ? (
                    <span>Sending...</span>
                  ) : countdown > 0 ? (
                    <span>Resend OTP ({countdown}s)</span>
                  ) : (
                    <span>Resend OTP</span>
                  )}
                </button>
              </div>
              <input
                type="text"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="e.g. MESS-8492"
                className="block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep("REQUEST")}
                className="w-1/3 py-2.5 px-3 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Back
              </button>
              <button
                type="submit"
                className="w-2/3 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 transition-colors"
              >
                <span>Verify & Proceed</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </form>
        )}

        {/* Step 3: Set New Password */}
        {step === "RESET" && (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <p className="text-sm text-slate-600">
              Create a new password for{" "}
              <span className="font-semibold text-slate-800">{email}</span>.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                New Password
              </label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className="block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Confirm New Password
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                className="block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep("VERIFY")}
                className="w-1/3 py-2.5 px-3 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading}
                className="w-2/3 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  "Update Password"
                )}
              </button>
            </div>
          </form>
        )}

        {/* Step 4: Success */}
        {step === "SUCCESS" && (
          <div className="text-center py-4 space-y-4">
            <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div>
              <h4 className="text-base font-bold text-slate-900">Password Reset Complete</h4>
              <p className="text-sm text-slate-500 mt-1">
                Your new password has been configured. You can now log into the console with your
                updated credentials.
              </p>
            </div>
            <div className="pt-2">
              <button
                onClick={handleComplete}
                className="w-full py-2.5 px-4 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 transition-colors shadow-sm"
              >
                Sign In with New Password
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
