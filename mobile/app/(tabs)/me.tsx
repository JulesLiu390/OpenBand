import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { Section } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { MusicPage } from "@/components/MusicPage";
import { getMusicTags } from "@/lib/taste";
import { theme } from "@/lib/theme";

export default function MeScreen() {
  const router = useRouter();
  const { session, user, logout } = useAuth();
  const [loading, setLoading] = useState(false);
  const [logoutConfirmVisible, setLogoutConfirmVisible] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const loadTags = useCallback(async () => {
    if (!session) {
      return;
    }
    setLoading(true);
    try {
      const response = await getMusicTags(session.accessToken);
      setTags(response.tags);
      setUpdatedAt(response.updated_at);
    } catch {
      setTags([]);
      setUpdatedAt(null);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  async function submitLogout() {
    if (loggingOut) {
      return;
    }
    setLoggingOut(true);
    try {
      await logout();
      setLogoutConfirmVisible(false);
      router.replace("/login");
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <MusicPage>
      <Section>
        <Text style={styles.eyebrow}>Profile</Text>
        <Text style={styles.title}>Me</Text>
      </Section>

      <Section>
        <View style={styles.profilePanel}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial(user?.label)}</Text>
          </View>
          <View style={styles.profileCopy}>
            <Text style={styles.name} numberOfLines={1}>
              {user?.label ?? "OpenBand Friend"}
            </Text>
            <Text style={styles.meta}>{tags.length ? `${tags.length} taste tags` : "No taste tags yet"}</Text>
          </View>
          {loading ? <ActivityIndicator color={theme.colors.tint} size="small" /> : null}
        </View>
      </Section>

      <Section>
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>Taste Tags</Text>
            <Text style={styles.updatedText}>{updatedAt ? `Updated ${shortDate(updatedAt)}` : "Generated from onboarding"}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/onboarding" as never)}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <Text style={styles.iconButtonText}>＋</Text>
          </Pressable>
        </View>
        {tags.length ? (
          <View style={styles.tagWrap}>
            {tags.map((tag) => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No taste profile</Text>
            <Text style={styles.emptyText}>Add favorites to generate your first music tags.</Text>
          </View>
        )}
      </Section>

      <Section>
        <Pressable
          accessibilityRole="button"
          onPress={() => setLogoutConfirmVisible(true)}
          style={({ pressed }) => [styles.logoutButton, pressed && styles.pressed]}>
          <Text style={styles.logoutText}>Log Out</Text>
        </Pressable>
      </Section>

      <Modal
        animationType="fade"
        transparent
        visible={logoutConfirmVisible}
        onRequestClose={() => {
          if (!loggingOut) {
            setLogoutConfirmVisible(false);
          }
        }}>
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="Cancel log out"
            disabled={loggingOut}
            onPress={() => setLogoutConfirmVisible(false)}
            style={styles.backdrop}
          />
          <View style={styles.confirmPanel}>
            <Text style={styles.confirmTitle}>Log out?</Text>
            <Text style={styles.confirmText}>
              Once you log out, you will need an administrator to generate a new QR code before you can sign in again.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                accessibilityRole="button"
                disabled={loggingOut}
                onPress={() => setLogoutConfirmVisible(false)}
                style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed, loggingOut && styles.disabled]}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={loggingOut}
                onPress={submitLogout}
                style={({ pressed }) => [styles.confirmButton, pressed && styles.pressed, loggingOut && styles.disabled]}>
                <Text style={styles.confirmButtonText}>{loggingOut ? "Logging Out" : "Log Out"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </MusicPage>
  );
}

function initial(label: string | undefined): string {
  const clean = (label || "O").trim();
  return clean.slice(0, 1).toUpperCase();
}

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  eyebrow: {
    color: theme.colors.tint,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
  },
  title: {
    color: theme.colors.text,
    fontSize: 42,
    fontWeight: "900",
  },
  profilePanel: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    flexDirection: "row",
    gap: 14,
    minHeight: 94,
    padding: 14,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: theme.colors.tint,
    borderRadius: theme.radius.md,
    height: 62,
    justifyContent: "center",
    width: 62,
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "900",
  },
  profileCopy: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: theme.colors.text,
    fontSize: 21,
    fontWeight: "900",
  },
  meta: {
    color: theme.colors.secondaryText,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 5,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  updatedText: {
    color: theme.colors.secondaryText,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  iconButtonText: {
    color: theme.colors.tint,
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 26,
  },
  tagWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tag: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  tagText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  emptyState: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    gap: 4,
    padding: 16,
  },
  emptyTitle: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  emptyText: {
    color: theme.colors.secondaryText,
    fontSize: 13,
    fontWeight: "700",
  },
  logoutButton: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    height: 48,
    justifyContent: "center",
  },
  logoutText: {
    color: theme.colors.tint,
    fontSize: 15,
    fontWeight: "900",
  },
  modalRoot: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  backdrop: {
    backgroundColor: "rgba(0,0,0,0.2)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  confirmPanel: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    gap: 12,
    maxWidth: 360,
    padding: 18,
    width: "100%",
  },
  confirmTitle: {
    color: theme.colors.text,
    fontSize: 21,
    fontWeight: "900",
  },
  confirmText: {
    color: theme.colors.secondaryText,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  confirmActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  cancelButton: {
    alignItems: "center",
    backgroundColor: theme.colors.background,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
  },
  cancelText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  confirmButton: {
    alignItems: "center",
    backgroundColor: theme.colors.tint,
    borderRadius: theme.radius.md,
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
  },
  confirmButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.76,
  },
});
