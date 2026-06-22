import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "@/components/AuthProvider";
import { ApiError } from "@/lib/auth";
import { theme } from "@/lib/theme";

export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ key?: string | string[] }>();
  const { isAuthenticated, loading, login } = useAuth();
  const [inviteKey, setInviteKey] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const deepLinkKey = useMemo(() => {
    if (Array.isArray(params.key)) {
      return params.key[0] ?? "";
    }
    return params.key ?? "";
  }, [params.key]);

  useEffect(() => {
    if (deepLinkKey) {
      setInviteKey(deepLinkKey);
    }
  }, [deepLinkKey]);

  if (!loading && isAuthenticated) {
    return <Redirect href="/" />;
  }

  async function submit() {
    const trimmedKey = inviteKey.trim();
    if (!trimmedKey) {
      setError("Enter an invite key.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await login(trimmedKey);
      router.replace("/");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Could not sign in.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = submitting || !inviteKey.trim();

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.root}>
        <View style={styles.content}>
          <View style={styles.brand}>
            <View style={styles.mark}>
              <Text style={styles.markText}>♪</Text>
            </View>
            <Text style={styles.title}>OpenBand</Text>
            <Text style={styles.subtitle}>Private, friends-only music.</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>Invite Key</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              editable={!submitting}
              onChangeText={setInviteKey}
              onSubmitEditing={submit}
              placeholder="ob_key_..."
              placeholderTextColor={theme.colors.tertiaryText}
              returnKeyType="go"
              spellCheck={false}
              style={styles.input}
              value={inviteKey}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              accessibilityRole="button"
              disabled={disabled}
              onPress={submit}
              style={({ pressed }) => [
                styles.button,
                disabled && styles.buttonDisabled,
                pressed && !disabled && styles.buttonPressed,
              ]}>
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.buttonText}>Continue</Text>
              )}
            </Pressable>
          </View>
        </View>

        <Text style={styles.footer}>Non-profit beta for friends.</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  root: {
    flex: 1,
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingBottom: 22,
    paddingTop: 24,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    gap: 34,
    width: "100%",
  },
  brand: {
    alignItems: "center",
    gap: 10,
  },
  mark: {
    alignItems: "center",
    backgroundColor: theme.colors.tint,
    borderRadius: 8,
    height: 62,
    justifyContent: "center",
    width: 62,
  },
  markText: {
    color: "#FFFFFF",
    fontSize: 34,
    fontWeight: "900",
    lineHeight: 38,
  },
  title: {
    color: theme.colors.text,
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 40,
  },
  subtitle: {
    color: theme.colors.secondaryText,
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 20,
  },
  form: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    padding: 16,
  },
  label: {
    color: theme.colors.secondaryText,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 16,
    textTransform: "uppercase",
  },
  input: {
    backgroundColor: theme.colors.elevated,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "700",
    minHeight: 48,
    paddingHorizontal: 12,
  },
  error: {
    color: theme.colors.tint,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  button: {
    alignItems: "center",
    backgroundColor: theme.colors.tint,
    borderRadius: theme.radius.sm,
    height: 48,
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
    lineHeight: 20,
  },
  footer: {
    color: theme.colors.tertiaryText,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    textAlign: "center",
  },
});
