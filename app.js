"use strict";

import {
  SCHEMA_VERSION,
  mealLabels,
  coffeeLabels,
  createEmptyData,
  normalizeData,
  normalizeMeal,
  normalizeHydration,
  normalizeCoffee,
  normalizeSession,
  mergeData,
  needsV1Migration,
  needsDataMigration,
  updateExerciseLibrary,
  getDay,
  dayTotals,
  getExerciseNames,
  findExerciseLibraryEntry,
  searchExerciseLibrary,
  findExerciseHistory,
  exerciseKey,
  maxWeight,
  makeId
} from "./data.js?v=0.1.2-6";

const STORAGE_KEY = "fitness-log.data.v1";
const PRE_IMPORT_KEY = "fitness-log.data.v1.pre-import";
const PRE_MIGRATION_KEY = "fitness-log.data.v1.pre-v4-migration";
const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

let migrationPerformed = false;
let data = loadData();
let selectedDate = todayISO();
let calendarMonth = selectedDate.slice(0, 7);
let activeView = location.hash.slice(1) || "log";
let chartMetric = "calories";
let selectedHistoryExercise = "";
let toastTimer;
let deferredInstallPrompt;
let shareSessionId = "";
let shareFormat = "detailed";
let shareImageBlob = null;
let shareRenderToken = 0;

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

function loadData() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return createEmptyData();
    const parsed = JSON.parse(stored);
    if (needsDataMigration(parsed)) {
      if (!localStorage.getItem(PRE_MIGRATION_KEY)) {
        localStorage.setItem(PRE_MIGRATION_KEY, JSON.stringify({
          app: "Fitness Log",
          formatVersion: Number(parsed.schemaVersion || 1),
          savedBeforeMigrationAt: new Date().toISOString(),
          data: parsed
        }));
      }
      migrationPerformed = true;
    }
    const normalized = normalizeData(parsed);
    if (migrationPerformed) localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch (error) {
    console.warn("无法读取本地数据", error);
    return createEmptyData();
  }
}

function saveData() {
  data.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error("保存失败", error);
    alert("保存失败：浏览器本地存储空间可能已满。请先导出 JSON 备份。");
    return false;
  }
  renderAll();
  return true;
}

function ensureDay(date) {
  const day = data.days[date] ||= { date, meals: [], sessions: [], hydration: [], coffees: [] };
  day.hydration ||= [];
  day.coffees ||= [];
  return day;
}

function removeEmptyDay(date) {
  const day = data.days[date];
  if (day && !day.meals.length && !day.sessions.length && !(day.hydration || []).length && !(day.coffees || []).length) delete data.days[date];
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
}

function parseDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function todayISO() { return toISO(new Date()); }
function shiftDate(iso, amount) { const date = parseDate(iso); date.setDate(date.getDate() + amount); return toISO(date); }
function formatShortDate(iso) { const date = parseDate(iso); return `${date.getMonth() + 1}月${date.getDate()}日`; }
function currentTime() { const date = new Date(); return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`; }
function compactNumber(value) { return Number.isInteger(value) ? String(value) : Number(value).toFixed(1).replace(/\.0$/, ""); }
function sortByTime(items, key = "time") { return [...items].sort((a, b) => (a[key] || "").localeCompare(b[key] || "")); }

function renderAll() {
  renderNavigation();
  renderDay();
  renderCalendar();
  renderSummary();
  renderBackup();
  renderExerciseOptions();
}

function renderNavigation() {
  if (!["log", "calendar", "summary", "backup"].includes(activeView)) activeView = "log";
  $$('[data-view]').forEach(view => {
    const isActive = view.dataset.view === activeView;
    view.classList.toggle("is-active", isActive);
    view.hidden = !isActive;
  });
  $$('[data-view-target]').forEach(button => button.classList.toggle("is-active", button.dataset.viewTarget === activeView));
}

function metricValue(value, unit, unavailable) {
  return unavailable && value === 0 ? `—` : `${compactNumber(value)}<small>${unit}</small>`;
}

function renderDay() {
  const day = getDay(data, selectedDate);
  const totals = dayTotals(day);
  const selected = parseDate(selectedDate);
  const isToday = selectedDate === todayISO();
  $('#date-eyebrow').textContent = isToday ? "今天" : "历史记录";
  $('#selected-date-label').textContent = isToday ? `${formatShortDate(selectedDate)} · 今天` : formatShortDate(selectedDate);
  $('#selected-weekday').textContent = weekdays[selected.getDay()];
  $('#date-picker').value = selectedDate;
  $('#date-picker').max = todayISO();
  $('#next-day').disabled = selectedDate >= todayISO();
  $('#next-day').style.opacity = selectedDate >= todayISO() ? ".35" : "1";
  $('#day-metrics').innerHTML = [
    ["喝水", `${compactNumber(totals.hydrationMl)}<small> / ${compactNumber(data.settings.hydrationTargetMl)} ml</small>`, "hydration"],
    ["咖啡", `${totals.coffeeCount}<small> 杯</small>`, "coffee"],
    ["训练", metricValue(totals.duration, " min", day.sessions.length > 0 && !day.sessions.some(item => item.durationMin != null)), ""]
  ].map(([label, value, action]) => action
    ? `<button class="metric-card metric-action" type="button" data-open-${action}><span>${label}</span><strong>${value}</strong><i aria-hidden="true">＋</i></button>`
    : `<div class="metric-card"><span>${label}</span><strong>${value}</strong></div>`).join("");
  renderMeals(day.meals);
  renderSessions(day.sessions);
}

function renderCalendar() {
  const [year, month] = calendarMonth.split("-").map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const start = new Date(year, month - 1, 1 - ((firstDay.getDay() + 6) % 7));
  const currentMonth = todayISO().slice(0, 7);
  $('#calendar-month-label').textContent = `${year}年 ${month}月`;
  $('#calendar-next-month').disabled = calendarMonth >= currentMonth;
  $('#calendar-next-month').style.opacity = calendarMonth >= currentMonth ? ".35" : "1";

  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const iso = toISO(date);
    const day = getDay(data, iso);
    const hasFood = day.meals.length > 0;
    const hasTraining = day.sessions.length > 0;
    const outside = date.getMonth() !== month - 1;
    const future = iso > todayISO();
    const markers = `${hasTraining ? '<i class="calendar-dot training" title="有训练"></i>' : ""}${hasFood ? '<i class="calendar-dot food" title="有饮食"></i>' : ""}`;
    const status = [hasTraining ? "有训练" : "", hasFood ? "有饮食" : ""].filter(Boolean).join("、") || "无记录";
    cells.push(`<button class="calendar-day${outside ? " is-outside" : ""}${iso === todayISO() ? " is-today" : ""}${iso === selectedDate ? " is-selected" : ""}${hasFood ? " has-food" : ""}" type="button" data-calendar-date="${iso}" aria-label="${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日，${status}" ${future ? "disabled" : ""}><span>${date.getDate()}</span><b>${markers}</b></button>`);
  }
  $('#calendar-grid').innerHTML = cells.join("");
}

function shiftCalendarMonth(amount) {
  const [year, month] = calendarMonth.split("-").map(Number);
  const target = new Date(year, month - 1 + amount, 1);
  calendarMonth = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`;
  renderCalendar();
}

