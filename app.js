// ============================================================
// Nexora — App logic (routing, rendering, auth, data)
// ============================================================

let currentUser = null;
let myListIds = new Set(); // "movie_123" / "tv_456"
let searchDebounce = null;
let currentDetailType = null; // "movie" | "tv"
let currentDetailId = null;
let currentDetailData = null;
let currentSeasonEpisodes = [];

// ---------------------------------------------------------------
function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}
function yearOf(dateStr) { return dateStr ? dateStr.slice(0, 4) : "—"; }
function ratingBadge(v) { return v ? v.toFixed(1) : "—"; }
function showToast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.add("hidden"), ms);
}

// ---------------------------------------------------------------
// Local progress tracking (continue watching) — localStorage
// ---------------------------------------------------------------
const PROGRESS_KEY = "nexora_progress";
function getProgressMap() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; }
  catch { return {}; }
}
function saveProgress(type, id, extra = {}) {
  const map = getProgressMap();
  const key = `${type}_${id}`;
  map[key] = { type, id, updatedAt: Date.now(), ...extra };
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(map)); } catch {}
}
function getRecentProgress(limit = 12) {
  const map = getProgressMap();
  return Object.values(map).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

// ---------------------------------------------------------------
// Poster card (works for movie or tv)
// ---------------------------------------------------------------
function buildPosterCard(item, type) {
  const title = item.title || item.name;
  const date = item.release_date || item.first_air_date;
  const card = document.createElement("div");
  card.className = "poster-card";
  card.dataset.id = item.id;
  card.dataset.type = type;

  const listKey = `${type}_${item.id}`;
  const inList = myListIds.has(listKey);

  card.innerHTML = `
    <div class="poster-img-wrap">
      ${
        item.poster_path
          ? `<img loading="lazy" src="${NexoraAPI.imgUrl(item.poster_path, "w342")}" alt="${escapeHtml(title)}">`
          : `<div class="poster-placeholder">${escapeHtml(title || "")}</div>`
      }
      <div class="poster-overlay">
        <button class="poster-play" title="Play">▶</button>
        <button class="poster-add ${inList ? "in-list" : ""}" title="My List">${inList ? "✓" : "+"}</button>
      </div>
      <span class="poster-rating">★ ${ratingBadge(item.vote_average)}</span>
      <span class="type-pill">${type === "tv" ? "TV" : "Movie"}</span>
    </div>
    <p class="poster-title">${escapeHtml(title)}</p>
    <p class="poster-year">${yearOf(date)}</p>
  `;

  card.querySelector(".poster-play").addEventListener("click", (e) => {
    e.stopPropagation();
    if (type === "movie") openPlayer("movie", item.id, title);
    else navigateTo(`#/tv/${item.id}`);
  });
  card.querySelector(".poster-add").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMyList(item, type, card.querySelector(".poster-add"));
  });
  card.addEventListener("click", () => navigateTo(`#/${type}/${item.id}`));

  return card;
}

function buildContinueCard(entry) {
  const card = document.createElement("div");
  card.className = "poster-card continue-card";
  card.innerHTML = `
    <div class="poster-img-wrap">
      ${entry.poster_path ? `<img loading="lazy" src="${NexoraAPI.imgUrl(entry.poster_path, "w342")}" alt="${escapeHtml(entry.title)}">` : `<div class="poster-placeholder">${escapeHtml(entry.title || "")}</div>`}
      <div class="poster-overlay"><button class="poster-play">▶</button></div>
      ${entry.type === "tv" ? `<span class="type-pill">S${entry.season} · E${entry.episode}</span>` : ""}
    </div>
    <p class="poster-title">${escapeHtml(entry.title)}</p>
  `;
  card.querySelector(".poster-play").addEventListener("click", () => {
    if (entry.type === "movie") openPlayer("movie", entry.id, entry.title);
    else openPlayer("tv", entry.id, entry.title, entry.season, entry.episode);
  });
  card.addEventListener("click", () => navigateTo(`#/${entry.type}/${entry.id}`));
  return card;
}

