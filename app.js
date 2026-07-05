// ============================================================
// Nexora — App logic (routing, rendering, auth, data)
// ============================================================

let currentUser = null;
let currentUserDoc = null;
let myListIds = new Set();
let searchDebounce = null;

// ---------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------
function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

function showToast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.add("hidden"), ms);
}

function yearOf(dateStr) {
  return dateStr ? dateStr.slice(0, 4) : "—";
}

function ratingBadge(voteAverage) {
  if (!voteAverage) return "—";
  return voteAverage.toFixed(1);
}

// ---------------------------------------------------------------
// Poster card builder
// ---------------------------------------------------------------
function buildPosterCard(movie) {
  const card = document.createElement("div");
  card.className = "poster-card";
  card.dataset.id = movie.id;

  const inList = myListIds.has(String(movie.id));

  card.innerHTML = `
    <div class="poster-img-wrap">
      ${
        movie.poster_path
          ? `<img loading="lazy" src="${NexoraAPI.imgUrl(movie.poster_path, "w342")}" alt="${escapeHtml(movie.title)}">`
          : `<div class="poster-placeholder">${escapeHtml(movie.title || "")}</div>`
      }
      <div class="poster-overlay">
        <button class="poster-play" title="Watch now">▶</button>
        <button class="poster-add ${inList ? "in-list" : ""}" title="${inList ? "Remove from My List" : "Add to My List"}">${inList ? "✓" : "+"}</button>
      </div>
      <span class="poster-rating">★ ${ratingBadge(movie.vote_average)}</span>
    </div>
    <p class="poster-title">${escapeHtml(movie.title)}</p>
    <p class="poster-year">${yearOf(movie.release_date)}</p>
  `;

  card.querySelector(".poster-play").addEventListener("click", (e) => {
    e.stopPropagation();
    openPlayer(movie.id, movie.title);
  });
  card.querySelector(".poster-add").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMyList(movie, card.querySelector(".poster-add"));
  });
  card.addEventListener("click", () => navigateTo(`#/movie/${movie.id}`));

  return card;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// ---------------------------------------------------------------
// Rail (horizontal row) rendering
// ---------------------------------------------------------------
async function renderRail(trackSelector, fetchPromise) {
  const track = document.querySelector(trackSelector);
  if (!track) return;
  track.innerHTML = `<div class="rail-skeleton"></div>`.repeat(6);
  try {
    const data = await fetchPromise;
    const results = (data.results || []).filter((m) => m.poster_path);
    track.innerHTML = "";
    results.forEach((movie) => track.appendChild(buildPosterCard(movie)));
  } catch (err) {
    track.innerHTML = `<p class="rail-error">Couldn't load this row. ${err.message.includes("auth") ? "Check your TMDB key." : ""}</p>`;
  }
}

// ---------------------------------------------------------------
// Hero
// ---------------------------------------------------------------
async function renderHero() {
  try {
    const data = await NexoraAPI.trending();
    const pick = (data.results || []).find((m) => m.backdrop_path) || data.results[0];
    if (!pick) return;

    $("#heroBackdrop").style.backgroundImage = `url(${NexoraAPI.imgUrl(pick.backdrop_path, "w1280")})`;
    $("#heroTitle").textContent = pick.title;
    $("#heroMeta").textContent = `${yearOf(pick.release_date)} · ★ ${ratingBadge(pick.vote_average)}`;
    $("#heroOverview").textContent = pick.overview || "";

    $("#heroWatchBtn").onclick = () => openPlayer(pick.id, pick.title);
    $("#heroInfoBtn").onclick = () => navigateTo(`#/movie/${pick.id}`);
    const listBtn = $("#heroListBtn");
    listBtn.textContent = myListIds.has(String(pick.id)) ? "✓" : "+";
    listBtn.onclick = () => toggleMyList(pick, listBtn);
  } catch (err) {
    $("#heroTitle").textContent = "Nexora";
    $("#heroOverview").textContent = "Set your TMDB API key in js/api.js to load movies.";
  }
}

// ---------------------------------------------------------------
// Home view
// ---------------------------------------------------------------
async function loadHome() {
  renderHero();
  renderRail('[data-track="trending"]', NexoraAPI.trending());
  renderRail('[data-track="top_rated"]', NexoraAPI.topRated());
  renderRail('[data-track="action"]', NexoraAPI.byGenre(GENRE_IDS.action));
  renderRail('[data-track="comedy"]', NexoraAPI.byGenre(GENRE_IDS.comedy));
  renderRail('[data-track="horror"]', NexoraAPI.byGenre(GENRE_IDS.horror));
  renderRail('[data-track="animation"]', NexoraAPI.byGenre(GENRE_IDS.animation));
}