function openCalendar() {
  calendarMonth = selectedDate.slice(0, 7);
  activeView = "calendar";
  history.replaceState(null, "", "#calendar");
  renderNavigation();
  renderCalendar();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openLogDate(date) {
  selectedDate = date;
  activeView = "log";
  history.replaceState(null, "", "#log");
  renderNavigation();
  renderDay();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderMeals(meals) {
  const container = $('#food-list');
  if (!meals.length) {
    container.innerHTML = `<div class="empty-state"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 3v8a3 3 0 0 0 3 3V3M8.5 14v7M16 3v18M16 3c3 2 3 7 0 9" /></svg><p>还没有饮食记录，先记下这一顿。</p></div>`;
    return;
  }
  const order = ["breakfast", "lunch", "dinner", "snack"];
  container.innerHTML = order.map(type => {
    const items = sortByTime(meals.filter(item => item.mealType === type));
    if (!items.length) return "";
    const cards = items.map(item => {
      const meta = [item.portion, item.proteinG != null ? `蛋白质 ${compactNumber(item.proteinG)}g` : "", item.note].filter(Boolean).join(" · ") || "点击补充详情";
      const value = item.calories != null ? `<strong>${compactNumber(item.calories)}</strong><span>kcal</span>` : `<strong>—</strong><span>kcal</span>`;
      return `<button class="entry-card" type="button" data-edit-food="${escapeHTML(item.id)}"><span class="entry-time">${escapeHTML(item.time)}</span><span class="entry-body"><strong>${escapeHTML(item.name)}</strong><span>${escapeHTML(meta)}</span></span><span class="entry-value">${value}</span></button>`;
    }).join("");
    return `<div class="entry-group"><p class="group-title">${mealLabels[type]}</p><div class="entry-list">${cards}</div></div>`;
  }).join("");
}

function renderSessions(sessions) {
  const container = $('#session-list');
  if (!sessions.length) {
    container.innerHTML = `<div class="empty-state"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12" /></svg><p>今天还没有训练，休息日也没关系。</p></div>`;
    return;
  }
  container.innerHTML = `<div class="entry-list">${sortByTime(sessions, "startTime").map(session => {
    const names = session.exercises.map(item => item.name);
    const title = names.length ? names.slice(0, 2).join("、") + (names.length > 2 ? ` 等 ${names.length} 个动作` : "") : "热身训练";
    const setCount = session.exercises.reduce((sum, item) => sum + item.sets.length, 0);
    const meta = [session.warmups.length ? `${session.warmups.length} 个热身` : "", session.exercises.length ? `${session.exercises.length} 个正式动作` : "", session.legacySource ? "由 V0.1 迁移" : ""].filter(Boolean).join(" · ");
    const value = session.durationMin != null ? `<strong>${compactNumber(session.durationMin)}</strong><span>分钟</span>` : `<strong>${setCount}</strong><span>组</span>`;
    return `<button class="entry-card session-card" type="button" data-view-session="${escapeHTML(session.id)}"><span class="entry-time">${escapeHTML(session.startTime)}</span><span class="entry-body"><strong>${escapeHTML(title)}</strong><span>${escapeHTML(meta || session.note || "点击查看训练详情")}</span></span><span class="entry-value">${value}</span></button>`;
  }).join("")}</div>`;
}

function openSessionDetail(sessionOrId) {
  const session = typeof sessionOrId === "string" ? findSession(sessionOrId) : sessionOrId;
  if (!session) return;
  const setCount = session.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
  const duration = session.durationMin != null ? `${compactNumber(session.durationMin)} min` : `${setCount} 组`;
  const warmups = session.warmups.length
    ? `<section class="detail-section"><div class="detail-section-heading"><p class="section-kicker">WARM UP</p><h3>热身</h3></div><div class="detail-warmups">${session.warmups.map(item => {
      const amount = item.mode === "duration"
        ? (item.durationMin != null ? `${compactNumber(item.durationMin)} min` : "未记录时长")
        : (item.reps != null ? `${compactNumber(item.reps)} 次` : "未记录次数");
      return `<div><strong>${escapeHTML(item.name)}</strong><span>${escapeHTML(amount)}${item.note ? ` · ${escapeHTML(item.note)}` : ""}</span></div>`;
    }).join("")}</div></section>`
    : "";
  const exercises = session.exercises.length
    ? `<section class="detail-section"><div class="detail-section-heading"><p class="section-kicker">WORK SETS</p><h3>正式训练</h3></div><div class="detail-exercises">${session.exercises.map(exercise => `
      <article class="detail-exercise">
        <div class="detail-exercise-title"><h4>${escapeHTML(exercise.name)}</h4><span>${exercise.sets.length} 组</span></div>
        <ul>${exercise.sets.length ? exercise.sets.map(set => `<li>${escapeHTML(setLabel(set))}</li>`).join("") : "<li>未记录组数据</li>"}</ul>
        ${exercise.cues ? `<div class="detail-note"><b>动作要点</b><p>${escapeHTML(exercise.cues)}</p></div>` : ""}
        ${exercise.coachCorrection ? `<div class="detail-note correction"><b>本次教练纠正</b><p>${escapeHTML(exercise.coachCorrection)}</p></div>` : ""}
      </article>`).join("")}</div></section>`
    : "";
  $('#session-detail-content').innerHTML = `
    <div class="detail-hero"><div><strong>${formatShortDate(session.date)} · ${escapeHTML(session.startTime)}</strong><span>${weekdays[parseDate(session.date).getDay()]}</span></div><b>${escapeHTML(duration)}</b></div>
    ${warmups}${exercises}
    ${session.note ? `<section class="session-overall-note"><b>整体训练备注</b><p>${escapeHTML(session.note)}</p></section>` : ""}`;
  $('#edit-session-from-detail').dataset.sessionId = session.id;
  $('#share-session-from-detail').dataset.sessionId = session.id;
  $('#session-detail-dialog').showModal();
}

const SHARE_STYLE = {
  width: 900,
  padding: 56,
  ink: "#171914",
  muted: "#686b61",
  paper: "#f4f2eb",
  card: "#fffef9",
  line: "#dcd9cf",
  accent: "#c7f36b",
  green: "#718f35",
  orange: "#a05f2d"
};

const shareFormatLabels = {
  detailed: "详细版",
  compact: "简版",
  text: "纯文字版"
};

function canvasFont(size, weight = 400) {
  return `${weight} ${size}px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif`;
}

function setCanvasFont(context, size, weight = 400) {
  context.font = canvasFont(size, weight);
  context.textBaseline = "top";
}

function wrapCanvasText(context, value, maxWidth) {
  const paragraphs = String(value || "").replace(/\r/g, "").split("\n");
  const lines = [];
  paragraphs.forEach(paragraph => {
    if (!paragraph) {
      lines.push("");
      return;
    }
    let line = "";
    for (const character of [...paragraph]) {
      const candidate = line + character;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line.trimEnd());
        line = character.trimStart();
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line.trimEnd());
  });
  return lines.length ? lines : [""];
}

function drawCanvasLines(context, lines, x, y, lineHeight) {
  lines.forEach((line, index) => context.fillText(line, x, y + (index * lineHeight)));
}

function roundedCanvasRect(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function buildSessionShareBlocks(session, format, context) {
  const blocks = [];
  const contentWidth = SHARE_STYLE.width - (SHARE_STYLE.padding * 2);
  const addSection = (kicker, title) => blocks.push({ type: "section", kicker, title, height: 72 });

  addSection("WORK SETS", "正式训练");
  if (!session.exercises.length) {
    blocks.push({ type: "empty", height: 92 });
  }

  session.exercises.forEach((exercise, index) => {
    setCanvasFont(context, format === "text" ? 27 : 30, 800);
    const nameLines = wrapCanvasText(context, `${format === "text" ? `${index + 1}. ` : ""}${exercise.name}`, contentWidth - (format === "text" ? 0 : 190));
    setCanvasFont(context, 24, format === "text" ? 500 : 700);
    const setLines = wrapCanvasText(context, exercise.sets.length ? exercise.sets.map(set => setLabel(set)).join(" · ") : "未记录组数据", contentWidth - (format === "text" ? 0 : 60));
    const block = {
      type: format === "text" ? "textExercise" : "exercise",
      nameLines,
      setLines,
      setCount: exercise.sets.length,
      height: 34 + (nameLines.length * 39) + 12 + (setLines.length * 34) + 30
    };
    if (format === "detailed") {
      const previous = findExerciseHistory(data, exercise.name, {
        exerciseId: exercise.exerciseId || undefined,
        excludeSessionId: session.id,
        beforeDate: session.date,
        beforeTime: session.startTime || "23:59"
      })[0];
      if (previous) {
        setCanvasFont(context, 22, 600);
        block.previousLabel = `上次 · ${formatShortDate(previous.date)}`;
        block.previousLines = wrapCanvasText(context, previous.exercise.sets.length
          ? previous.exercise.sets.map(set => setLabel(set)).join(" · ")
          : "未记录组数据", contentWidth - 60);
        block.height += 48 + (block.previousLines.length * 31);
      }
      if (exercise.coachCorrection) {
        setCanvasFont(context, 22, 500);
        block.correctionLines = wrapCanvasText(context, exercise.coachCorrection, contentWidth - 60);
        block.height += 48 + (block.correctionLines.length * 31);
      }
    }
    blocks.push(block);
  });

  if (format === "detailed" && session.note) {
    setCanvasFont(context, 22, 500);
    const lines = wrapCanvasText(context, session.note, contentWidth - 54);
    blocks.push({ type: "sessionNote", lines, height: 78 + (lines.length * 31) });
  }
  return blocks;
}

function drawSessionShareHeader(context, session, format) {
  const { width, padding, ink, muted, card, accent } = SHARE_STYLE;
  const setCount = session.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
  const duration = session.durationMin != null ? `${compactNumber(session.durationMin)} min` : "未记录时长";
  const summary = `${session.exercises.length} 个动作 · ${setCount} 组 · ${duration}`;
  const dateLine = `${formatShortDate(session.date)} · ${weekdays[parseDate(session.date).getDay()]} · ${session.startTime || "未记录时间"}`;

  if (format === "text") {
    context.fillStyle = ink;
    setCanvasFont(context, 19, 800);
    context.fillText("FITNESS LOG", padding, 56);
    setCanvasFont(context, 48, 850);
    context.fillText("训练记录", padding, 92);
    context.fillStyle = accent;
    context.fillRect(padding, 157, 92, 8);
    context.fillStyle = ink;
    setCanvasFont(context, 25, 700);
    context.fillText(dateLine, padding, 192);
    context.fillStyle = muted;
    setCanvasFont(context, 22, 500);
    context.fillText(summary, padding, 231);
    return 298;
  }

  const heroX = 40;
  const heroY = 40;
  const heroWidth = width - 80;
  const heroHeight = 210;
  context.fillStyle = ink;
  roundedCanvasRect(context, heroX, heroY, heroWidth, heroHeight, 34);
  context.fill();
  context.fillStyle = accent;
  setCanvasFont(context, 18, 850);
  context.fillText("FITNESS LOG / TRAINING", heroX + 36, heroY + 33);
  const badgeText = shareFormatLabels[format];
  setCanvasFont(context, 18, 800);
  const badgeWidth = context.measureText(badgeText).width + 34;
  roundedCanvasRect(context, heroX + heroWidth - badgeWidth - 30, heroY + 25, badgeWidth, 42, 21);
  context.fillStyle = accent;
  context.fill();
  context.fillStyle = ink;
  context.fillText(badgeText, heroX + heroWidth - badgeWidth - 13, heroY + 36);
  context.fillStyle = card;
  setCanvasFont(context, 42, 850);
  context.fillText(dateLine, heroX + 36, heroY + 82);
  context.fillStyle = "#c3c5bd";
  setCanvasFont(context, 24, 550);
  context.fillText(summary, heroX + 36, heroY + 150);
  return 290;
}

function drawSessionShareBlock(context, block, y, format) {
  const { width, padding, ink, muted, card, line, green, orange } = SHARE_STYLE;
  const contentWidth = width - (padding * 2);
  if (block.type === "section") {
    context.fillStyle = green;
    setCanvasFont(context, 17, 850);
    context.fillText(block.kicker, padding, y + 5);
    context.fillStyle = ink;
    setCanvasFont(context, 34, 850);
    context.fillText(block.title, padding, y + 30);
    return;
  }
  if (block.type === "empty") {
    context.fillStyle = muted;
    setCanvasFont(context, 23, 500);
    context.fillText("未记录正式动作", padding, y + 28);
    return;
  }
  if (block.type === "textExercise") {
    context.fillStyle = ink;
    setCanvasFont(context, 27, 800);
    drawCanvasLines(context, block.nameLines, padding, y + 8, 39);
    const setsY = y + 20 + (block.nameLines.length * 39);
    context.fillStyle = muted;
    setCanvasFont(context, 24, 500);
    drawCanvasLines(context, block.setLines, padding, setsY, 34);
    context.strokeStyle = line;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(padding, y + block.height - 6);
    context.lineTo(width - padding, y + block.height - 6);
    context.stroke();
    return;
  }

  context.fillStyle = card;
  context.strokeStyle = line;
  context.lineWidth = 2;
  roundedCanvasRect(context, padding, y, contentWidth, block.height - 10, 24);
  context.fill();
  context.stroke();
  const innerX = padding + 27;

  if (block.type === "sessionNote") {
    context.fillStyle = green;
    setCanvasFont(context, 17, 850);
    context.fillText("整体训练备注", innerX, y + 23);
    context.fillStyle = muted;
    setCanvasFont(context, 22, 500);
    drawCanvasLines(context, block.lines, innerX, y + 58, 31);
    return;
  }

  context.fillStyle = ink;
  setCanvasFont(context, 30, 800);
  drawCanvasLines(context, block.nameLines, innerX, y + 25, 39);
  const badgeText = `${block.setCount} 组`;
  setCanvasFont(context, 17, 800);
  const badgeWidth = context.measureText(badgeText).width + 28;
  roundedCanvasRect(context, width - padding - badgeWidth - 23, y + 22, badgeWidth, 36, 18);
  context.fillStyle = "#eaf4d9";
  context.fill();
  context.fillStyle = "#587d1b";
  context.fillText(badgeText, width - padding - badgeWidth - 9, y + 31);

  let cursorY = y + 37 + (block.nameLines.length * 39);
  context.fillStyle = ink;
  setCanvasFont(context, 24, 700);
  drawCanvasLines(context, block.setLines, innerX, cursorY, 34);
  cursorY += (block.setLines.length * 34) + 20;

  if (block.previousLines) {
    context.strokeStyle = line;
    context.beginPath();
    context.moveTo(innerX, cursorY - 2);
    context.lineTo(width - padding - 27, cursorY - 2);
    context.stroke();
    context.fillStyle = green;
    setCanvasFont(context, 16, 850);
    context.fillText(block.previousLabel, innerX, cursorY + 15);
    context.fillStyle = muted;
    setCanvasFont(context, 22, 600);
    drawCanvasLines(context, block.previousLines, innerX, cursorY + 44, 31);
    cursorY += 48 + (block.previousLines.length * 31);
  }
  if (block.correctionLines) {
    context.strokeStyle = line;
    context.beginPath();
    context.moveTo(innerX, cursorY - 2);
    context.lineTo(width - padding - 27, cursorY - 2);
    context.stroke();
    context.fillStyle = orange;
    setCanvasFont(context, 16, 850);
    context.fillText("本次教练纠正", innerX, cursorY + 15);
    context.fillStyle = muted;
    setCanvasFont(context, 22, 500);
    drawCanvasLines(context, block.correctionLines, innerX, cursorY + 44, 31);
  }
}

function drawSessionShareCanvas(session, format) {
  const canvas = $('#session-share-canvas');
  canvas.width = SHARE_STYLE.width;
  canvas.height = 1;
  let context = canvas.getContext("2d");
  const blocks = buildSessionShareBlocks(session, format, context);
  const headerHeight = format === "text" ? 298 : 290;
  const contentHeight = blocks.reduce((sum, block) => sum + block.height, 0);
  canvas.height = Math.ceil(headerHeight + contentHeight + 104);
  context = canvas.getContext("2d");
  context.fillStyle = SHARE_STYLE.paper;
  context.fillRect(0, 0, canvas.width, canvas.height);
  let y = drawSessionShareHeader(context, session, format);
  blocks.forEach(block => {
    drawSessionShareBlock(context, block, y, format);
    y += block.height;
  });
  context.fillStyle = SHARE_STYLE.muted;
  setCanvasFont(context, 18, 600);
  context.fillText("FITNESS LOG · 训练记录", SHARE_STYLE.padding, canvas.height - 62);
  context.textAlign = "right";
  context.fillText(session.date, SHARE_STYLE.width - SHARE_STYLE.padding, canvas.height - 62);
  context.textAlign = "left";
  return canvas;
}

function renderSessionSharePreview() {
  const session = findSession(shareSessionId);
  if (!session) return;
  const canvas = drawSessionShareCanvas(session, shareFormat);
  const button = $('#save-session-share');
  const token = ++shareRenderToken;
  shareImageBlob = null;
  button.disabled = true;
  button.textContent = "正在生成…";
  canvas.toBlob(blob => {
    if (token !== shareRenderToken) return;
    if (!blob) {
      button.textContent = "生成失败，请重试";
      return;
    }
    shareImageBlob = blob;
    button.disabled = false;
    button.textContent = navigator.share ? "保存 / 分享图片" : "下载 PNG 图片";
  }, "image/png");
}

function openSessionShareDialog(sessionId) {
  const session = findSession(sessionId);
  if (!session) return;
  shareSessionId = session.id;
  shareFormat = "detailed";
  $$('.share-format-card').forEach(button => {
    const active = button.dataset.shareFormat === shareFormat;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-checked", String(active));
  });
  $('#session-share-dialog').showModal();
  renderSessionSharePreview();
}

function saveSessionShareImage() {
  const session = findSession(shareSessionId);
  if (!session || !shareImageBlob) {
    showToast("图片还在生成，请稍等");
    return;
  }
  const suffix = { detailed: "detailed", compact: "compact", text: "text" }[shareFormat];
  const fileName = `fitness-log-training-${session.date}-${suffix}.png`;
  const file = new File([shareImageBlob], fileName, { type: "image/png" });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: `${formatShortDate(session.date)} 训练记录` })
      .then(() => showToast("训练图片已分享"))
      .catch(error => {
        if (error.name !== "AbortError") {
          console.warn("系统分享失败，改用下载", error);
          downloadSessionShareImage(fileName);
        }
      });
    return;
  }
  downloadSessionShareImage(fileName);
}

