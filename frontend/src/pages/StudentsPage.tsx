import React, { useState, useEffect, useCallback, useRef } from "react";
import { api, ApiClientError } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../components/common/Toast";
import { DataTable, Column } from "../components/common/DataTable";
import { StatusBadge } from "../components/common/StatusBadge";
import { Modal } from "../components/common/Modal";
import { ConfirmDialog } from "../components/common/ConfirmDialog";
import { Upload, RefreshCw, PhoneOff, FileText, CheckCircle2, AlertTriangle } from "lucide-react";

interface StudentItem {
  id: string;
  rollNo: string;
  name: string;
  email: string;
  department: string;
  active: boolean;
  mess: { id: string; code: string; name: string };
  whatsappStatus: "LINKED" | "NOT_LINKED";
  whatsappPhoneMasked: string | null;
  whatsappVerifiedAt: string | null;
  createdAt: string;
}

interface StudentListResponse {
  items: StudentItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface ImportResult {
  dryRun: boolean;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  createdCount: number;
  updatedCount: number;
  errors: Array<{ line: number; rollNo?: string; error: string }>;
  preview?: Array<{
    rollNo: string;
    name: string;
    email: string;
    department: string;
    messName: string;
    action: "CREATE" | "UPDATE";
  }>;
}

export const StudentsPage: React.FC = () => {
  const { can } = useAuth();
  const toast = useToast();

  // Student table state
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalItems, setTotalItems] = useState<number>(0);

  // Selected student for reset WhatsApp
  const [resetTarget, setResetTarget] = useState<StudentItem | null>(null);
  const [resetLoading, setResetLoading] = useState<boolean>(false);