// ---------------------------------------------------------------
// Rail rendering
// ---------------------------------------------------------------
async function renderRail(trackSelector, fetchPromise, type) {
  const track = document.querySelector(trackSelector);
  if (!track) return;
  track.innerHTML = `<div class="rail-skeleton"></div>`.repeat(6);
  try {
    const data = await fetchPromise;
    const results = (data.results || []).filter((m) => m.poster_path);
    track.innerHTML = "";
    results.forEach((item) => {
      const itemType = type || (item.media_type === "tv" || item.first_air_date ? "tv" : "movie");
      track.appendChild(buildPosterCard(item, itemType));
    });
  } catch (err) {
    track.innerHTML = `<p class="rail-error">Couldn't load this row.${err.message.includes("auth") ? " Check your TMDB key." : ""}</p>`;
  }
}

function renderContinueWatching() {
  const rail = $("#continueWatchingRail");
  const track = rail.querySelector('[data-track="continue"]');
  const entries = getRecentProgress();
  if (entries.length === 0) { rail.style.display = "none"; return; }
  rail.style.display = "";
  track.innerHTML = "";
  entries.forEach((e) => track.appendChild(buildContinueCard(e)));
}

// ---------------------------------------------------------------
// Hero
// ---------------------------------------------------------------
async function renderHero() {
  try {
    const data = await NexoraAPI.trendingMovies();
    const pick = (data.results || []).find((m) => m.backdrop_path) || data.results[0];
    if (!pick) return;

    $("#heroBackdrop").style.backgroundImage = `url(${NexoraAPI.imgUrl(pick.backdrop_path, "w1280")})`;
    $("#heroTitle").textContent = pick.title;
    $("#heroMeta").textContent = `${yearOf(pick.release_date)}  ·  ★ ${ratingBadge(pick.vote_average)}`;
    $("#heroOverview").textContent = pick.overview || "";

    $("#heroWatchBtn").onclick = () => openPlayer("movie", pick.id, pick.title);
    $("#heroInfoBtn").onclick = () => navigateTo(`#/movie/${pick.id}`);
    const listBtn = $("#heroListBtn");
    const key = `movie_${pick.id}`;
    listBtn.textContent = myListIds.has(key) ? "✓" : "+";
    listBtn.onclick = () => toggleMyList(pick, "movie", listBtn);
  } catch (err) {
    $("#heroTitle").textContent = "Nexora";
    $("#heroOverview").textContent = "Set your TMDB API key in api.js to load movies.";
  }
}

// ---------------------------------------------------------------
// Home
// ---------------------------------------------------------------
async function loadHome() {
  renderContinueWatching();
  renderHero();
  renderRail('[data-track="trending"]', NexoraAPI.trendingMovies(), "movie");
  renderRail('[data-track="popular_tv"]', NexoraAPI.popularTv(), "tv");
  renderRail('[data-track="top_rated"]', NexoraAPI.topRatedMovies(), "movie");
  renderRail('[data-track="action"]', NexoraAPI.movieByGenre(GENRE_IDS.action), "movie");
  renderRail('[data-track="comedy"]', NexoraAPI.movieByGenre(GENRE_IDS.comedy), "movie");
  renderRail('[data-track="horror"]', NexoraAPI.movieByGenre(GENRE_IDS.horror), "movie");
  renderRail('[data-track="animation"]', NexoraAPI.movieByGenre(GENRE_IDS.animation), "movie");
}

// ---------------------------------------------------------------
// Browse (movies / tv)
// ---------------------------------------------------------------
let moviePage = 1;
async function loadMovieBrowse(reset = true) {
  if (reset) { moviePage = 1; $("#movieGrid").innerHTML = ""; }
  const genreMap = await NexoraAPI.getMovieGenreMap();
  const sel = $("#movieGenreFilter");
  if (sel.options.length <= 1) {
    Object.entries(genreMap).forEach(([id, name]) => {
      const opt = document.createElement("option"); opt.value = id; opt.textContent = name;
      sel.appendChild(opt);
    });
  }
  const data = await NexoraAPI.discoverMovies(moviePage, $("#movieSortFilter").value, sel.value);
  const grid = $("#movieGrid");
  (data.results || []).filter((m) => m.poster_path).forEach((m) => grid.appendChild(buildPosterCard(m, "movie")));
}

