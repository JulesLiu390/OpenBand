import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Section } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { MusicPage } from "@/components/MusicPage";
import {
  generateMusicProfile,
  getMusicTagCatalog,
  getMusicTags,
  loadCachedMusicTagCatalog,
  loadCachedMusicTags,
  setMusicTags,
} from "@/lib/taste";
import { loadSongCatalog } from "@/lib/songs";
import { theme } from "@/lib/theme";

const RESULT_LIMIT = 120;

type GeneratedTagCandidate = {
  tag: string;
  meaning: string;
};

export default function TasteTagsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [catalogTags, setCatalogTags] = useState<string[]>([]);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [savedTags, setSavedTags] = useState<string[]>([]);
  const [profileInput, setProfileInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generatedSummary, setGeneratedSummary] = useState("");
  const [generatedCandidates, setGeneratedCandidates] = useState<GeneratedTagCandidate[]>([]);

  const selectedKeys = useMemo(() => new Set(selectedTags.map(tagKey)), [selectedTags]);
  const dirty = useMemo(() => !sameTags(selectedTags, savedTags), [savedTags, selectedTags]);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleCatalogTags = useMemo(() => {
    const candidates = catalogTags
      .filter((tag) => !selectedKeys.has(tagKey(tag)))
      .filter((tag) => !normalizedQuery || tag.toLowerCase().includes(normalizedQuery))
      .sort((left, right) => left.localeCompare(right));
    return candidates.slice(0, RESULT_LIMIT);
  }, [catalogTags, normalizedQuery, selectedKeys]);
  const sortedSelectedTags = useMemo(
    () => [...selectedTags].sort((left, right) => left.localeCompare(right)),
    [selectedTags],
  );

  useEffect(() => {
    let mounted = true;

    async function load() {
      if (!session) {
        setCatalogTags([]);
        setSelectedTags([]);
        setSavedTags([]);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const [cachedTags, cachedCatalog, cachedSongs] = await Promise.all([
          loadCachedMusicTags(session.user.id),
          loadCachedMusicTagCatalog(session.user.id),
          loadSongCatalog(session.user.id),
        ]);
        if (!mounted) {
          return;
        }
        if (cachedTags) {
          setSelectedTags(cachedTags.tags);
          setSavedTags(cachedTags.tags);
        }
        if (cachedCatalog) {
          setCatalogTags(cachedCatalog.tags);
          setCatalogTotal(cachedCatalog.total);
        } else {
          const fallbackTags = songCatalogTags(cachedSongs);
          setCatalogTags(fallbackTags);
          setCatalogTotal(fallbackTags.length);
        }

        const [tagsResponse, catalogResponse] = await Promise.all([
          getMusicTags(session.accessToken),
          getMusicTagCatalog(session.accessToken),
        ]);
        if (!mounted) {
          return;
        }
        setSelectedTags(tagsResponse.tags);
        setSavedTags(tagsResponse.tags);
        setCatalogTags(catalogResponse.tags);
        setCatalogTotal(catalogResponse.total);
      } catch (exc) {
        if (mounted) {
          setError(exc instanceof Error ? exc.message : "Tags could not load.");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      mounted = false;
    };
  }, [session]);

  function addTag(tag: string) {
    const key = tagKey(tag);
    setSelectedTags((current) => {
      if (current.some((item) => tagKey(item) === key)) {
        return current;
      }
      return [...current, tag].sort((left, right) => left.localeCompare(right));
    });
  }

  function removeTag(tag: string) {
    const key = tagKey(tag);
    setSelectedTags((current) => current.filter((item) => tagKey(item) !== key));
  }

  function toggleTag(tag: string) {
    if (selectedKeys.has(tagKey(tag))) {
      removeTag(tag);
      return;
    }
    addTag(tag);
  }

  async function saveTags() {
    if (!session || saving || !dirty) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await setMusicTags(session.accessToken, selectedTags);
      setSelectedTags(response.tags);
      setSavedTags(response.tags);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Tags could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function generateSuggestions() {
    if (!session || generating) {
      return;
    }
    const input = profileInput.trim();
    if (!input) {
      setGenerateError("Add a few favorites first.");
      return;
    }

    setGenerating(true);
    setGenerateError(null);
    setGeneratedSummary("");
    setGeneratedCandidates([]);
    try {
      const response = await generateMusicProfile(session.accessToken, {
        profile_input: input,
        save: false,
      });
      const catalogByKey = new Map(catalogTags.map((tag) => [tagKey(tag), tag]));
      const unknownKeys = new Set(response.unknown_tags.map(tagKey));
      const meaningByKey = new Map(response.tag_meanings.map((item) => [tagKey(item.tag), item.meaning]));
      const nextCandidates = dedupeCandidateTags(
        response.tags
          .filter((tag) => !tagKey(tag).startsWith("no "))
          .filter((tag) => !unknownKeys.has(tagKey(tag)))
          .map((tag) => {
            const key = tagKey(tag);
            const catalogTag = catalogByKey.get(key) ?? tag;
            return {
              tag: catalogTag,
              meaning: meaningByKey.get(key) ?? fallbackMeaning(catalogTag),
            };
          }),
      ).sort((left, right) => left.tag.localeCompare(right.tag));

      setGeneratedSummary(response.reference_summary);
      setGeneratedCandidates(nextCandidates);
      if (!nextCandidates.length) {
        setGenerateError("No matching catalog tags found.");
      }
    } catch (exc) {
      setGenerateError(exc instanceof Error ? exc.message : "Tags could not generate.");
    } finally {
      setGenerating(false);
    }
  }

  function toggleGeneratedTag(tag: string) {
    toggleTag(tag);
  }

  return (
    <MusicPage>
      <Section>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>Taste</Text>
            <Text style={styles.title}>Tags</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
            <Text style={styles.closeText}>Done</Text>
          </Pressable>
        </View>
      </Section>

      <Section>
        <View style={styles.actionRow}>
          <Text style={styles.meta}>{dirty ? `${selectedTags.length} selected · unsaved` : `${selectedTags.length} selected`}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={!dirty || saving}
            onPress={saveTags}
            style={({ pressed }) => [styles.saveButton, (!dirty || saving) && styles.disabled, pressed && styles.pressed]}>
            {saving ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.saveText}>Save</Text>}
          </Pressable>
        </View>
        {loading ? <ActivityIndicator color={theme.colors.tint} size="small" /> : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </Section>

      <Section>
        <View style={styles.generatorHeader}>
          <Text style={[styles.sectionTitle, styles.generatorTitle]}>AI Suggestions</Text>
          <Pressable
            accessibilityRole="button"
            disabled={generating || !session}
            onPress={generateSuggestions}
            style={({ pressed }) => [styles.generateButton, (generating || !session) && styles.disabled, pressed && styles.pressed]}>
            {generating ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.generateText}>Generate</Text>}
          </Pressable>
        </View>
        {generatedSummary ? <Text style={styles.generatorSummary}>{generatedSummary}</Text> : null}
        <TextInput
          autoCapitalize="sentences"
          multiline
          onChangeText={setProfileInput}
          placeholder="Artists, songs, games, scenes, moods, sounds..."
          placeholderTextColor={theme.colors.tertiaryText}
          style={[styles.searchInput, styles.profileInput]}
          textAlignVertical="top"
          value={profileInput}
        />
        {generateError ? <Text style={styles.errorText}>{generateError}</Text> : null}
        {generatedCandidates.length ? (
          <>
            <View style={styles.suggestionActionRow}>
              <Text style={styles.meta}>{generatedCandidates.length} suggestions</Text>
            </View>
            <View style={styles.suggestionGrid}>
              {generatedCandidates.map((candidate) => {
                const isSelected = selectedKeys.has(tagKey(candidate.tag));
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    key={candidate.tag}
                    onPress={() => toggleGeneratedTag(candidate.tag)}
                    style={({ pressed }) => [
                      styles.suggestionCard,
                      isSelected && styles.suggestionCardSelected,
                      pressed && styles.pressed,
                    ]}>
                    <View style={styles.suggestionCardHeader}>
                      <Text style={[styles.suggestionTagText, isSelected && styles.suggestionTagTextSelected]}>
                        {candidate.tag}
                      </Text>
                      <Text style={[styles.suggestionStatus, isSelected && styles.suggestionStatusSelected]}>
                        {isSelected ? "Selected" : "Add"}
                      </Text>
                    </View>
                    <Text
                      numberOfLines={4}
                      style={[styles.suggestionMeaning, isSelected && styles.suggestionMeaningSelected]}>
                      {candidate.meaning}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}
      </Section>

      <Section>
        <Text style={styles.sectionTitle}>Selected</Text>
        <View style={styles.tagWrap}>
          {sortedSelectedTags.length ? (
            sortedSelectedTags.map((tag) => (
              <Pressable
                accessibilityRole="button"
                key={tag}
                onPress={() => removeTag(tag)}
                style={({ pressed }) => [styles.selectedTag, pressed && styles.pressed]}>
                <Text style={styles.selectedTagText}>{tag}</Text>
                <Text style={styles.removeMark}>x</Text>
              </Pressable>
            ))
          ) : (
            <View style={styles.emptyPanel}>
              <Text style={styles.emptyText}>No tags selected</Text>
            </View>
          )}
        </View>
      </Section>

      <Section>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          onChangeText={setQuery}
          placeholder={`Search ${catalogTotal || 416} tags`}
          placeholderTextColor={theme.colors.tertiaryText}
          style={styles.searchInput}
          value={query}
        />
        <View style={styles.tagWrap}>
          {visibleCatalogTags.length ? (
            visibleCatalogTags.map((tag) => (
              <Pressable
                accessibilityRole="button"
                key={tag}
                onPress={() => addTag(tag)}
                style={({ pressed }) => [styles.catalogTag, pressed && styles.pressed]}>
                <Text style={styles.catalogTagText}>{tag}</Text>
              </Pressable>
            ))
          ) : (
            <View style={styles.emptyPanel}>
              <Text style={styles.emptyText}>No matching tags</Text>
            </View>
          )}
        </View>
      </Section>
    </MusicPage>
  );
}

function sameTags(left: string[], right: string[]): boolean {
  const leftSorted = [...left].map(tagKey).sort();
  const rightSorted = [...right].map(tagKey).sort();
  return leftSorted.length === rightSorted.length && leftSorted.every((tag, index) => tag === rightSorted[index]);
}

function songCatalogTags(songs: Awaited<ReturnType<typeof loadSongCatalog>>): string[] {
  const tags = new Map<string, string>();
  for (const song of songs) {
    for (const tag of song.tags) {
      const clean = tag.trim();
      if (clean) {
        tags.set(tagKey(clean), clean);
      }
    }
  }
  return Array.from(tags.values()).sort((left, right) => left.localeCompare(right));
}

function dedupeCandidateTags(candidates: GeneratedTagCandidate[]): GeneratedTagCandidate[] {
  const byKey = new Map<string, GeneratedTagCandidate>();
  candidates.forEach((candidate) => {
    const key = tagKey(candidate.tag);
    if (!byKey.has(key)) {
      byKey.set(key, candidate);
    }
  });
  return Array.from(byKey.values());
}

function fallbackMeaning(tag: string): string {
  return `Signals a preference for ${tag} in the music's style, sound, mood, arrangement, or production.`;
}

function tagKey(tag: string): string {
  return tag.trim().toLowerCase();
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
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
  closeButton: {
    alignItems: "center",
    minHeight: 38,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  closeText: {
    color: theme.colors.tint,
    fontSize: 14,
    fontWeight: "900",
  },
  actionRow: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 58,
    paddingLeft: 12,
    paddingRight: 12,
  },
  meta: {
    color: theme.colors.secondaryText,
    fontSize: 13,
    fontWeight: "800",
  },
  saveButton: {
    alignItems: "center",
    backgroundColor: theme.colors.tint,
    borderRadius: theme.radius.pill,
    minHeight: 38,
    justifyContent: "center",
    minWidth: 92,
    paddingHorizontal: 14,
  },
  saveText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  generatorHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingRight: 12,
  },
  generatorTitle: {
    flex: 1,
    minWidth: 0,
  },
  generatorSummary: {
    color: theme.colors.secondaryText,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
  },
  generateButton: {
    alignItems: "center",
    backgroundColor: theme.colors.tint,
    borderRadius: theme.radius.pill,
    minHeight: 38,
    justifyContent: "center",
    minWidth: 92,
    paddingHorizontal: 14,
  },
  generateText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },
  searchInput: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "800",
    minHeight: 48,
    paddingHorizontal: 14,
  },
  profileInput: {
    minHeight: 112,
    paddingTop: 12,
  },
  suggestionActionRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  suggestionGrid: {
    gap: 8,
  },
  suggestionCard: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
    padding: 12,
  },
  suggestionCardSelected: {
    backgroundColor: theme.colors.tintSoft,
    borderColor: theme.colors.tint,
  },
  suggestionCardHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  suggestionTagText: {
    color: theme.colors.text,
    flex: 1,
    fontSize: 15,
    fontWeight: "900",
  },
  suggestionTagTextSelected: {
    color: theme.colors.tint,
  },
  suggestionStatus: {
    color: theme.colors.secondaryText,
    fontSize: 12,
    fontWeight: "900",
  },
  suggestionStatusSelected: {
    color: theme.colors.tint,
  },
  suggestionMeaning: {
    color: theme.colors.secondaryText,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  suggestionMeaningSelected: {
    color: theme.colors.text,
  },
  tagWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  selectedTag: {
    alignItems: "center",
    backgroundColor: theme.colors.tint,
    borderRadius: theme.radius.pill,
    flexDirection: "row",
    gap: 7,
    minHeight: 36,
    paddingHorizontal: 11,
  },
  selectedTagText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },
  removeMark: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
    opacity: 0.82,
  },
  catalogTag: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: 11,
  },
  catalogTagText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  emptyPanel: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: 14,
  },
  emptyText: {
    color: theme.colors.secondaryText,
    fontSize: 13,
    fontWeight: "800",
  },
  errorText: {
    color: theme.colors.tint,
    fontSize: 13,
    fontWeight: "800",
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.75,
  },
});