  // Import Modal State
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState<boolean>(true);
  const [importing, setImporting] = useState<boolean>(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchStudents = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<StudentListResponse>("/students", {
        search,
        page,
        pageSize: 15,
      });
      setStudents(data.items);
      setTotalPages(data.totalPages);
      setTotalItems(data.total);
    } catch (err) {
      if (err instanceof ApiClientError) {
        toast.error("Failed to load students", err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [search, page, toast]);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  const handleResetWhatsApp = async () => {
    if (!resetTarget) return;
    setResetLoading(true);
    try {
      await api.post(`/students/${resetTarget.id}/reset-whatsapp`);
      toast.success(
        "WhatsApp Identity Reset",
        `Student ${resetTarget.rollNo} (${resetTarget.name}) unlinked successfully.`,
      );
      setResetTarget(null);
      fetchStudents();
    } catch (err) {
      if (err instanceof ApiClientError) {
        toast.error("Reset Failed", err.message);
      }
    } finally {
      setResetLoading(false);
    }
  };

  const handleImportSubmit = async (runAsDry: boolean) => {
    if (!importFile) return;
    setImporting(true);

    try {
      const formData = new FormData();
      formData.append("file", importFile);

      const result = await api.upload<ImportResult>(
        `/students/import?dryRun=${runAsDry}`,
        formData,
      );

      setImportResult(result);

      if (!runAsDry) {
        toast.success(
          "Roster Imported",
          `Successfully processed ${result.validRows} students (${result.createdCount} new, ${result.updatedCount} updated).`,
        );
        fetchStudents();
      } else {
        toast.info(
          "Dry Run Complete",
          `${result.validRows} valid rows, ${result.invalidRows} errors found.`,
        );
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        toast.error("Import Failed", err.message);
      }
    } finally {
      setImporting(false);
    }
  };

  const columns: Column<StudentItem>[] = [
    {
      key: "rollNo",
      header: "Roll Number",
      render: (s) => <span className="font-mono font-semibold text-slate-900">{s.rollNo}</span>,
    },
    {
      key: "name",
      header: "Name",
      render: (s) => (
        <div>
          <p className="font-medium text-slate-800">{s.name}</p>
          <p className="text-xs text-slate-400">{s.email}</p>
        </div>
      ),
    },
    {
      key: "department",
      header: "Department",
    },
    {
      key: "mess",
      header: "Assigned Mess",
      render: (s) => (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800">
          {s.mess.name}
        </span>
      ),
    },
    {
      key: "whatsapp",
      header: "WhatsApp",
      render: (s) => (
        <div className="flex flex-col gap-0.5">
          <StatusBadge status={s.whatsappStatus} />
          {s.whatsappPhoneMasked && (
            <span className="text-[11px] font-mono text-slate-400">{s.whatsappPhoneMasked}</span>
          )}
        </div>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      className: "text-right",
      render: (s) => (
        <div className="flex items-center justify-end gap-2">
          {can("student:reset_whatsapp") && s.whatsappStatus === "LINKED" && (
            <button
              onClick={() => setResetTarget(s)}
              title="Reset WhatsApp Identity"
              className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors focus:outline-none"
            >
              <PhoneOff className="w-4 h-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Student Directory</h1>
          <p className="text-sm text-slate-500 mt-1">
            Search active students, view assigned messes, and manage roster data.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchStudents()}
            className="p-2 border border-slate-200 rounded-lg bg-white text-slate-600 hover:bg-slate-50 focus:outline-none"
            title="Refresh list"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>

          {can("student:import") && (
            <button
              onClick={() => {
                setImportFile(null);
                setImportResult(null);
                setDryRun(true);
                setIsImportModalOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <Upload className="w-4 h-4" />
              <span>Import Roster CSV</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Students Table */}
      <DataTable
        columns={columns}
        data={students}
        loading={loading}
        search={search}
        onSearchChange={(val) => {
          setSearch(val);
          setPage(1);
        }}
        searchPlaceholder="Search by roll number, name, email..."
        page={page}
        totalPages={totalPages}
        totalItems={totalItems}
        onPageChange={(p) => setPage(p)}
        emptyMessage="No students found matching your search."
      />

      {/* Reset WhatsApp Confirm Dialog */}
      <ConfirmDialog
        isOpen={Boolean(resetTarget)}
        onClose={() => setResetTarget(null)}
        onConfirm={handleResetWhatsApp}
        title="Reset WhatsApp Identity"
        message={`Are you sure you want to unlink the registered phone number for ${resetTarget?.name} (${resetTarget?.rollNo})? They will need to verify their identity again via WhatsApp.`}
        confirmLabel="Unlink Phone"
        isDanger={true}
        loading={resetLoading}
      />

      {/* CSV Import Modal */}
      <Modal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        title="Import Student Roster"
        description="Upload a CSV file containing student enrollment records (ADR A13: Roll, Name, Email, Department, Mess)."
        maxWidth="2xl"
      >
        <div className="space-y-5">
          {/* File Picker Drag & Drop */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
              importFile
                ? "border-emerald-400 bg-emerald-50/30"
                : "border-slate-300 hover:border-slate-400 bg-slate-50/50"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setImportFile(f);
                  setImportResult(null);
                }
              }}
            />
            <div className="flex flex-col items-center justify-center gap-2">
              <div className="p-3 bg-white rounded-full border border-slate-200 text-slate-500 shadow-sm">
                <FileText className="w-6 h-6 text-emerald-600" />
              </div>
              {importFile ? (
                <div>
                  <p className="text-sm font-semibold text-slate-800">{importFile.name}</p>
                  <p className="text-xs text-slate-400">
                    {(importFile.size / 1024).toFixed(1)} KB — Click to change file
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-sm font-semibold text-slate-700">
                    Click to browse or drop CSV here
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Headers:{" "}
                    <code className="text-slate-600">roll, name, email, department, mess</code>
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Dry Run Checkbox */}
          <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-lg border border-slate-200">
            <div>
              <label
                htmlFor="dry-run"
                className="text-sm font-medium text-slate-800 cursor-pointer"
              >
                Validate Only (Dry Run)
              </label>
              <p className="text-xs text-slate-500">
                Check for schema errors, duplicate rolls, and invalid emails without saving to
                database.
              </p>
            </div>
            <input
              id="dry-run"
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
            />
          </div>

          {/* Import Results & Validation Summary */}
          {importResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div className="p-2.5 rounded-lg bg-slate-100 border border-slate-200">
                  <p className="text-slate-500">Total Rows</p>
                  <p className="text-base font-bold text-slate-800 mt-0.5">
                    {importResult.totalRows}
                  </p>
                </div>
                <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200">
                  <p className="text-emerald-600">Valid Rows</p>
                  <p className="text-base font-bold text-emerald-800 mt-0.5">
                    {importResult.validRows}
                  </p>
                </div>
                <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200">
                  <p className="text-rose-600">Errors</p>
                  <p className="text-base font-bold text-rose-800 mt-0.5">
                    {importResult.invalidRows}
                  </p>
                </div>
                <div className="p-2.5 rounded-lg bg-sky-50 border border-sky-200">
                  <p className="text-sky-600">New / Updates</p>
                  <p className="text-base font-bold text-sky-800 mt-0.5">
                    {importResult.createdCount} / {importResult.updatedCount}
                  </p>
                </div>
              </div>

              {/* Errors list if any */}
              {importResult.errors.length > 0 && (
                <div className="border border-rose-200 rounded-lg bg-rose-50/50 p-3 max-h-40 overflow-y-auto">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-800 mb-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    <span>Row Validation Errors ({importResult.errors.length}):</span>
                  </div>
                  <div className="space-y-1 text-xs">
                    {importResult.errors.map((err, idx) => (
                      <div key={idx} className="flex gap-2 text-rose-700">
                        <span className="font-mono font-medium">Line {err.line}:</span>
                        <span>{err.error}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Preview table in dry run */}
              {importResult.preview && importResult.preview.length > 0 && (
                <div className="border border-slate-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0">
                      <tr>
                        <th className="p-2">Roll</th>
                        <th className="p-2">Name</th>
                        <th className="p-2">Department</th>
                        <th className="p-2">Mess</th>
                        <th className="p-2">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {importResult.preview.map((p, idx) => (
                        <tr key={idx}>
                          <td className="p-2 font-mono font-medium">{p.rollNo}</td>
                          <td className="p-2">{p.name}</td>
                          <td className="p-2">{p.department}</td>
                          <td className="p-2">{p.messName}</td>
                          <td className="p-2">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                p.action === "CREATE"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-sky-100 text-sky-800"
                              }`}
                            >
                              {p.action}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Modal Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsImportModalOpen(false)}
              className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 bg-white hover:bg-slate-50"
            >
              Close
            </button>

            {dryRun ? (
              <button
                type="button"
                disabled={!importFile || importing}
                onClick={() => handleImportSubmit(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-slate-800 hover:bg-slate-900 disabled:opacity-50"
              >
                {importing && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                <span>Run Dry Run Validation</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={
                  !importFile || importing || Boolean(importResult && importResult.validRows === 0)
                }
                onClick={() => handleImportSubmit(false)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
              >
                {importing && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                <CheckCircle2 className="w-4 h-4" />
                <span>Import {importResult ? `${importResult.validRows} Records` : "Now"}</span>
              </button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
};
