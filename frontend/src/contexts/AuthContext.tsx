import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { api, ApiClientError } from "../lib/api";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "SUPER_ADMIN" | "ADMIN" | "MESS_STAFF";
  messId: string | null;
  permissions: string[];
}

export interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchCurrentUser = useCallback(async () => {
    try {
      const data = await api.get<{ user: AuthUser } | AuthUser>("/auth/me");
      const currentUser = data && "user" in data && data.user ? data.user : (data as AuthUser);
      setUser(currentUser);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        setUser(null);
      } else {
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCurrentUser();
  }, [fetchCurrentUser]);

  const login = async (email: string, password: string): Promise<AuthUser> => {
    const data = await api.post<{ user: AuthUser; sessionToken?: string } | AuthUser>(
      "/auth/login",
      { email, password },
    );
    const currentUser = data && "user" in data && data.user ? data.user : (data as AuthUser);
    if (data && "sessionToken" in data && typeof data.sessionToken === "string") {
      try {
        localStorage.setItem("campus_mess_session_token", data.sessionToken);
      } catch {
        // Ignore localStorage errors
      }
    }
    setUser(currentUser);
    return currentUser;
  };

  const logout = async (): Promise<void> => {
    try {
      await api.post("/auth/logout");
    } catch {
      // Ignore network errors on logout
    } finally {
      try {
        localStorage.removeItem("campus_mess_session_token");
      } catch {
        // Ignore localStorage errors
      }
      setUser(null);
      window.location.href = "/login";
    }
  };

  const can = useCallback(
    (permission: string): boolean => {
      if (!user) return false;
      if (user.role === "SUPER_ADMIN") return true;
      return Array.isArray(user.permissions) ? user.permissions.includes(permission) : false;
    },
    [user],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        can,
        refreshUser: fetchCurrentUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
