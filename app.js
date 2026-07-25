import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* =========================================================
   CONFIG FIREBASE
   ========================================================= */
const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

/* =========================================================
   CONSTANTES
   ========================================================= */
const COMPETITIONS = [
  { id: "ligue1", label: "Ligue 1" },
  { id: "liga", label: "Liga" },
  { id: "serieA", label: "Serie A" },
  { id: "premierLeague", label: "Premier League" },
  { id: "ldc", label: "Ligue des Champions" }
];

const WEEKLY_LIMITED_COMPETITIONS = new Set(["ligue1", "liga", "serieA", "premierLeague"]);

const POINTS = {
  exact: 3,
  outcome: 1,
  wrong: 0
};

const state = {
  currentUser: null,
  userProfile: null,
  users: [],
  matches: [],
  predictions: [],
  rankings: {
    general: [],
    byCompetition: {
      ligue1: [],
      liga: [],
      serieA: [],
      premierLeague: [],
      ldc: []
    }
  },
  evolution: [],
  chart: null,
  currentView: "general"
};

/* =========================================================
   DOM
   ========================================================= */
const $ = (id) => document.getElementById(id);

const dom = {
  pageTitle: $("page-title"),
  syncStatus: $("sync-status"),
  authStatus: $("auth-status"),
  authLoggedOut: $("auth-logged-out"),
  authLoggedIn: $("auth-logged-in"),
  btnGoogleLogin: $("btn-google-login"),
  btnOpenAuth: $("btn-open-auth"),
  btnLogout: $("btn-logout"),
  authDialog: $("auth-dialog"),
  authEmail: $("auth-email"),
  authPassword: $("auth-password"),
  btnEmailLogin: $("btn-email-login"),
  btnEmailSignup: $("btn-email-signup"),
  themeToggle: $("theme-toggle"),

  statTotalUsers: $("stat-total-users"),
  statTotalFinished: $("stat-total-finished"),
  statMyRank: $("stat-my-rank"),
  statMyPoints: $("stat-my-points"),

  rankingGeneralBody: $("ranking-general-body"),
  rankingBodies: {
    ligue1: $("ranking-ligue1-body"),
    liga: $("ranking-liga-body"),
    serieA: $("ranking-serieA-body"),
    premierLeague: $("ranking-premierLeague-body"),
    ldc: $("ranking-ldc-body")
  },

  matchContainers: {
    ligue1: $("matches-ligue1"),
    liga: $("matches-liga"),
    serieA: $("matches-serieA"),
    premierLeague: $("matches-premierLeague"),
    ldc: $("matches-ldc")
  },

  evolutionPlayerSelect: $("evolution-player-select"),
  evolutionChart: $("evolution-chart"),

  adminCreateUserForm: $("admin-create-user-form"),
  createUserName: $("create-user-name"),
  createUserEmail: $("create-user-email"),
  createUserPassword: $("create-user-password"),

  adminCreateMatchForm: $("admin-create-match-form"),
  adminMatchCompetition: $("admin-match-competition"),
  adminMatchRound: $("admin-match-round"),
  adminMatchHome: $("admin-match-home"),
  adminMatchAway: $("admin-match-away"),
  adminMatchKickoff: $("admin-match-kickoff"),

  adminResultsList: $("admin-results-list")
};

/* =========================================================
   OUTILS
   ========================================================= */
