import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  updateDoc,
  serverTimestamp,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "REMPLACE_PAR_TA_CLE",
  authDomain: "REMPLACE_PAR_TON_PROJET.firebaseapp.com",
  projectId: "REMPLACE_PAR_TON_PROJET",
  storageBucket: "REMPLACE_PAR_TON_PROJET.appspot.com",
  messagingSenderId: "REMPLACE_PAR_ID",
  appId: "REMPLACE_PAR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

const COMPETITIONS = {
  ligue1: { label: "Ligue 1", singleWeekly: true },
  liga: { label: "Liga", singleWeekly: true },
  serieA: { label: "Serie A", singleWeekly: true },
  premierLeague: { label: "Premier League", singleWeekly: true },
  ldc: { label: "Ligue des Champions", singleWeekly: false }
};

const VIEWS = {
  general: "Classement général",
  ligue1: "Ligue 1",
  liga: "Liga",
  serieA: "Serie A",
  premierLeague: "Premier League",
  ldc: "Ligue des Champions",
  evolution: "Évolution",
  admin: "Admin"
};

const state = {
  currentUser: null,
  users: [],
  matches: [],
  predictions: [],
  activeView: "general",
  isAdmin: false,
  theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  selectedEvolutionPlayers: []
};

let evolutionChart = null;

const pageTitle = document.getElementById("page-title");
const authStatus = document.getElementById("auth-status");
const authFeedback = document.getElementById("auth-feedback");
const liveStatus = document.getElementById("live-status");
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const googleLoginBtn = document.getElementById("google-login-btn");
const logoutBtn = document.getElementById("logout-btn");
const themeToggle = document.getElementById("theme-toggle");
const themeToggleIcon = document.getElementById("theme-toggle-icon");
const generalRankingBody = document.getElementById("general-ranking-body");
const generalTotalPlayers = document.getElementById("general-total-players");
const generalTotalFinished = document.getElementById("general-total-finished");
const evolutionFilters = document.getElementById("evolution-player-filters");
const adminMatchForm = document.getElementById("admin-match-form");
const adminFormFeedback = document.getElementById("admin-form-feedback");
const adminMatchList = document.getElementById("admin-match-list");

const competitionMatchContainers = {
  ligue1: document.getElementById("ligue1-matches"),
  liga: document.getElementById("liga-matches"),
  serieA: document.getElementById("serieA-matches"),
  premierLeague: document.getElementById("premierLeague-matches"),
  ldc: document.getElementById("ldc-matches")
};
const rankingBodies = {
  ligue1: document.getElementById("ligue1-ranking-body"),
  liga: document.getElementById("liga-ranking-body"),
  serieA: document.getElementById("serieA-ranking-body"),
  premierLeague: document.getElementById("premierLeague-ranking-body"),
  ldc: document.getElementById("ldc-ranking-body")
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "Date non définie";
  const date = value?.toDate ? value.toDate() : new Date(value);
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  themeToggleIcon.textContent = theme === "dark" ? "☀️" : "🌙";
  renderEvolutionChart();
}

function getMatchResultType(homeScore, awayScore) {
  if (homeScore > awayScore) return "H";
  if (homeScore < awayScore) return "A";
  return "D";
}

function computePoints(pred, match) {
  if (!pred || pred.homeScore == null || pred.awayScore == null || match.homeScore == null || match.awayScore == null) return 0;
  const exact = pred.homeScore === match.homeScore && pred.awayScore === match.awayScore;
  if (exact) return 3;
  return getMatchResultType(pred.homeScore, pred.awayScore) === getMatchResultType(match.homeScore, match.awayScore) ? 1 : 0;
}

function isMatchFinished(match) {
  return match.homeScore != null && match.awayScore != null;
}

function isPredictionOpen(match) {
  return new Date(match.kickoff).getTime() > Date.now();
}