let tvPage = 1;
async function loadTvBrowse(reset = true) {
  if (reset) { tvPage = 1; $("#tvGrid").innerHTML = ""; }
  const genreMap = await NexoraAPI.getTvGenreMap();
  const sel = $("#tvGenreFilter");
  if (sel.options.length <= 1) {
    Object.entries(genreMap).forEach(([id, name]) => {
      const opt = document.createElement("option"); opt.value = id; opt.textContent = name;
      sel.appendChild(opt);
    });
  }
  const data = await NexoraAPI.discoverTv(tvPage, $("#tvSortFilter").value, sel.value);
  const grid = $("#tvGrid");
  (data.results || []).filter((m) => m.poster_path).forEach((m) => grid.appendChild(buildPosterCard(m, "tv")));
}

// ---------------------------------------------------------------
// My List
// ---------------------------------------------------------------
async function loadMyList() {
  const grid = $("#myListGrid");
  const emptyMsg = $("#myListEmptyMsg");
  const signedOutMsg = $("#myListSignedOutMsg");
  grid.innerHTML = "";
  emptyMsg.classList.add("hidden");

  if (!currentUser) { signedOutMsg.classList.remove("hidden"); return; }
  signedOutMsg.classList.add("hidden");

  if (myListIds.size === 0) { emptyMsg.classList.remove("hidden"); return; }

  const entries = Array.from(myListIds).map((key) => {
    const [type, id] = key.split("_");
    return { type, id };
  });
  const results = await Promise.allSettled(
    entries.map((e) => (e.type === "movie" ? NexoraAPI.movieDetails(e.id) : NexoraAPI.tvDetails(e.id))),
  );
  results.forEach((r, i) => {
    if (r.status === "fulfilled") grid.appendChild(buildPosterCard(r.value, entries[i].type));
  });
}

// ---------------------------------------------------------------
// Detail view (movie or tv)
// ---------------------------------------------------------------
async function loadDetail(type, id) {
  currentDetailType = type;
  currentDetailId = id;
  const view = $("#view-detail");
  $("#episodePicker").classList.toggle("hidden", type !== "tv");

  try {
    const item = type === "movie" ? await NexoraAPI.movieDetails(id) : await NexoraAPI.tvDetails(id);
    currentDetailData = item;
    const title = item.title || item.name;
    const date = item.release_date || item.first_air_date;

    $("#detailBackdrop").style.backgroundImage = item.backdrop_path
      ? `url(${NexoraAPI.imgUrl(item.backdrop_path, "w1280")})` : "none";
    $("#detailPoster").src = item.poster_path ? NexoraAPI.imgUrl(item.poster_path, "w500") : "";
    $("#detailTitle").textContent = title;

    const runtime = item.runtime
      ? `${Math.floor(item.runtime / 60)}h ${item.runtime % 60}m`
      : (item.number_of_seasons ? `${item.number_of_seasons} season${item.number_of_seasons > 1 ? "s" : ""}` : null);
    const genres = (item.genres || []).map((g) => g.name).join(" · ");

    $("#detailChips").innerHTML = [
      `<span class="chip">★ ${ratingBadge(item.vote_average)}</span>`,
      `<span class="chip">${yearOf(date)}</span>`,
      runtime ? `<span class="chip">${runtime}</span>` : "",
      genres ? `<span class="chip chip-muted">${escapeHtml(genres)}</span>` : "",
    ].join("");

    $("#detailOverview").textContent = item.overview || "";

    const listBtn = $("#detailListBtn");
    const key = `${type}_${id}`;
    const inList = myListIds.has(key);
    listBtn.textContent = inList ? "✓ In My List" : "+ My List";
    listBtn.onclick = () => toggleMyList(item, type, listBtn, true);

    const cast = (item.credits?.cast || []).slice(0, 8);
    $("#detailCast").innerHTML = cast.length
      ? `<h3>Cast</h3><p class="muted">${cast.map((c) => escapeHtml(c.name)).join(", ")}</p>` : "";

    if (type === "movie") {
      $("#detailWatchBtn").onclick = () => openPlayer("movie", id, title);
      renderRail("#similarTrack", NexoraAPI.similarMovies(id), "movie");
    } else {
      await loadSeasons(item);
      $("#detailWatchBtn").onclick = () => {
        const firstEp = currentSeasonEpisodes[0];
        if (firstEp) openPlayer("tv", id, title, $("#seasonSelect").value, firstEp.episode_number);
      };
      renderRail("#similarTrack", NexoraAPI.similarTv(id), "tv");
    }
  } catch (err) {
    view.innerHTML = `<div class="container" style="padding-top:100px;"><p class="empty-msg">Couldn't load this title.</p></div>`;
  }
}

