import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LoginPage } from "./LoginPage";
import { AuthProvider } from "../contexts/AuthContext";

// Mock API
vi.mock("../lib/api", () => {
  return {
    api: {
      get: vi.fn().mockImplementation((path: string) => {
        if (path === "/auth/me") {
          return Promise.reject({ status: 401, message: "Not logged in" });
        }
        return Promise.resolve({});
      }),
      post: vi.fn().mockImplementation((path: string, body?: Record<string, unknown>) => {
        if (path === "/auth/login") {
          return Promise.resolve({
            user: {
              id: "usr-demo",
              email: (body?.email as string) || "admin@campus.edu",
              name: "Demo User",
              role: body?.email === "staff@campus.edu" ? "MESS_STAFF" : "SUPER_ADMIN",
              messId: "akshaya",
              permissions: [],
            },
            sessionToken: "demo_token_123",
          });
        }
        if (path === "/auth/forgot-password") {
          return Promise.resolve({
            success: true,
            demoToken: "MESS-8492",
          });
        }
        if (path === "/auth/reset-password") {
          return Promise.resolve({
            success: true,
            message: "Password updated successfully.",
          });
        }
        return Promise.resolve({});
      }),
    },
    ApiClientError: class ApiClientError extends Error {
      status: number;
      constructor(message: string, status = 400) {
        super(message);
        this.status = status;
      }
    },
  };
});

describe("LoginPage Demo Login & Mock Password Reset Workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderComponent = async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </MemoryRouter>,
      );
    });
  };

  describe("Demo Login Presets", () => {
    it("renders demo login cards with GDSC and @SolveWithAI branding", async () => {
      await renderComponent();

      expect(screen.getByText("Demo Accounts")).toBeInTheDocument();
      expect(screen.getByText("Super Admin")).toBeInTheDocument();
      expect(screen.getByText("Counter Staff")).toBeInTheDocument();
      expect(screen.getByText("admin@campus.edu")).toBeInTheDocument();
      expect(screen.getByText("staff@campus.edu")).toBeInTheDocument();
      expect(screen.getByText("GDSC NIT AP")).toBeInTheDocument();
      expect(screen.getByText("@SolveWithAI")).toBeInTheDocument();
    });

    it("populates Super Admin credentials into form when card is clicked", async () => {
      await renderComponent();

      const superAdminCard = screen.getByText("Super Admin").closest("button")!;
      await act(async () => {
        fireEvent.click(superAdminCard);
      });

      const emailInput = screen.getByLabelText(/email address/i) as HTMLInputElement;
      const passInput = screen.getByLabelText(/^password$/i) as HTMLInputElement;

      expect(emailInput.value).toBe("admin@campus.edu");
      expect(passInput.value).toBe("SuperAdminPassword123!");
      expect(screen.getByText(/credentials for admin@campus.edu populated/i)).toBeInTheDocument();
    });

    it("populates Counter Staff credentials into form when card is clicked", async () => {
      await renderComponent();

      const staffCard = screen.getByText("Counter Staff").closest("button")!;
      await act(async () => {
        fireEvent.click(staffCard);
      });

      const emailInput = screen.getByLabelText(/email address/i) as HTMLInputElement;
      const passInput = screen.getByLabelText(/^password$/i) as HTMLInputElement;

      expect(emailInput.value).toBe("staff@campus.edu");
      expect(passInput.value).toBe("StaffPassword123!");
      expect(screen.getByText(/credentials for staff@campus.edu populated/i)).toBeInTheDocument();
    });
  });

  describe("Mock Password Reset Workflow", () => {
    it("opens reset modal when Forgot password? is clicked", async () => {
      await renderComponent();

      const forgotBtn = screen.getByRole("button", { name: /forgot password\?/i });
      await act(async () => {
        fireEvent.click(forgotBtn);
      });

      expect(screen.getByText("Reset Password")).toBeInTheDocument();
      expect(screen.getByText(/demo password recovery workflow/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /generate reset token/i })).toBeInTheDocument();
    });

    it("completes the full reset password cycle: Request -> Verify -> Reset -> Success", async () => {
      await renderComponent();

      // 1. Open modal
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /forgot password\?/i }));
      });

      // 2. Request token
      const generateBtn = screen.getByRole("button", { name: /generate reset token/i });
      await act(async () => {
        fireEvent.click(generateBtn);
      });

      // 3. Verify step
      await waitFor(() => {
        expect(screen.getByText(/simulated token dispatched/i)).toBeInTheDocument();
      });
      expect(screen.getByText("MESS-8492")).toBeInTheDocument();

      // Click auto-fill token
      const autoFillBtn = screen.getByRole("button", { name: /auto-fill token/i });
      await act(async () => {
        fireEvent.click(autoFillBtn);
      });

      // Submit token verification
      const verifyBtn = screen.getByRole("button", { name: /verify & proceed/i });
      await act(async () => {
        fireEvent.click(verifyBtn);
      });

      // 4. Reset step
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/minimum 8 characters/i)).toBeInTheDocument();
      });

      const newPassInput = screen.getByPlaceholderText(/minimum 8 characters/i);
      const confirmPassInput = screen.getByPlaceholderText(/re-enter password/i);

      fireEvent.change(newPassInput, { target: { value: "NewSecurePassword123!" } });
      fireEvent.change(confirmPassInput, { target: { value: "NewSecurePassword123!" } });

      const updateBtn = screen.getByRole("button", { name: /update password/i });
      await act(async () => {
        fireEvent.click(updateBtn);
      });

      // 5. Success step
      await waitFor(() => {
        expect(screen.getByText("Password Reset Complete")).toBeInTheDocument();
      });

      // 6. Complete and return to login
      const returnBtn = screen.getByRole("button", { name: /sign in with new password/i });
      await act(async () => {
        fireEvent.click(returnBtn);
      });

      // Form should now have the new password and success message
      await waitFor(() => {
        const passInput = screen.getByLabelText(/^password$/i) as HTMLInputElement;
        expect(passInput.value).toBe("NewSecurePassword123!");
        expect(
          screen.getByText(/password reset successful! you can now sign in/i),
        ).toBeInTheDocument();
      });
    });
  });
});