function getPredictionForUser(matchId, userId) {
  return state.predictions.find(p => p.matchId === matchId && p.userId === userId) || null;
}

function getCompetitionMatches(competitionId) {
  return state.matches
    .filter(m => m.competitionId === competitionId)
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
}

function getVisibleCompetitionMatches(competitionId) {
  return getCompetitionMatches(competitionId).filter(match => match.enabled === true || isMatchFinished(match));
}

function getCompetitionStatsForUser(userId, competitionId) {
  const matches = state.matches.filter(m => m.competitionId === competitionId);
  let points = 0;
  let playedPredictions = 0;
  matches.forEach(match => {
    const pred = getPredictionForUser(match.id, userId);
    if (pred) playedPredictions += 1;
    points += computePoints(pred, match);
  });
  return { points, playedPredictions };
}

function getGeneralStatsForUser(userId) {
  const byCompetition = {};
  let total = 0;
  Object.keys(COMPETITIONS).forEach(compId => {
    const stats = getCompetitionStatsForUser(userId, compId);
    byCompetition[compId] = stats.points;
    total += stats.points;
  });
  return { total, byCompetition };
}

function getFinishedMatchesChronological() {
  return [...state.matches]
    .filter(isMatchFinished)
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
}

function buildEvolutionSeriesForUser(userId) {
  const finished = getFinishedMatchesChronological();
  let cumulative = 0;
  return finished.map(match => {
    const pred = getPredictionForUser(match.id, userId);
    cumulative += computePoints(pred, match);
    return cumulative;
  });
}

function getEvolutionLabels() {
  return getFinishedMatchesChronological().map(match => `${COMPETITIONS[match.competitionId]?.label || match.competitionId} • ${match.homeTeam}-${match.awayTeam}`);
}

async function ensureUserDoc(user, explicitName = "") {
  if (!user) return;
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  const displayName = explicitName || user.displayName || user.email || "Participant";
  const payload = {
    uid: user.uid,
    displayName,
    email: user.email || "",
    photoURL: user.photoURL || "",
    isAdmin: snap.exists() ? !!snap.data().isAdmin : false,
    updatedAt: serverTimestamp()
  };
  if (!snap.exists()) payload.createdAt = serverTimestamp();
  await setDoc(ref, payload, { merge: true });
}

function switchView(viewId) {
  state.activeView = viewId;
  document.querySelectorAll(".nav-link").forEach(btn => btn.classList.toggle("active", btn.dataset.view === viewId));
  document.querySelectorAll(".view").forEach(view => view.classList.toggle("active", view.id === `view-${viewId}`));
  pageTitle.textContent = VIEWS[viewId] || "Pronos Europe V2";
  if (viewId === "evolution") renderEvolutionChart();
}

document.querySelectorAll(".nav-link").forEach(btn => btn.addEventListener("click", () => switchView(btn.dataset.view)));

themeToggle.addEventListener("click", () => setTheme(state.theme === "dark" ? "light" : "dark"));

