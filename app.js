import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  updateDoc,
  serverTimestamp
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
  isAdmin: false,
  activeView: "general",
  theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  chart: null
};

const pageTitle = document.getElementById("page-title");
const authStatus = document.getElementById("auth-status");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const liveStatus = document.getElementById("live-status");

const emailAuthForm = document.getElementById("email-auth-form");
const authEmail = document.getElementById("auth-email");
const authPassword = document.getElementById("auth-password");
const signupBtn = document.getElementById("signup-btn");
const signinBtn = document.getElementById("signin-btn");
const emailAuthFeedback = document.getElementById("email-auth-feedback");

const generalRankingBody = document.getElementById("general-ranking-body");
const generalTotalPlayers = document.getElementById("general-total-players");
const generalTotalMatches = document.getElementById("general-total-matches");

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

const adminMatchForm = document.getElementById("admin-match-form");
const adminCompetition = document.getElementById("admin-competition");
const adminRound = document.getElementById("admin-round");
const adminHomeTeam = document.getElementById("admin-home-team");
const adminAwayTeam = document.getElementById("admin-away-team");
const adminKickoff = document.getElementById("admin-kickoff");
const adminEnabled = document.getElementById("admin-enabled");
const adminFormFeedback = document.getElementById("admin-form-feedback");
const adminMatchList = document.getElementById("admin-match-list");

const themeToggle = document.getElementById("theme-toggle");
const themeToggleIcon = document.getElementById("theme-toggle-icon");
const evolutionCanvas = document.getElementById("evolution-chart");

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
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function parseDate(value) {
  return value?.toDate ? value.toDate() : new Date(value);
}

function getMatchResultType(homeScore, awayScore) {
  if (homeScore > awayScore) return "H";
  if (homeScore < awayScore) return "A";
  return "D";
}

function computePoints(pred, match) {
  if (
    pred == null ||
    pred.homeScore == null ||
    pred.awayScore == null ||
    match.homeScore == null ||
    match.awayScore == null
  ) return 0;

  const exact = pred.homeScore === match.homeScore && pred.awayScore === match.awayScore;
  const predictedResult = getMatchResultType(pred.homeScore, pred.awayScore);
  const realResult = getMatchResultType(match.homeScore, match.awayScore);

  if (exact) return 3;
  if (predictedResult === realResult) return 1;
  return 0;
}

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  themeToggleIcon.textContent = theme === "dark" ? "☀️" : "🌙";
}

function getPredictionForUser(matchId, userId) {
  return state.predictions.find(p => p.matchId === matchId && p.userId === userId) || null;
}

function getCompetitionMatches(competitionId) {
  return state.matches
    .filter(m => m.competitionId === competitionId && m.enabled === true)
    .sort((a, b) => parseDate(a.kickoff) - parseDate(b.kickoff));
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

function isKickoffPassed(match) {
  return parseDate(match.kickoff).getTime() <= Date.now();
}

function getWeekKey(value) {
  const date = parseDate(value);
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function ensureUserDoc(user) {
  if (!user) return Promise.resolve();
  const ref = doc(db, "users", user.uid);
  return getDoc(ref).then(snap => {
    const payload = {
      uid: user.uid,
      displayName: user.displayName || user.email || "Participant",
      email: user.email || "",
      photoURL: user.photoURL || "",
      isAdmin: snap.exists() ? !!snap.data().isAdmin : false,
      updatedAt: serverTimestamp()
    };
    if (!snap.exists()) payload.createdAt = serverTimestamp();
    return setDoc(ref, payload, { merge: true });
  });
}

function switchView(viewId) {
  state.activeView = viewId;

  document.querySelectorAll(".nav-link").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === viewId);
  });

  document.querySelectorAll(".view").forEach(view => {
    view.classList.toggle("active", view.id === `view-${viewId}`);
  });

  pageTitle.textContent = VIEWS[viewId] || "Pronos Europe";

  if (viewId === "evolution") {
    requestAnimationFrame(() => renderEvolutionChart());
  }
}