function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toMillis(value) {
  if (!value) return 0;
  if (value?.toMillis) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatDateTime(value) {
  const ms = toMillis(value);
  if (!ms) return "Date inconnue";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(ms);
}

function nowMs() {
  return Date.now();
}

function isMatchClosed(match) {
  return nowMs() >= toMillis(match.kickoff);
}

function isMatchFinished(match) {
  return Number.isFinite(match.homeScore) && Number.isFinite(match.awayScore);
}

function getOutcome(home, away) {
  if (home > away) return "H";
  if (home < away) return "A";
  return "D";
}

function getPredictionPoints(predHome, predAway, realHome, realAway) {
  if (
    !Number.isFinite(predHome) ||
    !Number.isFinite(predAway) ||
    !Number.isFinite(realHome) ||
    !Number.isFinite(realAway)
  ) {
    return 0;
  }

  if (predHome === realHome && predAway === realAway) return POINTS.exact;
  if (getOutcome(predHome, predAway) === getOutcome(realHome, realAway)) return POINTS.outcome;
  return POINTS.wrong;
}

function getCompetitionLabel(competitionId) {
  return COMPETITIONS.find((c) => c.id === competitionId)?.label || competitionId;
}

function getDisplayName(user) {
  return user?.displayName || user?.name || user?.email || "Participant";
}

function weekKeyFromKickoff(kickoff) {
  const date = new Date(toMillis(kickoff));
  if (Number.isNaN(date.getTime())) return "";
  const jan1 = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const current = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayMs = 86400000;
  const dayOfYear = Math.floor((current - jan1) / dayMs) + 1;
  const week = Math.ceil(dayOfYear / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function generateColor(index) {
  const colors = [
    "#0d6b73",
    "#aa151b",
    "#009246",
    "#012169",
    "#0a84ff",
    "#8b5cf6",
    "#f59e0b",
    "#ef4444",
    "#10b981",
    "#3b82f6"
  ];
  return colors[index % colors.length];
}

function alertError(error, fallback = "Une erreur est survenue.") {
  console.error(error);
  alert(error?.message || fallback);
}

function ensureAuthMessageBox() {
  let box = document.getElementById("auth-feedback");
  if (box) return box;

  const target = document.querySelector("#auth-dialog .form-stack");
  if (!target) return null;

  box = document.createElement("div");
  box.id = "auth-feedback";
  box.style.marginTop = "10px";
  box.style.padding = "10px 12px";
  box.style.borderRadius = "12px";
  box.style.fontSize = "14px";
  box.style.display = "none";
  target.appendChild(box);

  return box;
}

function setAuthFeedback(message, type = "error") {
  const box = ensureAuthMessageBox();
  if (!box) return;

  if (!message) {
    box.style.display = "none";
    box.textContent = "";
    return;
  }

  const styles = {
    error: {
      bg: "rgba(168,47,72,.12)",
      border: "1px solid rgba(168,47,72,.28)",
      color: "#b4234d"
    },
    success: {
      bg: "rgba(45,122,53,.12)",
      border: "1px solid rgba(45,122,53,.28)",
      color: "#246a2d"
    },
    info: {
      bg: "rgba(13,107,115,.12)",
      border: "1px solid rgba(13,107,115,.28)",
      color: "#0d6b73"
    }
  };

  const style = styles[type] || styles.error;
  box.style.display = "block";
  box.style.background = style.bg;
  box.style.border = style.border;
  box.style.color = style.color;
  box.textContent = message;
}

function getFriendlyAuthErrorMessage(error) {
  const code = error?.code || "";

  switch (code) {
    case "auth/invalid-email":
      return "L’adresse email n’est pas valide.";
    case "auth/missing-password":
      return "Merci de saisir un mot de passe.";
    case "auth/weak-password":
      return "Le mot de passe doit contenir au moins 6 caractères.";
    case "auth/email-already-in-use":
      return "Cet email est déjà utilisé par un autre compte.";
    case "auth/user-not-found":
    case "auth/invalid-credential":
    case "auth/wrong-password":
      return "Email ou mot de passe incorrect.";
    case "auth/popup-closed-by-user":
      return "La fenêtre de connexion Google a été fermée avant la fin.";
    case "auth/network-request-failed":
      return "Problème réseau. Vérifie ta connexion puis réessaie.";
    case "auth/operation-not-allowed":
      return "Cette méthode de connexion n’est pas activée dans Firebase Authentication.";
    default:
      return error?.message || "Une erreur est survenue pendant l’authentification.";
  }
}

/* =========================================================
   THEME
   ========================================================= */
(function initTheme() {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
})();

dom.themeToggle?.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  document.documentElement.setAttribute("data-theme", current === "dark" ? "light" : "dark");
});

/* =========================================================
   NAVIGATION
   ========================================================= */
function setView(viewId) {
  state.currentView = viewId;

  document.querySelectorAll(".nav-link").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.viewTarget === viewId);
  });

  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.dataset.view === viewId);
  });

  const titles = {
    general: "Classement général",
    ligue1: "Ligue 1",
    liga: "Liga",
    serieA: "Serie A",
    premierLeague: "Premier League",
    ldc: "Ligue des Champions",
    evolution: "Évolution",
    admin: "Admin"
  };

  dom.pageTitle.textContent = titles[viewId] || "Prono Multi-Championnats";
}