async function loadSeasons(tvItem) {
  const seasonSelect = $("#seasonSelect");
  const realSeasons = (tvItem.seasons || []).filter((s) => s.season_number > 0);
  seasonSelect.innerHTML = realSeasons.map((s) => `<option value="${s.season_number}">${escapeHtml(s.name)}</option>`).join("");
  seasonSelect.onchange = () => loadEpisodes(tvItem.id, seasonSelect.value, tvItem.name);
  if (realSeasons.length) await loadEpisodes(tvItem.id, realSeasons[0].season_number, tvItem.name);
}

async function loadEpisodes(tvId, seasonNum, showTitle) {
  const list = $("#episodeList");
  list.innerHTML = `<div class="rail-skeleton" style="width:100%;height:80px;"></div>`;
  try {
    const data = await NexoraAPI.tvSeason(tvId, seasonNum);
    currentSeasonEpisodes = data.episodes || [];
    list.innerHTML = "";
    currentSeasonEpisodes.forEach((ep) => {
      const row = document.createElement("div");
      row.className = "episode-row";
      row.innerHTML = `
        <div class="episode-thumb">
          ${ep.still_path ? `<img loading="lazy" src="${NexoraAPI.imgUrl(ep.still_path, "w300")}" alt="">` : `<div class="episode-thumb-placeholder">▶</div>`}
        </div>
        <div class="episode-info">
          <p class="episode-name">${ep.episode_number}. ${escapeHtml(ep.name)}</p>
          <p class="episode-overview">${escapeHtml((ep.overview || "").slice(0, 110))}${ep.overview && ep.overview.length > 110 ? "…" : ""}</p>
        </div>
        <button class="episode-play">▶</button>
      `;
      row.querySelector(".episode-play").addEventListener("click", () => {
        openPlayer("tv", tvId, showTitle, seasonNum, ep.episode_number, ep.name);
      });
      list.appendChild(row);
    });
  } catch {
    list.innerHTML = `<p class="rail-error">Couldn't load episodes.</p>`;
  }
}

// ---------------------------------------------------------------
// Full-screen player with source switching
// ---------------------------------------------------------------
let playerState = { type: null, id: null, season: null, episode: null, title: null };

function openPlayer(type, id, title, season = null, episode = null, episodeName = null) {
  playerState = { type, id, season, episode, title };
  const modal = $("#playerModal");
  const label = type === "tv" ? `${title} · S${season} E${episode}${episodeName ? " — " + episodeName : ""}` : title;
  $("#playerTitleLabel").textContent = label;

  renderSourceSwitch();
  loadPlayerSource(NexoraAPI.DEFAULT_SOURCE);

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";

  saveProgress(type, id, {
    title,
    poster_path: currentDetailData && String(currentDetailData.id) === String(id) ? currentDetailData.poster_path : null,
    season, episode,
  });
}

