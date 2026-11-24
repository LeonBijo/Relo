export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
  durationText: string;
  thumbnailUrl: string;
  watchUrl: string;
}

export type YouTubeSearchResponse =
  | { ok: true; results: YouTubeSearchResult[]; cached: boolean }
  | { ok: false; error: string; errorCode: string };

interface CacheEntry {
  results: YouTubeSearchResult[];
  expiresAt: number;
}

const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
const ISO_DURATION_REGEX = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;

/**
 * Formats an ISO 8601 YouTube duration (e.g. PT4M12S) into m:ss or h:mm:ss.
 */
export function formatIsoDuration(iso?: string | null): string {
  if (!iso) return "—";
  const match = ISO_DURATION_REGEX.exec(iso);
  if (!match) return "—";

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);

  if (hours === 0 && minutes === 0 && seconds === 0) {
    return "Live";
  }

  if (hours > 0) {
    return `${hours}∶${String(minutes).padStart(2, "0")}∶${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}∶${String(seconds).padStart(2, "0")}`;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export class YouTubeSearchService {
  private readonly getApiKey: () => string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly suggestCache = new Map<
    string,
    { suggestions: string[]; expiresAt: number }
  >();

  constructor(options?: {
    getApiKey?: () => string | undefined;
    fetchImpl?: typeof fetch;
    cacheTtlMs?: number;
    now?: () => number;
  }) {
    this.getApiKey = options?.getApiKey ?? (() => process.env.YOUTUBE_API_KEY);
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.cacheTtlMs = options?.cacheTtlMs ?? 5 * 60_000;
    this.now = options?.now ?? (() => Date.now());
  }

  async search(rawQuery: unknown): Promise<YouTubeSearchResponse> {
    const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
    if (!query) {
      return {
        ok: false,
        error: "Enter a search term.",
        errorCode: "EMPTY_QUERY",
      };
    }
    if (query.length > 100) {
      return {
        ok: false,
        error: "Search query must be 100 characters or fewer.",
        errorCode: "QUERY_TOO_LONG",
      };
    }

    const cacheKey = query.toLowerCase();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) {
      return { ok: true, results: cached.results, cached: true };
    }

    const apiKey = this.getApiKey()?.trim();
    if (!apiKey) {
      return {
        ok: false,
        error:
          "YouTube search is not configured on the relay. Paste a YouTube link below instead.",
        errorCode: "API_KEY_MISSING",
      };
    }

    try {
      const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
      searchUrl.searchParams.set("part", "snippet");
      searchUrl.searchParams.set("type", "video");
      searchUrl.searchParams.set("maxResults", "6");
      searchUrl.searchParams.set("safeSearch", "moderate");
      searchUrl.searchParams.set("q", query);
      searchUrl.searchParams.set("key", apiKey);

      const searchRes = await this.fetchImpl(searchUrl.toString());
      if (!searchRes.ok) {
        const body = (await searchRes.json().catch(() => ({}))) as {
          error?: { errors?: Array<{ reason?: string }> };
        };
        const reason = body.error?.errors?.[0]?.reason ?? "";
        if (searchRes.status === 403 && reason.toLowerCase().includes("quota")) {
          return {
            ok: false,
            error:
              "Daily YouTube search quota reached. Paste a YouTube link below instead.",
            errorCode: "QUOTA_EXCEEDED",
          };
        }
        return {
          ok: false,
          error:
            "YouTube search is temporarily unavailable. Paste a YouTube link below instead.",
          errorCode: "UPSTREAM_ERROR",
        };
      }

      const searchJson = (await searchRes.json()) as {
        items?: Array<{
          id?: { videoId?: string };
          snippet?: {
            title?: string;
            channelTitle?: string;
            thumbnails?: {
              medium?: { url?: string };
              default?: { url?: string };
            };
          };
        }>;
      };

      const rawItems = (searchJson.items ?? []).filter((item) =>
        VIDEO_ID_REGEX.test(item.id?.videoId ?? ""),
      );

      if (rawItems.length === 0) {
        this.cache.set(cacheKey, {
          results: [],
          expiresAt: this.now() + this.cacheTtlMs,
        });
        return { ok: true, results: [], cached: false };
      }

      // Fetch durations via videos.list (1 quota unit)
      const durationMap = new Map<string, string>();
      try {
        const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
        videosUrl.searchParams.set("part", "contentDetails");
        videosUrl.searchParams.set(
          "id",
          rawItems.map((i) => i.id!.videoId!).join(","),
        );
        videosUrl.searchParams.set("key", apiKey);

        const videosRes = await this.fetchImpl(videosUrl.toString());
        if (videosRes.ok) {
          const videosJson = (await videosRes.json()) as {
            items?: Array<{
              id?: string;
              contentDetails?: { duration?: string };
            }>;
          };
          for (const v of videosJson.items ?? []) {
            if (v.id) {
              durationMap.set(v.id, formatIsoDuration(v.contentDetails?.duration));
            }
          }
        }
      } catch {
        // Duration lookup is best-effort; continue with search results
      }

      const results: YouTubeSearchResult[] = rawItems.map((item) => {
        const videoId = item.id!.videoId!;
        return {
          videoId,
          title: decodeHtmlEntities(item.snippet?.title ?? "YouTube video"),
          channelTitle: decodeHtmlEntities(
            item.snippet?.channelTitle ?? "YouTube",
          ),
          durationText: durationMap.get(videoId) ?? "—",
          thumbnailUrl:
            item.snippet?.thumbnails?.medium?.url ??
            item.snippet?.thumbnails?.default?.url ??
            "",
          watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
        };
      });

      this.cache.set(cacheKey, {
        results,
        expiresAt: this.now() + this.cacheTtlMs,
      });

      return { ok: true, results, cached: false };
    } catch {
      return {
        ok: false,
        error:
          "Network error reaching YouTube search. Paste a YouTube link below instead.",
        errorCode: "NETWORK_ERROR",
      };
    }
  }

  /**
   * Fetches lightweight search autocomplete suggestions (zero Data API quota).
   * Never throws; returns an empty list on network errors.
   */
  async suggest(rawQuery: unknown): Promise<string[]> {
    const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
    if (query.length < 2 || query.length > 80) {
      return [];
    }

    const cacheKey = query.toLowerCase();
    const cached = this.suggestCache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) {
      return cached.suggestions;
    }

    try {
      const url = new URL("https://suggestqueries.google.com/complete/search");
      url.searchParams.set("client", "firefox");
      url.searchParams.set("ds", "yt");
      url.searchParams.set("q", query);

      const res = await this.fetchImpl(url.toString());
      if (!res.ok) return [];

      const json = (await res.json()) as unknown;
      if (!Array.isArray(json) || !Array.isArray(json[1])) {
        return [];
      }

      const suggestions = (json[1] as unknown[])
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .slice(0, 6);

      this.suggestCache.set(cacheKey, {
        suggestions,
        expiresAt: this.now() + this.cacheTtlMs,
      });
      return suggestions;
    } catch {
      return [];
    }
  }
}
