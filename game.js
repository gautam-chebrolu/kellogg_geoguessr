// ============================================================
// KELLOGG GEOGUESSR — GAME LOGIC
// ============================================================
// Rounds are loaded from Firebase Firestore (geoguessr_rounds).
// Photos are served from Firebase Storage.
// Each floor plan is a separate image (split from composite).
//
// Use editor.html to manage rounds — upload photos, set
// answer coordinates, and save directly to Firestore.
// ============================================================

// ── FLOOR PLAN IMAGES (local, per-floor) ─────────────────────
const FLOOR_IMAGES = {
  LL: "media/floor_LL.jpg",
  L1: "media/floor_L1.jpg",
  L2: "media/floor_L2.jpg",
  L3: "media/floor_L3.jpg",
  L4: "media/floor_L4.jpg",
  L5: "media/floor_L5.jpg",
};

// ── FLOOR DEFINITIONS ────────────────────────────────────────
const FLOORS = [
  { id: "LL", label: "Lower Level" },
  { id: "L1", label: "Level 1" },
  { id: "L2", label: "Level 2" },
  { id: "L3", label: "Level 3" },
  { id: "L4", label: "Level 4" },
  { id: "L5", label: "Level 5" },
];

// ── SCORING ──────────────────────────────────────────────────
const MAX_POINTS = 1000;
const SCORE_DECAY = 12;
const TIMER_SECONDS = 30;
const WRONG_FLOOR_POINTS = 0; // Wrong floor = 0 points

// ── STATE ────────────────────────────────────────────────────
let state = {
  round: 0,
  scores: [],
  pendingGuess: null,     // { x%, y% } on the current floor image
  selectedFloor: null,
  timerInterval: null,
  timerLeft: TIMER_SECONDS,
  shuffledRounds: [],
  allRounds: [],          // All rounds loaded from Firestore
  sessionId: null,        // Analytics session ID
  sessionStartedAt: null,
  roundStartedAt: null,
  roundDetails: [],       // Per-round analytics
  leaderboardDocId: null, // Firestore doc ID for leaderboard entry
};

// ── DOM REFS ─────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const splash = $("splash");
const gameScreen = $("game");
const resultScreen = $("result");
const finalScreen = $("final");

// ── FIREBASE INIT ────────────────────────────────────────────
let db = null;

function initFirebase() {
  if (!window.FIREBASE_CONFIG) {
    console.warn("firebase-config.js not found — running without Firebase");
    return false;
  }
  try {
    const app = firebase.initializeApp(window.FIREBASE_CONFIG);
    db = firebase.firestore();
    return true;
  } catch (e) {
    console.error("Firebase init failed:", e);
    return false;
  }
}

const firebaseReady = initFirebase();

// ── LOAD ROUNDS FROM FIRESTORE ───────────────────────────────
async function loadRoundsFromFirestore() {
  if (!firebaseReady || !db) return [];
  try {
    const snapshot = await db.collection("geoguessr_rounds").get();
    const rounds = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      rounds.push({
        id: doc.id,
        photoUrl: data.photoUrl || "",
        hint: data.hint || "",
        locationName: data.locationName || "",
        answer: data.answer || { floor: "", x: 50, y: 50 },
      });
    });
    return rounds;
  } catch (e) {
    console.error("Failed to load rounds from Firestore:", e);
    return [];
  }
}

// ── FALLBACK ROUNDS (used when Firestore is empty or offline) ─
const FALLBACK_ROUNDS = [
  {
    id: "fallback_1",
    photoUrl: "media/test_photo1.jpg",
    hint: "Look carefully at the architectural details and surroundings.",
    locationName: "TBD — set in editor",
    answer: { floor: "L1", x: 50, y: 50 },
  },
  {
    id: "fallback_2",
    photoUrl: "media/test_photo2.jpg",
    hint: "Look carefully at the architectural details and surroundings.",
    locationName: "TBD — set in editor",
    answer: { floor: "L1", x: 50, y: 50 },
  },
  {
    id: "fallback_3",
    photoUrl: "media/test_photo3.jpg",
    hint: "Look carefully at the architectural details and surroundings.",
    locationName: "TBD — set in editor",
    answer: { floor: "L2", x: 50, y: 50 },
  },
  {
    id: "fallback_4",
    photoUrl: "media/test_photo4.jpg",
    hint: "Look carefully at the architectural details and surroundings.",
    locationName: "TBD — set in editor",
    answer: { floor: "L3", x: 50, y: 50 },
  },
];

