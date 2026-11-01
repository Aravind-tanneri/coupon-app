import React, { useState, useEffect, useRef, useCallback } from "react";
import { api, ApiClientError } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../components/common/Toast";
import { DataTable, Column } from "../components/common/DataTable";
import { StatusBadge } from "../components/common/StatusBadge";
import { ISTDateDisplay } from "../components/common/ISTDateDisplay";
import {
  QrCode,
  Camera,
  CameraOff,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Search,
  Volume2,
  VolumeX,
  History,
  ShieldCheck,
  UserCheck,
  Utensils,
  Clock,
  Sparkles,
  ArrowRight,
} from "lucide-react";

type MealType = "BREAKFAST" | "LUNCH" | "SNACKS" | "DINNER" | "SPECIAL_DINNER";

interface StudentPreview {
  id: string;
  rollNo: string;
  name: string;
  department: string;
}

interface CouponPreview {
  id: string;
  shortCode: string;
  mealType: MealType;
  validDate: string;
  status: "ACTIVE" | "REDEEMED" | "EXPIRED" | "REVOKED";
  redeemedAt?: string | null;
  expiresAt: string;
  student: StudentPreview;
  mess?: { id: string; code: string; name: string };
}

interface LookupResponse {
  success: boolean;
  canRedeem: boolean;
  reason?: string;
  message: string;
  coupon?: CouponPreview;
}

interface RedemptionSummary {
  date: string;
  totalRedeemedToday: number;
  byMeal: Record<MealType, number>;
  recentFeed: Array<{
    id: string;
    shortCode: string;
    mealType: MealType;
    redeemedAt: string;
    student: {
      rollNo: string;
      name: string;
      department: string;
    };
    product?: { code: string };
  }>;
}

interface RedemptionRecord {
  id: string;
  shortCode: string;
  mealType: MealType;
  validDate: string;
  status: string;
  redeemedAt: string;
  redeemedById?: string;
  student: StudentPreview;
  mess: { id: string; name: string };
}

interface PaginatedRedemptions {
  items: RedemptionRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Web Audio API Sound Synthesizer (zero dependencies)
function playAudioFeedback(type: "success" | "error") {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    if (type === "success") {
      // Pleasant two-tone chime
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = "sine";
      osc2.type = "sine";
      osc1.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc2.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5

      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.12);
      osc2.start(ctx.currentTime + 0.1);
      osc2.stop(ctx.currentTime + 0.35);
    } else {
      // Low buzzer
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(160, ctx.currentTime);
      osc.frequency.setValueAtTime(110, ctx.currentTime + 0.15);

      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    }
  } catch {
    // Audio context may be restricted by browser policy before user interaction
  }
}