function downloadSessionShareImage(fileName) {
  const url = URL.createObjectURL(shareImageBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("训练图片已下载");
}

function recentDates() {
  return Array.from({ length: 7 }, (_, index) => shiftDate(todayISO(), index - 6));
}

function renderSummary() {
  const dates = recentDates();
  const days = dates.map(date => ({ ...getDay(data, date), totals: dayTotals(getDay(data, date)) }));
  const meals = days.reduce((sum, day) => sum + day.meals.length, 0);
  const sessions = days.reduce((sum, day) => sum + day.sessions.length, 0);
  const sets = days.reduce((sum, day) => sum + day.totals.setCount, 0);
  const activeDays = days.filter(day => day.meals.length || day.sessions.length || day.hydration.length || day.coffees.length).length;
  const totalDuration = days.reduce((sum, day) => sum + day.totals.duration, 0);
  $('#summary-range').textContent = `${formatShortDate(dates[0])} — ${formatShortDate(dates[6])}`;
  $('#summary-metrics').innerHTML = [
    ["有记录天数", `${activeDays}<small> / 7 天</small>`],
    ["饮食条目", `${meals}<small> 条</small>`],
    ["训练场次", `${sessions}<small> 次</small>`],
    ["正式训练组", `${sets}<small> 组</small>`],
    ["训练总时长", `${compactNumber(totalDuration)}<small> min</small>`]
  ].map(([label, value]) => `<div class="metric-card"><span>${label}</span><strong>${value}</strong></div>`).join("");

  const config = {
    calories: { key: "calories", unit: "kcal", title: "热量仅统计手动填写过的条目" },
    protein: { key: "protein", unit: "g", title: "蛋白质仅统计手动填写过的条目" },
    duration: { key: "duration", unit: "min", title: "训练时长仅统计手动填写过的场次" }
  }[chartMetric];
  const values = days.map(day => day.totals[config.key]);
  const max = Math.max(...values, 1);
  $('#bar-chart').innerHTML = days.map((day, index) => {
    const value = values[index];
    const height = value ? Math.max(8, Math.round((value / max) * 150)) : 3;
    const date = parseDate(day.date);
    return `<div class="bar-column ${day.date === todayISO() ? "is-today" : ""}" title="${formatShortDate(day.date)}：${compactNumber(value)} ${config.unit}"><span class="bar-value">${value ? compactNumber(value) : ""}</span><span class="bar" style="height:${height}px"></span><span class="bar-label">${date.getMonth() + 1}/${date.getDate()}</span></div>`;
  }).join("");
  $('#chart-note').textContent = config.title;

  $('#recap-list').innerHTML = [...days].reverse().map(day => {
    const hasData = day.meals.length || day.sessions.length || day.hydration.length || day.coffees.length;
    const training = day.sessions.length
      ? day.sessions.map((session, index) => {
        const count = session.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
        const label = day.sessions.length === 1 ? `1 次训练 · ${count} 组` : `${escapeHTML(session.startTime)} 训练 ${index + 1} · ${count} 组`;
        return `<button class="recap-training" type="button" data-view-session="${escapeHTML(session.id)}">${label}</button>`;
      }).join('<span class="recap-separator"> · </span>')
      : "无训练";
    const wellness = `${compactNumber(day.totals.hydrationMl)}ml 水 · ${day.totals.coffeeCount} 杯咖啡`;
    return `<div class="recap-row"><div class="recap-date"><strong>${formatShortDate(day.date)}</strong><span>${weekdays[parseDate(day.date).getDay()]}</span></div><div class="recap-main">${hasData ? `<span><strong>${day.meals.length}</strong> 条饮食 · ${training}</span><small>${wellness}</small>` : "无记录"}</div><div class="recap-tail">${day.totals.duration ? `${compactNumber(day.totals.duration)} min` : ""}</div></div>`;
  }).join("");
  renderExerciseHistory();
}

function renderExerciseOptions() {
  const names = getExerciseNames(data);
  $('#exercise-name-options').innerHTML = names.map(name => `<option value="${escapeHTML(name)}"></option>`).join("");
  const select = $('#exercise-history-select');
  const previous = selectedHistoryExercise || select.value;
  select.innerHTML = names.length
    ? names.map(name => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join("")
    : `<option value="">暂无动作</option>`;
  selectedHistoryExercise = names.includes(previous) ? previous : (names[0] || "");
  select.value = selectedHistoryExercise;
}

function renderExerciseHistory() {
  const container = $('#exercise-history');
  const names = getExerciseNames(data);
  if (!names.length) {
    container.innerHTML = `<div class="empty-state compact-empty"><p>记录第一个正式动作后，这里会显示长期表现。</p></div>`;
    return;
  }
  if (!selectedHistoryExercise || !names.includes(selectedHistoryExercise)) selectedHistoryExercise = names[0];
  const history = findExerciseHistory(data, selectedHistoryExercise);
  const weights = history.map(item => maxWeight(item.exercise)).filter(value => value != null);
  const best = weights.length ? Math.max(...weights) : null;
  container.innerHTML = `
    <div class="history-overview"><div><span>训练记录</span><strong>${history.length}<small> 次</small></strong></div><div><span>历史最高重量</span><strong>${best != null ? `${compactNumber(best)}<small> kg</small>` : "—"}</strong></div></div>
    <div class="history-list">${history.map(item => historyCardHTML(item, best)).join("")}</div>`;
}

function historyCardHTML(item, best) {
  const exerciseMax = maxWeight(item.exercise);
  const sets = item.exercise.sets.length ? item.exercise.sets.map(set => setLabel(set)).join(" · ") : "未记录组数据";
  const isBest = best != null && exerciseMax === best;
  return `<article class="history-card"><header><div><strong>${formatShortDate(item.date)}</strong><span>${escapeHTML(item.startTime)}</span></div>${isBest ? `<b>最高重量</b>` : exerciseMax != null ? `<em>最高 ${compactNumber(exerciseMax)}kg</em>` : ""}</header><p class="set-line">${escapeHTML(sets)}</p>${item.exercise.cues ? `<div class="history-note"><span>动作要点</span><p>${escapeHTML(item.exercise.cues)}</p></div>` : ""}${item.exercise.coachCorrection ? `<div class="history-note correction"><span>教练纠正</span><p>${escapeHTML(item.exercise.coachCorrection)}</p></div>` : ""}</article>`;
}

function renderBackup() {
  const days = Object.values(data.days);
  const meals = days.reduce((sum, day) => sum + day.meals.length, 0);
  const sessions = days.reduce((sum, day) => sum + day.sessions.length, 0);
  const exercises = days.reduce((sum, day) => sum + day.sessions.reduce((subtotal, session) => subtotal + session.exercises.length, 0), 0);
  const hydration = days.reduce((sum, day) => sum + (day.hydration || []).length, 0);
  const coffees = days.reduce((sum, day) => sum + (day.coffees || []).length, 0);
  $('#data-footprint').textContent = `当前共有 ${days.length} 个记录日、${meals} 条饮食、${sessions} 次训练、${exercises} 个正式动作、${hydration} 条喝水、${coffees} 杯咖啡。`;
}

function openHydrationDialog() {
  $('#hydration-date').textContent = `${formatShortDate(selectedDate)} · ${weekdays[parseDate(selectedDate).getDay()]}`;
  $('#hydration-time').value = currentTime();
  $('#hydration-custom-ml').value = "";
  renderHydrationDialog();
  $('#hydration-dialog').showModal();
}

function renderHydrationDialog() {
  const day = getDay(data, selectedDate);
  const total = dayTotals(day).hydrationMl;
  const target = data.settings.hydrationTargetMl;
  const progress = target ? Math.min(100, Math.round((total / target) * 100)) : 0;
  const state = progress >= 100 ? 100 : progress >= 75 ? 75 : progress >= 50 ? 50 : progress >= 25 ? 25 : 0;
  const progressCard = $('#hydration-progress');
  progressCard.style.setProperty("--fill-ratio", String(progress / 100));
  progressCard.dataset.progressState = String(state);
  progressCard.dataset.empty = String(total === 0);
  progressCard.setAttribute("aria-label", `今日喝水 ${compactNumber(total)} 毫升，目标 ${compactNumber(target)} 毫升，已完成 ${progress}%`);
  $('#hydration-total').innerHTML = `${compactNumber(total)} <small>/ ${compactNumber(target)} ml</small>`;
  $('#hydration-percent').textContent = progress >= 100 ? "今日目标已完成 ✓" : `已完成 ${progress}%`;
  $('#hydration-record-count').textContent = `${day.hydration.length} 条`;
  $('#hydration-record-list').innerHTML = day.hydration.length
    ? `<div class="quick-record-list">${sortByTime(day.hydration).reverse().map(item => `<div class="quick-record"><time>${escapeHTML(item.time)}</time><div><strong>喝水 ${compactNumber(item.ml)} ml</strong><span>已计入今日累计</span></div><button type="button" data-delete-water="${escapeHTML(item.id)}" aria-label="删除 ${escapeHTML(item.time)} 的喝水记录">删除</button></div>`).join("")}</div>`
    : `<div class="quick-empty">还没有记录，点上面的容量就能快速添加。</div>`;
}

function addHydrationRecord(amount) {
  const item = normalizeHydration({
    id: makeId("water"),
    date: selectedDate,
    time: $('#hydration-time').value || currentTime(),
    ml: amount,
    createdAt: new Date().toISOString()
  }, selectedDate);
  if (!item) {
    alert("请输入 1—10000 ml 的有效容量。");
    return;
  }
  ensureDay(selectedDate).hydration.push(item);
  if (saveData()) {
    renderHydrationDialog();
    $('#hydration-custom-ml').value = "";
    showToast(`已记录 ${compactNumber(item.ml)} ml`);
  }
}

function openCoffeeDialog() {
  $('#coffee-date').textContent = `${formatShortDate(selectedDate)} · ${weekdays[parseDate(selectedDate).getDay()]}`;
  $('#coffee-form').reset();
  $('#coffee-time').value = currentTime();
  $('#coffee-custom-field').hidden = true;
  $('#coffee-custom-capacity').required = false;
  renderCoffeeDialog();
  $('#coffee-dialog').showModal();
}

function renderCoffeeDialog() {
  const day = getDay(data, selectedDate);
  $('#coffee-count').textContent = `${day.coffees.length} 杯`;
  $('#coffee-record-count').textContent = `${day.coffees.length} 条`;
  $('#coffee-record-list').innerHTML = day.coffees.length
    ? `<div class="quick-record-list">${sortByTime(day.coffees).reverse().map(item => {
      const capacity = item.capacityMl != null ? `${compactNumber(item.capacityMl)} ml` : "未记录容量";
      return `<div class="quick-record"><time>${escapeHTML(item.time)}</time><div><strong>${escapeHTML(coffeeLabels[item.type] || "其他")}</strong><span>${escapeHTML(capacity)}</span></div><button type="button" data-delete-coffee="${escapeHTML(item.id)}" aria-label="删除 ${escapeHTML(item.time)} 的咖啡记录">删除</button></div>`;
    }).join("")}</div>`
    : `<div class="quick-empty">今天还没有咖啡记录。</div>`;
}

function saveCoffee(event) {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  const capacityChoice = $('#coffee-capacity').value;
  const customCapacity = $('#coffee-custom-capacity').value;
  if (capacityChoice === "custom" && !customCapacity) {
    alert("请输入自定义容量，或选择“不记录”。");
    return;
  }
  const item = normalizeCoffee({
    id: makeId("coffee"),
    date: selectedDate,
    time: $('#coffee-time').value,
    type: $('#coffee-type').value,
    capacityMl: capacityChoice === "custom" ? customCapacity : capacityChoice,
    createdAt: new Date().toISOString()
  }, selectedDate);
  if (!item) return;
  ensureDay(selectedDate).coffees.push(item);
  if (saveData()) {
    const nextTime = currentTime();
    $('#coffee-form').reset();
    $('#coffee-time').value = nextTime;
    $('#coffee-custom-field').hidden = true;
    $('#coffee-custom-capacity').required = false;
    renderCoffeeDialog();
    showToast(`已记录 1 杯${coffeeLabels[item.type]}`);
  }
}

function deleteQuickRecord(key, id) {
  const day = ensureDay(selectedDate);
  day[key] = day[key].filter(item => item.id !== id);
  removeEmptyDay(selectedDate);
  if (saveData()) {
    if (key === "hydration") renderHydrationDialog();
    if (key === "coffees") renderCoffeeDialog();
    showToast("记录已删除");
  }
}

function openFoodDialog(item = null) {
  $('#food-form').reset();
  $('#food-id').value = item?.id || "";
  $('#food-dialog-title').textContent = item ? "编辑饮食" : "记录饮食";
  $('#delete-food').hidden = !item;
  $('#food-date').value = item ? findMealLocation(item.id)?.date || selectedDate : selectedDate;
  $('#food-date').max = todayISO();
  $('#food-meal').value = item?.mealType || suggestedMeal();
  $('#food-time').value = item?.time || currentTime();
  $('#food-name').value = item?.name || "";
  $('#food-portion').value = item?.portion || "";
  $('#food-calories').value = item?.calories ?? "";
  $('#food-protein').value = item?.proteinG ?? "";
  $('#food-note').value = item?.note || "";
  $('#food-dialog').showModal();
  setTimeout(() => $('#food-name').focus(), 80);
}

function suggestedMeal() {
  const hour = new Date().getHours();
  if (hour < 10) return "breakfast";
  if (hour < 15) return "lunch";
  if (hour < 21) return "dinner";
  return "snack";
}

function saveFood(event) {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  const id = $('#food-id').value || makeId("meal");
  const targetDate = $('#food-date').value || selectedDate;
  const existingLocation = findMealLocation(id);
  const item = normalizeMeal({
    id,
    mealType: $('#food-meal').value,
    time: $('#food-time').value,
    name: $('#food-name').value,
    portion: $('#food-portion').value,
    calories: $('#food-calories').value,
    proteinG: $('#food-protein').value,
    note: $('#food-note').value,
    createdAt: existingLocation?.item.createdAt || new Date().toISOString()
  });
  const snapshot = JSON.stringify(data);
  removeRecordEverywhere("meals", id);
  ensureDay(targetDate).meals.push(item);
  if (saveData()) {
    selectedDate = targetDate;
    closeDialog($('#food-dialog'));
    renderDay();
    showToast(existingLocation ? (existingLocation.date === targetDate ? "饮食记录已更新" : `饮食记录已移动到 ${formatShortDate(targetDate)}`) : "饮食记录已保存");
  } else {
    data = JSON.parse(snapshot);
  }
}

function findMealLocation(id) {
  if (!id) return null;
  for (const [date, day] of Object.entries(data.days)) {
    const item = day.meals.find(meal => meal.id === id);
    if (item) return { date, item };
  }
  return null;
}

function openSessionDialog(session = null) {
  $('#session-form').reset();
  $('#session-id').value = session?.id || "";
  $('#session-dialog-title').textContent = session ? "编辑训练" : "记录训练";
  $('#delete-session').hidden = !session;
  $('#session-date').value = session?.date || selectedDate;
  $('#session-date').max = todayISO();
  $('#session-start-time').value = session?.startTime || currentTime();
  $('#session-duration').value = session?.durationMin ?? "";
  $('#session-note').value = session?.note || "";
  $('#warmup-editor-list').innerHTML = "";
  $('#exercise-editor-list').innerHTML = "";
  (session?.warmups || []).forEach(item => addWarmupEditor(item));
  (session?.exercises || []).forEach(item => addExerciseEditor(item));
  if (!session?.exercises?.length) addExerciseEditor();
  refreshEditorCounts();
  $('#session-dialog').showModal();
}

function addWarmupEditor(item = {}) {
  const row = document.createElement("div");
  row.className = "warmup-editor";
  row.dataset.id = item.id || makeId("warmup");
  const mode = item.mode === "duration" ? "duration" : "reps";
  row.innerHTML = `<div class="warmup-name-row"><label class="field"><span>热身动作</span><input data-warmup-field="name" type="text" maxlength="80" placeholder="例如：弹力带肩外旋" value="${escapeHTML(item.name || "")}" /></label><button class="row-delete" type="button" data-remove-warmup aria-label="删除热身动作">×</button></div><div class="warmup-value-row"><label class="field"><span>记录方式</span><select data-warmup-field="mode"><option value="reps" ${mode === "reps" ? "selected" : ""}>按次数</option><option value="duration" ${mode === "duration" ? "selected" : ""}>按时长</option></select></label><label class="field warmup-reps" ${mode === "duration" ? "hidden" : ""}><span>次数 reps</span><input data-warmup-field="reps" type="number" min="0" max="5000" step="1" inputmode="numeric" placeholder="—" value="${item.reps ?? ""}" /></label><label class="field warmup-duration" ${mode === "reps" ? "hidden" : ""}><span>时长 min</span><input data-warmup-field="duration" type="number" min="0" max="1440" step="0.5" inputmode="decimal" placeholder="—" value="${item.durationMin ?? ""}" /></label></div><label class="field compact-field"><span>备注</span><input data-warmup-field="note" type="text" maxlength="200" placeholder="可选" value="${escapeHTML(item.note || "")}" /></label>`;
  $('#warmup-editor-list').append(row);
  refreshEditorCounts();
}

function addExerciseEditor(item = {}) {
  const exercise = document.createElement("details");
  exercise.className = "exercise-editor";
  exercise.open = true;
  exercise.dataset.id = item.id || makeId("exercise");
  exercise.dataset.exerciseId = item.exerciseId || "";
  exercise.dataset.libraryNameKey = exerciseKey(item.name || "");
  exercise.innerHTML = `<summary><span class="exercise-summary-name">${escapeHTML(item.name || "新动作")}</span><b class="exercise-set-count">0 组</b></summary><div class="exercise-editor-body"><div class="field exercise-name-field"><label><span>动作名称 <em>优先选择历史动作</em></span><input data-exercise-field="name" type="text" required maxlength="80" autocomplete="off" placeholder="输入“杠”查找历史动作" value="${escapeHTML(item.name || "")}" /></label><div class="exercise-suggestions" role="listbox" hidden></div></div><div class="last-performance" hidden></div><label class="field"><span>动作要点 <em>下次自动带入</em></span><textarea data-exercise-field="cues" rows="2" maxlength="1000" placeholder="例如：肩胛下沉并后收">${escapeHTML(item.cues || "")}</textarea></label><label class="field"><span>本次教练纠正 <em>仅属于本次</em></span><textarea data-exercise-field="correction" rows="2" maxlength="1000" placeholder="例如：第三组开始出现耸肩">${escapeHTML(item.coachCorrection || "")}</textarea></label><div class="sets-heading"><span>训练组</span><small>重量 kg × 次数</small></div><div class="set-editor-list"></div><button class="inline-add add-set" type="button" data-add-set>＋ 添加一组</button><button class="remove-exercise" type="button" data-remove-exercise>删除这个动作</button></div>`;
  $('#exercise-editor-list').append(exercise);
  (item.sets || []).forEach(set => addSetEditor(exercise, set, false));
  if (!item.sets?.length) addSetEditor(exercise, {}, false);
  updateExerciseEditor(exercise, false);
  refreshEditorCounts();
}

function addSetEditor(exercise, item = {}, copyPrevious = true) {
  const list = $('.set-editor-list', exercise);
  const previous = list.lastElementChild;
  const weight = item.weightKg ?? (copyPrevious && previous ? $('[data-set-field="weight"]', previous).value : "");
  const reps = item.reps ?? (copyPrevious && previous ? $('[data-set-field="reps"]', previous).value : "");
  const row = document.createElement("div");
  row.className = "set-editor";
  row.dataset.id = item.id || makeId("set");
  row.innerHTML = `<span class="set-index"></span><label><span>重量 kg</span><input data-set-field="weight" type="number" min="0" max="2000" step="0.5" inputmode="decimal" placeholder="—" value="${escapeHTML(weight)}" /></label><span class="set-times">×</span><label><span>次数</span><input data-set-field="reps" type="number" min="0" max="5000" step="1" inputmode="numeric" placeholder="—" value="${escapeHTML(reps)}" /></label><button class="row-delete" type="button" data-remove-set aria-label="删除这一组">×</button>`;
  list.append(row);
  updateSetIndexes(exercise);
}

function updateSetIndexes(exercise) {
  $$('.set-editor', exercise).forEach((row, index) => $('.set-index', row).textContent = String(index + 1));
  $('.exercise-set-count', exercise).textContent = `${$$('.set-editor', exercise).length} 组`;
}

function refreshEditorCounts() {
  if (!$('#warmup-count')) return;
  $('#warmup-count').textContent = `${$$('.warmup-editor', $('#warmup-editor-list')).length} 个动作`;
  $('#exercise-count').textContent = `${$$('.exercise-editor', $('#exercise-editor-list')).length} 个动作`;
}

function updateWarmupMode(row) {
  const mode = $('[data-warmup-field="mode"]', row).value;
  $('.warmup-reps', row).hidden = mode !== "reps";
  $('.warmup-duration', row).hidden = mode !== "duration";
}

function updateExerciseEditor(exercise, applyLibrary = true) {
  const nameInput = $('[data-exercise-field="name"]', exercise);
  const cuesInput = $('[data-exercise-field="cues"]', exercise);
  const name = nameInput.value.trim();
  $('.exercise-summary-name', exercise).textContent = name || "新动作";
  const library = findExerciseLibraryEntry(data, name);
  if (library) {
    exercise.dataset.exerciseId = library.id;
    exercise.dataset.libraryNameKey = exerciseKey(library.name);
    if (applyLibrary) cuesInput.value = library.cues || "";
  }
  renderLastPerformance(exercise, name, exercise.dataset.exerciseId);
}

function renderExerciseSuggestions(exercise, query) {
  const container = $('.exercise-suggestions', exercise);
  const matches = searchExerciseLibrary(data, query);
  if (!matches.length) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }
  container.innerHTML = matches.map(entry => `<button type="button" role="option" data-select-exercise="${escapeHTML(entry.id)}"><strong>${escapeHTML(entry.name)}</strong><span>${entry.cues ? escapeHTML(entry.cues) : `${entry.usageCount} 次历史记录`}</span></button>`).join("");
  container.hidden = false;
}

function selectLibraryExercise(exercise, id) {
  const entry = data.exerciseLibrary[id];
  if (!entry) return;
  const nameInput = $('[data-exercise-field="name"]', exercise);
  nameInput.value = entry.name;
  exercise.dataset.exerciseId = entry.id;
  exercise.dataset.libraryNameKey = exerciseKey(entry.name);
  nameInput.dataset.appliedLibraryKey = exerciseKey(entry.name);
  $('[data-exercise-field="cues"]', exercise).value = entry.cues || "";
  $('.exercise-summary-name', exercise).textContent = entry.name;
  $('.exercise-suggestions', exercise).hidden = true;
  renderLastPerformance(exercise, entry.name, entry.id);
}

function renderLastPerformance(exercise, name, exerciseId = "") {
  const container = $('.last-performance', exercise);
  const history = findExerciseHistory(data, name, {
    exerciseId: exerciseId || undefined,
    excludeSessionId: $('#session-id').value || undefined,
    beforeDate: $('#session-date').value || selectedDate,
    beforeTime: $('#session-start-time').value || "23:59"
  });
  if (!history.length) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }
  const last = history[0];
  const sets = last.exercise.sets.length ? last.exercise.sets.map(set => setLabel(set)).join(" · ") : "未记录组数据";
  container.hidden = false;
  container.innerHTML = `<div class="last-title"><strong>上次 · ${formatShortDate(last.date)}</strong><span>${escapeHTML(last.startTime)}</span></div><p>${escapeHTML(sets)}</p>${last.exercise.cues ? `<small><b>动作要点</b>${escapeHTML(last.exercise.cues)}</small>` : ""}${last.exercise.coachCorrection ? `<small class="last-correction"><b>教练纠正</b>${escapeHTML(last.exercise.coachCorrection)}</small>` : ""}`;
}