// ── INIT ─────────────────────────────────────────────────────
$("startBtn").addEventListener("click", startGame);
$("guessBtn").addEventListener("click", confirmGuess);
$("nextBtn").addEventListener("click", nextRound);
$("playAgainBtn").addEventListener("click", () => location.reload());
$("submitScoreBtn").addEventListener("click", submitToLeaderboard);

buildFloorTabs();
setupMapClick();
initSplash();

// ── SPLASH INIT ──────────────────────────────────────────────
async function initSplash() {
  const rounds = await loadRoundsFromFirestore();
  if (rounds.length > 0) {
    state.allRounds = rounds;
    $("splashMeta").textContent = `${rounds.length} rounds · Score up to ${MAX_POINTS} points per round`;
  } else {
    state.allRounds = FALLBACK_ROUNDS;
    $("splashMeta").textContent = `${FALLBACK_ROUNDS.length} rounds · Score up to ${MAX_POINTS} points per round`;
    if (firebaseReady) {
      $("splashMeta").textContent += " (offline mode)";
    }
  }
}

// ── FLOOR TABS ───────────────────────────────────────────────
function buildFloorTabs() {
  const container = $("floorTabs");
  FLOORS.forEach((f) => {
    const btn = document.createElement("button");
    btn.className = "floor-tab";
    btn.textContent = f.label;
    btn.dataset.floor = f.id;
    btn.addEventListener("click", () => selectFloor(f.id));
    container.appendChild(btn);
  });
}

function selectFloor(floorId) {
  state.selectedFloor = floorId;
  document.querySelectorAll(".floor-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.floor === floorId);
  });

  // Swap floor plan image to the selected floor
  const img = $("floorplanImg");
  img.src = FLOOR_IMAGES[floorId];

  // Hide the floor-select hint
  const hint = $("floorSelectHint");
  if (hint) hint.style.display = "none";

  // Clear any pending guess when switching floors
  state.pendingGuess = null;
  $("guessBtn").disabled = true;
  redrawCanvas();
}

// ── MAP CLICK ────────────────────────────────────────────────
function setupMapClick() {
  const canvas = $("guessCanvas");
  canvas.addEventListener("click", (e) => {
    if (!state.selectedFloor) {
      flashMessage("Select a floor first!");
      return;
    }
    const rect = canvas.getBoundingClientRect();
    // Coordinates are now relative to the individual floor image (0–100%)
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;

    state.pendingGuess = { x: xPct, y: yPct };
    $("guessBtn").disabled = false;
    redrawCanvas();
  });

  // Keep canvas in sync with image size
  const img = $("floorplanImg");
  img.addEventListener("load", syncCanvasSize);
  window.addEventListener("resize", syncCanvasSize);
}

function syncCanvasSize() {
  const canvas = $("guessCanvas");
  const img = $("floorplanImg");
  canvas.width = img.offsetWidth;
  canvas.height = img.offsetHeight;
  redrawCanvas();
}

