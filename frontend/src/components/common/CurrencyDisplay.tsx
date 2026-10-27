import React from "react";

export interface CurrencyDisplayProps {
  paise: number;
  className?: string;
  showZeroAsFree?: boolean;
}

export const CurrencyDisplay: React.FC<CurrencyDisplayProps> = ({
  paise,
  className = "",
  showZeroAsFree = false,
}) => {
  if (showZeroAsFree && paise === 0) {
    return <span className={className}>Free</span>;
  }

  const rupees = paise / 100;
  const formatted = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);

  return <span className={`font-mono ${className}`}>{formatted}</span>;
};