document.querySelectorAll(".nav-link").forEach(btn => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

loginBtn.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
    emailAuthFeedback.textContent = "";
  } catch (error) {
    console.error(error);
    authStatus.textContent = "Erreur de connexion";
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error(error);
  }
});

signupBtn.addEventListener("click", async () => {
  const email = authEmail.value.trim();
  const password = authPassword.value.trim();
  if (!email || !password) {
    emailAuthFeedback.textContent = "Email et mot de passe requis.";
    return;
  }

  try {
    await createUserWithEmailAndPassword(auth, email, password);
    emailAuthFeedback.textContent = "Compte créé avec succès.";
  } catch (error) {
    console.error(error);
    emailAuthFeedback.textContent = error.message || "Erreur à l'inscription.";
  }
});

signinBtn.addEventListener("click", async () => {
  const email = authEmail.value.trim();
  const password = authPassword.value.trim();
  if (!email || !password) {
    emailAuthFeedback.textContent = "Email et mot de passe requis.";
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
    emailAuthFeedback.textContent = "";
  } catch (error) {
    console.error(error);
    emailAuthFeedback.textContent = error.message || "Erreur à la connexion.";
  }
});

onAuthStateChanged(auth, async user => {
  state.currentUser = user;

  if (user) {
    await ensureUserDoc(user);
    authStatus.textContent = user.displayName || user.email || "Connecté";
    loginBtn.classList.add("hidden");
    logoutBtn.classList.remove("hidden");

    const userSnap = await getDoc(doc(db, "users", user.uid));
    state.isAdmin = !!(userSnap.exists() && userSnap.data().isAdmin);
  } else {
    authStatus.textContent = "Non connecté";
    loginBtn.classList.remove("hidden");
    logoutBtn.classList.add("hidden");
    state.isAdmin = false;
  }

  renderAll();
});

onSnapshot(collection(db, "users"), snapshot => {
  state.users = snapshot.docs.map(docSnap => ({
    id: docSnap.id,
    ...docSnap.data()
  }));
  liveStatus.textContent = "Utilisateurs synchronisés";
  renderAll();
});

onSnapshot(collection(db, "matches"), snapshot => {
  state.matches = snapshot.docs.map(docSnap => ({
    id: docSnap.id,
    ...docSnap.data()
  }));
  generalTotalMatches.textContent = String(state.matches.length);
  liveStatus.textContent = "Matchs synchronisés";
  renderAll();
});

onSnapshot(collection(db, "predictions"), snapshot => {
  state.predictions = snapshot.docs.map(docSnap => ({
    id: docSnap.id,
    ...docSnap.data()
  }));
  liveStatus.textContent = "Pronostics synchronisés";
  renderAll();
});

