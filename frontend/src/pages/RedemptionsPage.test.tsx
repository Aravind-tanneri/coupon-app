import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RedemptionsPage } from "./RedemptionsPage";
import { ToastProvider } from "../components/common/Toast";
import { api } from "../lib/api";

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: "staff-1",
      name: "Ramesh Staff",
      role: "MESS_STAFF",
      messId: "mess-1",
      permissions: ["redemption:scan", "redemption:view", "menu:view"],
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

describe("RedemptionsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/redemptions/summary") {
        return {
          date: "2026-10-29",
          totalRedeemedToday: 42,
          byMeal: {
            BREAKFAST: 10,
            LUNCH: 20,
            SNACKS: 2,
            DINNER: 10,
            SPECIAL_DINNER: 0,
          },
          recentFeed: [
            {
              id: "c1",
              shortCode: "7K9X2MW4",
              mealType: "LUNCH",
              redeemedAt: new Date().toISOString(),
              student: {
                name: "Rahul Sharma",
                rollNo: "2024CS01",
                department: "CSE",
              },
            },
          ],
        };
      }
      if (path === "/redemptions") {
        return {
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        };
      }
      return {};
    });
  });

  it("renders the counter redemption console and daily statistics", async () => {
    render(
      <ToastProvider>
        <RedemptionsPage />
      </ToastProvider>,
    );

    expect(screen.getByText("Counter Redemption Console")).toBeInTheDocument();
    expect(screen.getByText("Live Scanner")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/e\.g\. 7K9X2MW4/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /lookup/i })).toBeInTheDocument();

    // Verify daily summary stats loaded
    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument();
      expect(screen.getByText("Rahul Sharma")).toBeInTheDocument();
    });
  });

  it("handles valid coupon lookup and confirmation workflow", async () => {
    vi.mocked(api.post).mockImplementation(async (path: string) => {
      if (path === "/redemptions/lookup") {
        return {
          success: true,
          canRedeem: true,
          message: "Ready for redemption",
          coupon: {
            id: "coupon-1",
            shortCode: "7K9X2MW4",
            mealType: "LUNCH",
            validDate: "2026-10-29",
            status: "ACTIVE",
            student: {
              id: "s1",
              name: "Ananya Iyer",
              rollNo: "2024EC05",
              department: "ECE",
            },
            mess: { id: "m1", code: "AKSHAYA", name: "Akshaya" },
          },
        };
      }
      if (path === "/redemptions") {
        return {
          id: "coupon-1",
          shortCode: "7K9X2MW4",
          mealType: "LUNCH",
          validDate: "2026-10-29",
          status: "REDEEMED",
          student: {
            id: "s1",
            name: "Ananya Iyer",
            rollNo: "2024EC05",
            department: "ECE",
          },
        };
      }
      return {};
    });

    render(
      <ToastProvider>
        <RedemptionsPage />
      </ToastProvider>,
    );

    const input = screen.getByPlaceholderText(/e\.g\. 7K9X2MW4/i);
    fireEvent.change(input, { target: { value: "7K9X2MW4" } });

    const lookupBtn = screen.getByRole("button", { name: /lookup/i });
    fireEvent.click(lookupBtn);

    // Should display preview card
    expect(await screen.findByText("Ananya Iyer")).toBeInTheDocument();
    expect(screen.getByText(/2024EC05/)).toBeInTheDocument();
    expect(screen.getByText(/Identity Verified • Ready to Serve/i)).toBeInTheDocument();

    // Confirm button
    const confirmBtn = screen.getByRole("button", { name: /confirm & redeem meal/i });
    fireEvent.click(confirmBtn);

    // Should invoke atomic redeem endpoint
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/redemptions", { shortCode: "7K9X2MW4" });
    });
  });

  it("switches to the historical redemption log tab", async () => {
    render(
      <ToastProvider>
        <RedemptionsPage />
      </ToastProvider>,
    );

    const historyTabBtn = screen.getByRole("button", { name: /redemption log/i });
    fireEvent.click(historyTabBtn);

    expect(await screen.findByText("Historical Redemptions")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("/redemptions", expect.any(Object));
  });
});
