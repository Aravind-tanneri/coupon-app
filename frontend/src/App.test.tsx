import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";

// Mock fetch for /auth/me call
global.fetch = vi.fn().mockImplementation(() =>
  Promise.resolve({
    ok: false,
    status: 401,
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve({ error: { code: "UNAUTHORIZED", message: "Not logged in" } }),
  }),
);

describe("App Router Shell", () => {
  it("renders login page when user is not authenticated", async () => {
    render(<App />);

    // Should redirect to /login and show login header
    expect(await screen.findByText("Campus Mess System")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in to console/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });
});