function renderGeneralRanking() {
  const rows = state.users.map(user => {
    const stats = getGeneralStatsForUser(user.id);
    return {
      user,
      total: stats.total,
      byCompetition: stats.byCompetition
    };
  }).sort((a, b) => b.total - a.total || (a.user.displayName || "").localeCompare(b.user.displayName || ""));

  generalTotalPlayers.textContent = String(rows.length);

  generalRankingBody.innerHTML = rows.length
    ? rows.map((row, index) => `
      <tr class="${index === 0 ? "rank-first" : ""} ${state.currentUser?.uid === row.user.id ? "rank-me" : ""}">
        <td>${index + 1}</td>
        <td>${escapeHtml(row.user.displayName || "Participant")}</td>
        <td><strong>${row.total}</strong></td>
        <td>${row.byCompetition.ligue1 || 0}</td>
        <td>${row.byCompetition.liga || 0}</td>
        <td>${row.byCompetition.serieA || 0}</td>
        <td>${row.byCompetition.premierLeague || 0}</td>
        <td>${row.byCompetition.ldc || 0}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="8">Aucun participant pour le moment.</td></tr>`;
}

function renderMatchCard(match) {
  const user = state.currentUser;
  const prediction = user ? getPredictionForUser(match.id, user.uid) : null;
  const lock = isKickoffPassed(match);
  const resultKnown = match.homeScore != null && match.awayScore != null;

  return `
    <article class="match-card">
      <div class="match-top">
        <div>
          <div class="match-title">${escapeHtml(match.homeTeam)} vs ${escapeHtml(match.awayTeam)}</div>
          <div class="match-meta">${escapeHtml(match.round || "")} • ${formatDate(match.kickoff)}</div>
        </div>
        <span class="tag ${lock ? "tag-closed" : "tag-open"}">${lock ? "Fermé" : "Ouvert"}</span>
      </div>

      ${resultKnown ? `<div class="score-line">${match.homeScore} - ${match.awayScore}</div>` : `<div class="match-meta">Score officiel en attente</div>`}

      ${
        user
          ? `
            <form class="prediction-form" data-match-id="${match.id}">
              <input type="number" min="0" step="1" name="homeScore" value="${prediction?.homeScore ?? ""}" placeholder="${escapeHtml(match.homeTeam)}" ${lock ? "disabled" : ""} required>
              <input type="number" min="0" step="1" name="awayScore" value="${prediction?.awayScore ?? ""}" placeholder="${escapeHtml(match.awayTeam)}" ${lock ? "disabled" : ""} required>
              <button class="btn btn-primary" type="submit" ${lock ? "disabled" : ""}>Valider</button>
            </form>
          `
          : `<p class="helper-text">Connecte-toi pour enregistrer ton pronostic.</p>`
      }

      ${prediction ? `<span class="points-badge">Ton prono : ${prediction.homeScore} - ${prediction.awayScore}</span>` : ""}
    </article>
  `;
}

function renderCompetitionMatches(competitionId) {
  const container = competitionMatchContainers[competitionId];
  if (!container) return;

  const matches = getCompetitionMatches(competitionId);

  container.innerHTML = matches.length
    ? matches.map(renderMatchCard).join("")
    : `<article class="match-card"><p>Aucun match ouvert pour cette compétition.</p></article>`;

  container.querySelectorAll(".prediction-form").forEach(form => {
    form.addEventListener("submit", handlePredictionSubmit);
  });
}

function renderCompetitionRanking(competitionId) {
  const tbody = rankingBodies[competitionId];
  if (!tbody) return;

  const rows = state.users.map(user => {
    const stats = getCompetitionStatsForUser(user.id, competitionId);
    return {
      user,
      points: stats.points,
      playedPredictions: stats.playedPredictions
    };
  }).sort((a, b) => b.points - a.points || b.playedPredictions - a.playedPredictions || (a.user.displayName || "").localeCompare(b.user.displayName || ""));

  tbody.innerHTML = rows.length
    ? rows.map((row, index) => `
      <tr class="${index === 0 ? "rank-first" : ""} ${state.currentUser?.uid === row.user.id ? "rank-me" : ""}">
        <td>${index + 1}</td>
        <td>${escapeHtml(row.user.displayName || "Participant")}</td>
        <td><strong>${row.points}</strong></td>
        <td>${row.playedPredictions}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="4">Aucun participant pour le moment.</td></tr>`;
}

async function handlePredictionSubmit(event) {
  event.preventDefault();

  if (!state.currentUser) {
    alert("Connexion requise.");
    return;
  }

  const form = event.currentTarget;
  const matchId = form.dataset.matchId;
  const homeScore = Number(form.homeScore.value);
  const awayScore = Number(form.awayScore.value);

  const match = state.matches.find(m => m.id === matchId);
  if (!match) return;

  if (isKickoffPassed(match)) {
    alert("Le pronostic est fermé pour ce match.");
    return;
  }

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

adminMatchForm?.addEventListener("submit", async event => {
  event.preventDefault();

  if (!state.currentUser || !state.isAdmin) {
    adminFormFeedback.textContent = "Accès admin requis.";
    return;
  }

  const competition = adminCompetition.value;
  const round = adminRound.value.trim();
  const kickoff = adminKickoff.value;

  if (COMPETITIONS[competition]?.singleWeekly) {
    const weekKey = getWeekKey(kickoff);
    const sameWeek = state.matches.filter(m =>
      m.competitionId === competition &&
      m.round === round &&
      getWeekKey(m.kickoff) === weekKey &&
      m.enabled === true
    );

    if (sameWeek.length > 0) {
      adminFormFeedback.textContent = "Un match actif existe déjà pour cette semaine dans ce championnat.";
      return;
    }
  }

  try {
    const matchRef = doc(collection(db, "matches"));
    await setDoc(matchRef, {
      competitionId: competition,
      round,
      homeTeam: adminHomeTeam.value.trim(),
      awayTeam: adminAwayTeam.value.trim(),
      kickoff,
      enabled: adminEnabled.value === "true",
      homeScore: null,
      awayScore: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    adminFormFeedback.textContent = "Match enregistré avec succès.";
    adminMatchForm.reset();
    adminCompetition.value = "ligue1";
    adminEnabled.value = "true";
  } catch (error) {
    console.error(error);
    adminFormFeedback.textContent = "Erreur lors de l'enregistrement du match.";
  }
});

function renderAdminMatches() {
  if (!adminMatchList) return;

  if (!state.isAdmin) {
    adminMatchList.innerHTML = `<article class="match-card"><p>Connecte-toi avec un compte administrateur pour gérer les matchs.</p></article>`;
    return;
  }

  const sorted = [...state.matches].sort((a, b) => parseDate(a.kickoff) - parseDate(b.kickoff));

  adminMatchList.innerHTML = sorted.length
    ? sorted.map(match => `
      <article class="match-card">
        <div class="match-top">
          <div>
            <div class="match-title">${escapeHtml(match.homeTeam)} vs ${escapeHtml(match.awayTeam)}</div>
            <div class="match-meta">${escapeHtml(COMPETITIONS[match.competitionId]?.label || match.competitionId)} • ${escapeHtml(match.round || "")} • ${formatDate(match.kickoff)}</div>
          </div>
          <span class="tag ${match.enabled ? "tag-open" : "tag-closed"}">${match.enabled ? "Actif" : "Inactif"}</span>
        </div>

        <form class="admin-result-form" data-admin-match-id="${match.id}">
          <input type="number" min="0" step="1" name="homeScore" value="${match.homeScore ?? ""}" placeholder="Score domicile">
          <input type="number" min="0" step="1" name="awayScore" value="${match.awayScore ?? ""}" placeholder="Score extérieur">
          <button type="button" class="btn btn-secondary toggle-enabled-btn" data-match-id="${match.id}">
            ${match.enabled ? "Fermer" : "Ouvrir"}
          </button>
          <button type="submit" class="btn btn-primary">Sauver</button>
        </form>
      </article>
    `).join("")
    : `<article class="match-card"><p>Aucun match enregistré.</p></article>`;

  adminMatchList.querySelectorAll(".admin-result-form").forEach(form => {
    form.addEventListener("submit", handleAdminResultSubmit);
  });

  adminMatchList.querySelectorAll(".toggle-enabled-btn").forEach(btn => {
    btn.addEventListener("click", handleToggleEnabled);
  });
}

async function handleAdminResultSubmit(event) {
  event.preventDefault();

  if (!state.currentUser || !state.isAdmin) {
    alert("Accès admin requis.");
    return;
  }

  const form = event.currentTarget;
  const matchId = form.dataset.adminMatchId;

  try {
    const home = form.homeScore.value;
    const away = form.awayScore.value;

    await updateDoc(doc(db, "matches", matchId), {
      homeScore: home === "" ? null : Number(home),
      awayScore: away === "" ? null : Number(away),
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error(error);
    alert("Erreur lors de la sauvegarde du résultat.");
  }
}

async function handleToggleEnabled(event) {
  const matchId = event.currentTarget.dataset.matchId;
  const match = state.matches.find(m => m.id === matchId);

  if (!state.currentUser || !state.isAdmin || !match) {
    alert("Accès admin requis.");
    return;
  }

  try {
    await updateDoc(doc(db, "matches", matchId), {
      enabled: !match.enabled,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error(error);
    alert("Erreur lors du changement de statut.");
  }
}

function getEvolutionSeries() {
  const orderedMatches = [...state.matches]
    .filter(m => m.homeScore != null && m.awayScore != null)
    .sort((a, b) => parseDate(a.kickoff) - parseDate(b.kickoff));

  return state.users.map(user => {
    let cumulative = 0;
    const data = orderedMatches.map(match => {
      const pred = getPredictionForUser(match.id, user.id);
      cumulative += computePoints(pred, match);
      return cumulative;
    });

    return {
      label: user.displayName || "Participant",
      data,
      colorIndex: data.length ? data[data.length - 1] % 6 : 0
    };
  });
}

function renderEvolutionChart() {
  if (!evolutionCanvas) return;
  const ctx = evolutionCanvas.getContext("2d");
  if (!ctx) return;

  const series = getEvolutionSeries();
  const orderedMatches = [...state.matches]
    .filter(m => m.homeScore != null && m.awayScore != null)
    .sort((a, b) => parseDate(a.kickoff) - parseDate(b.kickoff));

  const dpr = window.devicePixelRatio || 1;
  const cssWidth = evolutionCanvas.clientWidth || 1200;
  const cssHeight = evolutionCanvas.clientHeight || 520;

  evolutionCanvas.width = Math.floor(cssWidth * dpr);
  evolutionCanvas.height = Math.floor(cssHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--color-surface").trim() || "#fff";
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  if (!orderedMatches.length || !series.length) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--color-text-muted").trim() || "#666";
    ctx.font = "16px Satoshi, sans-serif";
    ctx.fillText("Aucune donnée suffisante pour afficher l'évolution.", 24, 40);
    return;
  }

  const padding = { top: 30, right: 24, bottom: 48, left: 44 };
  const chartW = cssWidth - padding.left - padding.right;
  const chartH = cssHeight - padding.top - padding.bottom;

  const maxY = Math.max(1, ...series.flatMap(s => s.data));
  const colors = ["#0d6b73", "#c8102e", "#2d7a35", "#a35f13", "#001a72", "#6b4cff", "#9b2f76"];

  ctx.strokeStyle = "rgba(128,128,128,.18)";
  ctx.lineWidth = 1;

  for (let i = 0; i <= 5; i++) {
    const y = padding.top + (chartH / 5) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + chartW, y);
    ctx.stroke();
  }

  series.forEach((s, idx) => {
    if (!s.data.length) return;
    ctx.strokeStyle = colors[idx % colors.length];
    ctx.lineWidth = 3;
    ctx.beginPath();

    s.data.forEach((value, i) => {
      const x = padding.left + (chartW / Math.max(1, s.data.length - 1)) * i;
      const y = padding.top + chartH - (value / maxY) * chartH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.stroke();
  });

  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--color-text-muted").trim() || "#666";
  ctx.font = "12px Satoshi, sans-serif";
  ctx.fillText("Points cumulés", 12, 18);

  orderedMatches.forEach((match, idx) => {
    const x = padding.left + (chartW / Math.max(1, orderedMatches.length - 1)) * idx;
    ctx.save();
    ctx.translate(x, cssHeight - 14);
    ctx.rotate(-0.35);
    ctx.fillText(`${match.round || ""}`, -6, 0);
    ctx.restore();
  });
}

function renderAll() {
  renderGeneralRanking();
  Object.keys(COMPETITIONS).forEach(compId => {
    renderCompetitionMatches(compId);
    renderCompetitionRanking(compId);
  });
  renderAdminMatches();

  if (state.activeView === "evolution") {
    renderEvolutionChart();
  }
}

themeToggle.addEventListener("click", () => {
  const next = state.theme === "dark" ? "light" : "dark";
  setTheme(next);
  if (state.activeView === "evolution") renderEvolutionChart();
});

window.addEventListener("resize", () => {
  if (state.activeView === "evolution") renderEvolutionChart();
});

setTheme(state.theme);
switchView("general");
