// ============================================================
// Nexora — API layer
// TMDB fetch helpers + streaming player source list, adapted
// from the reference project's src/utils/api.js.
// ============================================================

// ---- TMDB configuration -------------------------------------------------
// Get a free API Read Access Token at https://www.themoviedb.org/settings/api
// and paste it below. Movies will not load until this is set.
const TMDB_API_KEY = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIwN2I5ODFhMWU2ZGFkOTIwOWZjNTEzMmQ3NjcyYmNlMiIsIm5iZiI6MTc3NDAxNTE0Mi4zODMwMDAxLCJzdWIiOiI2OWJkNTJhNjEwMjI5NjkwMTE1ZmI2NTciLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.coEH7RP5fn-lOrhw9iCHPpNQRT94gYMOiSg9J63YWHc";

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p";

const imgUrl = (path, size = "w500") => (path ? `${IMG_BASE}/${size}${path}` : null);

// ---- in-memory response cache (5 min TTL) --------------------------------
const _tmdbCache = new Map();
const TMDB_CACHE_TTL = 5 * 60 * 1000;

// ---- concurrency-limited fetch queue (max 4 in flight) -------------------
let _inflight = 0;
const MAX_INFLIGHT = 4;
const _waiters = [];

function _acquireSlot() {
  if (_inflight < MAX_INFLIGHT) {
    _inflight++;
    return Promise.resolve();
  }
  return new Promise((resolve) => _waiters.push(resolve));
}
function _releaseSlot() {
  _inflight--;
  if (_waiters.length > 0) {
    _inflight++;
    _waiters.shift()();
  }
}

/**
 * Fetch a path from TMDB (movie-only usage in Nexora).
 * path example: "/movie/popular?page=1"
 */
async function tmdbFetch(path) {
  const sep = path.includes("?") ? "&" : "?";
  const localizedPath = `${path}${sep}language=en-US`;
  const cacheKey = localizedPath;
  const cached = _tmdbCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  await _acquireSlot();
  let res;
  try {
    res = await fetch(`${TMDB_BASE}${localizedPath}`, {
      headers: { Authorization: `Bearer ${TMDB_API_KEY}` },
    });
  } catch (err) {
    _releaseSlot();
    throw new Error("TMDB unreachable");
  }
  _releaseSlot();

  if (res.status === 401 || res.status === 403) {
    throw new Error(`TMDB auth error (${res.status}) — check your TMDB_API_KEY in js/api.js`);
  }
  if (!res.ok) throw new Error(`TMDB ${res.status}`);

  const data = await res.json();
  _tmdbCache.set(cacheKey, { data, expiresAt: Date.now() + TMDB_CACHE_TTL });
  if (_tmdbCache.size > 100) {
    const now = Date.now();
    for (const [k, v] of _tmdbCache) if (now >= v.expiresAt) _tmdbCache.delete(k);
  }
  return data;
}

// ---- Player sources (movie-only subset, from reference project) ---------
// Documentation:
// https://www.videasy.to/docs
// https://vsembed.su/api/
// https://www.vidking.net/#documentation
const PLAYER_SOURCES = [
  {
    id: "videasy",
    label: "Videasy",
    colorParam: "color",
    params: { overlay: "true" },
    movieUrl: (id) => `https://player.videasy.to/movie/${id}`,
  },
  {
    id: "vidsrc",
    label: "VidSrc",
    colorParam: null,
    params: {},
    movieUrl: (id) => `https://vsembed.su/embed/movie/${id}`,
  },
  {
    id: "vidking",
    label: "Vidking",
    colorParam: "color",
    params: { autoPlay: "true" },
    movieUrl: (id) => `https://www.vidking.net/embed/movie/${id}`,
  },
];

const DEFAULT_SOURCE = "vidking";

/** Build a playable embed URL for a given movie's TMDB id. */
function getMovieSourceUrl(sourceId, tmdbId, accentColor = "e8a33d") {
  const src = PLAYER_SOURCES.find((s) => s.id === sourceId) || PLAYER_SOURCES[0];
  const url = new URL(src.movieUrl(tmdbId));
  Object.entries(src.params).forEach(([k, v]) => url.searchParams.set(k, v));
  if (src.colorParam) url.searchParams.set(src.colorParam, accentColor.replace(/^#/, ""));
  return url.toString();
}

// ---- Genre map (movie genres, fetched once) ------------------------------
let _genreMap = null;
async function getGenreMap() {
  if (_genreMap) return _genreMap;
  try {
    const data = await tmdbFetch("/genre/movie/list");
    _genreMap = {};
    (data.genres || []).forEach((g) => (_genreMap[g.id] = g.name));
  } catch {
    _genreMap = {};
  }
  return _genreMap;
}

// ---- Convenience wrappers used by app.js ---------------------------------
const NexoraAPI = {
  imgUrl,
  getMovieSourceUrl,
  getGenreMap,
  PLAYER_SOURCES,
  DEFAULT_SOURCE,

  trending: () => tmdbFetch("/trending/movie/week"),
  topRated: (page = 1) => tmdbFetch(`/movie/top_rated?page=${page}`),
  nowPlaying: (page = 1) => tmdbFetch(`/movie/now_playing?page=${page}`),
  popular: (page = 1) => tmdbFetch(`/movie/popular?page=${page}`),
  byGenre: (genreId, page = 1, sort = "popularity.desc") =>
    tmdbFetch(`/discover/movie?with_genres=${genreId}&sort_by=${sort}&page=${page}`),
  discover: (page = 1, sort = "popularity.desc", genreId = "") =>
    tmdbFetch(
      `/discover/movie?sort_by=${sort}&page=${page}${genreId ? `&with_genres=${genreId}` : ""}`,
    ),
  details: (id) => tmdbFetch(`/movie/${id}?append_to_response=credits`),
  similar: (id) => tmdbFetch(`/movie/${id}/similar`),
  search: (query, page = 1) =>
    tmdbFetch(`/search/movie?query=${encodeURIComponent(query)}&page=${page}`),
};

// Known TMDB genre IDs used for the fixed homepage rows
const GENRE_IDS = {
  action: 28,
  comedy: 35,
  horror: 27,
  animation: 16,
};