document.querySelectorAll(".nav-link").forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.viewTarget));
});

/* =========================================================
   AUTH
   ========================================================= */
async function ensureUserProfile(user, fallbackName = "") {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    const profile = {
      uid: user.uid,
      email: user.email || "",
      displayName: user.displayName || fallbackName || user.email?.split("@")[0] || "Participant",
      isAdmin: false,
      createdAt: serverTimestamp()
    };
    await setDoc(ref, profile);
    return profile;
  }

  return { id: snap.id, ...snap.data() };
}

async function loginWithGoogle() {
  try {
    setAuthFeedback("Connexion Google en cours…", "info");
    await signInWithPopup(auth, googleProvider);
    setAuthFeedback("Connexion réussie.", "success");
  } catch (error) {
    console.error(error);
    setAuthFeedback(getFriendlyAuthErrorMessage(error), "error");
  }
}

async function loginWithEmail() {
  try {
    const email = dom.authEmail.value.trim();
    const password = dom.authPassword.value.trim();

    if (!email || !password) {
      setAuthFeedback("Merci de remplir l’email et le mot de passe.", "error");
      return;
    }

    setAuthFeedback("Connexion en cours…", "info");
    await signInWithEmailAndPassword(auth, email, password);
    setAuthFeedback("Connexion réussie.", "success");

    setTimeout(() => {
      setAuthFeedback("");
      dom.authDialog.close();
    }, 500);
  } catch (error) {
    console.error(error);
    setAuthFeedback(getFriendlyAuthErrorMessage(error), "error");
  }
}

async function signupWithEmail() {
  try {
    const email = dom.authEmail.value.trim();
    const password = dom.authPassword.value.trim();

    if (!email || !password) {
      setAuthFeedback("Merci de remplir l’email et le mot de passe.", "error");
      return;
    }

    if (password.length < 6) {
      setAuthFeedback("Le mot de passe doit contenir au moins 6 caractères.", "error");
      return;
    }

    setAuthFeedback("Création du compte en cours…", "info");
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await ensureUserProfile(cred.user);
    setAuthFeedback("Compte créé avec succès.", "success");

    setTimeout(() => {
      setAuthFeedback("");
      dom.authDialog.close();
    }, 700);
  } catch (error) {
    console.error(error);
    setAuthFeedback(getFriendlyAuthErrorMessage(error), "error");
  }
}

async function logoutUser() {
  try {
    await signOut(auth);
  } catch (error) {
    alertError(error, "Déconnexion impossible.");
  }
}

dom.btnGoogleLogin?.addEventListener("click", loginWithGoogle);
dom.btnOpenAuth?.addEventListener("click", () => {
  setAuthFeedback("");
  dom.authDialog.showModal();
});
dom.btnEmailLogin?.addEventListener("click", loginWithEmail);
dom.btnEmailSignup?.addEventListener("click", signupWithEmail);
dom.btnLogout?.addEventListener("click", logoutUser);