// ---------------------------------------------------------------
// Browse view
// ---------------------------------------------------------------
let browsePage = 1;
async function loadBrowse(reset = true) {
  if (reset) {
    browsePage = 1;
    $("#browseGrid").innerHTML = "";
  }
  const genreMap = await NexoraAPI.getGenreMap();
  const genreSelect = $("#genreFilter");
  if (genreSelect.options.length <= 1) {
    Object.entries(genreMap).forEach(([id, name]) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = name;
      genreSelect.appendChild(opt);
    });
  }

  const genreId = genreSelect.value;
  const sort = $("#sortFilter").value;
  const data = await NexoraAPI.discover(browsePage, sort, genreId);
  const grid = $("#browseGrid");
  (data.results || []).filter((m) => m.poster_path).forEach((m) => grid.appendChild(buildPosterCard(m)));
}

// ---------------------------------------------------------------
// My List view
// ---------------------------------------------------------------
async function loadMyList() {
  const grid = $("#myListGrid");
  const emptyMsg = $("#myListEmptyMsg");
  const signedOutMsg = $("#myListSignedOutMsg");
  grid.innerHTML = "";
  emptyMsg.classList.add("hidden");

  if (!currentUser) {
    signedOutMsg.classList.remove("hidden");
    return;
  }
  signedOutMsg.classList.add("hidden");

  if (myListIds.size === 0) {
    emptyMsg.classList.remove("hidden");
    return;
  }

  const ids = Array.from(myListIds);
  const results = await Promise.allSettled(ids.map((id) => NexoraAPI.details(id)));
  results.forEach((r) => {
    if (r.status === "fulfilled") grid.appendChild(buildPosterCard(r.value));
  });
}

// ---------------------------------------------------------------
// Movie detail view
// ---------------------------------------------------------------
async function loadDetail(id) {
  const view = $("#view-detail");
  try {
    const movie = await NexoraAPI.details(id);
    $("#detailBackdrop").style.backgroundImage = movie.backdrop_path
      ? `url(${NexoraAPI.imgUrl(movie.backdrop_path, "w1280")})`
      : "none";
    $("#detailPoster").src = movie.poster_path ? NexoraAPI.imgUrl(movie.poster_path, "w500") : "";
    $("#detailTitle").textContent = movie.title;

    const runtime = movie.runtime ? `${Math.floor(movie.runtime / 60)}h ${movie.runtime % 60}m` : null;
    const genres = (movie.genres || []).map((g) => g.name).join(" · ");
    $("#detailChips").innerHTML = [
      `<span class="chip">★ ${ratingBadge(movie.vote_average)}</span>`,
      `<span class="chip">${yearOf(movie.release_date)}</span>`,
      runtime ? `<span class="chip">${runtime}</span>` : "",
      genres ? `<span class="chip chip-muted">${escapeHtml(genres)}</span>` : "",
    ].join("");

    $("#detailOverview").textContent = movie.overview || "";

    $("#detailWatchBtn").onclick = () => openPlayer(movie.id, movie.title);
    const listBtn = $("#detailListBtn");
    const inList = myListIds.has(String(movie.id));
    listBtn.textContent = inList ? "✓ In My List" : "+ My List";
    listBtn.onclick = () => toggleMyList(movie, listBtn, true);

    const cast = (movie.credits?.cast || []).slice(0, 8);
    $("#detailCast").innerHTML = cast.length
      ? `<h3>Cast</h3><p class="muted">${cast.map((c) => escapeHtml(c.name)).join(", ")}</p>`
      : "";

    renderRail("#similarTrack", NexoraAPI.similar(id));
  } catch (err) {
    view.innerHTML = `<div class="container"><p class="empty-msg">Couldn't load this title.</p></div>`;
  }
}