function redrawCanvas(answerPct = null, answerFloor = null) {
  const canvas = $("guessCanvas");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (state.pendingGuess) {
    const gx = (state.pendingGuess.x / 100) * canvas.width;
    const gy = (state.pendingGuess.y / 100) * canvas.height;
    drawMarker(ctx, gx, gy, "#6b3dab", "YOUR GUESS");
  }

  // Only draw answer on the matching floor
  if (answerPct && answerFloor === state.selectedFloor) {
    const ax = (answerPct.x / 100) * canvas.width;
    const ay = (answerPct.y / 100) * canvas.height;
    drawMarker(ctx, ax, ay, "#c8a96e", "ANSWER");

    if (state.pendingGuess) {
      const gx = (state.pendingGuess.x / 100) * canvas.width;
      const gy = (state.pendingGuess.y / 100) * canvas.height;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(ax, ay);
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function drawMarker(ctx, x, y, color, label) {
  // Outer pulse ring
  ctx.beginPath();
  ctx.arc(x, y, 16, 0, Math.PI * 2);
  ctx.fillStyle = color + "33";
  ctx.fill();

  // Inner dot
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Label
  ctx.font = "600 10px DM Sans, sans-serif";
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.fillText(label, x, y - 22);
}

// ── GAME START ───────────────────────────────────────────────
function startGame() {
  state.round = 0;
  state.scores = [];
  state.roundDetails = [];
  state.sessionId = generateId();
  state.sessionStartedAt = new Date();
  state.leaderboardDocId = null;

  // Shuffle and pick rounds
  state.shuffledRounds = [...state.allRounds].sort(() => Math.random() - 0.5);

  // Create leaderboard entry placeholder
  createLeaderboardEntry();

  show("game");
  loadRound();
}

// ── LOAD ROUND ───────────────────────────────────────────────
function loadRound() {
  const round = state.shuffledRounds[state.round];
  state.pendingGuess = null;
  state.selectedFloor = null;
  state.roundStartedAt = new Date();

  // UI updates
  $("roundNum").textContent = state.round + 1;
  if ($("roundTotal")) $("roundTotal").textContent = state.shuffledRounds.length;
  $("roundPhoto").src = round.photoUrl;
  $("roundPhoto").onerror = () => {
    $("roundPhoto").src = generatePlaceholder(round.locationName);
  };
  $("photoCaption").textContent = round.hint;
  $("photoLabel").textContent = `Round ${state.round + 1} / ${state.shuffledRounds.length}`;

  // Clear floor tab selection
  document.querySelectorAll(".floor-tab").forEach((t) => t.classList.remove("active"));
  $("guessBtn").disabled = true;

  // Reset floor plan image — show hint to select a floor
  $("floorplanImg").src = "";
  const hint = $("floorSelectHint");
  if (hint) hint.style.display = "";

  // Clear canvas
  const canvas = $("guessCanvas");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  syncCanvasSize();

  // Start timer
  startTimer();
}

// ── TIMER ────────────────────────────────────────────────────
function startTimer() {
  clearInterval(state.timerInterval);
  state.timerLeft = TIMER_SECONDS;
  updateTimerUI();

  state.timerInterval = setInterval(() => {
    state.timerLeft--;
    updateTimerUI();
    if (state.timerLeft <= 0) {
      clearInterval(state.timerInterval);
      confirmGuess(true);
    }
  }, 1000);
}

function updateTimerUI() {
  $("timerText").textContent = state.timerLeft;
  const pct = (state.timerLeft / TIMER_SECONDS) * 100;
  $("timerArc").setAttribute("stroke-dasharray", `${pct} 100`);
  $("timerArc").style.stroke =
    state.timerLeft <= 5 ? "#e05252" : state.timerLeft <= 10 ? "#e0a832" : "#c8a96e";
}

// ── CONFIRM GUESS ────────────────────────────────────────────
function confirmGuess(autoSubmit = false) {
  clearInterval(state.timerInterval);
  const round = state.shuffledRounds[state.round];
  const timeSpent = Math.round((new Date() - state.roundStartedAt) / 1000);

  let pts = 0;
  let distanceLabel = "No guess placed";
  let floorCorrect = false;

  if (state.pendingGuess && state.selectedFloor) {
    // Check if the floor is correct
    floorCorrect = state.selectedFloor === round.answer.floor;

    if (floorCorrect) {
      // Same floor — calculate distance on the per-floor coordinate system
      const dist = euclidean(
        state.pendingGuess.x, state.pendingGuess.y,
        round.answer.x, round.answer.y
      );
      pts = calcScore(dist);
      distanceLabel = `~${dist.toFixed(1)} units away · Correct floor!`;
    } else {
      // Wrong floor = 0 points
      pts = WRONG_FLOOR_POINTS;
      distanceLabel = `Wrong floor! (${getFloorLabel(state.selectedFloor)} → ${getFloorLabel(round.answer.floor)})`;
    }
  }

  // Track round details for analytics
  state.roundDetails.push({
    roundId: round.id,
    floor: state.selectedFloor || "none",
    correctFloor: round.answer.floor,
    floorCorrect,
    score: pts,
    timeSpent,
  });

  state.scores.push(pts);
  $("scoreDisplay").textContent = state.scores.reduce((a, b) => a + b, 0);

  showResult(pts, distanceLabel, round, floorCorrect);
}

function getFloorLabel(floorId) {
  const f = FLOORS.find((fl) => fl.id === floorId);
  return f ? f.label : floorId;
}

function calcScore(dist) {
  return Math.round(MAX_POINTS * Math.exp(-dist / SCORE_DECAY));
}

function euclidean(x1, y1, x2, y2) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

// ── SHOW RESULT ──────────────────────────────────────────────
function showResult(pts, distanceLabel, round, floorCorrect) {
  $("resultPts").textContent = pts;
  $("resultDistance").textContent = distanceLabel;
  $("resultLocation").textContent = `📍 ${round.locationName}`;

  // Floor badge
  const badge = $("resultFloorBadge");
  if (badge) {
    badge.textContent = getFloorLabel(round.answer.floor);
    badge.className = "result-floor-badge " + (floorCorrect ? "correct" : "incorrect");
  }

  // Animate score arc
  const circum = 2 * Math.PI * 52;
  const fraction = pts / MAX_POINTS;
  setTimeout(() => {
    $("resultArc").setAttribute(
      "stroke-dasharray",
      `${(fraction * circum).toFixed(1)} ${circum}`
    );
  }, 100);

  // Switch to the correct floor and draw result preview
  selectFloor(round.answer.floor);
  drawResultPreview(round);

  resultScreen.classList.remove("hidden");
  resultScreen.classList.add("active");
}

function drawResultPreview(round) {
  const canvas = $("resultCanvas");
  const img = new Image();
  img.src = FLOOR_IMAGES[round.answer.floor];
  img.onload = () => {
    const W = 360, H = Math.round((img.naturalHeight / img.naturalWidth) * W);
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, W, H);

    // Draw answer marker
    const ax = (round.answer.x / 100) * W;
    const ay = (round.answer.y / 100) * H;
    drawMarker(ctx, ax, ay, "#c8a96e", "ANSWER");

    // Draw guess if available and on the same floor
    if (state.pendingGuess && state.selectedFloor === round.answer.floor) {
      const gx = (state.pendingGuess.x / 100) * W;
      const gy = (state.pendingGuess.y / 100) * H;
      drawMarker(ctx, gx, gy, "#6b3dab", "GUESS");
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(ax, ay);
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  };
  img.onerror = () => {
    canvas.width = 360;
    canvas.height = 80;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#1a1916";
    ctx.fillRect(0, 0, 360, 80);
    ctx.fillStyle = "#8a8478";
    ctx.font = "13px DM Sans, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Floor plan preview unavailable", 180, 45);
  };
}

// ── NEXT ROUND ───────────────────────────────────────────────
function nextRound() {
  resultScreen.classList.add("hidden");
  resultScreen.classList.remove("active");

  // Reset the result arc for the next round
  $("resultArc").setAttribute("stroke-dasharray", "0 327");

  state.round++;
  if (state.round >= state.shuffledRounds.length) {
    showFinal();
  } else {
    loadRound();
  }
}

// ── FINAL SCREEN ─────────────────────────────────────────────
function showFinal() {
  show("final");
  const total = state.scores.reduce((a, b) => a + b, 0);
  const maxPossible = state.scores.length * MAX_POINTS;
  $("finalScore").textContent = total;
  const maxEl = document.querySelector(".final-score-max");
  if (maxEl) maxEl.textContent = `/ ${maxPossible}`;
  $("finalGrade").textContent = getGrade(total);

  const breakdown = $("finalBreakdown");
  breakdown.innerHTML = "";
  state.scores.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "breakdown-row";
    row.innerHTML = `<span>Round ${i + 1}</span><span class="pts">${s} pts</span>`;
    breakdown.appendChild(row);
  });

  // Log analytics and update leaderboard
  logAnalytics(total);
  updateLeaderboardScore(total);
}