googleLoginBtn.addEventListener("click", async () => {
  try {
    authFeedback.textContent = "";
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error(error);
    authFeedback.textContent = "Erreur de connexion Google.";
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error(error);
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  try {
    authFeedback.textContent = "";
    await signInWithEmailAndPassword(auth, email, password);
    loginForm.reset();
  } catch (error) {
    console.error(error);
    authFeedback.textContent = "Connexion impossible. Vérifie ton email et ton mot de passe.";
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.getElementById("register-name").value.trim();
  const email = document.getElementById("register-email").value.trim();
  const password = document.getElementById("register-password").value;
  if (password.length < 8) {
    authFeedback.textContent = "Le mot de passe doit contenir au moins 8 caractères.";
    return;
  }
  try {
    authFeedback.textContent = "";
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (name) await updateProfile(cred.user, { displayName: name });
    await ensureUserDoc(cred.user, name);
    registerForm.reset();
  } catch (error) {
    console.error(error);
    authFeedback.textContent = "Création du compte impossible. Vérifie si l’email n’est pas déjà utilisé.";
  }
});

onAuthStateChanged(auth, async (user) => {
  state.currentUser = user;
  if (user) {
    await ensureUserDoc(user);
    authStatus.textContent = user.displayName || user.email || "Connecté";
    logoutBtn.classList.remove("hidden");
    const userSnap = await getDoc(doc(db, "users", user.uid));
    state.isAdmin = !!(userSnap.exists() && userSnap.data().isAdmin);
  } else {
    authStatus.textContent = "Non connecté";
    logoutBtn.classList.add("hidden");
    state.isAdmin = false;
  }
  renderAll();
});

onSnapshot(collection(db, "users"), snapshot => {
  state.users = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  if (!state.selectedEvolutionPlayers.length && state.users.length) {
    state.selectedEvolutionPlayers = state.users.slice(0, 3).map(u => u.id);
  }
  liveStatus.textContent = "Utilisateurs synchronisés";
  renderAll();
});

onSnapshot(collection(db, "matches"), snapshot => {
  state.matches = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  generalTotalFinished.textContent = String(state.matches.filter(isMatchFinished).length);
  liveStatus.textContent = "Matchs synchronisés";
  renderAll();
});

onSnapshot(collection(db, "predictions"), snapshot => {
  state.predictions = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  liveStatus.textContent = "Pronostics synchronisés";
  renderAll();
});

function renderGeneralRanking() {
  const rows = state.users.map(user => {
    const stats = getGeneralStatsForUser(user.id);
    return { user, total: stats.total, byCompetition: stats.byCompetition };
  }).sort((a, b) => b.total - a.total || a.user.displayName.localeCompare(b.user.displayName));

  generalTotalPlayers.textContent = String(rows.length);
  generalRankingBody.innerHTML = rows.length ? rows.map((row, index) => `
    <tr class="${index === 0 ? "rank-first" : ""} ${state.currentUser?.uid === row.user.id ? "rank-me" : ""}">
      <td>${index + 1}</td>
      <td>${escapeHtml(row.user.displayName || "Participant")}</td>
      <td><strong>${row.total}</strong></td>
      <td>${row.byCompetition.ligue1}</td>
      <td>${row.byCompetition.liga}</td>
      <td>${row.byCompetition.serieA}</td>
      <td>${row.byCompetition.premierLeague}</td>
      <td>${row.byCompetition.ldc}</td>
    </tr>`).join("") : `<tr><td colspan="8">Aucun participant pour le moment.</td></tr>`;
}

function renderMatchCard(match) {
  const user = state.currentUser;
  const prediction = user ? getPredictionForUser(match.id, user.uid) : null;
  const open = isPredictionOpen(match) && match.enabled === true;
  const resultKnown = isMatchFinished(match);
  return `
    <article class="match-card">
      <div class="match-top">
        <div>
          <div class="match-title">${escapeHtml(match.homeTeam)} vs ${escapeHtml(match.awayTeam)}</div>
          <div class="match-meta">${escapeHtml(match.round || "")} • ${escapeHtml(match.weekKey || "")} • ${formatDate(match.kickoff)}</div>
        </div>
        <span class="tag ${open ? "tag-open" : "tag-closed"}">${open ? "Ouvert" : "Fermé"}</span>
      </div>
      ${resultKnown ? `<div class="score-line">${match.homeScore} - ${match.awayScore}</div>` : `<div class="match-meta">Résultat officiel en attente</div>`}
      ${user ? `
        <form class="prediction-form" data-match-id="${match.id}">
          <input type="number" min="0" step="1" name="homeScore" value="${prediction?.homeScore ?? ""}" placeholder="${escapeHtml(match.homeTeam)}" ${open ? "" : "disabled"} required>
          <input type="number" min="0" step="1" name="awayScore" value="${prediction?.awayScore ?? ""}" placeholder="${escapeHtml(match.awayTeam)}" ${open ? "" : "disabled"} required>
          <button class="btn btn-primary" type="submit" ${open ? "" : "disabled"}>Valider</button>
        </form>` : `<p class="helper-text">Connecte-toi pour enregistrer ton pronostic.</p>`}
      ${prediction ? `<span class="points-badge">Ton prono : ${prediction.homeScore} - ${prediction.awayScore}</span>` : ""}
    </article>`;
}

function renderCompetitionMatches(competitionId) {
  const container = competitionMatchContainers[competitionId];
  const matches = getVisibleCompetitionMatches(competitionId);
  container.innerHTML = matches.length ? matches.map(renderMatchCard).join("") : `<article class="match-card"><p>Aucun match pour cette compétition.</p></article>`;
  container.querySelectorAll(".prediction-form").forEach(form => form.addEventListener("submit", handlePredictionSubmit));
}

function renderCompetitionRanking(competitionId) {
  const tbody = rankingBodies[competitionId];
  const rows = state.users.map(user => {
    const stats = getCompetitionStatsForUser(user.id, competitionId);
    return { user, points: stats.points, playedPredictions: stats.playedPredictions };
  }).sort((a, b) => b.points - a.points || b.playedPredictions - a.playedPredictions || a.user.displayName.localeCompare(b.user.displayName));
  tbody.innerHTML = rows.length ? rows.map((row, index) => `
    <tr class="${index === 0 ? "rank-first" : ""} ${state.currentUser?.uid === row.user.id ? "rank-me" : ""}">
      <td>${index + 1}</td>
      <td>${escapeHtml(row.user.displayName || "Participant")}</td>
      <td><strong>${row.points}</strong></td>
      <td>${row.playedPredictions}</td>
    </tr>`).join("") : `<tr><td colspan="4">Aucun participant.</td></tr>`;
}

async function handlePredictionSubmit(event) {
  event.preventDefault();
  if (!state.currentUser) return alert("Connexion requise.");
  const form = event.currentTarget;
  const matchId = form.dataset.matchId;
  const homeScore = Number(form.homeScore.value);
  const awayScore = Number(form.awayScore.value);
  const match = state.matches.find(m => m.id === matchId);
  if (!match) return;
  if (!(isPredictionOpen(match) && match.enabled === true)) return alert("Le pronostic est fermé pour ce match.");
  try {
    const predictionId = `${state.currentUser.uid}_${matchId}`;
    await setDoc(doc(db, "predictions", predictionId), {
      userId: state.currentUser.uid,
      matchId,
      competitionId: match.competitionId,
      homeScore,
      awayScore,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    }, { merge: true });
  } catch (error) {
    console.error(error);
    alert("Erreur lors de l'enregistrement du pronostic.");
  }
}

function isSingleWeeklyCompetition(competitionId) {
  return !!COMPETITIONS[competitionId]?.singleWeekly;
}

async function ensureWeeklySingleActive(competitionId, weekKey, currentMatchId = null) {
  if (!isSingleWeeklyCompetition(competitionId)) return;
  const sameWeekMatches = state.matches.filter(m => m.competitionId === competitionId && m.weekKey === weekKey && m.enabled === true && m.id !== currentMatchId);
  for (const match of sameWeekMatches) {
    await updateDoc(doc(db, "matches", match.id), { enabled: false, updatedAt: serverTimestamp() });
  }
}

adminMatchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.currentUser || !state.isAdmin) {
    adminFormFeedback.textContent = "Accès admin requis.";
    return;
  }
  const competitionId = document.getElementById("admin-competition").value;
  const weekKey = document.getElementById("admin-week-key").value.trim();
  const enabled = document.getElementById("admin-enabled").value === "true";
  try {
    if (enabled && isSingleWeeklyCompetition(competitionId)) {
      const alreadyEnabled = state.matches.find(m => m.competitionId === competitionId && m.weekKey === weekKey && m.enabled === true);
      if (alreadyEnabled) {
        adminFormFeedback.textContent = "Un match est déjà actif pour cette semaine dans ce championnat. Ferme-le d’abord ou désactive celui-ci.";
        return;
      }
    }
    const matchRef = doc(collection(db, "matches"));
    await setDoc(matchRef, {
      competitionId,
      round: document.getElementById("admin-round").value.trim(),
      weekKey,
      homeTeam: document.getElementById("admin-home-team").value.trim(),
      awayTeam: document.getElementById("admin-away-team").value.trim(),
      kickoff: document.getElementById("admin-kickoff").value,
      enabled,
      homeScore: null,
      awayScore: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    adminMatchForm.reset();
    document.getElementById("admin-competition").value = "ligue1";
    document.getElementById("admin-enabled").value = "true";
    adminFormFeedback.textContent = "Match enregistré avec succès.";
  } catch (error) {
    console.error(error);
    adminFormFeedback.textContent = "Erreur lors de l’enregistrement du match.";
  }
});

function renderAdminMatches() {
  if (!state.isAdmin) {
    adminMatchList.innerHTML = `<article class="match-card"><p>Connecte-toi avec un compte administrateur pour gérer les matchs.</p></article>`;
    return;
  }
  const sorted = [...state.matches].sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  adminMatchList.innerHTML = sorted.length ? sorted.map(match => `
    <article class="match-card">
      <div class="match-top">
        <div>
          <div class="match-title">${escapeHtml(match.homeTeam)} vs ${escapeHtml(match.awayTeam)}</div>
          <div class="match-meta">${escapeHtml(COMPETITIONS[match.competitionId]?.label || match.competitionId)} • ${escapeHtml(match.weekKey || "")} • ${formatDate(match.kickoff)}</div>
        </div>
        <span class="tag ${match.enabled ? "tag-open" : "tag-closed"}">${match.enabled ? "Actif" : "Inactif"}</span>
      </div>
      ${isSingleWeeklyCompetition(match.competitionId) ? `<p class="helper-text">Championnat à match hebdo unique.</p>` : `<p class="helper-text">Plusieurs matchs peuvent rester actifs.</p>`}
      <form class="admin-result-form" data-admin-match-id="${match.id}">
        <input type="number" min="0" step="1" name="homeScore" value="${match.homeScore ?? ""}" placeholder="Score domicile">
        <input type="number" min="0" step="1" name="awayScore" value="${match.awayScore ?? ""}" placeholder="Score extérieur">
        <button type="button" class="btn btn-secondary toggle-enabled-btn" data-match-id="${match.id}">${match.enabled ? "Fermer" : "Ouvrir"}</button>
        <button type="submit" class="btn btn-primary">Sauver</button>
      </form>
    </article>`).join("") : `<article class="match-card"><p>Aucun match enregistré.</p></article>`;

  adminMatchList.querySelectorAll(".admin-result-form").forEach(form => form.addEventListener("submit", handleAdminResultSubmit));
  adminMatchList.querySelectorAll(".toggle-enabled-btn").forEach(btn => btn.addEventListener("click", handleToggleEnabled));
}

async function handleAdminResultSubmit(event) {
  event.preventDefault();
  if (!state.currentUser || !state.isAdmin) return alert("Accès admin requis.");
  const form = event.currentTarget;
  const matchId = form.dataset.adminMatchId;
  try {
    const payload = { updatedAt: serverTimestamp() };
    payload.homeScore = form.homeScore.value === "" ? null : Number(form.homeScore.value);
    payload.awayScore = form.awayScore.value === "" ? null : Number(form.awayScore.value);
    await updateDoc(doc(db, "matches", matchId), payload);
  } catch (error) {
    console.error(error);
    alert("Erreur lors de la sauvegarde du résultat.");
  }
}

async function handleToggleEnabled(event) {
  const matchId = event.currentTarget.dataset.matchId;
  const match = state.matches.find(m => m.id === matchId);
  if (!state.currentUser || !state.isAdmin || !match) return alert("Accès admin requis.");
  try {
    const nextEnabled = !match.enabled;
    if (nextEnabled && isSingleWeeklyCompetition(match.competitionId)) {
      const conflict = state.matches.find(m => m.id !== match.id && m.competitionId === match.competitionId && m.weekKey === match.weekKey && m.enabled === true);
      if (conflict) {
        alert("Impossible : un autre match est déjà actif cette semaine pour ce championnat.");
        return;
      }
    }
    await updateDoc(doc(db, "matches", match.id), { enabled: nextEnabled, updatedAt: serverTimestamp() });
  } catch (error) {
    console.error(error);
    alert("Erreur lors du changement de statut.");
  }
}

function renderEvolutionFilters() {
  if (!state.users.length) {
    evolutionFilters.innerHTML = `<div class="match-card"><p>Aucun participant disponible.</p></div>`;
    return;
  }
  evolutionFilters.innerHTML = state.users.map(user => `
    <label class="player-filter">
      <input type="checkbox" data-player-id="${user.id}" ${state.selectedEvolutionPlayers.includes(user.id) ? "checked" : ""}>
      <span>${escapeHtml(user.displayName || user.email || "Participant")}</span>
    </label>`).join("");
  evolutionFilters.querySelectorAll("input[type='checkbox']").forEach(input => {
    input.addEventListener("change", () => {
      const userId = input.dataset.playerId;
      if (input.checked) {
        if (!state.selectedEvolutionPlayers.includes(userId)) state.selectedEvolutionPlayers.push(userId);
      } else {
        state.selectedEvolutionPlayers = state.selectedEvolutionPlayers.filter(id => id !== userId);
      }
      renderEvolutionChart();
    });
  });
}

function renderEvolutionChart() {
  const canvas = document.getElementById("evolution-chart");
  if (!canvas || typeof Chart === "undefined") return;
  const labels = getEvolutionLabels();
  const palette = ["#0f6a72", "#c0392b", "#8e44ad", "#2d7c3b", "#d4a017", "#1f5fbf", "#ff7f50"];
  const selectedUsers = state.users.filter(user => state.selectedEvolutionPlayers.includes(user.id));
  const datasets = selectedUsers.map((user, index) => ({
    label: user.displayName || user.email || "Participant",
    data: buildEvolutionSeriesForUser(user.id),
    borderColor: palette[index % palette.length],
    backgroundColor: palette[index % palette.length],
    tension: 0.25,
    fill: false,
    borderWidth: 3,
    pointRadius: 2,
    pointHoverRadius: 4
  }));
  if (evolutionChart) evolutionChart.destroy();
  evolutionChart = new Chart(canvas, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { labels: { color: getComputedStyle(document.documentElement).getPropertyValue("--color-text").trim() || "#222" } } },
      scales: {
        x: { ticks: { color: getComputedStyle(document.documentElement).getPropertyValue("--color-text-muted").trim() || "#666" }, grid: { color: "rgba(120,120,120,0.12)" } },
        y: { beginAtZero: true, ticks: { color: getComputedStyle(document.documentElement).getPropertyValue("--color-text-muted").trim() || "#666" }, grid: { color: "rgba(120,120,120,0.12)" } }
      }
    }
  });
}

function renderAll() {
  renderGeneralRanking();
  Object.keys(COMPETITIONS).forEach(compId => {
    renderCompetitionMatches(compId);
    renderCompetitionRanking(compId);
  });
  renderAdminMatches();
  renderEvolutionFilters();
  if (state.activeView === "evolution") renderEvolutionChart();
}

setTheme(state.theme);
switchView("general");
