// ============================================================
// Nexora — API layer (movies + TV shows)
// ============================================================

const TMDB_API_KEY = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIwN2I5ODFhMWU2ZGFkOTIwOWZjNTEzMmQ3NjcyYmNlMiIsIm5iZiI6MTc3NDAxNTE0Mi4zODMwMDAxLCJzdWIiOiI2OWJkNTJhNjEwMjI5NjkwMTE1ZmI2NTciLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.coEH7RP5fn-lOrhw9iCHPpNQRT94gYMOiSg9J63YWHc";

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p";

const imgUrl = (path, size = "w500") => (path ? `${IMG_BASE}/${size}${path}` : null);

// ---- cache ----------------------------------------------------------------
const _tmdbCache = new Map();
const TMDB_CACHE_TTL = 5 * 60 * 1000;

// ---- concurrency-limited fetch queue ---------------------------------------
let _inflight = 0;
const MAX_INFLIGHT = 4;
const _waiters = [];
function _acquireSlot() {
  if (_inflight < MAX_INFLIGHT) { _inflight++; return Promise.resolve(); }
  return new Promise((resolve) => _waiters.push(resolve));
}
function _releaseSlot() {
  _inflight--;
  if (_waiters.length > 0) { _inflight++; _waiters.shift()(); }
}

async function tmdbFetch(path) {
  const sep = path.includes("?") ? "&" : "?";
  const localizedPath = `${path}${sep}language=en-US`;
  const cached = _tmdbCache.get(localizedPath);
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
    throw new Error(`TMDB auth error (${res.status}) — check your TMDB_API_KEY`);
  }
  if (!res.ok) throw new Error(`TMDB ${res.status}`);

  const data = await res.json();
  _tmdbCache.set(localizedPath, { data, expiresAt: Date.now() + TMDB_CACHE_TTL });
  if (_tmdbCache.size > 120) {
    const now = Date.now();
    for (const [k, v] of _tmdbCache) if (now >= v.expiresAt) _tmdbCache.delete(k);
  }
  return data;
}

// ---- Player sources (movie + tv) -------------------------------------------
// 伺 = "server" (short for 伺服器) — used as a prefix on every source label
// below, per site branding. Four sources, pulled from three different
// embed networks so a single provider going down doesn't take out playback.
// Documentation:
// https://vidlink.pro
// https://vidsrc.cc
// https://www.videasy.to/docs
// https://multiembed.mov
const PLAYER_SOURCES = [
  {
    id: "vidlink",
    label: "伺 Prime",
    note: "Recommended",
    movieUrl: (id, accentColor) =>
      `https://vidlink.pro/movie/${id}?player=jw&primaryColor=${accentColor}&secondaryColor=${accentColor}&iconColor=${accentColor}&autoplay=false`,
    tvUrl: (id, s, e, accentColor) =>
      `https://vidlink.pro/tv/${id}/${s}/${e}?player=jw&primaryColor=${accentColor}&secondaryColor=${accentColor}&iconColor=${accentColor}&autoplay=false`,
  },
  {
    id: "vidsrc",
    label: "伺 Nova",
    movieUrl: (id) => `https://vidsrc.cc/v3/embed/movie/${id}?autoPlay=false`,
    tvUrl: (id, s, e) => `https://vidsrc.cc/v3/embed/tv/${id}/${s}/${e}?autoPlay=false`,
  },
  {
    id: "videasy",
    label: "伺 Turbo",
    movieUrl: (id, accentColor) => `https://player.videasy.to/movie/${id}?overlay=true&color=${accentColor}`,
    tvUrl: (id, s, e, accentColor) => `https://player.videasy.to/tv/${id}/${s}/${e}?overlay=true&color=${accentColor}`,
  },
  {
    id: "multiembed",
    label: "伺 Echo",
    movieUrl: (id) => `https://multiembed.mov/?video_id=${id}&tmdb=1`,
    tvUrl: (id, s, e) => `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${s}&e=${e}`,
  },
];
const DEFAULT_SOURCE = "vidlink";