function renderSourceSwitch() {
  const wrap = $("#playerSourceSwitch");
  wrap.innerHTML = NexoraAPI.PLAYER_SOURCES.map(
    (s) => `<button class="source-btn ${s.id === NexoraAPI.DEFAULT_SOURCE ? "active" : ""}" data-source="${s.id}">${s.label}</button>`,
  ).join("");
  wrap.querySelectorAll(".source-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      wrap.querySelectorAll(".source-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      loadPlayerSource(btn.dataset.source);
    });
  });
}

function loadPlayerSource(sourceId) {
  const frame = $("#playerFrame");
  const loading = $("#playerLoading");
  loading.classList.remove("hidden");
  const url = NexoraAPI.getSourceUrl(sourceId, playerState.type, playerState.id, playerState.season, playerState.episode);
  frame.src = url;
  frame.onload = () => loading.classList.add("hidden");
  setTimeout(() => loading.classList.add("hidden"), 4000); // fallback in case onload doesn't fire (cross-origin)
}

function closePlayer() {
  $("#playerModal").classList.add("hidden");
  $("#playerFrame").src = "";
  document.body.style.overflow = "";
  if (window.location.hash.includes("/home")) renderContinueWatching();
}

// ---------------------------------------------------------------
// Search (multi: movies + tv)
// ---------------------------------------------------------------
async function runSearch(query) {
  const grid = $("#searchResultsGrid");
  const emptyMsg = $("#searchEmptyMsg");
  if (!query.trim()) { grid.innerHTML = ""; emptyMsg.classList.add("hidden"); return; }

  grid.innerHTML = `<div class="rail-skeleton"></div>`.repeat(6);
  emptyMsg.classList.add("hidden");
  try {
    const data = await NexoraAPI.searchMulti(query);
    const results = (data.results || []).filter(
      (m) => m.poster_path && (m.media_type === "movie" || m.media_type === "tv"),
    );
    grid.innerHTML = "";
    if (results.length === 0) emptyMsg.classList.remove("hidden");
    else results.forEach((m) => grid.appendChild(buildPosterCard(m, m.media_type)));
  } catch {
    grid.innerHTML = "";
    emptyMsg.textContent = "Search failed. Check your TMDB key.";
    emptyMsg.classList.remove("hidden");
  }
}

function openSearch() {
  $("#searchOverlay").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  setTimeout(() => $("#searchInput").focus(), 50);
}
function closeSearch() {
  $("#searchOverlay").classList.add("hidden");
  document.body.style.overflow = "";
}

// ---------------------------------------------------------------
// Routing
// ---------------------------------------------------------------
function navigateTo(hash) { window.location.hash = hash; }

function parseRoute() {
  const hash = window.location.hash || "#/home";
  const parts = hash.replace("#/", "").split("/");
  return { name: parts[0] || "home", param: parts[1] };
}

async function router() {
  const { name, param } = parseRoute();

  if (name === "search") { openSearch(); navigateTo("#/home"); return; }

  closeSearch();
  $all(".view").forEach((v) => v.classList.add("hidden"));
  $all(".nav-link, .bnav-item").forEach((l) => l.classList.remove("active"));

  if ((name === "movie" || name === "tv") && param) {
    $("#view-detail").classList.remove("hidden");
    window.scrollTo(0, 0);
    await loadDetail(name, param);
    return;
  }

  if (name === "admin") {
    if (!currentUser || currentUser.email !== ADMIN_EMAIL) { navigateTo("#/home"); return; }
    $("#view-admin").classList.remove("hidden");
    $all('[data-nav="admin"]').forEach((l) => l.classList.add("active"));
    await loadAdminDashboard();
    return;
  }

  if (name === "movies") {
    $("#view-movies").classList.remove("hidden");
    $all('[data-nav="movies"]').forEach((l) => l.classList.add("active"));
    await loadMovieBrowse(true);
    return;
  }

  if (name === "shows") {
    $("#view-shows").classList.remove("hidden");
    $all('[data-nav="shows"]').forEach((l) => l.classList.add("active"));
    await loadTvBrowse(true);
    return;
  }

  if (name === "my-list") {
    $("#view-my-list").classList.remove("hidden");
    $all('[data-nav="my-list"]').forEach((l) => l.classList.add("active"));
    await loadMyList();
    return;
  }

  $("#view-home").classList.remove("hidden");
  $all('[data-nav="home"]').forEach((l) => l.classList.add("active"));
  await loadHome();
}