onAuthStateChanged(auth, async (user) => {
  state.currentUser = user || null;

  if (!user) {
    state.userProfile = null;
    dom.authStatus.textContent = "Non connecté";
    dom.authLoggedOut.classList.remove("hidden");
    dom.authLoggedIn.classList.add("hidden");
    renderAll();
    return;
  }

  dom.syncStatus.textContent = "Connexion…";

  try {
    state.userProfile = await ensureUserProfile(user);
    dom.authStatus.textContent = `${getDisplayName(state.userProfile)}${state.userProfile.isAdmin ? " · Admin" : ""}`;
    dom.authLoggedOut.classList.add("hidden");
    dom.authLoggedIn.classList.remove("hidden");
  } catch (error) {
    alertError(error, "Impossible de charger le profil utilisateur.");
  }

  renderAll();
});

/* =========================================================
   FIRESTORE LISTENERS
   ========================================================= */
function subscribeCollection(collectionName, assign) {
  const q = query(collection(db, collectionName));
  return onSnapshot(
    q,
    (snap) => {
      assign(
        snap.docs.map((d) => ({
          id: d.id,
          ...d.data()
        }))
      );
      dom.syncStatus.textContent = "Synchronisé";
      computeDerivedData();
      renderAll();
    },
    (error) => {
      console.error(error);
      dom.syncStatus.textContent = "Erreur sync";
    }
  );
}

subscribeCollection("users", (items) => {
  state.users = items;
});

subscribeCollection("matches", (items) => {
  state.matches = items.sort((a, b) => toMillis(a.kickoff) - toMillis(b.kickoff));
});

subscribeCollection("predictions", (items) => {
  state.predictions = items;
});

/* =========================================================
   DERIVED DATA
   ========================================================= */
function computeDerivedData() {
  const predictionsByMatch = new Map();

  for (const pred of state.predictions) {
    if (!predictionsByMatch.has(pred.matchId)) predictionsByMatch.set(pred.matchId, []);
    predictionsByMatch.get(pred.matchId).push(pred);
  }

  const scoreMap = new Map();
  for (const user of state.users) {
    const uid = user.id || user.uid;
    scoreMap.set(uid, {
      userId: uid,
      displayName: getDisplayName(user),
      competitions: {
        ligue1: 0,
        liga: 0,
        serieA: 0,
        premierLeague: 0,
        ldc: 0
      },
      total: 0
    });
  }

  const evolutionBase = [];
  let finishedCounter = 0;

  const finishedMatches = [...state.matches]
    .filter((m) => isMatchFinished(m))
    .sort((a, b) => toMillis(a.kickoff) - toMillis(b.kickoff));

  for (const match of finishedMatches) {
    finishedCounter += 1;
    const matchPreds = predictionsByMatch.get(match.id) || [];

    for (const pred of matchPreds) {
      const scoreEntry = scoreMap.get(pred.userId);
      if (!scoreEntry) continue;

      const points = getPredictionPoints(
        Number(pred.predHome),
        Number(pred.predAway),
        Number(match.homeScore),
        Number(match.awayScore)
      );

      scoreEntry.competitions[match.competitionId] += points;
      scoreEntry.total += points;
    }

    for (const entry of scoreMap.values()) {
      evolutionBase.push({
        step: finishedCounter,
        matchId: match.id,
        label: `${getCompetitionLabel(match.competitionId)} · ${match.homeTeam} - ${match.awayTeam}`,
        userId: entry.userId,
        displayName: entry.displayName,
        total: entry.total
      });
    }
  }

  const rankingGeneral = [...scoreMap.values()].sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return a.displayName.localeCompare(b.displayName, "fr");
  });

  const rankingByCompetition = {
    ligue1: [],
    liga: [],
    serieA: [],
    premierLeague: [],
    ldc: []
  };

  for (const comp of COMPETITIONS) {
    rankingByCompetition[comp.id] = [...scoreMap.values()]
      .map((entry) => ({
        userId: entry.userId,
        displayName: entry.displayName,
        points: entry.competitions[comp.id]
      }))
      .sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        return a.displayName.localeCompare(b.displayName, "fr");
      });
  }

  state.rankings.general = rankingGeneral;
  state.rankings.byCompetition = rankingByCompetition;
  state.evolution = evolutionBase;
}

