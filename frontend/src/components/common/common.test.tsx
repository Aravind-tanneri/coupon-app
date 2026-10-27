import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CurrencyDisplay } from "./CurrencyDisplay";
import { StatusBadge } from "./StatusBadge";
import { ISTDateDisplay } from "./ISTDateDisplay";

describe("Shared UI Components", () => {
  describe("CurrencyDisplay", () => {
    it("formats 13100 paise as ₹131.00", () => {
      render(<CurrencyDisplay paise={13100} />);
      // Non-breaking space or currency symbol
      expect(screen.getByText(/131\.00/)).toBeInTheDocument();
    });

    it("formats 0 paise as Free when showZeroAsFree is true", () => {
      render(<CurrencyDisplay paise={0} showZeroAsFree={true} />);
      expect(screen.getByText("Free")).toBeInTheDocument();
    });
  });

  describe("StatusBadge", () => {
    it("renders normalized badge text", () => {
      render(<StatusBadge status="ACTIVE" />);
      expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    });

    it("renders underscore-separated status cleanly", () => {
      render(<StatusBadge status="UNDER_REVIEW" />);
      expect(screen.getByText("UNDER REVIEW")).toBeInTheDocument();
    });
  });

  describe("ISTDateDisplay", () => {
    it("renders date formatted in IST", () => {
      const utcDate = "2026-10-27T10:00:00.000Z"; // 15:30 IST
      render(<ISTDateDisplay date={utcDate} format="time" />);
      expect(screen.getByText(/03:30:00\s*(?:pm|PM)\s*IST/i)).toBeInTheDocument();
    });

    it("shows fallback for null date", () => {
      render(<ISTDateDisplay date={null} fallback="Never" />);
      expect(screen.getByText("Never")).toBeInTheDocument();
    });
  });
});