function getSourceUrl(sourceId, type, id, season, episode, accentColor = "c9a24b") {
  const src = PLAYER_SOURCES.find((s) => s.id === sourceId) || PLAYER_SOURCES[0];
  const color = accentColor.replace(/^#/, "");
  return type === "tv" ? src.tvUrl(id, season, episode, color) : src.movieUrl(id, color);
}

// ---- Genre maps -------------------------------------------------------------
let _movieGenreMap = null;
let _tvGenreMap = null;
async function getMovieGenreMap() {
  if (_movieGenreMap) return _movieGenreMap;
  try {
    const data = await tmdbFetch("/genre/movie/list");
    _movieGenreMap = {};
    (data.genres || []).forEach((g) => (_movieGenreMap[g.id] = g.name));
  } catch { _movieGenreMap = {}; }
  return _movieGenreMap;
}
async function getTvGenreMap() {
  if (_tvGenreMap) return _tvGenreMap;
  try {
    const data = await tmdbFetch("/genre/tv/list");
    _tvGenreMap = {};
    (data.genres || []).forEach((g) => (_tvGenreMap[g.id] = g.name));
  } catch { _tvGenreMap = {}; }
  return _tvGenreMap;
}

// ---- Public API --------------------------------------------------------------
const NexoraAPI = {
  imgUrl,
  getSourceUrl,
  PLAYER_SOURCES,
  DEFAULT_SOURCE,
  getMovieGenreMap,
  getTvGenreMap,

  // Movies
  trendingMovies: () => tmdbFetch("/trending/movie/week"),
  topRatedMovies: (page = 1) => tmdbFetch(`/movie/top_rated?page=${page}`),
  popularMovies: (page = 1) => tmdbFetch(`/movie/popular?page=${page}`),
  movieByGenre: (genreId, page = 1, sort = "popularity.desc") =>
    tmdbFetch(`/discover/movie?with_genres=${genreId}&sort_by=${sort}&page=${page}`),
  discoverMovies: (page = 1, sort = "popularity.desc", genreId = "") =>
    tmdbFetch(`/discover/movie?sort_by=${sort}&page=${page}${genreId ? `&with_genres=${genreId}` : ""}`),
  movieDetails: (id) => tmdbFetch(`/movie/${id}?append_to_response=credits`),
  similarMovies: (id) => tmdbFetch(`/movie/${id}/similar`),
  searchMovies: (q, page = 1) => tmdbFetch(`/search/movie?query=${encodeURIComponent(q)}&page=${page}`),

  // TV
  popularTv: (page = 1) => tmdbFetch(`/tv/popular?page=${page}`),
  topRatedTv: (page = 1) => tmdbFetch(`/tv/top_rated?page=${page}`),
  tvByGenre: (genreId, page = 1, sort = "popularity.desc") =>
    tmdbFetch(`/discover/tv?with_genres=${genreId}&sort_by=${sort}&page=${page}`),
  discoverTv: (page = 1, sort = "popularity.desc", genreId = "") =>
    tmdbFetch(`/discover/tv?sort_by=${sort}&page=${page}${genreId ? `&with_genres=${genreId}` : ""}`),
  tvDetails: (id) => tmdbFetch(`/tv/${id}?append_to_response=credits`),
  tvSeason: (id, seasonNum) => tmdbFetch(`/tv/${id}/season/${seasonNum}`),
  similarTv: (id) => tmdbFetch(`/tv/${id}/similar`),
  searchTv: (q, page = 1) => tmdbFetch(`/search/tv?query=${encodeURIComponent(q)}&page=${page}`),

  // Combined multi-search
  searchMulti: (q, page = 1) => tmdbFetch(`/search/multi?query=${encodeURIComponent(q)}&page=${page}`),
};

const GENRE_IDS = { action: 28, comedy: 35, horror: 27, animation: 16 };