/* =========================================================
   RENDERS
   ========================================================= */
function getCurrentUserPrediction(matchId) {
  if (!state.currentUser) return null;
  return state.predictions.find((p) => p.matchId === matchId && p.userId === state.currentUser.uid) || null;
}

function renderCompetitionMatches(competitionId) {
  const container = dom.matchContainers[competitionId];
  if (!container) return;

  const matches = state.matches.filter((m) => m.competitionId === competitionId);

  if (!matches.length) {
    container.innerHTML = `<div class="match-card"><p class="helper-text">Aucun match n’a encore été ajouté.</p></div>`;
    return;
  }

  container.innerHTML = matches.map((match) => {
    const myPred = getCurrentUserPrediction(match.id);
    const closed = isMatchClosed(match);
    const finished = isMatchFinished(match);
    const tagClass = closed ? "tag tag-closed" : "tag tag-open";
    const tagText = closed ? "Fermé" : "Ouvert";
    const exactScore = finished ? `<div class="score-line">${match.homeScore} - ${match.awayScore}</div>` : "";
    const predInfo = myPred
      ? `<div class="points-badge">Mon prono : ${Number(myPred.predHome)} - ${Number(myPred.predAway)}</div>`
      : `<div class="points-badge">Aucun prono enregistré</div>`;

    return `
      <article class="match-card">
        <div class="match-top">
          <div>
            <div class="match-title">${escapeHtml(match.homeTeam)} - ${escapeHtml(match.awayTeam)}</div>
            <div class="match-meta">${escapeHtml(match.roundLabel || "")} · ${formatDateTime(match.kickoff)}</div>
          </div>
          <span class="${tagClass}">${tagText}</span>
        </div>

        ${exactScore}
        ${predInfo}

        <form class="prediction-form" data-prediction-form="${match.id}">
          <input type="number" min="0" inputmode="numeric" placeholder="Domicile" value="${myPred ? Number(myPred.predHome) : ""}" ${closed ? "disabled" : ""} />
          <input type="number" min="0" inputmode="numeric" placeholder="Extérieur" value="${myPred ? Number(myPred.predAway) : ""}" ${closed ? "disabled" : ""} />
          <button class="btn btn-primary" type="submit" ${closed ? "disabled" : ""}>Valider</button>
        </form>
      </article>
    `;
  }).join("");

  container.querySelectorAll("[data-prediction-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const matchId = form.getAttribute("data-prediction-form");
      const inputs = form.querySelectorAll("input");
      const predHome = Number(inputs[0].value);
      const predAway = Number(inputs[1].value);
      await submitPrediction(matchId, predHome, predAway);
    });
  });
}