// ---------------------------------------------------------------
// Firebase auth
// ---------------------------------------------------------------
function updateAuthUI() {
  const authArea = $("#authArea");
  const adminLinks = $all('[data-nav="admin"]');

  if (currentUser) {
    authArea.innerHTML = `<div class="user-chip" id="userChip"><span class="user-avatar">${currentUser.email[0].toUpperCase()}</span></div>`;
    $("#userChip").addEventListener("click", () => { if (confirm("Sign out of Nexora?")) auth.signOut(); });
    adminLinks.forEach((l) => l.classList.toggle("hidden", currentUser.email !== ADMIN_EMAIL));
  } else {
    authArea.innerHTML = `<button class="btn btn-solid" id="signInBtn">Sign in</button>`;
    $("#signInBtn").addEventListener("click", openAuthModal);
    adminLinks.forEach((l) => l.classList.add("hidden"));
  }
}

auth.onAuthStateChanged(async (user) => {
  currentUser = user;
  updateAuthUI();
  if (user) { await ensureUserDoc(user); await loadMyListIds(user.uid); }
  else { myListIds = new Set(); }
  router();
});

async function ensureUserDoc(user) {
  const ref = db.collection("users").doc(user.uid);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({ email: user.email, createdAt: firebase.firestore.FieldValue.serverTimestamp(), lastSignIn: firebase.firestore.FieldValue.serverTimestamp() });
  } else {
    await ref.update({ lastSignIn: firebase.firestore.FieldValue.serverTimestamp() });
  }
}

// ---------------------------------------------------------------
// My List (Firestore) — keyed as "movie_123" / "tv_456"
// ---------------------------------------------------------------
async function loadMyListIds(uid) {
  const snap = await db.collection("users").doc(uid).collection("watchlist").get();
  myListIds = new Set(snap.docs.map((d) => d.id));
}

async function toggleMyList(item, type, btnEl, isDetailView = false) {
  if (!currentUser) { openAuthModal(); return; }
  const title = item.title || item.name;
  const key = `${type}_${item.id}`;
  const ref = db.collection("users").doc(currentUser.uid).collection("watchlist").doc(key);

  if (myListIds.has(key)) {
    await ref.delete();
    myListIds.delete(key);
    if (btnEl) { btnEl.classList.remove("in-list"); btnEl.textContent = isDetailView ? "+ My List" : "+"; }
    showToast(`Removed "${title}" from My List`);
  } else {
    await ref.set({ title, type, poster_path: item.poster_path || null, addedAt: firebase.firestore.FieldValue.serverTimestamp() });
    myListIds.add(key);
    if (btnEl) { btnEl.classList.add("in-list"); btnEl.textContent = isDetailView ? "✓ In My List" : "✓"; }
    showToast(`Added "${title}" to My List`);
  }
}