function getGrade(total) {
  const max = state.scores.length * MAX_POINTS;
  const ratio = total / max;
  if (ratio >= 0.9) return "You could be a Global Hub tour guide 🏆";
  if (ratio >= 0.7) return "Impressive — clearly a regular in the building!";
  if (ratio >= 0.5) return "Not bad — you know the building pretty well.";
  if (ratio >= 0.3) return "Getting there — spend more time on each floor!";
  return "Time to explore the Global Hub more!";
}

// ── FIREBASE: LEADERBOARD ────────────────────────────────────
async function createLeaderboardEntry() {
  if (!firebaseReady || !db) return;
  try {
    const docRef = await db.collection("geoguessr_leaderboard").add({
      playerName: "",
      score: 0,
      maxScore: state.shuffledRounds.length * MAX_POINTS,
      roundCount: state.shuffledRounds.length,
      roundScores: [],
      startedAt: firebase.firestore.FieldValue.serverTimestamp(),
      completedAt: null,
    });
    state.leaderboardDocId = docRef.id;
  } catch (e) {
    console.error("Failed to create leaderboard entry:", e);
  }
}

async function updateLeaderboardScore(total) {
  if (!firebaseReady || !db || !state.leaderboardDocId) return;
  try {
    await db.collection("geoguessr_leaderboard").doc(state.leaderboardDocId).update({
      score: total,
      roundScores: state.scores,
      completedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.error("Failed to update leaderboard score:", e);
  }
}

async function submitToLeaderboard() {
  const nameInput = $("playerNameInput");
  const name = nameInput.value.trim();
  if (!name) {
    flashMessage("Please enter your name!");
    return;
  }

  if (!firebaseReady || !db || !state.leaderboardDocId) {
    flashMessage("Leaderboard unavailable — no Firebase connection");
    return;
  }

  try {
    await db.collection("geoguessr_leaderboard").doc(state.leaderboardDocId).update({
      playerName: name,
    });
    $("leaderboardSubmit").classList.add("hidden");
    $("leaderboardSubmitted").classList.remove("hidden");
    flashMessage("Score submitted! 🎉");
  } catch (e) {
    console.error("Failed to submit name:", e);
    flashMessage("Failed to submit — try again");
  }
}

// ── FIREBASE: ANALYTICS ─────────────────────────────────────
async function logAnalytics(total) {
  if (!firebaseReady || !db) return;
  try {
    await db.collection("geoguessr_analytics").add({
      sessionId: state.sessionId,
      score: total,
      maxScore: state.shuffledRounds.length * MAX_POINTS,
      roundCount: state.shuffledRounds.length,
      roundScores: state.scores,
      roundDetails: state.roundDetails,
      totalTime: Math.round((new Date() - state.sessionStartedAt) / 1000),
      completedAt: firebase.firestore.FieldValue.serverTimestamp(),
      userAgent: navigator.userAgent,
    });
  } catch (e) {
    console.error("Failed to log analytics:", e);
  }
}

// ── HELPERS ──────────────────────────────────────────────────
function show(screenId) {
  [splash, gameScreen, resultScreen, finalScreen].forEach((s) => {
    s.classList.remove("active");
    s.style.display = "none";
  });
  const target = $(screenId);
  target.style.display = "flex";
  target.classList.add("active");
}

function flashMessage(msg) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    toast.style.cssText = `
      position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
      background:#4e2a84; color:#fff; padding:0.5em 1.5em; border-radius:2em;
      font-size:0.85rem; z-index:999; pointer-events:none;
      animation: fadeInOut 2s ease both;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.animation = "none";
  void toast.offsetWidth;
  toast.style.animation = "fadeInOut 2s ease both";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.remove(), 2100);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

// Add fadeInOut keyframes dynamically
const style = document.createElement("style");
style.textContent = `
  @keyframes fadeInOut {
    0% { opacity:0; transform:translateX(-50%) translateY(8px); }
    15% { opacity:1; transform:translateX(-50%) translateY(0); }
    75% { opacity:1; }
    100% { opacity:0; }
  }
`;
document.head.appendChild(style);

// Placeholder SVG when photos are missing
function generatePlaceholder(text) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600'>
    <rect width='800' height='600' fill='%231a1916'/>
    <text x='400' y='270' font-family='Georgia,serif' font-size='18' fill='%23c8a96e' text-anchor='middle'>Photo Coming Soon</text>
    <text x='400' y='305' font-family='Arial,sans-serif' font-size='13' fill='%235a5650' text-anchor='middle'>${encodeURIComponent(text)}</text>
    <text x='400' y='340' font-family='Arial,sans-serif' font-size='11' fill='%234a4540' text-anchor='middle'>Upload a photo via the editor</text>
  </svg>`;
  return `data:image/svg+xml,${svg}`;
}

// Initialize canvas once page loads
window.addEventListener("load", () => {
  if ($("floorplanImg").complete) syncCanvasSize();
});