function setLabel(set) {
  const weight = set.weightKg != null ? `${compactNumber(set.weightKg)}kg` : "自重";
  const reps = set.reps != null ? compactNumber(set.reps) : "—";
  return `${weight} × ${reps}`;
}

function collectSessionFromForm() {
  const existing = findSession($('#session-id').value);
  const warmups = $$('.warmup-editor', $('#warmup-editor-list')).map(row => {
    const mode = $('[data-warmup-field="mode"]', row).value;
    return {
      id: row.dataset.id,
      name: $('[data-warmup-field="name"]', row).value,
      mode,
      reps: mode === "reps" ? $('[data-warmup-field="reps"]', row).value : "",
      durationMin: mode === "duration" ? $('[data-warmup-field="duration"]', row).value : "",
      note: $('[data-warmup-field="note"]', row).value
    };
  }).filter(item => item.name.trim());

  const exercises = $$('.exercise-editor', $('#exercise-editor-list')).map(exercise => {
    const previousExercise = existing?.exercises.find(item => item.id === exercise.dataset.id);
    const previousSetIds = new Set(previousExercise?.sets.map(set => set.id) || []);
    return {
      id: exercise.dataset.id,
      exerciseId: exercise.dataset.exerciseId,
      name: $('[data-exercise-field="name"]', exercise).value,
      cues: $('[data-exercise-field="cues"]', exercise).value,
      coachCorrection: $('[data-exercise-field="correction"]', exercise).value,
      sets: $$('.set-editor', exercise).map(row => ({
        id: row.dataset.id,
        weightKg: $('[data-set-field="weight"]', row).value,
        reps: $('[data-set-field="reps"]', row).value
      })).filter(set => set.weightKg !== "" || set.reps !== "" || previousSetIds.has(set.id)),
      legacySource: previousExercise?.legacySource
    };
  }).filter(item => item.name.trim());
  return normalizeSession({
    id: $('#session-id').value || makeId("session"),
    date: $('#session-date').value || selectedDate,
    startTime: $('#session-start-time').value,
    durationMin: $('#session-duration').value,
    warmups,
    exercises,
    note: $('#session-note').value,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    legacySource: existing?.legacySource
  }, $('#session-date').value || selectedDate);
}

