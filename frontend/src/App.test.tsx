import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";

describe("App", () => {
  it("renders campus mess system header", () => {
    render(<App />);
    expect(screen.getByText("Campus Mess System")).toBeInTheDocument();
    expect(screen.getByText("Phase 0 Active")).toBeInTheDocument();
  });
});
