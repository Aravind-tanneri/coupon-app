import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ReimbursementsPage } from "./ReimbursementsPage";
import { ToastProvider } from "../components/common/Toast";
import { api } from "../lib/api";

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: "admin-1",
      name: "Admin Officer",
      role: "SUPER_ADMIN",
      messId: "akshaya",
      permissions: [
        "reimbursement:view",
        "reimbursement:review",
        "reimbursement:approve",
        "policy:manage",
      ],
    },
    loading: false,
    can: () => true,
  }),
}));

vi.mock("../lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
  ApiClientError: class ApiClientError extends Error {
    code = "ERROR";
    status = 400;
  },
}));

describe("ReimbursementsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/reimbursements/stats") {
        return {
          submitted: 5,
          underReview: 3,
          approved: 8,
          paid: 12,
          infoRequested: 1,
          totalActive: 17,
        };
      }
      if (path === "/reimbursements") {
        return {
          items: [
            {
              id: "claim-1",
              publicRef: "CLM-2026-TEST1",
              messId: "akshaya",
              studentId: "s1",
              startDate: "2026-10-10",
              endDate: "2026-10-17",
              countedDays: 6,
              rateAtClaimPaise: 13100,
              claimedAmountPaise: 78600,
              approvedAmountPaise: null,
              status: "SUBMITTED",
              version: 1,
              reason: "Attending hackathon",
              rejectionReason: null,
              studentSnapshot: {
                name: "Rahul Verma",
                rollNo: "2024CS09",
                department: "CSE",
                messCode: "AKSHAYA",
              },
              student: {
                id: "s1",
                name: "Rahul Verma",
                rollNo: "2024CS09",
                department: "CSE",
              },
              mess: { id: "akshaya", code: "AKSHAYA", name: "Akshaya Mess" },
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        };
      }
      if (path === "/reimbursement-policy") {
        return [
          {
            id: "pol-1",
            messId: "akshaya",
            dailyRatePaise: 13100,
            minAbsenceDays: 4,
            effectiveFrom: "2026-01-01",
            effectiveUntil: null,
            claimDeadlineDays: 30,
            maxAbsenceDays: null,
            documentRequired: false,
            createdAt: new Date().toISOString(),
          },
        ];
      }
      if (path === "/reimbursements/claim-1") {
        return {
          id: "claim-1",
          publicRef: "CLM-2026-TEST1",
          messId: "akshaya",
          studentId: "s1",
          startDate: "2026-10-10",
          endDate: "2026-10-17",
          countedDays: 6,
          rateAtClaimPaise: 13100,
          claimedAmountPaise: 78600,
          approvedAmountPaise: null,
          status: "SUBMITTED",
          version: 1,
          reason: "Attending hackathon",
          maskedPayout: "******1234",
          student: {
            id: "s1",
            name: "Rahul Verma",
            rollNo: "2024CS09",
            department: "CSE",
          },
          mess: { id: "akshaya", code: "AKSHAYA", name: "Akshaya Mess" },
          calculationBreakdown: {
            startDate: "2026-10-10",
            endDate: "2026-10-17",
            departureDateExcluded: "2026-10-10",
            returnDateExcluded: "2026-10-17",
            countedDays: 6,
            rateAtClaimPaise: 13100,
            claimablePaise: 78600,
            segments: [],
          },
          documents: [],
          statusHistory: [],
          payments: [],
        };
      }
      return {};
    });
  });

  it("renders the stats cards and claims table", async () => {
    render(
      <ToastProvider>
        <ReimbursementsPage />
      </ToastProvider>,
    );

    expect(screen.getByText("Reimbursement Pipeline & Policy")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("CLM-2026-TEST1")).toBeInTheDocument();
      expect(screen.getByText("Rahul Verma")).toBeInTheDocument();
      expect(screen.getByText("6 days")).toBeInTheDocument();
    });
  });

  it("opens claim detail modal with calculation breakdown", async () => {
    render(
      <ToastProvider>
        <ReimbursementsPage />
      </ToastProvider>,
    );

    const reviewBtn = await screen.findByRole("button", { name: /review claim/i });
    fireEvent.click(reviewBtn);

    expect(await screen.findByText(/ADR A1 Calculation Breakdown/i)).toBeInTheDocument();
    expect(screen.getByText("6 full days")).toBeInTheDocument();
    expect(screen.getByText(/Attending hackathon/i)).toBeInTheDocument();
    expect(screen.getByText(/Start Review/i)).toBeInTheDocument();
  });

  it("switches to the policies tab and displays active policy", async () => {
    render(
      <ToastProvider>
        <ReimbursementsPage />
      </ToastProvider>,
    );

    const policiesTabBtn = screen.getByRole("button", { name: /reimbursement policies/i });
    fireEvent.click(policiesTabBtn);

    expect(await screen.findByText("Active Policy in Effect")).toBeInTheDocument();
    expect(screen.getByText("Immutable Policy Audit Log")).toBeInTheDocument();
  });
});
