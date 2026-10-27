import React from "react";

export interface ISTDateDisplayProps {
  date: string | Date | null | undefined;
  format?: "datetime" | "date" | "time" | "short";
  className?: string;
  fallback?: string;
}

export const ISTDateDisplay: React.FC<ISTDateDisplayProps> = ({
  date,
  format = "datetime",
  className = "",
  fallback = "—",
}) => {
  if (!date) return <span className={`text-slate-400 ${className}`}>{fallback}</span>;

  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) {
    return <span className={`text-slate-400 ${className}`}>{fallback}</span>;
  }

  const options: Intl.DateTimeFormatOptions = {
    timeZone: "Asia/Kolkata",
  };

  switch (format) {
    case "date":
      options.year = "numeric";
      options.month = "short";
      options.day = "numeric";
      break;
    case "time":
      options.hour = "2-digit";
      options.minute = "2-digit";
      options.second = "2-digit";
      options.hour12 = true;
      break;
    case "short":
      options.month = "short";
      options.day = "numeric";
      break;
    case "datetime":
    default:
      options.year = "numeric";
      options.month = "short";
      options.day = "numeric";
      options.hour = "2-digit";
      options.minute = "2-digit";
      options.hour12 = true;
      break;
  }

  const formatted = new Intl.DateTimeFormat("en-IN", options).format(d);

  return <span className={className}>{formatted} IST</span>;
};
