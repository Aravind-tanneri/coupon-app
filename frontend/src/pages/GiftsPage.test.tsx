import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GiftsPage } from "./GiftsPage";
import { ToastProvider } from "../components/common/Toast";
import { api } from "../lib/api";

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: "admin-1",
      name: "Admin User",
      role: "ADMIN",
      messId: "akshaya",
      permissions: ["gift:view", "gift:issue", "gift:revoke", "gift:resend"],
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

describe("Phase 20: GiftsPage UI & Dashboard (§20.3, §20.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/gifts") {
        return {
          batches: [
            {
              id: "batch-1",
              messId: "akshaya",
              mess: { id: "akshaya", code: "AKSHAYA", name: "Akshaya Mess" },
              createdById: "admin-1",
              mealDate: "2026-11-05",
              message: "Diwali Special Dinner 2026",
              idempotencyKey: "key-1",
              status: "COMPLETED",
              createdAt: "2026-10-29T10:00:00Z",
              counts: {
                total: 2,
                active: 1,
                redeemed: 1,
                revoked: 0,
              },
            },
          ],
          total: 1,
          page: 1,
          pageSize: 10,
          totalPages: 1,
        };
      }
      if (path === "/students") {
        return {
          items: [
            {
              id: "stud-1",
              rollNo: "2024CS001",
              name: "Alice Johnson",
              email: "alice@campus.edu",
              department: "Computer Science",
              messId: "akshaya",
            },
            {
              id: "stud-2",
              rollNo: "2024EE002",
              name: "Bob Smith",
              email: "bob@campus.edu",
              department: "Electrical",
              messId: "akshaya",
            },
          ],
        };
      }
      if (path.startsWith("/gifts/batch-1")) {
        return {
          id: "batch-1",
          messId: "akshaya",
          mess: { id: "akshaya", code: "AKSHAYA", name: "Akshaya Mess" },
          createdById: "admin-1",
          mealDate: "2026-11-05",
          message: "Diwali Special Dinner 2026",
          status: "COMPLETED",
          createdAt: "2026-10-29T10:00:00Z",
          counts: {
            total: 2,
            active: 1,
            redeemed: 1,
            revoked: 0,
          },
          items: [
            {
              id: "item-1",
              studentId: "stud-1",
              student: {
                id: "stud-1",
                rollNo: "2024CS001",
                name: "Alice Johnson",
                email: "alice@campus.edu",
                department: "Computer Science",
              },
              couponId: "coup-1",
              coupon: {
                id: "coup-1",
                shortCode: "DWLI9999",
                status: "ACTIVE",
                validDate: "2026-11-05",
                mealType: "SPECIAL_DINNER",
                redeemedAt: null,
                revokedAt: null,
              },
              emailStatus: "SENT",
              whatsappStatus: "SENT",
              createdAt: "2026-10-29T10:00:00Z",
            },
            {
              id: "item-2",
              studentId: "stud-2",
              student: {
                id: "stud-2",
                rollNo: "2024EE002",
                name: "Bob Smith",
                email: "bob@campus.edu",
                department: "Electrical",
              },
              couponId: "coup-2",
              coupon: {
                id: "coup-2",
                shortCode: "DWLI8888",
                status: "REDEEMED",
                validDate: "2026-11-05",
                mealType: "SPECIAL_DINNER",
                redeemedAt: "2026-11-05T19:30:00Z",
                revokedAt: null,
              },
              emailStatus: "SENT",
              whatsappStatus: "SENT",
              createdAt: "2026-10-29T10:00:00Z",
            },
          ],
        };
      }
      return {};
    });
  });

  it("renders the dashboard with stats, batch rows, and redemption status breakdown (§20.5)", async () => {
    render(
      <ToastProvider>
        <GiftsPage />
      </ToastProvider>,
    );

    // Headline & Stats
    expect(screen.getByText("Admin Gift Coupons")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Diwali Special Dinner 2026")).toBeInTheDocument();
      expect(screen.getByText("Akshaya Mess")).toBeInTheDocument();
      expect(screen.getByText("1 Active")).toBeInTheDocument();
      expect(screen.getByText("1 Redeemed")).toBeInTheDocument();
    });
  });

  it("opens student multi-select issue modal and shows preview (§20.3)", async () => {
    render(
      <ToastProvider>
        <GiftsPage />
      </ToastProvider>,
    );

    const issueButton = screen.getByRole("button", { name: /issue gift batch/i });
    fireEvent.click(issueButton);

    expect(screen.getByText("Issue Complimentary Gift Coupons")).toBeInTheDocument();

    // Roster should load
    await waitFor(() => {
      expect(screen.getByText("Alice Johnson")).toBeInTheDocument();
      expect(screen.getByText("Bob Smith")).toBeInTheDocument();
    });

    // Check preview updates
    const selectVisibleBtn = screen.getByText("Select Visible");
    fireEvent.click(selectVisibleBtn);

    expect(screen.getByText(/Recipients:/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirm & Issue \(2\)/i })).toBeInTheDocument();
  });

  it("opens batch roster details, displays short codes, and handles revocation (§20.4, §20.5)", async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      data: { id: "coup-1", status: "REVOKED" },
    });

    render(
      <ToastProvider>
        <GiftsPage />
      </ToastProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("View Roster")).toBeInTheDocument();
    });

    // Open Roster Details
    fireEvent.click(screen.getByText("View Roster"));

    await waitFor(() => {
      expect(screen.getByText("DWLI9999")).toBeInTheDocument();
      expect(screen.getByText("DWLI8888")).toBeInTheDocument();
    });

    // Alice has ACTIVE coupon -> Revoke button should be visible
    const revokeButtons = screen.getAllByRole("button", { name: /revoke/i });
    expect(revokeButtons.length).toBeGreaterThan(0);

    fireEvent.click(revokeButtons[0]!);

    // Revocation Guard confirmation dialog
    expect(screen.getByText("Atomic Revocation Guard (§20.4)")).toBeInTheDocument();
    const confirmRevokeBtn = screen.getByRole("button", { name: "Confirm Revoke" });
    fireEvent.click(confirmRevokeBtn);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/gifts/coupons/coup-1/revoke",
        expect.objectContaining({ reason: undefined }),
      );
    });
  });
});
