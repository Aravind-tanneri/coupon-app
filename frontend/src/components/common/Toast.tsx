import React, { createContext, useContext, useCallback, useMemo } from "react";
import hotToast, { Toaster } from "react-hot-toast";

export type ToastType = "success" | "error" | "info";

export interface ToastItem {
  id?: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextType {
  toast: (options: ToastItem) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const addToast = useCallback((options: ToastItem) => {
    const text = options.message ? `${options.title}\n${options.message}` : options.title;
    if (options.type === "success") {
      hotToast.success(text, { duration: options.duration ?? 3500 });
    } else if (options.type === "error") {
      hotToast.error(text, { duration: options.duration ?? 4500 });
    } else {
      hotToast(text, { duration: options.duration ?? 3500, icon: "ℹ️" });
    }
  }, []);

  const success = useCallback(
    (title: string, message?: string) => addToast({ type: "success", title, message }),
    [addToast],
  );

  const error = useCallback(
    (title: string, message?: string) =>
      addToast({ type: "error", title, message, duration: 5000 }),
    [addToast],
  );

  const info = useCallback(
    (title: string, message?: string) => addToast({ type: "info", title, message }),
    [addToast],
  );

  const contextValue = useMemo(
    () => ({ toast: addToast, success, error, info }),
    [addToast, success, error, info],
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3500,
          style: {
            background: "#ffffff",
            color: "#1e293b",
            fontSize: "13px",
            fontWeight: 500,
            borderRadius: "10px",
            boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)",
            border: "1px solid #e2e8f0",
          },
          success: {
            iconTheme: {
              primary: "#059669",
              secondary: "#ecfdf5",
            },
          },
          error: {
            iconTheme: {
              primary: "#e11d48",
              secondary: "#fff1f2",
            },
          },
        }}
      />
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextType {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