// ---------------------------------------------------------------
// Player modal
// ---------------------------------------------------------------
function openPlayer(tmdbId, title) {
  const modal = $("#playerModal");
  const frame = $("#playerFrame");
  frame.src = NexoraAPI.getMovieSourceUrl(NexoraAPI.DEFAULT_SOURCE, tmdbId);
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
function closePlayer() {
  $("#playerModal").classList.add("hidden");
  $("#playerFrame").src = "";
  document.body.style.overflow = "";
}

// ---------------------------------------------------------------
// Search
// ---------------------------------------------------------------
async function runSearch(query) {
  const panel = $("#searchResultsPanel");
  const grid = $("#searchResultsGrid");
  const emptyMsg = $("#searchEmptyMsg");
  $("#searchQueryLabel").textContent = query;

  if (!query.trim()) {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  grid.innerHTML = `<div class="rail-skeleton"></div>`.repeat(6);
  emptyMsg.classList.add("hidden");

  try {
    const data = await NexoraAPI.search(query);
    const results = (data.results || []).filter((m) => m.poster_path);
    grid.innerHTML = "";
    if (results.length === 0) {
      emptyMsg.classList.remove("hidden");
    } else {
      results.forEach((m) => grid.appendChild(buildPosterCard(m)));
    }
  } catch (err) {
    grid.innerHTML = "";
    emptyMsg.textContent = "Search failed. Check your TMDB key.";
    emptyMsg.classList.remove("hidden");
  }
}

// ---------------------------------------------------------------
// Routing
// ---------------------------------------------------------------
function navigateTo(hash) {
  window.location.hash = hash;
}

function parseRoute() {
  const hash = window.location.hash || "#/home";
  const parts = hash.replace("#/", "").split("/");
  return { name: parts[0] || "home", param: parts[1] };
}

async function router() {
  const { name, param } = parseRoute();
  $("#searchResultsPanel").classList.add("hidden");

  $all(".view").forEach((v) => v.classList.add("hidden"));
  $all(".nav-link").forEach((l) => l.classList.remove("active"));

  if (name === "movie" && param) {
    $("#view-detail").classList.remove("hidden");
    window.scrollTo(0, 0);
    await loadDetail(param);
    return;
  }

  if (name === "admin") {
    if (!currentUser || currentUser.email !== ADMIN_EMAIL) {
      navigateTo("#/home");
      return;
    }
    $("#view-admin").classList.remove("hidden");
    $('[data-nav="admin"]').classList.add("active");
    await loadAdminDashboard();
    return;
  }

  if (name === "browse") {
    $("#view-browse").classList.remove("hidden");
    $('[data-nav="browse"]').classList.add("active");
    await loadBrowse(true);
    return;
  }

  if (name === "my-list") {
    $("#view-my-list").classList.remove("hidden");
    $('[data-nav="my-list"]').classList.add("active");
    await loadMyList();
    return;
  }

  // default: home
  $("#view-home").classList.remove("hidden");
  $('[data-nav="home"]').classList.add("active");
  await loadHome();
}

// ---------------------------------------------------------------
// Firebase — Auth
// ---------------------------------------------------------------
function updateAuthUI() {
  const authArea = $("#authArea");
  const adminLink = $('[data-nav="admin"]');

  if (currentUser) {
    authArea.innerHTML = `
      <div class="user-chip" id="userChip">
        <span class="user-avatar">${currentUser.email[0].toUpperCase()}</span>
      </div>
    `;
    $("#userChip").addEventListener("click", () => {
      if (confirm("Sign out of Nexora?")) firebaseSignOut();
    });
    adminLink.classList.toggle("hidden", currentUser.email !== ADMIN_EMAIL);
  } else {
    authArea.innerHTML = `<button class="btn btn-ghost" id="signInBtn">Sign in</button>`;
    $("#signInBtn").addEventListener("click", openAuthModal);
    adminLink.classList.add("hidden");
  }
}

async function firebaseSignOut() {
  await auth.signOut();
}

auth.onAuthStateChanged(async (user) => {
  currentUser = user;
  updateAuthUI();
  if (user) {
    await ensureUserDoc(user);
    await loadMyListIds(user.uid);
  } else {
    myListIds = new Set();
  }
  // Re-render current view's list state (in-list checkmarks)
  router();
});

async function ensureUserDoc(user) {
  const ref = db.collection("users").doc(user.uid);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      email: user.email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastSignIn: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } else {
    await ref.update({ lastSignIn: firebase.firestore.FieldValue.serverTimestamp() });
  }
}

// ---------------------------------------------------------------
// Firestore — My List
// ---------------------------------------------------------------
async function loadMyListIds(uid) {
  const snap = await db.collection("users").doc(uid).collection("watchlist").get();
  myListIds = new Set(snap.docs.map((d) => d.id));
}

async function toggleMyList(movie, btnEl, isDetailView = false) {
  if (!currentUser) {
    openAuthModal();
    return;
  }
  const id = String(movie.id);
  const ref = db.collection("users").doc(currentUser.uid).collection("watchlist").doc(id);

  if (myListIds.has(id)) {
    await ref.delete();
    myListIds.delete(id);
    if (btnEl) {
      btnEl.classList.remove("in-list");
      btnEl.textContent = isDetailView ? "+ My List" : "+";
    }
    showToast(`Removed “${movie.title}” from My List`);
  } else {
    await ref.set({
      title: movie.title,
      poster_path: movie.poster_path || null,
      addedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    myListIds.add(id);
    if (btnEl) {
      btnEl.classList.add("in-list");
      btnEl.textContent = isDetailView ? "✓ In My List" : "✓";
    }
    showToast(`Added “${movie.title}” to My List`);
  }
}

// ---------------------------------------------------------------
// Auth modal
// ---------------------------------------------------------------
function openAuthModal() {
  $("#authModal").classList.remove("hidden");
  $("#authError").classList.add("hidden");
}
function closeAuthModal() {
  $("#authModal").classList.add("hidden");
  $("#authForm").reset();
}

let authMode = "signin";

function setAuthMode(mode) {
  authMode = mode;
  $all(".auth-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === mode));
  $("#authSubmitBtn .ticket-label").textContent = mode === "signin" ? "Sign in" : "Create account";
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email = $("#authEmail").value.trim();
  const password = $("#authPassword").value;
  const errorEl = $("#authError");
  errorEl.classList.add("hidden");

  try {
    if (authMode === "signin") {
      await auth.signInWithEmailAndPassword(email, password);
    } else {
      await auth.createUserWithEmailAndPassword(email, password);
    }
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

    let totalWatchlist = 0;
    let signedInToday = 0;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const tbody = $("#adminUserTable tbody");
    tbody.innerHTML = "";

    for (const doc of usersSnap.docs) {
      const data = doc.data();
      const watchlistSnap = await db.collection("users").doc(doc.id).collection("watchlist").get();
      totalWatchlist += watchlistSnap.size;

      const lastSignIn = data.lastSignIn?.toDate?.();
      if (lastSignIn && lastSignIn >= startOfToday) signedInToday++;

      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${escapeHtml(data.email || "—")}</td>
        <td>${data.createdAt?.toDate?.().toLocaleDateString() || "—"}</td>
        <td>${watchlistSnap.size}</td>
      `;
      tbody.appendChild(row);
    }

    $("#statWatchlist").textContent = totalWatchlist;
    $("#statToday").textContent = signedInToday;
  } catch (err) {
    showToast("Couldn't load admin data — check Firestore rules.");
  }
}

// ---------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------
window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", () => {
  router();

  // Desktop search
  $("#searchInput").addEventListener("input", (e) => {
    clearTimeout(searchDebounce);
    const q = e.target.value;
    searchDebounce = setTimeout(() => runSearch(q), 400);
  });
  // Mobile search
  $("#mobileSearchBtn").addEventListener("click", () => {
    $("#searchDrawer").classList.toggle("open");
    $("#searchInputMobile").focus();
  });
  $("#searchInputMobile").addEventListener("input", (e) => {
    clearTimeout(searchDebounce);
    const q = e.target.value;
    searchDebounce = setTimeout(() => runSearch(q), 400);
  });
  $("#closeSearchResults").addEventListener("click", () => {
    $("#searchResultsPanel").classList.add("hidden");
    $("#searchInput").value = "";
    $("#searchInputMobile").value = "";
  });

  // Browse filters
  $("#genreFilter").addEventListener("change", () => loadBrowse(true));
  $("#sortFilter").addEventListener("change", () => loadBrowse(true));
  $("#loadMoreBtn").addEventListener("click", async () => {
    browsePage++;
    await loadBrowse(false);
  });

  // Detail back
  $("#detailBackBtn").addEventListener("click", () => window.history.back());

  // Player modal
  $("#playerCloseBtn").addEventListener("click", closePlayer);
  $("#playerModal").addEventListener("click", (e) => {
    if (e.target.id === "playerModal") closePlayer();
  });

  // Auth modal
  $("#authCloseBtn").addEventListener("click", closeAuthModal);
  $("#authModal").addEventListener("click", (e) => {
    if (e.target.id === "authModal") closeAuthModal();
  });
  $all(".auth-tab").forEach((tab) => tab.addEventListener("click", () => setAuthMode(tab.dataset.tab)));
  $("#authForm").addEventListener("submit", handleAuthSubmit);

  // Sticky header shrink on scroll
  window.addEventListener("scroll", () => {
    $("#siteHeader").classList.toggle("scrolled", window.scrollY > 20);
  });
});