function renderRankings() {
  const myUid = state.currentUser?.uid || null;

  dom.rankingGeneralBody.innerHTML = state.rankings.general.map((entry, index) => {
    const classNames = [
      index === 0 ? "rank-first" : "",
      myUid && entry.userId === myUid ? "rank-me" : ""
    ].filter(Boolean).join(" ");

    return `
      <tr class="${classNames}">
        <td>${index + 1}</td>
        <td>${escapeHtml(entry.displayName)}</td>
        <td>${entry.competitions.ligue1}</td>
        <td>${entry.competitions.liga}</td>
        <td>${entry.competitions.serieA}</td>
        <td>${entry.competitions.premierLeague}</td>
        <td>${entry.competitions.ldc}</td>
        <td><strong>${entry.total}</strong></td>
      </tr>
    `;
  }).join("");

  for (const comp of COMPETITIONS) {
    const body = dom.rankingBodies[comp.id];
    if (!body) continue;

    body.innerHTML = state.rankings.byCompetition[comp.id].map((entry, index) => {
      const classNames = [
        index === 0 ? "rank-first" : "",
        myUid && entry.userId === myUid ? "rank-me" : ""
      ].filter(Boolean).join(" ");

      return `
        <tr class="${classNames}">
          <td>${index + 1}</td>
          <td>${escapeHtml(entry.displayName)}</td>
          <td><strong>${entry.points}</strong></td>
        </tr>
      `;
    }).join("");
  }

  const myRankIndex = state.rankings.general.findIndex((r) => r.userId === myUid);
  const myEntry = state.rankings.general.find((r) => r.userId === myUid);

  dom.statTotalUsers.textContent = String(state.users.length);
  dom.statTotalFinished.textContent = String(state.matches.filter(isMatchFinished).length);
  dom.statMyRank.textContent = myRankIndex >= 0 ? String(myRankIndex + 1) : "-";
  dom.statMyPoints.textContent = String(myEntry?.total || 0);
}

function renderEvolution() {
  if (!dom.evolutionPlayerSelect) return;

  const currentSelection = new Set(
    Array.from(dom.evolutionPlayerSelect.selectedOptions).map((opt) => opt.value)
  );

  dom.evolutionPlayerSelect.innerHTML = state.users.map((user) => {
    const uid = user.id || user.uid;
    const selected = currentSelection.size ? currentSelection.has(uid) : false;
    return `<option value="${uid}" ${selected ? "selected" : ""}>${escapeHtml(getDisplayName(user))}</option>`;
  }).join("");

  if (!currentSelection.size && state.users.length) {
    for (let i = 0; i < Math.min(3, dom.evolutionPlayerSelect.options.length); i += 1) {
      dom.evolutionPlayerSelect.options[i].selected = true;
    }
  }

  drawEvolutionChart();
}

function drawEvolutionChart() {
  if (!window.Chart || !dom.evolutionChart) return;

  const selectedIds = Array.from(dom.evolutionPlayerSelect.selectedOptions).map((opt) => opt.value);
  const ctx = dom.evolutionChart.getContext("2d");

  const grouped = new Map();
  for (const row of state.evolution) {
    if (!selectedIds.includes(row.userId)) continue;
    if (!grouped.has(row.userId)) grouped.set(row.userId, []);
    grouped.get(row.userId).push(row);
  }

  const labels = [...new Set(state.evolution.map((row) => row.label))];
  const datasets = selectedIds.map((userId, index) => {
    const rows = grouped.get(userId) || [];
    const displayName = state.users.find((u) => (u.id || u.uid) === userId);
    return {
      label: getDisplayName(displayName),
      data: rows.map((r) => r.total),
      borderColor: generateColor(index),
      backgroundColor: generateColor(index),
      tension: 0.25,
      fill: false
    };
  });

  if (state.chart) state.chart.destroy();

  state.chart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" }
      },
      scales: {
        y: { beginAtZero: true }
      }
    }
  });
}

dom.evolutionPlayerSelect?.addEventListener("change", drawEvolutionChart);

