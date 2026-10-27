export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export class ApiClientError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;
  public readonly requestId?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
    requestId?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

const API_BASE = import.meta.env.VITE_API_URL || "/api/v1";

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined | null>;
}

export async function apiRequest<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { params, headers, ...customConfig } = options;

  let url = `${API_BASE}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        searchParams.append(key, String(value));
      }
    });
    const queryString = searchParams.toString();
    if (queryString) {
      url += (url.includes("?") ? "&" : "?") + queryString;
    }
  }

  const defaultHeaders: Record<string, string> = {
    "X-Requested-With": "XMLHttpRequest",
  };

  // Only set Content-Type to JSON if not FormData
  if (!(customConfig.body instanceof FormData)) {
    defaultHeaders["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    credentials: "include", // Send and receive session cookies
    headers: {
      ...defaultHeaders,
      ...headers,
    },
    ...customConfig,
  });

  if (response.status === 401) {
    // If not already on /login, trigger redirect (skip in test environment to avoid jsdom navigation error)
    if (
      typeof window !== "undefined" &&
      window.location &&
      !window.location.pathname.startsWith("/login") &&
      process.env.NODE_ENV !== "test"
    ) {
      window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
    }
  }

  const contentType = response.headers.get("content-type");
  let data: unknown = null;

  if (contentType && contentType.includes("application/json")) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const errorBody = data as ApiErrorResponse | null;
    const errorCode = errorBody?.error?.code || `HTTP_${response.status}`;
    const errorMessage =
      errorBody?.error?.message ||
      (typeof data === "string" ? data : response.statusText || "Request failed");
    const errorDetails = errorBody?.error?.details;
    const requestId = errorBody?.error?.requestId;

    throw new ApiClientError(response.status, errorCode, errorMessage, errorDetails, requestId);
  }

  // If response matches our standardized success envelope { success: true, data: T }
  if (data && typeof data === "object" && "data" in data && "success" in data) {
    return (data as { data: T }).data;
  }

  return data as T;
}

export const api = {
  get: <T>(endpoint: string, params?: RequestOptions["params"]) =>
    apiRequest<T>(endpoint, { method: "GET", params }),

  post: <T>(endpoint: string, body?: unknown, params?: RequestOptions["params"]) =>
    apiRequest<T>(endpoint, {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
      params,
    }),

  put: <T>(endpoint: string, body?: unknown, params?: RequestOptions["params"]) =>
    apiRequest<T>(endpoint, {
      method: "PUT",
      body: body !== undefined ? JSON.stringify(body) : undefined,
      params,
    }),

  patch: <T>(endpoint: string, body?: unknown, params?: RequestOptions["params"]) =>
    apiRequest<T>(endpoint, {
      method: "PATCH",
      body: body !== undefined ? JSON.stringify(body) : undefined,
      params,
    }),

  delete: <T>(endpoint: string, params?: RequestOptions["params"]) =>
    apiRequest<T>(endpoint, { method: "DELETE", params }),

  upload: <T>(endpoint: string, formData: FormData, params?: RequestOptions["params"]) =>
    apiRequest<T>(endpoint, {
      method: "POST",
      body: formData,
      params,
    }),
};