function findSession(id) {
  if (!id) return null;
  for (const day of Object.values(data.days)) {
    const session = day.sessions.find(item => item.id === id);
    if (session) return session;
  }
  return null;
}

function findSessionLocation(id) {
  if (!id) return null;
  for (const [date, day] of Object.entries(data.days)) {
    const item = day.sessions.find(session => session.id === id);
    if (item) return { date, item };
  }
  return null;
}

function removeRecordEverywhere(key, id) {
  Object.keys(data.days).forEach(date => {
    data.days[date][key] = (data.days[date][key] || []).filter(item => item.id !== id);
    removeEmptyDay(date);
  });
}

function saveSession(event) {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  const session = collectSessionFromForm();
  if (!session || !session.exercises.length) {
    alert("请至少添加一个正式训练动作，并填写动作名称。");
    return;
  }
  const emptySets = session.exercises.find(exercise => !exercise.sets.length);
  if (emptySets) {
    alert(`请为“${emptySets.name}”至少填写一组重量或次数。`);
    return;
  }
  const existingLocation = findSessionLocation(session.id);
  const targetDate = session.date;
  const snapshot = JSON.stringify(data);
  removeRecordEverywhere("sessions", session.id);
  ensureDay(targetDate).sessions.push(session);
  updateExerciseLibrary(data, session.exercises);
  if (saveData()) {
    selectedDate = targetDate;
    closeDialog($('#session-dialog'));
    renderDay();
    showToast(existingLocation ? (existingLocation.date === targetDate ? "训练记录已更新" : `整场训练已移动到 ${formatShortDate(targetDate)}`) : "训练记录已保存");
  } else {
    data = JSON.parse(snapshot);
  }
}