export const RedemptionsPage: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<"counter" | "history">("counter");
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Manual Input State (Crockford Base32)
  const [manualCode, setManualCode] = useState<string>("");
  const [isLookingUp, setIsLookingUp] = useState<boolean>(false);
  const [isRedeeming, setIsRedeeming] = useState<boolean>(false);

  // Preview / Verification State
  const [lookupResult, setLookupResult] = useState<LookupResponse | null>(null);
  const [lastRedeemedResult, setLastRedeemedResult] = useState<{
    studentName: string;
    studentRoll: string;
    mealType: MealType;
    shortCode: string;
    redeemedAt: string;
  } | null>(null);

  // Live Summary & Counter Stats
  const [summary, setSummary] = useState<RedemptionSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState<boolean>(false);

  // History Tab State
  const [historyData, setHistoryData] = useState<PaginatedRedemptions>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  });
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [historySearch, setHistorySearch] = useState<string>("");
  const [historyMealFilter, setHistoryMealFilter] = useState<string>("");
  const [historyDateFilter, setHistoryDateFilter] = useState<string>("");

  // Camera QR Scanner State
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<number | null>(null);

  // Fetch Summary
  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const data = await api.get<RedemptionSummary>("/redemptions/summary", {
        messId: user?.messId || undefined,
      });
      setSummary(data);
    } catch {
      // Non-fatal
    } finally {
      setSummaryLoading(false);
    }
  }, [user?.messId]);

  // Fetch History
  const fetchHistory = useCallback(
    async (page = 1) => {
      setHistoryLoading(true);
      try {
        const data = await api.get<PaginatedRedemptions>("/redemptions", {
          page,
          pageSize: 20,
          messId: user?.messId || undefined,
          mealType: historyMealFilter || undefined,
          date: historyDateFilter || undefined,
          search: historySearch.trim() || undefined,
        });
        setHistoryData(data);
      } catch (err) {
        if (err instanceof ApiClientError) {
          toast.error("Failed to load history", err.message);
        }
      } finally {
        setHistoryLoading(false);
      }
    },
    [user?.messId, historyMealFilter, historyDateFilter, historySearch, toast],
  );

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    if (activeTab === "history") {
      fetchHistory(1);
    }
  }, [activeTab, fetchHistory]);

  // Clean and filter Crockford Base32 characters (0-9, A-Z excluding I, L, O, U)
  const handleManualCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.toUpperCase();
    const filtered = raw.replace(/[^0-9A-Z]/g, "").replace(/[ILOU]/g, "");
    setManualCode(filtered.slice(0, 8));
  };

  // Perform Lookup
  const performLookup = async (codeOrToken: string, isToken = false) => {
    const trimmed = codeOrToken.trim();
    if (!trimmed) return;

    setIsLookingUp(true);
    setLookupResult(null);

    try {
      const payload = isToken ? { token: trimmed } : { shortCode: trimmed.toUpperCase() };
      const res = await api.post<LookupResponse>("/redemptions/lookup", payload);
      setLookupResult(res);

      if (res.canRedeem) {
        if (soundEnabled) playAudioFeedback("success");
      } else {
        if (soundEnabled) playAudioFeedback("error");
      }
    } catch (err) {
      if (soundEnabled) playAudioFeedback("error");
      if (err instanceof ApiClientError) {
        setLookupResult({
          success: false,
          canRedeem: false,
          reason: err.code || "NOT_FOUND",
          message: err.message,
        });
      } else {
        setLookupResult({
          success: false,
          canRedeem: false,
          reason: "ERROR",
          message: "Failed to communicate with redemption service.",
        });
      }
    } finally {
      setIsLookingUp(false);
    }
  };

  // Auto-fill and lookup if ?code= is provided in URL
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const codeParam = params.get("code");
      if (codeParam) {
        const sanitized = codeParam
          .toUpperCase()
          .replace(/[^0-9A-Z]/g, "")
          .replace(/[ILOU]/g, "")
          .slice(0, 8);
        if (sanitized) {
          setManualCode(sanitized);
          performLookup(sanitized, false);
        }
      }
    }
  }, []);

  // Confirm and Consume Redemption
  const handleConfirmRedeem = async () => {
    if (!lookupResult?.coupon) return;
    setIsRedeeming(true);

    try {
      const payload = { shortCode: lookupResult.coupon.shortCode };
      const res = await api.post<CouponPreview>("/redemptions", payload);

      if (soundEnabled) playAudioFeedback("success");

      setLastRedeemedResult({
        studentName: res.student.name,
        studentRoll: res.student.rollNo,
        mealType: res.mealType,
        shortCode: res.shortCode,
        redeemedAt: new Date().toLocaleTimeString(),
      });

      toast.success(
        "Meal Redeemed Successfully",
        `${res.student.name} (${res.student.rollNo}) - ${res.mealType}`,
      );

      // Reset state for next scan
      setLookupResult(null);
      setManualCode("");
      fetchSummary();
    } catch (err) {
      if (soundEnabled) playAudioFeedback("error");
      if (err instanceof ApiClientError) {
        toast.error("Redemption Rejected", err.message);
        // Refresh lookup with latest state
        performLookup(lookupResult.coupon.shortCode, false);
      } else {
        toast.error("Error", "Unexpected redemption failure");
      }
    } finally {
      setIsRedeeming(false);
    }
  };

  // Camera controls
  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current) {
      window.clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setCameraActive(true);

      // Check BarcodeDetector support
      if ("BarcodeDetector" in window) {
        const detector = new (
          window as unknown as {
            BarcodeDetector: new (opt: { formats: string[] }) => {
              detect: (el: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>;
            };
          }
        ).BarcodeDetector({ formats: ["qr_code"] });

        scanIntervalRef.current = window.setInterval(async () => {
          if (videoRef.current && !isLookingUp && !isRedeeming) {
            try {
              const barcodes = await detector.detect(videoRef.current);
              if (barcodes.length > 0 && barcodes[0]?.rawValue) {
                const detectedVal = barcodes[0].rawValue;
                stopCamera();
                performLookup(detectedVal, true);
              }
            } catch {
              // Frame dropped, continue
            }
          }
        }, 300);
      }
    } catch {
      toast.error(
        "Camera Access Denied",
        "Could not access camera device. Please use manual code entry.",
      );
      stopCamera();
    }
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // History columns
  const historyColumns: Column<RedemptionRecord>[] = [
    {
      key: "shortCode",
      header: "Short Code",
      render: (r) => (
        <span className="font-mono font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded text-xs">
          {r.shortCode}
        </span>
      ),
    },
    {
      key: "student",
      header: "Student",
      render: (r) => (
        <div>
          <p className="font-semibold text-slate-900 text-sm">{r.student.name}</p>
          <p className="text-xs text-slate-500 font-mono">
            {r.student.rollNo} • {r.student.department}
          </p>
        </div>
      ),
    },
    {
      key: "mealType",
      header: "Meal",
      render: (r) => (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
          <Utensils className="w-3 h-3" />
          {r.mealType.replace("_", " ")}
        </span>
      ),
    },
    {
      key: "validDate",
      header: "Meal Date",
      render: (r) => <ISTDateDisplay date={r.validDate} format="short" />,
    },
    {
      key: "redeemedAt",
      header: "Redeemed At",
      render: (r) => (
        <ISTDateDisplay date={r.redeemedAt} format="datetime" className="text-xs text-slate-600" />
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusBadge status={r.status} />,
    },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-emerald-600 rounded-xl text-white shadow-md shadow-emerald-200">
            <QrCode className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Counter Redemption Console
              </h1>
              <span className="px-2 py-0.5 text-xs font-semibold bg-emerald-100 text-emerald-800 rounded-full">
                Live Scanner
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              Rapid coupon verification and atomic consumption for mess dining hall counter staff.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Sound Toggle */}
          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2 rounded-lg border text-sm font-medium transition-colors flex items-center gap-1.5 ${
              soundEnabled
                ? "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                : "bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100"
            }`}
            title={soundEnabled ? "Audio feedback active" : "Audio muted"}
          >
            {soundEnabled ? (
              <Volume2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <VolumeX className="w-4 h-4" />
            )}
            <span className="text-xs hidden md:inline">{soundEnabled ? "Sound ON" : "Muted"}</span>
          </button>

          {/* Tab Selector */}
          <div className="bg-slate-100 p-1 rounded-xl flex items-center">
            <button
              type="button"
              onClick={() => setActiveTab("counter")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === "counter"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <QrCode className="w-3.5 h-3.5 text-emerald-600" />
              Counter Scanner
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === "history"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <History className="w-3.5 h-3.5 text-blue-600" />
              Redemption Log
            </button>
          </div>
        </div>
      </div>

      {/* Daily Metrics Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-medium text-slate-500">Today's Total</span>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-2xl font-bold text-slate-900">
              {summary?.totalRedeemedToday ?? 0}
            </span>
            <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
              Served
            </span>
          </div>
        </div>

        {(["BREAKFAST", "LUNCH", "SNACKS", "DINNER", "SPECIAL_DINNER"] as MealType[]).map(
          (meal) => (
            <div
              key={meal}
              className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between"
            >
              <span className="text-xs font-medium text-slate-500 capitalize">
                {meal.toLowerCase().replace("_", " ")}
              </span>
              <div className="flex items-baseline justify-between mt-2">
                <span className="text-xl font-bold text-slate-800">
                  {summary?.byMeal[meal] ?? 0}
                </span>
                <Utensils className="w-3.5 h-3.5 text-slate-400" />
              </div>
            </div>
          ),
        )}
      </div>

      {/* MAIN VIEW: Counter Scanner */}
      {activeTab === "counter" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Scanner & Verification (8 cols) */}
          <div className="lg:col-span-8 space-y-6">
            {/* Success Toast Banner from Last Redemption */}
            {lastRedeemedResult && (
              <div className="p-4 bg-emerald-500 text-white rounded-2xl shadow-lg shadow-emerald-200 flex items-center justify-between animate-fadeIn">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/20 rounded-xl backdrop-blur-sm">
                    <CheckCircle2 className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-base leading-tight">
                      Confirmed: {lastRedeemedResult.studentName} ({lastRedeemedResult.studentRoll})
                    </h3>
                    <p className="text-xs text-emerald-100 mt-0.5">
                      Served {lastRedeemedResult.mealType} meal • Code{" "}
                      {lastRedeemedResult.shortCode} • {lastRedeemedResult.redeemedAt}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setLastRedeemedResult(null)}
                  className="px-2.5 py-1 text-xs bg-white/20 hover:bg-white/30 rounded-lg text-white font-medium"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Input Card: Dual Mode (Camera OR Manual Crockford 8-char Code) */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                  <h2 className="font-bold text-slate-900">Counter Input Mode</h2>
                </div>

                <div className="flex items-center gap-2">
                  {!cameraActive ? (
                    <button
                      type="button"
                      onClick={startCamera}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors shadow-sm"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      Start Camera Scanner
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-colors"
                    >
                      <CameraOff className="w-3.5 h-3.5" />
                      Stop Camera
                    </button>
                  )}
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* Camera Viewfinder if Active */}
                {cameraActive && (
                  <div className="relative rounded-2xl overflow-hidden bg-slate-900 aspect-video max-h-72 mx-auto flex items-center justify-center border-2 border-emerald-500 shadow-inner">
                    <video
                      ref={videoRef}
                      className="w-full h-full object-cover"
                      autoPlay
                      playsInline
                      muted
                    />
                    {/* Targeting Reticle */}
                    <div className="absolute inset-0 border-2 border-emerald-400/50 m-10 rounded-2xl pointer-events-none flex items-center justify-center">
                      <div className="w-48 h-48 border-2 border-emerald-400 rounded-xl relative animate-pulse">
                        <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-emerald-400 -mt-1 -ml-1" />
                        <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-emerald-400 -mt-1 -mr-1" />
                        <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-emerald-400 -mb-1 -ml-1" />
                        <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-emerald-400 -mb-1 -mr-1" />
                      </div>
                    </div>
                    <span className="absolute bottom-3 bg-black/60 text-white text-xs px-3 py-1 rounded-full backdrop-blur-sm font-medium">
                      Point camera at student QR code
                    </span>
                  </div>
                )}

                {/* Manual 8-Character Input Box */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                    Crockford Base32 Short Code (8 Characters)
                  </label>
                  <div className="flex gap-3">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={manualCode}
                        onChange={handleManualCodeChange}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && manualCode.length > 0) {
                            performLookup(manualCode, false);
                          }
                        }}
                        placeholder="e.g. 7K9X2MW4"
                        maxLength={8}
                        className="w-full px-4 py-3 text-2xl font-mono font-bold tracking-widest text-center text-slate-900 bg-slate-50 border-2 border-slate-200 rounded-xl focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-4 focus:ring-emerald-100 transition-all uppercase placeholder:text-slate-300"
                      />
                      <span className="absolute right-3 top-3.5 text-xs font-mono font-semibold text-slate-400">
                        {manualCode.length}/8
                      </span>
                    </div>

                    <button
                      type="button"
                      disabled={isLookingUp || manualCode.length === 0}
                      onClick={() => performLookup(manualCode, false)}
                      className="px-6 py-3 bg-slate-900 text-white font-bold text-sm rounded-xl hover:bg-slate-800 disabled:opacity-50 transition-colors flex items-center gap-2 shrink-0 shadow-sm"
                    >
                      {isLookingUp ? (
                        <RefreshCw className="w-4 h-4 animate-spin text-white" />
                      ) : (
                        <Search className="w-4 h-4" />
                      )}
                      Lookup
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 mt-2">
                    Enter the student's 8-character code or scan with a USB barcode gun. Ambiguous
                    characters (I, L, O, U) are automatically sanitized.
                  </p>

                  {/* Quick Demo Fill Buttons */}
                  <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-100">
                    <span className="text-xs font-semibold text-slate-500 flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Demo Codes:
                    </span>
                    {[
                      {
                        code: "TRAY8421",
                        label: "Lunch #1",
                        color:
                          "text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100",
                      },
                      {
                        code: "TRAY9923",
                        label: "Lunch #2",
                        color:
                          "text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100",
                      },
                      {
                        code: "EVEN7741",
                        label: "Dinner",
                        color: "text-sky-700 bg-sky-50 border-sky-200 hover:bg-sky-100",
                      },
                      {
                        code: "SPEC1001",
                        label: "Special",
                        color: "text-purple-700 bg-purple-50 border-purple-200 hover:bg-purple-100",
                      },
                    ].map((d) => (
                      <button
                        key={d.code}
                        type="button"
                        onClick={() => {
                          setManualCode(d.code);
                          performLookup(d.code, false);
                        }}
                        className={`px-2.5 py-1 text-xs font-mono font-bold rounded-lg border transition-all ${d.color} shadow-sm`}
                        title={`Auto-fill and verify ${d.code} (${d.label})`}
                      >
                        {d.code}{" "}
                        <span className="text-[10px] font-sans opacity-70 font-normal">
                          ({d.label})
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* PREVIEW & VERIFICATION CARD */}
            {lookupResult && (
              <div
                className={`rounded-2xl border-2 p-6 transition-all shadow-md ${
                  lookupResult.canRedeem
                    ? "bg-emerald-50/50 border-emerald-400"
                    : "bg-rose-50/50 border-rose-400"
                }`}
              >
                {/* Result Header */}
                <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200">
                  <div className="flex items-center gap-3">
                    <div
                      className={`p-3 rounded-xl ${
                        lookupResult.canRedeem
                          ? "bg-emerald-600 text-white shadow-md shadow-emerald-200"
                          : "bg-rose-600 text-white shadow-md shadow-rose-200"
                      }`}
                    >
                      {lookupResult.canRedeem ? (
                        <UserCheck className="w-6 h-6" />
                      ) : (
                        <AlertTriangle className="w-6 h-6" />
                      )}
                    </div>
                    <div>
                      <span
                        className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                          lookupResult.canRedeem
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-rose-100 text-rose-800"
                        }`}
                      >
                        {lookupResult.canRedeem
                          ? "Identity Verified • Ready to Serve"
                          : `Redemption Denied: ${lookupResult.reason || "REJECTED"}`}
                      </span>
                      <h3 className="text-xl font-bold text-slate-900 mt-1">
                        {lookupResult.coupon?.student.name || "Unknown Student"}
                      </h3>
                      <p className="text-xs text-slate-500 font-mono mt-0.5">
                        Roll: {lookupResult.coupon?.student.rollNo || "—"} • Dept:{" "}
                        {lookupResult.coupon?.student.department || "—"}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setLookupResult(null)}
                    className="text-slate-400 hover:text-slate-600 p-1"
                  >
                    <XCircle className="w-5 h-5" />
                  </button>
                </div>

                {/* Details Breakdown */}
                {lookupResult.coupon ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4 border-b border-slate-200 text-center sm:text-left">
                    <div>
                      <span className="text-xs text-slate-500 block">Meal Type</span>
                      <span className="font-bold text-sm text-slate-900 capitalize">
                        {lookupResult.coupon.mealType.replace("_", " ")}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block">Valid Date</span>
                      <ISTDateDisplay
                        date={lookupResult.coupon.validDate}
                        format="short"
                        className="font-bold text-sm text-slate-900"
                      />
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block">Short Code</span>
                      <span className="font-mono font-bold text-sm text-slate-800">
                        {lookupResult.coupon.shortCode}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block">Mess</span>
                      <span className="font-bold text-sm text-slate-900">
                        {lookupResult.coupon.mess?.name || "Akshaya"}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="py-4 text-sm text-rose-700 font-medium">
                    {lookupResult.message}
                  </div>
                )}

                {/* Action Area */}
                <div className="pt-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="text-xs text-slate-500">
                    {lookupResult.canRedeem
                      ? "Please visually confirm the student's ID card / face before pressing Confirm."
                      : lookupResult.message}
                  </div>

                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() => setLookupResult(null)}
                      className="flex-1 sm:flex-none px-4 py-2.5 border border-slate-300 rounded-xl text-sm font-semibold text-slate-700 bg-white hover:bg-slate-50 transition-colors"
                    >
                      Clear
                    </button>

                    {lookupResult.canRedeem && (
                      <button
                        type="button"
                        disabled={isRedeeming}
                        onClick={handleConfirmRedeem}
                        className="flex-1 sm:flex-none px-8 py-3 bg-emerald-600 text-white font-bold text-base rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-all shadow-md shadow-emerald-200 flex items-center justify-center gap-2"
                      >
                        {isRedeeming ? (
                          <RefreshCw className="w-5 h-5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-5 h-5" />
                        )}
                        Confirm & Redeem Meal
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Live Counter Feed (4 cols) */}
          <div className="lg:col-span-4 space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-emerald-600" />
                  <h3 className="font-bold text-sm text-slate-900">Live Counter Feed</h3>
                </div>
                <button
                  type="button"
                  onClick={fetchSummary}
                  disabled={summaryLoading}
                  className="p-1 text-slate-400 hover:text-slate-600"
                  title="Refresh live feed"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${summaryLoading ? "animate-spin" : ""}`} />
                </button>
              </div>

              <div className="mt-3 space-y-3 max-h-[500px] overflow-y-auto pr-1">
                {summary?.recentFeed && summary.recentFeed.length > 0 ? (
                  summary.recentFeed.map((item) => (
                    <div
                      key={item.id}
                      className="p-3 bg-slate-50 hover:bg-slate-100/80 rounded-xl transition-colors border border-slate-100 flex items-center justify-between"
                    >
                      <div>
                        <p className="font-semibold text-sm text-slate-900">{item.student.name}</p>
                        <p className="text-xs text-slate-500 font-mono">
                          {item.student.rollNo} • {item.mealType}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="font-mono text-xs font-bold text-slate-700 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                          {item.shortCode}
                        </span>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {new Date(item.redeemedAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-8 text-center text-slate-400 text-xs">
                    No meals redeemed yet today.
                  </div>
                )}
              </div>
            </div>

            {/* Quick Helper Tips Card */}
            <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-5 text-white shadow-md">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-200" />
                <h4 className="font-bold text-sm">Staff Fast-Key Tips</h4>
              </div>
              <ul className="text-xs space-y-2 mt-3 text-emerald-50">
                <li className="flex items-start gap-2">
                  <ArrowRight className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-200" />
                  <span>
                    Press <strong>Enter</strong> in the input box to immediately trigger code
                    lookup.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <ArrowRight className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-200" />
                  <span>
                    Hardware USB scanner guns input the code and press Enter automatically.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <ArrowRight className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-200" />
                  <span>
                    The atomic lock ensures a coupon cannot be double-redeemed even under concurrent
                    scans.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* HISTORY VIEW: Paginated Table */}
      {activeTab === "history" && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Historical Redemptions</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Audit trail of all meals claimed and consumed at dining hall counters.
              </p>
            </div>

            {/* Search & Filter Toolbar */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search roll no or code..."
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && fetchHistory(1)}
                  className="pl-9 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <select
                value={historyMealFilter}
                onChange={(e) => setHistoryMealFilter(e.target.value)}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 bg-white"
              >
                <option value="">All Meals</option>
                <option value="BREAKFAST">Breakfast</option>
                <option value="LUNCH">Lunch</option>
                <option value="SNACKS">Snacks</option>
                <option value="DINNER">Dinner</option>
                <option value="SPECIAL_DINNER">Special Dinner</option>
              </select>

              <input
                type="date"
                value={historyDateFilter}
                onChange={(e) => setHistoryDateFilter(e.target.value)}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 bg-white"
              />

              <button
                type="button"
                onClick={() => fetchHistory(1)}
                className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors"
              >
                Filter
              </button>
            </div>
          </div>

          <DataTable
            columns={historyColumns}
            data={historyData.items}
            loading={historyLoading}
            page={historyData.page}
            totalPages={historyData.totalPages}
            totalItems={historyData.total}
            onPageChange={(p) => fetchHistory(p)}
            emptyMessage="No redemptions found matching the selected filters."
          />
        </div>
      )}
    </div>
  );
};