function renderAdminResults() {
  if (!dom.adminResultsList) return;

  const isAdmin = !!state.userProfile?.isAdmin;

  if (!state.matches.length) {
    dom.adminResultsList.innerHTML = `<div class="match-card"><p class="helper-text">Aucun match à gérer pour le moment.</p></div>`;
    return;
  }

  dom.adminResultsList.innerHTML = state.matches.map((match) => `
    <article class="match-card">
      <div class="match-top">
        <div>
          <div class="match-title">${escapeHtml(match.homeTeam)} - ${escapeHtml(match.awayTeam)}</div>
          <div class="match-meta">${escapeHtml(getCompetitionLabel(match.competitionId))} · ${formatDateTime(match.kickoff)}</div>
        </div>
        <span class="${isMatchClosed(match) ? "tag tag-closed" : "tag tag-open"}">${isMatchClosed(match) ? "Fermé" : "Ouvert"}</span>
      </div>

      <form class="admin-result-form" data-admin-result-form="${match.id}">
        <input type="number" min="0" placeholder="Score domicile" value="${Number.isFinite(match.homeScore) ? Number(match.homeScore) : ""}" />
        <input type="number" min="0" placeholder="Score extérieur" value="${Number.isFinite(match.awayScore) ? Number(match.awayScore) : ""}" />
        <button class="btn btn-primary" type="submit">Enregistrer</button>
        <button class="btn btn-ghost" type="button" data-delete-match="${match.id}">Supprimer</button>
      </form>
      ${!isAdmin ? `<p class="helper-text">Accès réservé à l’administrateur pour modifier ce match.</p>` : ""}
    </article>
  `).join("");

  dom.adminResultsList.querySelectorAll("[data-admin-result-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const matchId = form.getAttribute("data-admin-result-form");
      const inputs = form.querySelectorAll("input");
      const homeScore = Number(inputs[0].value);
      const awayScore = Number(inputs[1].value);
      await saveOfficialResult(matchId, homeScore, awayScore);
    });
  });

  dom.adminResultsList.querySelectorAll("[data-delete-match]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const matchId = btn.getAttribute("data-delete-match");
      await deleteMatch(matchId);
    });
  });
}

function renderAdminVisibility() {
  const isAdmin = !!state.userProfile?.isAdmin;
  const adminView = document.getElementById("view-admin");
  if (!adminView) return;

  adminView.querySelectorAll("form, .admin-match-list").forEach((node) => {
    node.style.pointerEvents = "auto";
    node.style.opacity = "1";
  });

  let info = document.getElementById("admin-access-message");

  if (!isAdmin) {
    if (!info) {
      info = document.createElement("div");
      info.id = "admin-access-message";
      info.className = "panel";
      info.style.marginBottom = "16px";
      info.innerHTML = `
        <p class="eyebrow">Accès</p>
        <h3>Zone visible, accès restreint</h3>
        <p class="helper-text">
          Tu peux voir l’onglet admin, mais seules les personnes avec <strong>isAdmin: true</strong>
          dans Firestore peuvent enregistrer des actions.
        </p>
      `;
      adminView.prepend(info);
    }
  } else if (info) {
    info.remove();
  }
}

function renderAll() {
  COMPETITIONS.forEach((comp) => renderCompetitionMatches(comp.id));
  renderRankings();
  renderEvolution();
  renderAdminResults();
  renderAdminVisibility();
}

/* =========================================================
   ACTIONS USER
   ========================================================= */