function removeEntry(kind) {
  const isFood = kind === "food";
  const id = $(`#${kind === "session" ? "session" : "food"}-id`).value;
  if (!id || !confirm(`确定删除这条${isFood ? "饮食" : "训练"}记录吗？`)) return;
  const key = isFood ? "meals" : "sessions";
  removeRecordEverywhere(key, id);
  if (saveData()) {
    closeDialog($(`#${kind}-dialog`));
    showToast("记录已删除");
  }
}

function exportBackup() {
  const payload = {
    app: "Fitness Log",
    appVersion: "0.1.2",
    formatVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `fitness-log-backup-${todayISO()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("完整备份已下载");
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const wasV1 = needsV1Migration(parsed);
    const incoming = normalizeData(parsed);
    const mode = $('input[name="import-mode"]:checked').value;
    if (mode === "replace" && !confirm("这会用备份完全替换当前数据。确定继续吗？")) return;
    localStorage.setItem(PRE_IMPORT_KEY, JSON.stringify({
      app: "Fitness Log",
      formatVersion: SCHEMA_VERSION,
      savedBeforeImportAt: new Date().toISOString(),
      data
    }));
    data = mode === "replace" ? incoming : mergeData(data, incoming);
    if (saveData()) showToast(`${mode === "replace" ? "数据已替换" : "数据已合并"}${wasV1 ? "，旧格式已迁移" : ""}`);
  } catch (error) {
    console.error(error);
    alert(error.message || "导入失败，请检查 JSON 文件");
  } finally {
    event.target.value = "";
  }
}

function closeDialog(dialog) { if (dialog.open) dialog.close(); }

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function setupEvents() {
  $$('[data-view-target]').forEach(button => button.addEventListener("click", () => {
    activeView = button.dataset.viewTarget;
    history.replaceState(null, "", `#${activeView}`);
    renderNavigation();
    if (activeView === "summary") renderSummary();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }));
  $('#previous-day').addEventListener("click", () => { selectedDate = shiftDate(selectedDate, -1); renderDay(); });
  $('#next-day').addEventListener("click", () => { if (selectedDate < todayISO()) selectedDate = shiftDate(selectedDate, 1); renderDay(); });
  $('#open-calendar').addEventListener("click", openCalendar);
  $('#calendar-previous-month').addEventListener("click", () => shiftCalendarMonth(-1));
  $('#calendar-next-month').addEventListener("click", () => { if (calendarMonth < todayISO().slice(0, 7)) shiftCalendarMonth(1); });
  $('#calendar-grid').addEventListener("click", event => {
    const button = event.target.closest('[data-calendar-date]');
    if (button && !button.disabled) openLogDate(button.dataset.calendarDate);
  });
  $('#open-date-picker').addEventListener("click", () => { const input = $('#date-picker'); input.showPicker ? input.showPicker() : input.click(); });
  $('#date-picker').addEventListener("change", event => { if (!event.target.value) return; selectedDate = event.target.value > todayISO() ? todayISO() : event.target.value; renderDay(); });
  $('#day-metrics').addEventListener("click", event => {
    if (event.target.closest('[data-open-hydration]')) openHydrationDialog();
    if (event.target.closest('[data-open-coffee]')) openCoffeeDialog();
  });
  $('#add-food').addEventListener("click", () => openFoodDialog());
  $('#add-session').addEventListener("click", () => openSessionDialog());
  $('#food-list').addEventListener("click", event => {
    const button = event.target.closest('[data-edit-food]');
    if (button) openFoodDialog(getDay(data, selectedDate).meals.find(item => item.id === button.dataset.editFood));
  });
  $('#session-list').addEventListener("click", event => {
    const button = event.target.closest('[data-view-session]');
    if (button) openSessionDetail(button.dataset.viewSession);
  });
  $('#recap-list').addEventListener("click", event => {
    const button = event.target.closest('[data-view-session]');
    if (button) openSessionDetail(button.dataset.viewSession);
  });
  $('#edit-session-from-detail').addEventListener("click", event => {
    const session = findSession(event.currentTarget.dataset.sessionId);
    if (!session) return;
    closeDialog($('#session-detail-dialog'));
    openSessionDialog(session);
  });
  $('#share-session-from-detail').addEventListener("click", event => openSessionShareDialog(event.currentTarget.dataset.sessionId));
  $('.share-format-options').addEventListener("click", event => {
    const button = event.target.closest('[data-share-format]');
    if (!button || button.dataset.shareFormat === shareFormat) return;
    shareFormat = button.dataset.shareFormat;
    $$('.share-format-card').forEach(item => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-checked", String(active));
    });
    renderSessionSharePreview();
  });
  $('#save-session-share').addEventListener("click", saveSessionShareImage);
  $('#hydration-dialog').addEventListener("click", event => {
    const quickAdd = event.target.closest('[data-add-water]');
    if (quickAdd) addHydrationRecord(quickAdd.dataset.addWater);
    const removeButton = event.target.closest('[data-delete-water]');
    if (removeButton) deleteQuickRecord("hydration", removeButton.dataset.deleteWater);
  });
  $('#hydration-form').addEventListener("submit", event => {
    event.preventDefault();
    addHydrationRecord($('#hydration-custom-ml').value);
  });
  $('#coffee-form').addEventListener("submit", saveCoffee);
  $('#coffee-capacity').addEventListener("change", event => {
    const isCustom = event.target.value === "custom";
    $('#coffee-custom-field').hidden = !isCustom;
    $('#coffee-custom-capacity').required = isCustom;
    if (isCustom) setTimeout(() => $('#coffee-custom-capacity').focus(), 0);
  });
  $('#coffee-record-list').addEventListener("click", event => {
    const button = event.target.closest('[data-delete-coffee]');
    if (button) deleteQuickRecord("coffees", button.dataset.deleteCoffee);
  });
  $('#food-form').addEventListener("submit", saveFood);
  $('#session-form').addEventListener("submit", saveSession);
  $('#delete-food').addEventListener("click", () => removeEntry("food"));
  $('#delete-session').addEventListener("click", () => removeEntry("session"));
  $('#add-warmup').addEventListener("click", () => addWarmupEditor());
  $('#add-exercise').addEventListener("click", () => addExerciseEditor());
  $('#warmup-editor-list').addEventListener("click", event => {
    const button = event.target.closest('[data-remove-warmup]');
    if (button) { button.closest('.warmup-editor').remove(); refreshEditorCounts(); }
  });
  $('#warmup-editor-list').addEventListener("change", event => {
    if (event.target.matches('[data-warmup-field="mode"]')) updateWarmupMode(event.target.closest('.warmup-editor'));
  });
  $('#exercise-editor-list').addEventListener("click", event => {
    const exercise = event.target.closest('.exercise-editor');
    if (!exercise) return;
    const suggestion = event.target.closest('[data-select-exercise]');
    if (suggestion) {
      selectLibraryExercise(exercise, suggestion.dataset.selectExercise);
      return;
    }
    if (event.target.closest('[data-add-set]')) addSetEditor(exercise);
    if (event.target.closest('[data-remove-set]')) { event.target.closest('.set-editor').remove(); updateSetIndexes(exercise); }
    if (event.target.closest('[data-remove-exercise]')) { exercise.remove(); refreshEditorCounts(); }
  });
  $('#exercise-editor-list').addEventListener("input", event => {
    if (event.target.matches('[data-exercise-field="name"]')) {
      const exercise = event.target.closest('.exercise-editor');
      $('.exercise-summary-name', exercise).textContent = event.target.value.trim() || "新动作";
      const key = exerciseKey(event.target.value);
      if (exercise.dataset.libraryNameKey && key !== exercise.dataset.libraryNameKey) exercise.dataset.exerciseId = "";
      const library = findExerciseLibraryEntry(data, event.target.value);
      if (library && event.target.dataset.appliedLibraryKey !== key) {
        exercise.dataset.exerciseId = library.id;
        exercise.dataset.libraryNameKey = exerciseKey(library.name);
        $('[data-exercise-field="cues"]', exercise).value = library.cues || "";
        event.target.dataset.appliedLibraryKey = key;
        renderLastPerformance(exercise, event.target.value, library.id);
      } else if (!library) {
        renderLastPerformance(exercise, event.target.value);
      }
      renderExerciseSuggestions(exercise, event.target.value);
    }
  });
  $('#exercise-editor-list').addEventListener("focusin", event => {
    if (event.target.matches('[data-exercise-field="name"]')) renderExerciseSuggestions(event.target.closest('.exercise-editor'), event.target.value);
  });
  $('#exercise-editor-list').addEventListener("focusout", event => {
    if (event.target.matches('[data-exercise-field="name"]')) setTimeout(() => {
      const container = $('.exercise-suggestions', event.target.closest('.exercise-editor'));
      if (container) container.hidden = true;
    }, 120);
  });
  $('#exercise-editor-list').addEventListener("change", event => {
    if (event.target.matches('[data-exercise-field="name"]')) updateExerciseEditor(event.target.closest('.exercise-editor'), true);
  });
  $('#session-start-time').addEventListener("change", () => $$('.exercise-editor', $('#exercise-editor-list')).forEach(item => updateExerciseEditor(item, false)));
  $('#session-date').addEventListener("change", () => $$('.exercise-editor', $('#exercise-editor-list')).forEach(item => updateExerciseEditor(item, false)));
  $$('[data-close-dialog]').forEach(button => button.addEventListener("click", () => closeDialog(button.closest("dialog"))));
  $$('.entry-dialog').forEach(dialog => dialog.addEventListener("click", event => { if (event.target === dialog) closeDialog(dialog); }));
  $$('[data-chart-metric]').forEach(button => button.addEventListener("click", () => {
    chartMetric = button.dataset.chartMetric;
    $$('[data-chart-metric]').forEach(item => item.classList.toggle("is-active", item === button));
    renderSummary();
  }));
  $('#exercise-history-select').addEventListener("change", event => { selectedHistoryExercise = event.target.value; renderExerciseHistory(); });
  $('#export-data').addEventListener("click", exportBackup);
  $('#import-data').addEventListener("change", importBackup);
  window.addEventListener("hashchange", () => { activeView = location.hash.slice(1) || "log"; renderNavigation(); if (activeView === "calendar") renderCalendar(); });
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    $('#install-app').hidden = false;
    $('#install-copy').textContent = "安装到设备后，可以从主屏幕快速打开并离线使用。";
  });
  $('#install-app').addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    $('#install-app').hidden = true;
  });
}

setupEvents();
renderAll();
if (migrationPerformed) setTimeout(() => showToast("历史数据已安全升级，并保留迁移前备份"), 250);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(error => console.warn("离线缓存注册失败", error)));
}
