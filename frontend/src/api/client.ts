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
  status: "regular" | "short" | "day_off" | "non_working" | "leave";
  hours: number;
  label: string;
  is_today: boolean;
  public_holiday?: string | null;
  school_holiday?: string | null;
  leave_note?: string | null;
};

export type Leave = {
  id: string;
  date: string;
  note?: string | null;
  created_at: string;
};

export type AccessCode = {
  id: string;
  code: string;
  note?: string | null;
  is_active: boolean;
  is_admin_gate: boolean;
  created_at: string;
};

export type DiscoverEntry = {
  id: string;
  name: string;
  working_days: number[];
  is_friend: boolean;
};

export type FriendEntry = {
  id: string;
  name: string;
  working_days: number[];
  since: string;
};

export type FeedItem = {
  date: string;
  type: "day_off" | "leave" | "short";
  label: string;
  friend_id: string;
  friend_name: string;
  note?: string | null;
};

export type Post = {
  id: string;
  user_id: string;
  author_name: string;
  text: string;
  visibility: "public" | "friends";
  created_at: string;
  like_count: number;
  liked_by_me: boolean;
  reply_count: number;
};

export type Reply = {
  id: string;
  post_id: string;
  user_id: string;
  author_name: string;
  text: string;
  created_at: string;
};

export type Notification = {
  id: string;
  user_id: string;
  type: "friend_post" | "reply";
  actor_id: string;
  actor_name: string;
  post_id?: string | null;
  text?: string | null;
  read: boolean;
  created_at: string;
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
      public_holiday?: string | null;
      school_holiday?: string | null;
    }>("/roster/today"),
  holidays: (start?: string, end?: string) => {
    const q = new URLSearchParams();
    if (start) q.set("start", start);
    if (end) q.set("end", end);
    return request<{
      holidays: (
        | { date: string; name: string; type: "public" }
        | { start: string; end: string; name: string; type: "school" }
      )[];
    }>(`/holidays?${q.toString()}`);
  },
  adminUsers: () => request<{ users: UserPublic[] }>("/admin/users"),
  adminRoster: (userId: string, days = 14, start?: string) => {
    const q = new URLSearchParams();
    q.set("days", String(days));
    if (start) q.set("start", start);
    return request<RosterResponse>(`/admin/roster/${userId}?${q.toString()}`);
  },
  adminRefreshHolidays: () =>
    request<{ refreshed: Record<string, number> }>("/admin/holidays/refresh", {
      method: "POST",
    }),
  listLeaves: () => request<{ leaves: Leave[] }>("/leaves"),
  addLeave: (date: string, note?: string) =>
    request<Leave>("/leaves", {
      method: "POST",
      body: JSON.stringify({ date, note }),
    }),
  deleteLeave: (id: string) =>
    request<{ ok: boolean }>(`/leaves/${id}`, { method: "DELETE" }),
  verifyAccessCode: (code: string) =>
    request<{ ok: boolean; code_id: string; is_admin_gate: boolean }>("/access/verify", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  adminListAccessCodes: () =>
    request<{ codes: AccessCode[] }>("/admin/access-codes"),
  adminCreateAccessCode: (code: string, note?: string, isAdminGate?: boolean) =>
    request<AccessCode>("/admin/access-codes", {
      method: "POST",
      body: JSON.stringify({ code, note, is_admin_gate: !!isAdminGate }),
    }),
  adminDeleteAccessCode: (id: string) =>
    request<{ ok: boolean }>(`/admin/access-codes/${id}`, { method: "DELETE" }),
  discover: (limit = 50) =>
    request<{ users: DiscoverEntry[] }>(`/discover?limit=${limit}`),
  listFriends: () => request<{ friends: FriendEntry[] }>("/friends"),
  addFriend: (friendId: string) =>
    request<{ ok: boolean; friend: { id: string; name: string } }>(
      `/friends/${friendId}`,
      { method: "POST" },
    ),
  removeFriend: (friendId: string) =>
    request<{ ok: boolean }>(`/friends/${friendId}`, { method: "DELETE" }),
  feed: (days = 14) => request<{ items: FeedItem[] }>(`/feed?days=${days}`),
  listPosts: (limit = 40) => request<{ posts: Post[] }>(`/posts?limit=${limit}`),
  createPost: (text: string, visibility: "public" | "friends") =>
    request<Post>("/posts", {
      method: "POST",
      body: JSON.stringify({ text, visibility }),
    }),
  deletePost: (id: string) =>
    request<{ ok: boolean }>(`/posts/${id}`, { method: "DELETE" }),
  toggleLike: (postId: string) =>
    request<{ ok: boolean; liked: boolean; like_count: number }>(
      `/posts/${postId}/like`,
      { method: "POST" },
    ),
  listReplies: (postId: string) =>
    request<{ replies: Reply[] }>(`/posts/${postId}/replies`),
  createReply: (postId: string, text: string) =>
    request<Reply>(`/posts/${postId}/replies`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  deleteReply: (postId: string, replyId: string) =>
    request<{ ok: boolean }>(`/posts/${postId}/replies/${replyId}`, {
      method: "DELETE",
    }),
  listNotifications: () =>
    request<{ notifications: Notification[]; unread: number }>("/notifications"),
  markNotificationsRead: () =>
    request<{ ok: boolean }>("/notifications/mark-read", { method: "POST" }),
  deleteNotification: (id: string) =>
    request<{ ok: boolean }>(`/notifications/${id}`, { method: "DELETE" }),
};
