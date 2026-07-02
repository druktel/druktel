import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
const TOKEN_KEY = "auth_token";

export type UserPublic = {
  id: string;
  name: string;
  working_days: number[];
  initial_day_off_date: string;
  is_admin: boolean;
  created_at: string;
};

export type DayEntry = {
  date: string;
  weekday: number;
  weekday_name: string;
  status: "regular" | "short" | "day_off" | "non_working";
  hours: number;
  label: string;
  is_today: boolean;
};

export type RosterResponse = {
  start_date: string;
  end_date: string;
  days: DayEntry[];
};

async function getToken(): Promise<string | null> {
  return await storage.getItem<string>(TOKEN_KEY, "");
}

async function setToken(token: string | null) {
  if (token) {
    await storage.setItem(TOKEN_KEY, token);
  } else {
    await storage.removeItem(TOKEN_KEY);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}/api${path}`, { ...init, headers });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail = body?.detail || body?.message || `Request failed (${res.status})`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return body as T;
}

export const api = {
  setToken,
  getToken,
  register: (payload: {
    name: string;
    pin: string;
    working_days: number[];
    initial_day_off_date: string;
    is_admin: boolean;
  }) => request<{ token: string; user: UserPublic }>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  }),
  login: (pin: string) =>
    request<{ token: string; user: UserPublic }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ pin }),
    }),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  me: () => request<UserPublic>("/users/me"),
  updateMe: (payload: { working_days: number[]; initial_day_off_date: string }) =>
    request<UserPublic>("/users/me", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  myRoster: (start?: string, days = 14) => {
    const q = new URLSearchParams();
    if (start) q.set("start", start);
    q.set("days", String(days));
    return request<RosterResponse>(`/roster/me?${q.toString()}`);
  },
  today: () =>
    request<{
      date: string;
      weekday_name: string;
      status: DayEntry["status"];
      hours: number;
      label: string;
    }>("/roster/today"),
  adminUsers: () => request<{ users: UserPublic[] }>("/admin/users"),
  adminRoster: (userId: string, days = 14, start?: string) => {
    const q = new URLSearchParams();
    q.set("days", String(days));
    if (start) q.set("start", start);
    return request<RosterResponse>(`/admin/roster/${userId}?${q.toString()}`);
  },
};