async function submitPrediction(matchId, predHome, predAway) {
  try {
    if (!state.currentUser) {
      alert("Merci de vous connecter pour enregistrer un pronostic.");
      return;
    }

    if (!Number.isFinite(predHome) || !Number.isFinite(predAway) || predHome < 0 || predAway < 0) {
      alert("Merci de saisir deux scores valides.");
      return;
    }

    const match = state.matches.find((m) => m.id === matchId);
    if (!match) {
      alert("Match introuvable.");
      return;
    }

    if (isMatchClosed(match)) {
      alert("Les pronostics pour ce match sont fermés.");
      return;
    }

    const existing = state.predictions.find((p) => p.matchId === matchId && p.userId === state.currentUser.uid);

    if (existing) {
      await updateDoc(doc(db, "predictions", existing.id), {
        predHome,
        predAway,
        updatedAt: serverTimestamp()
      });
    } else {
      await addDoc(collection(db, "predictions"), {
        matchId,
        competitionId: match.competitionId,
        userId: state.currentUser.uid,
        predHome,
        predAway,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }
  } catch (error) {
    alertError(error, "Impossible d’enregistrer le pronostic.");
  }
}

/* =========================================================
   ACTIONS ADMIN
   ========================================================= */
function requireAdmin() {
  if (!state.userProfile?.isAdmin) {
    throw new Error("Accès réservé à l’administrateur.");
  }
}

async function createParticipantByAdmin(name, email, password) {
  requireAdmin();

  if (!name || !email || !password) {
    throw new Error("Nom, email et mot de passe sont obligatoires.");
  }

  throw new Error(
    "La création directe d’un compte participant depuis l’onglet admin n’est pas encore activée dans cette version. " +
    "Pour l’instant, le participant doit créer son compte via le bouton “Email / mot de passe”. " +
    "Pour une vraie création admin, il faudra passer par une Cloud Function ou Firebase Admin SDK."
  );
}

async function createMatchByAdmin(payload) {
  requireAdmin();

  const { competitionId, roundLabel, homeTeam, awayTeam, kickoff } = payload;

  if (!competitionId || !homeTeam || !awayTeam || !kickoff) {
    throw new Error("Tous les champs du match sont obligatoires.");
  }

  const kickoffDate = new Date(kickoff);
  if (Number.isNaN(kickoffDate.getTime())) {
    throw new Error("Date de match invalide.");
  }

  if (WEEKLY_LIMITED_COMPETITIONS.has(competitionId)) {
    const targetWeek = weekKeyFromKickoff(kickoffDate);
    const conflict = state.matches.find((m) => {
      if (m.competitionId !== competitionId) return false;
      return weekKeyFromKickoff(m.kickoff) === targetWeek;
    });

    if (conflict) {
      throw new Error(`Un match est déjà programmé cette semaine pour ${getCompetitionLabel(competitionId)}.`);
    }
  }

  await addDoc(collection(db, "matches"), {
    competitionId,
    roundLabel: roundLabel || "",
    homeTeam,
    awayTeam,
    kickoff: Timestamp.fromDate(kickoffDate),
    createdAt: serverTimestamp()
  });
}

async function saveOfficialResult(matchId, homeScore, awayScore) {
  try {
    requireAdmin();

    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore) || homeScore < 0 || awayScore < 0) {
      alert("Merci de saisir deux scores valides.");
      return;
    }

    await updateDoc(doc(db, "matches", matchId), {
      homeScore,
      awayScore,
      resultUpdatedAt: serverTimestamp()
    });
  } catch (error) {
    alertError(error, "Impossible d’enregistrer le résultat.");
  }
}

async function deleteMatch(matchId) {
  try {
    requireAdmin();

    const confirmed = window.confirm("Supprimer ce match ?");
    if (!confirmed) return;

    await deleteDoc(doc(db, "matches", matchId));

    const linkedPredictions = state.predictions.filter((p) => p.matchId === matchId);
    await Promise.all(linkedPredictions.map((pred) => deleteDoc(doc(db, "predictions", pred.id))));
  } catch (error) {
    alertError(error, "Impossible de supprimer le match.");
  }
}

/* =========================================================
   FORMULAIRES ADMIN
   ========================================================= */
dom.adminCreateUserForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await createParticipantByAdmin(
      dom.createUserName.value.trim(),
      dom.createUserEmail.value.trim(),
      dom.createUserPassword.value.trim()
    );
    dom.adminCreateUserForm.reset();
  } catch (error) {
    alertError(error, "Impossible de créer le participant.");
  }
});

dom.adminCreateMatchForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await createMatchByAdmin({
      competitionId: dom.adminMatchCompetition.value,
      roundLabel: dom.adminMatchRound.value.trim(),
      homeTeam: dom.adminMatchHome.value.trim(),
      awayTeam: dom.adminMatchAway.value.trim(),
      kickoff: dom.adminMatchKickoff.value
    });

    dom.adminCreateMatchForm.reset();
  } catch (error) {
    alertError(error, "Impossible d’ajouter le match.");
  }
});

/* =========================================================
   INIT
   ========================================================= */
setView("general");
computeDerivedData();
renderAll();