// ---------------------------------------------------------------
// Auth modal
// ---------------------------------------------------------------
function openAuthModal() { $("#authModal").classList.remove("hidden"); $("#authError").classList.add("hidden"); }
function closeAuthModal() { $("#authModal").classList.add("hidden"); $("#authForm").reset(); }
let authMode = "signin";
function setAuthMode(mode) {
  authMode = mode;
  $all(".auth-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === mode));
  $("#authSubmitLabel").textContent = mode === "signin" ? "Sign in" : "Create account";
}
async function handleAuthSubmit(e) {
  e.preventDefault();
  const email = $("#authEmail").value.trim();
  const password = $("#authPassword").value;
  const errorEl = $("#authError");
  errorEl.classList.add("hidden");
  try {
    if (authMode === "signin") await auth.signInWithEmailAndPassword(email, password);
    else await auth.createUserWithEmailAndPassword(email, password);
    closeAuthModal();
    showToast(authMode === "signin" ? "Welcome back!" : "Account created — welcome to Nexora!");
  } catch (err) {
    errorEl.textContent = friendlyAuthError(err.code);
    errorEl.classList.remove("hidden");
  }
}
function friendlyAuthError(code) {
  const map = {
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/email-already-in-use": "An account already exists with that email.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/invalid-credential": "Incorrect email or password.",
  };
  return map[code] || "Something went wrong. Please try again.";
}

// ---------------------------------------------------------------
// Admin dashboard
// ---------------------------------------------------------------
async function loadAdminDashboard() {
  try {
    const usersSnap = await db.collection("users").get();
    $("#statUsers").textContent = usersSnap.size;
    let totalWatchlist = 0, signedInToday = 0;
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const tbody = $("#adminUserTable tbody");
    tbody.innerHTML = "";
    for (const doc of usersSnap.docs) {
      const data = doc.data();
      const watchlistSnap = await db.collection("users").doc(doc.id).collection("watchlist").get();
      totalWatchlist += watchlistSnap.size;
      const lastSignIn = data.lastSignIn?.toDate?.();
      if (lastSignIn && lastSignIn >= startOfToday) signedInToday++;
      const row = document.createElement("tr");
      row.innerHTML = `<td>${escapeHtml(data.email || "—")}</td><td>${data.createdAt?.toDate?.().toLocaleDateString() || "—"}</td><td>${watchlistSnap.size}</td>`;
      tbody.appendChild(row);
    }
    $("#statWatchlist").textContent = totalWatchlist;
    $("#statToday").textContent = signedInToday;
  } catch {
    showToast("Couldn't load admin data — check Firestore rules.");
  }
}

// ---------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------
window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", () => {
  router();

  // Ad warning banner — show once per browser unless dismissed
  const adWarning = $("#adWarning");
  if (!localStorage.getItem("nexora_ad_warning_dismissed")) {
    adWarning.classList.remove("hidden");
  }
  $("#adWarningClose").addEventListener("click", () => {
    adWarning.classList.add("hidden");
    localStorage.setItem("nexora_ad_warning_dismissed", "1");
  });

  $("#searchBtn").addEventListener("click", openSearch);
  $("#bnavSearch").addEventListener("click", (e) => { e.preventDefault(); openSearch(); });
  $("#closeSearchBtn").addEventListener("click", closeSearch);
  $("#searchInput").addEventListener("input", (e) => {
    clearTimeout(searchDebounce);
    const q = e.target.value;
    searchDebounce = setTimeout(() => runSearch(q), 350);
  });

  $("#movieGenreFilter").addEventListener("change", () => loadMovieBrowse(true));
  $("#movieSortFilter").addEventListener("change", () => loadMovieBrowse(true));
  $("#movieLoadMoreBtn").addEventListener("click", async () => { moviePage++; await loadMovieBrowse(false); });

  $("#tvGenreFilter").addEventListener("change", () => loadTvBrowse(true));
  $("#tvSortFilter").addEventListener("change", () => loadTvBrowse(true));
  $("#tvLoadMoreBtn").addEventListener("click", async () => { tvPage++; await loadTvBrowse(false); });

  $("#detailBackBtn").addEventListener("click", () => window.history.back());

  $("#playerCloseBtn").addEventListener("click", closePlayer);

  $("#authCloseBtn").addEventListener("click", closeAuthModal);
  $("#authModal").addEventListener("click", (e) => { if (e.target.id === "authModal") closeAuthModal(); });
  $all(".auth-tab").forEach((tab) => tab.addEventListener("click", () => setAuthMode(tab.dataset.tab)));
  $("#authForm").addEventListener("submit", handleAuthSubmit);

  window.addEventListener("scroll", () => {
    $("#siteHeader").classList.toggle("scrolled", window.scrollY > 20);
  });
});
