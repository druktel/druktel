import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import {
  api,
  DiscoverEntry,
  FriendEntry,
  FeedItem,
  Post,
  Reply,
  Notification,
  UserPublic,
} from "@/src/api/client";
import { LogoMarkCompact } from "@/src/components/Brand";
import { colors, spacing, radius } from "@/src/theme/colors";

const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
}

function feedTypeMeta(type: FeedItem["type"]) {
  switch (type) {
    case "leave":
      return { color: "#7C3AED", icon: "airplane-outline" as const };
    case "day_off":
      return { color: colors.muted, icon: "moon-outline" as const };
    case "short":
      return { color: colors.warning, icon: "sunny-outline" as const };
  }
}

function formatFeedDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function FeedScreen() {
  const [discover, setDiscover] = useState<DiscoverEntry[]>([]);
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [me, setMe] = useState<UserPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Composer state
  const [composerText, setComposerText] = useState("");
  const [composerVis, setComposerVis] = useState<"public" | "friends">("public");
  const [posting, setPosting] = useState(false);

  // Post interactions
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  const [repliesByPost, setRepliesByPost] = useState<Record<string, Reply[]>>({});
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyBusy, setReplyBusy] = useState<string | null>(null);
  const [likeBusy, setLikeBusy] = useState<string | null>(null);

  // Notifications
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const u = await api.me();
        setMe(u);
      } catch {
        // ignore
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [d, f, feedResp, p, n] = await Promise.all([
        api.discover(30),
        api.listFriends(),
        api.feed(14),
        api.listPosts(40),
        api.listNotifications(),
      ]);
      setDiscover(d.users);
      setFriends(f.friends);
      setFeed(feedResp.items);
      setPosts(p.posts);
      setNotifs(n.notifications);
      setUnread(n.unread);
    } catch (e: any) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const addFriend = async (id: string) => {
    setBusyId(id);
    try {
      await api.addFriend(id);
      await load();
    } catch (e: any) {
      setError(e.message || "Failed to add friend");
    } finally {
      setBusyId(null);
    }
  };

  const removeFriend = async (id: string) => {
    setBusyId(id);
    try {
      await api.removeFriend(id);
      await load();
    } catch (e: any) {
      setError(e.message || "Failed to remove");
    } finally {
      setBusyId(null);
    }
  };

  const submitPost = async () => {
    const text = composerText.trim();
    if (!text) return;
    setPosting(true);
    try {
      await api.createPost(text, composerVis);
      setComposerText("");
      await load();
    } catch (e: any) {
      setError(e.message || "Failed to post");
    } finally {
      setPosting(false);
    }
  };

  const deletePost = async (id: string) => {
    setBusyId(id);
    try {
      await api.deletePost(id);
      await load();
    } catch (e: any) {
      setError(e.message || "Failed to delete");
    } finally {
      setBusyId(null);
    }
  };

  const formatPostTime = (iso: string) => {
    const t = new Date(iso).getTime();
    const now = Date.now();
    const diff = Math.max(0, Math.round((now - t) / 60000));
    if (diff < 1) return "just now";
    if (diff < 60) return `${diff}m ago`;
    if (diff < 60 * 24) return `${Math.round(diff / 60)}h ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  const toggleLike = async (postId: string) => {
    setLikeBusy(postId);
    // Optimistic update
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? {
              ...p,
              liked_by_me: !p.liked_by_me,
              like_count: p.like_count + (p.liked_by_me ? -1 : 1),
            }
          : p,
      ),
    );
    try {
      await api.toggleLike(postId);
    } catch (e: any) {
      setError(e.message || "Failed to like");
      await load();
    } finally {
      setLikeBusy(null);
    }
  };

  const toggleReplies = async (postId: string) => {
    if (expandedPostId === postId) {
      setExpandedPostId(null);
      return;
    }
    setExpandedPostId(postId);
    if (!repliesByPost[postId]) {
      try {
        const r = await api.listReplies(postId);
        setRepliesByPost((prev) => ({ ...prev, [postId]: r.replies }));
      } catch (e: any) {
        setError(e.message || "Failed to load replies");
      }
    }
  };

  const submitReply = async (postId: string) => {
    const text = (replyDrafts[postId] || "").trim();
    if (!text) return;
    setReplyBusy(postId);
    try {
      const r = await api.createReply(postId, text);
      setRepliesByPost((prev) => ({
        ...prev,
        [postId]: [...(prev[postId] || []), r],
      }));
      setReplyDrafts((prev) => ({ ...prev, [postId]: "" }));
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId ? { ...p, reply_count: p.reply_count + 1 } : p,
        ),
      );
    } catch (e: any) {
      setError(e.message || "Failed to reply");
    } finally {
      setReplyBusy(null);
    }
  };

  const removeReply = async (postId: string, replyId: string) => {
    try {
      await api.deleteReply(postId, replyId);
      setRepliesByPost((prev) => ({
        ...prev,
        [postId]: (prev[postId] || []).filter((r) => r.id !== replyId),
      }));
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId ? { ...p, reply_count: Math.max(0, p.reply_count - 1) } : p,
        ),
      );
    } catch (e: any) {
      setError(e.message || "Failed to delete reply");
    }
  };

  const openNotifs = async () => {
    setNotifOpen(true);
    try {
      await api.markNotificationsRead();
      setUnread(0);
      // Refresh so items show as read
      const n = await api.listNotifications();
      setNotifs(n.notifications);
    } catch {
      // ignore
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.brand}
          />
        }
      >
        <View style={styles.brandBar}>
          <LogoMarkCompact />
        </View>
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Team feed</Text>
            <Text style={styles.subtitle}>
              Follow teammates to see their upcoming day-offs and leave.
            </Text>
          </View>
          <TouchableOpacity
            testID="open-notifs"
            style={styles.notifBtn}
            onPress={openNotifs}
          >
            <Ionicons name="notifications-outline" size={22} color={colors.onSurface} />
            {unread > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>{unread > 9 ? "9+" : unread}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {error && (
          <View style={styles.errBox}>
            <Text style={styles.errText}>{error}</Text>
          </View>
        )}

        {/* COMPOSER */}
        <View style={styles.composer} testID="post-composer">
          <TextInput
            testID="post-input"
            value={composerText}
            onChangeText={setComposerText}
            placeholder="Share what you're thinking..."
            placeholderTextColor={colors.muted}
            style={styles.composerInput}
            multiline
            maxLength={500}
          />
          <View style={styles.composerFoot}>
            <View style={styles.visRow}>
              <TouchableOpacity
                testID="post-vis-public"
                onPress={() => setComposerVis("public")}
                style={[styles.visChip, composerVis === "public" && styles.visChipActive]}
              >
                <Ionicons
                  name="globe-outline"
                  size={13}
                  color={composerVis === "public" ? "#fff" : colors.onSurface}
                />
                <Text style={[styles.visText, composerVis === "public" && styles.visTextActive]}>
                  Public
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="post-vis-friends"
                onPress={() => setComposerVis("friends")}
                style={[styles.visChip, composerVis === "friends" && styles.visChipActive]}
              >
                <Ionicons
                  name="people-outline"
                  size={13}
                  color={composerVis === "friends" ? "#fff" : colors.onSurface}
                />
                <Text style={[styles.visText, composerVis === "friends" && styles.visTextActive]}>
                  Friends only
                </Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              testID="post-submit"
              disabled={posting || !composerText.trim()}
              onPress={submitPost}
              style={[
                styles.postBtn,
                (posting || !composerText.trim()) && { opacity: 0.5 },
              ]}
            >
              {posting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="send" size={14} color="#fff" />
                  <Text style={styles.postBtnText}>Post</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
          <Text style={styles.composerHint}>
            {composerText.length}/500 · {composerVis === "public" ? "Everyone can see this" : "Only your friends can see this"}
          </Text>
        </View>

        {/* POSTS STREAM */}
        {posts.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Latest posts</Text>
              <Text style={styles.sectionCaption}>{posts.length}</Text>
            </View>
            <View style={styles.postsList}>
              {posts.map((p) => (
                <View key={p.id} style={styles.postCard} testID={`post-${p.id}`}>
                  <View style={styles.postHead}>
                    <View style={styles.avatarSm}>
                      <Text style={styles.avatarText}>{initials(p.author_name)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.postAuthor}>{p.author_name}</Text>
                      <View style={styles.postMeta}>
                        <Ionicons
                          name={p.visibility === "public" ? "globe-outline" : "people-outline"}
                          size={11}
                          color={colors.muted}
                        />
                        <Text style={styles.postMetaText}>
                          {p.visibility === "public" ? "Public" : "Friends"} · {formatPostTime(p.created_at)}
                        </Text>
                      </View>
                    </View>
                    {me?.id === p.user_id && (
                      <TouchableOpacity
                        testID={`delete-post-${p.id}`}
                        onPress={() => deletePost(p.id)}
                        disabled={busyId === p.id}
                        style={styles.postDelete}
                      >
                        <Ionicons name="trash-outline" size={16} color={colors.error} />
                      </TouchableOpacity>
                    )}
                  </View>
                  <Text style={styles.postText}>{p.text}</Text>

                  <View style={styles.postActions}>
                    <TouchableOpacity
                      testID={`like-${p.id}`}
                      onPress={() => toggleLike(p.id)}
                      disabled={likeBusy === p.id}
                      style={styles.actionBtn}
                    >
                      <Ionicons
                        name={p.liked_by_me ? "heart" : "heart-outline"}
                        size={18}
                        color={p.liked_by_me ? "#DC2626" : colors.onSurfaceTertiary}
                      />
                      <Text style={[styles.actionText, p.liked_by_me && { color: "#DC2626" }]}>
                        {p.like_count}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      testID={`reply-toggle-${p.id}`}
                      onPress={() => toggleReplies(p.id)}
                      style={styles.actionBtn}
                    >
                      <Ionicons
                        name="chatbubble-outline"
                        size={17}
                        color={colors.onSurfaceTertiary}
                      />
                      <Text style={styles.actionText}>{p.reply_count}</Text>
                    </TouchableOpacity>
                  </View>

                  {expandedPostId === p.id && (
                    <View style={styles.repliesBox} testID={`replies-box-${p.id}`}>
                      {(repliesByPost[p.id] || []).map((r) => (
                        <View key={r.id} style={styles.replyRow} testID={`reply-${r.id}`}>
                          <View style={styles.replyAvatar}>
                            <Text style={styles.replyAvatarText}>
                              {initials(r.author_name)}
                            </Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.replyAuthor}>
                              {r.author_name}{" "}
                              <Text style={styles.replyMeta}>
                                · {formatPostTime(r.created_at)}
                              </Text>
                            </Text>
                            <Text style={styles.replyText}>{r.text}</Text>
                          </View>
                          {me?.id === r.user_id && (
                            <TouchableOpacity
                              testID={`delete-reply-${r.id}`}
                              onPress={() => removeReply(p.id, r.id)}
                            >
                              <Ionicons name="close" size={14} color={colors.muted} />
                            </TouchableOpacity>
                          )}
                        </View>
                      ))}
                      <View style={styles.replyComposer}>
                        <TextInput
                          testID={`reply-input-${p.id}`}
                          value={replyDrafts[p.id] || ""}
                          onChangeText={(t) =>
                            setReplyDrafts((prev) => ({ ...prev, [p.id]: t }))
                          }
                          placeholder="Reply..."
                          placeholderTextColor={colors.muted}
                          style={styles.replyInput}
                          maxLength={300}
                        />
                        <TouchableOpacity
                          testID={`reply-send-${p.id}`}
                          onPress={() => submitReply(p.id)}
                          disabled={replyBusy === p.id || !(replyDrafts[p.id] || "").trim()}
                          style={[
                            styles.replySendBtn,
                            (replyBusy === p.id || !(replyDrafts[p.id] || "").trim()) && { opacity: 0.5 },
                          ]}
                        >
                          {replyBusy === p.id ? (
                            <ActivityIndicator color="#fff" size="small" />
                          ) : (
                            <Ionicons name="send" size={14} color="#fff" />
                          )}
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              ))}
            </View>
          </>
        )}

        {/* DISCOVER SLIDER */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Discover</Text>
          <Text style={styles.sectionCaption}>{discover.length} profiles</Text>
        </View>
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : discover.length === 0 ? (
          <Text style={styles.empty}>No other profiles yet.</Text>
        ) : (
          <FlatList
            data={discover}
            horizontal
            keyExtractor={(u) => u.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sliderRow}
            testID="discover-slider"
            renderItem={({ item }) => (
              <View style={styles.discoverCard} testID={`discover-card-${item.id}`}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials(item.name)}</Text>
                </View>
                <Text style={styles.cardName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.cardMeta} numberOfLines={1}>
                  {item.working_days.map((d) => WEEKDAY_NAMES[d]).join("·")}
                </Text>
                {item.is_friend ? (
                  <View style={styles.friendChip}>
                    <Ionicons name="checkmark" size={12} color={colors.brand} />
                    <Text style={styles.friendChipText}>Friend</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    testID={`add-friend-${item.id}`}
                    disabled={busyId === item.id}
                    onPress={() => addFriend(item.id)}
                    style={[styles.addBtn, busyId === item.id && { opacity: 0.6 }]}
                  >
                    {busyId === item.id ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <>
                        <Ionicons name="add" size={14} color="#fff" />
                        <Text style={styles.addBtnText}>Add</Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            )}
          />
        )}

        {/* MY FRIENDS */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>My friends</Text>
          <Text style={styles.sectionCaption}>{friends.length}</Text>
        </View>
        {friends.length === 0 ? (
          <Text style={styles.empty}>No friends yet — add one from the slider above.</Text>
        ) : (
          <View style={styles.friendsList}>
            {friends.map((f) => (
              <View key={f.id} style={styles.friendRow} testID={`friend-${f.id}`}>
                <View style={styles.avatarSm}>
                  <Text style={styles.avatarText}>{initials(f.name)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.friendName}>{f.name}</Text>
                  <Text style={styles.friendMeta}>
                    Works {f.working_days.map((d) => WEEKDAY_NAMES[d]).join(", ")}
                  </Text>
                </View>
                <TouchableOpacity
                  testID={`remove-friend-${f.id}`}
                  onPress={() => removeFriend(f.id)}
                  style={styles.removeBtn}
                  disabled={busyId === f.id}
                >
                  <Ionicons name="person-remove-outline" size={16} color={colors.error} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* FEED */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Upcoming from your friends</Text>
          <Text style={styles.sectionCaption}>next 2 weeks</Text>
        </View>
        {friends.length === 0 ? (
          <Text style={styles.empty}>
            Add friends to see their upcoming day-offs and leave here.
          </Text>
        ) : feed.length === 0 ? (
          <Text style={styles.empty}>Nothing coming up in the next 2 weeks.</Text>
        ) : (
          <View style={styles.feedList}>
            {feed.map((it, idx) => {
              const meta = feedTypeMeta(it.type);
              return (
                <View
                  key={`${it.friend_id}-${it.date}-${idx}`}
                  style={styles.feedItem}
                  testID={`feed-item-${it.friend_id}-${it.date}`}
                >
                  <View style={[styles.feedIconWrap, { backgroundColor: meta.color + "22" }]}>
                    <Ionicons name={meta.icon} size={18} color={meta.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.feedName}>{it.friend_name}</Text>
                    <Text style={styles.feedDesc}>
                      {it.label}
                      {it.note ? ` — ${it.note}` : ""}
                    </Text>
                  </View>
                  <Text style={styles.feedDate}>{formatFeedDate(it.date)}</Text>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={notifOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setNotifOpen(false)}
      >
        <SafeAreaView style={styles.notifRoot} edges={["top", "bottom"]} testID="notif-modal">
          <View style={styles.notifHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.notifTitle}>Notifications</Text>
              <Text style={styles.notifSub}>{notifs.length} total</Text>
            </View>
            <TouchableOpacity
              testID="close-notifs"
              onPress={() => setNotifOpen(false)}
              style={styles.closeNotifBtn}
            >
              <Ionicons name="close" size={22} color={colors.onSurface} />
            </TouchableOpacity>
          </View>
          {notifs.length === 0 ? (
            <View style={styles.notifEmpty}>
              <Ionicons name="notifications-off-outline" size={44} color={colors.muted} />
              <Text style={styles.notifEmptyText}>Nothing new</Text>
              <Text style={styles.notifEmptyHelp}>
                You&apos;ll be notified here when friends post or reply to your posts.
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.notifList}>
              {notifs.map((n) => (
                <View
                  key={n.id}
                  style={[styles.notifRow, !n.read && styles.notifUnread]}
                  testID={`notif-${n.id}`}
                >
                  <View style={styles.notifIcon}>
                    <Ionicons
                      name={n.type === "friend_post" ? "megaphone-outline" : "chatbubble-ellipses-outline"}
                      size={18}
                      color={colors.brand}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.notifText}>
                      <Text style={styles.notifActor}>{n.actor_name}</Text>{" "}
                      {n.type === "friend_post" ? "shared a new post" : "replied to your post"}
                    </Text>
                    {n.text ? (
                      <Text style={styles.notifSnippet} numberOfLines={2}>
                        {n.text}
                      </Text>
                    ) : null}
                    <Text style={styles.notifTime}>{formatPostTime(n.created_at)}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.xl, paddingBottom: spacing.xxxl },
  brandBar: { marginBottom: spacing.md },
  title: { fontSize: 26, fontWeight: "700", color: colors.onSurface },
  subtitle: { color: colors.onSurfaceTertiary, marginTop: 4, marginBottom: spacing.xl },
  errBox: {
    backgroundColor: "#FFECEC",
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  errText: { color: colors.error, fontSize: 13 },
  composer: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  composerInput: {
    color: colors.onSurface,
    fontSize: 15,
    minHeight: 72,
    textAlignVertical: "top",
    padding: 0,
  },
  composerFoot: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  visRow: { flexDirection: "row", gap: 6, flexShrink: 1 },
  visChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  visChipActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  visText: { color: colors.onSurface, fontSize: 11, fontWeight: "600" },
  visTextActive: { color: "#fff" },
  postBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  postBtnText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  composerHint: {
    color: colors.onSurfaceTertiary,
    fontSize: 10,
    marginTop: spacing.sm,
    letterSpacing: 0.3,
  },

  postsList: { gap: spacing.sm },
  postCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  postHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  postAuthor: { color: colors.onSurface, fontWeight: "700", fontSize: 14 },
  postMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  postMetaText: { color: colors.muted, fontSize: 11 },
  postDelete: { padding: 6 },
  postText: {
    color: colors.onSurface,
    fontSize: 14,
    lineHeight: 20,
  },
  postActions: {
    flexDirection: "row",
    gap: spacing.lg,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
  },
  actionText: {
    color: colors.onSurfaceTertiary,
    fontWeight: "600",
    fontSize: 13,
    minWidth: 14,
  },
  repliesBox: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    gap: spacing.sm,
  },
  replyRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  replyAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  replyAvatarText: {
    color: colors.onBrandTertiary,
    fontWeight: "800",
    fontSize: 11,
  },
  replyAuthor: {
    color: colors.onSurface,
    fontWeight: "700",
    fontSize: 13,
  },
  replyMeta: {
    color: colors.muted,
    fontWeight: "400",
    fontSize: 11,
  },
  replyText: {
    color: colors.onSurface,
    fontSize: 13,
    marginTop: 2,
    lineHeight: 18,
  },
  replyComposer: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  replyInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    fontSize: 13,
    color: colors.onSurface,
  },
  replySendBtn: {
    backgroundColor: colors.brand,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  notifBtn: {
    padding: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    position: "relative",
  },
  notifBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    backgroundColor: colors.error,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  notifBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },

  notifRoot: { flex: 1, backgroundColor: colors.surface },
  notifHead: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.xl,
    paddingBottom: spacing.md,
  },
  notifTitle: { fontSize: 22, fontWeight: "700", color: colors.onSurface },
  notifSub: { color: colors.onSurfaceTertiary, marginTop: 2 },
  closeNotifBtn: {
    padding: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  notifEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xxxl,
  },
  notifEmptyText: {
    color: colors.onSurface,
    fontWeight: "700",
    fontSize: 15,
  },
  notifEmptyHelp: {
    color: colors.onSurfaceTertiary,
    textAlign: "center",
    fontSize: 13,
    lineHeight: 18,
  },
  notifList: { padding: spacing.xl, gap: spacing.sm },
  notifRow: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  notifUnread: {
    borderColor: colors.brand,
    backgroundColor: colors.brandTertiary,
  },
  notifIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  notifText: { color: colors.onSurface, fontSize: 14 },
  notifActor: { fontWeight: "800" },
  notifSnippet: {
    color: colors.onSurfaceTertiary,
    fontSize: 12,
    marginTop: 4,
    fontStyle: "italic",
  },
  notifTime: { color: colors.muted, fontSize: 11, marginTop: 4 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    color: colors.onSurface,
    fontWeight: "700",
    fontSize: 15,
  },
  sectionCaption: { color: colors.onSurfaceTertiary, fontSize: 12 },
  loadingRow: { padding: spacing.xl, alignItems: "center" },
  empty: {
    color: colors.onSurfaceTertiary,
    fontSize: 13,
    fontStyle: "italic",
    marginBottom: spacing.md,
  },

  // Discover slider
  sliderRow: {
    paddingRight: spacing.xl,
    gap: spacing.md,
  },
  discoverCard: {
    width: 140,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarSm: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.onBrandTertiary, fontWeight: "800", fontSize: 15 },
  cardName: {
    color: colors.onSurface,
    fontWeight: "700",
    fontSize: 13,
    textAlign: "center",
  },
  cardMeta: {
    color: colors.onSurfaceTertiary,
    fontSize: 10,
    letterSpacing: 0.3,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    marginTop: 4,
  },
  addBtnText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  friendChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    marginTop: 4,
  },
  friendChipText: {
    color: colors.brand,
    fontWeight: "700",
    fontSize: 11,
  },

  // Friends list
  friendsList: { gap: spacing.sm },
  friendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  friendName: { color: colors.onSurface, fontWeight: "700", fontSize: 14 },
  friendMeta: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  removeBtn: {
    padding: spacing.sm,
    borderRadius: radius.pill,
  },

  // Feed
  feedList: { gap: spacing.sm },
  feedItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  feedIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  feedName: { color: colors.onSurface, fontWeight: "700", fontSize: 14 },
  feedDesc: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  feedDate: {
    color: colors.onSurface,
    fontWeight: "700",
    fontSize: 12,
  },
});
