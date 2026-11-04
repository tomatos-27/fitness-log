export const SCHEMA_VERSION = 4;

export const mealLabels = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack: "加餐"
};

export const coffeeLabels = {
  americano: "美式",
  latte: "拿铁",
  coldBrew: "冷萃",
  flatWhite: "澳白",
  other: "其他"
};

export function createEmptyData() {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    days: {},
    exerciseLibrary: {},
    settings: {
      hydrationTargetMl: 2000
    }
  };
}

export function unwrapBackup(source) {
  return source?.data && source?.app === "Fitness Log" ? source.data : source;
}

export function needsV1Migration(source) {
  const raw = unwrapBackup(source);
  if (!raw || typeof raw !== "object") return false;
  if (Number(raw.schemaVersion || 1) <= 1) return true;
  return Object.values(raw.days || {}).some(day => Array.isArray(day?.workouts));
}

export function needsDataMigration(source) {
  const raw = unwrapBackup(source);
  if (!raw || typeof raw !== "object") return false;
  if (Number(raw.schemaVersion || 1) < SCHEMA_VERSION) return true;
  if (Object.values(raw.exerciseLibrary || {}).some(item => !item?.id)) return true;
  return Object.values(raw.days || {}).some(day => (day?.sessions || []).some(session =>
    (session.exercises || []).some(exercise => !exercise.exerciseId) ||
    (session.warmups || []).some(warmup => !warmup.mode)
  ));
}

export function normalizeData(source) {
  let raw = unwrapBackup(source);
  if (!raw || typeof raw !== "object" || !raw.days || typeof raw.days !== "object") {
    throw new Error("文件不是有效的 Fitness Log 备份");
  }
  const sourceVersion = Number(raw.schemaVersion || 1);
  if (needsV1Migration(raw)) raw = migrateV1Data(raw);

  const normalized = createEmptyData();
  normalized.createdAt = safeText(raw.createdAt, 40) || normalized.createdAt;
  normalized.updatedAt = safeText(raw.updatedAt, 40) || normalized.updatedAt;
  normalized.migration = normalizeMigration(raw.migration);
  normalized.migrations = normalizeMigrations(raw.migrations);
  normalized.settings = normalizeSettings(raw.settings);

  for (const [date, day] of Object.entries(raw.days).slice(0, 5000)) {
    if (!validDate(date) || !day || typeof day !== "object") continue;
    const meals = Array.isArray(day.meals)
      ? day.meals.slice(0, 1000).map(normalizeMeal).filter(Boolean)
      : [];
    const sessions = Array.isArray(day.sessions)
      ? day.sessions.slice(0, 300).map(item => normalizeSession(item, date)).filter(Boolean)
      : [];
    const hydration = Array.isArray(day.hydration)
      ? day.hydration.slice(0, 1000).map(item => normalizeHydration(item, date)).filter(Boolean)
      : [];
    const coffees = Array.isArray(day.coffees)
      ? day.coffees.slice(0, 500).map(item => normalizeCoffee(item, date)).filter(Boolean)
      : [];
    if (meals.length || sessions.length || hydration.length || coffees.length) {
      normalized.days[date] = { date, meals, sessions, hydration, coffees };
    }
  }

  if (raw.exerciseLibrary && typeof raw.exerciseLibrary === "object") {
    for (const item of Object.values(raw.exerciseLibrary).slice(0, 2000)) {
      const entry = normalizeLibraryEntry(item);
      if (entry) normalized.exerciseLibrary[entry.id] = entry;
    }
  }
  rebuildExerciseLibrary(normalized);
  if (sourceVersion < SCHEMA_VERSION && !normalized.migrations.some(item => item.toSchemaVersion === SCHEMA_VERSION)) {
    normalized.migrations.push({
      fromSchemaVersion: sourceVersion,
      toSchemaVersion: SCHEMA_VERSION,
      migratedAt: new Date().toISOString(),
      strategy: sourceVersion < 3
        ? "为历史正式动作绑定稳定 exerciseId；旧热身默认迁移为按次数记录；新增喝水与咖啡数据集合，原训练和饮食内容保持不变。"
        : "新增独立 hydration / coffees 数据集合与默认 2000ml 喝水目标；原训练、饮食、动作库和历史记录保持不变。"
    });
  }
  return normalized;
}

export function migrateV1Data(source) {
  const raw = unwrapBackup(source);
  const migrated = createEmptyData();
  migrated.createdAt = safeText(raw.createdAt, 40) || migrated.createdAt;
  migrated.updatedAt = safeText(raw.updatedAt, 40) || migrated.updatedAt;
  migrated.migration = {
    fromSchemaVersion: Number(raw.schemaVersion || 1),
    migratedAt: new Date().toISOString(),
    strategy: "每条旧训练记录迁移为一个训练场次；旧组数展开为多个独立 Set，原字段保存在 legacySource。"
  };

  for (const [date, day] of Object.entries(raw.days || {}).slice(0, 5000)) {
    if (!validDate(date) || !day || typeof day !== "object") continue;
    const meals = Array.isArray(day.meals)
      ? day.meals.slice(0, 1000).map(normalizeMeal).filter(Boolean)
      : [];
    const sessions = Array.isArray(day.sessions)
      ? day.sessions.slice(0, 300).map(item => normalizeSession(item, date)).filter(Boolean)
      : [];
    const hydration = Array.isArray(day.hydration)
      ? day.hydration.slice(0, 1000).map(item => normalizeHydration(item, date)).filter(Boolean)
      : [];
    const coffees = Array.isArray(day.coffees)
      ? day.coffees.slice(0, 500).map(item => normalizeCoffee(item, date)).filter(Boolean)
      : [];
    const legacyWorkouts = Array.isArray(day.workouts) ? day.workouts.slice(0, 1000) : [];
    legacyWorkouts.forEach((workout, index) => {
      const converted = migrateV1Workout(workout, date, index);
      if (converted) sessions.push(converted);
    });
    if (meals.length || sessions.length || hydration.length || coffees.length) {
      migrated.days[date] = { date, meals, sessions, hydration, coffees };
    }
  }
  rebuildExerciseLibrary(migrated);
  return migrated;
}

function migrateV1Workout(item, date, index) {
  if (!item || typeof item !== "object" || !safeText(item.name, 80)) return null;
  const oldId = safeText(item.id, 80) || `legacy-${date}-${index + 1}`;
  const oldSetCount = safeNumber(item.sets, 0, 100);
  const oldReps = safeNumber(item.reps, 0, 1000);
  const oldWeight = safeNumber(item.weightKg, 0, 2000);
  const setCount = oldSetCount && oldSetCount > 0 ? Math.round(oldSetCount) : (oldReps != null || oldWeight != null ? 1 : 0);
  const sets = Array.from({ length: setCount }, (_, setIndex) => ({
    id: `${oldId}-set-${setIndex + 1}`,
    weightKg: oldWeight,
    reps: oldReps
  }));
  const createdAt = safeText(item.createdAt, 40) || new Date().toISOString();
  return {
    id: `session-${oldId}`,
    date,
    startTime: validTime(item.time) ? item.time : "18:00",
    durationMin: safeNumber(item.durationMin, 0, 1440),
    warmups: [],
    exercises: [{
      id: `exercise-${oldId}`,
      name: safeText(item.name, 80),
      cues: "",
      coachCorrection: "",
      sets,
      legacySource: {
        schemaVersion: 1,
        id: oldId,
        type: safeText(item.type, 30),
        time: safeText(item.time, 10),
        sets: oldSetCount,
        reps: oldReps,
        weightKg: oldWeight,
        durationMin: safeNumber(item.durationMin, 0, 1440),
        note: safeText(item.note, 200),
        createdAt
      }
    }],
    note: safeText(item.note, 500),
    createdAt,
    updatedAt: createdAt,
    legacySource: {
      schemaVersion: 1,
      workoutId: oldId,
      type: safeText(item.type, 30)
    }
  };
}

export function normalizeMeal(item) {
  if (!item || typeof item !== "object" || !safeText(item.name, 80)) return null;
  return {
    id: safeText(item.id, 80) || makeId("meal"),
    mealType: mealLabels[item.mealType] ? item.mealType : "snack",
    time: validTime(item.time) ? item.time : "12:00",
    name: safeText(item.name, 80),
    portion: safeText(item.portion, 40),
    calories: safeNumber(item.calories, 0, 20000),
    proteinG: safeNumber(item.proteinG, 0, 1000),
    note: safeText(item.note, 200),
    createdAt: safeText(item.createdAt, 40) || new Date().toISOString()
  };
}

export function normalizeHydration(item, fallbackDate) {
  if (!item || typeof item !== "object") return null;
  const date = validDate(fallbackDate) ? fallbackDate : (validDate(item.date) ? item.date : "");
  const ml = safeNumber(item.ml ?? item.amountMl, 1, 10000);
  if (!date || ml == null) return null;
  return {
    id: safeText(item.id, 80) || makeId("water"),
    date,
    time: validTime(item.time) ? item.time : "12:00",
    ml,
    createdAt: safeText(item.createdAt, 40) || new Date().toISOString()
  };
}

export function normalizeCoffee(item, fallbackDate) {
  if (!item || typeof item !== "object") return null;
  const date = validDate(fallbackDate) ? fallbackDate : (validDate(item.date) ? item.date : "");
  if (!date) return null;
  const type = coffeeLabels[item.type] ? item.type : "other";
  return {
    id: safeText(item.id, 80) || makeId("coffee"),
    date,
    time: validTime(item.time) ? item.time : "12:00",
    type,
    capacityMl: safeNumber(item.capacityMl, 1, 2000),
    createdAt: safeText(item.createdAt, 40) || new Date().toISOString()
  };
}

export function normalizeSession(item, fallbackDate) {
  if (!item || typeof item !== "object") return null;
  const date = validDate(item.date) ? item.date : fallbackDate;
  if (!validDate(date)) return null;
  const warmups = Array.isArray(item.warmups)
    ? item.warmups.slice(0, 100).map(normalizeWarmup).filter(Boolean)
    : [];
  const exercises = Array.isArray(item.exercises)
    ? item.exercises.slice(0, 100).map(normalizeExercise).filter(Boolean)
    : [];
  if (!warmups.length && !exercises.length && !safeText(item.note, 500)) return null;
  const now = new Date().toISOString();
  return {
    id: safeText(item.id, 80) || makeId("session"),
    date,
    startTime: validTime(item.startTime) ? item.startTime : "18:00",
    durationMin: safeNumber(item.durationMin, 0, 1440),
    warmups,
    exercises,
    note: safeText(item.note, 500),
    createdAt: safeText(item.createdAt, 40) || now,
    updatedAt: safeText(item.updatedAt, 40) || now,
    legacySource: normalizeLegacySource(item.legacySource)
  };
}

export function normalizeWarmup(item) {
  if (!item || typeof item !== "object" || !safeText(item.name, 80)) return null;
  const reps = safeNumber(item.reps, 0, 5000);
  const durationMin = safeNumber(item.durationMin ?? item.duration, 0, 1440);
  const mode = item.mode === "duration" || (durationMin != null && reps == null) ? "duration" : "reps";
  return {
    id: safeText(item.id, 80) || makeId("warmup"),
    name: safeText(item.name, 80),
    mode,
    reps: mode === "reps" ? reps : null,
    durationMin: mode === "duration" ? durationMin : null,
    note: safeText(item.note, 200)
  };
}

export function normalizeExercise(item) {
  if (!item || typeof item !== "object" || !safeText(item.name, 80)) return null;
  return {
    id: safeText(item.id, 80) || makeId("exercise"),
    exerciseId: safeText(item.exerciseId, 100),
    name: safeText(item.name, 80),
    cues: safeText(item.cues, 1000),
    coachCorrection: safeText(item.coachCorrection, 1000),
    sets: Array.isArray(item.sets) ? item.sets.slice(0, 100).map(normalizeSet).filter(Boolean) : [],
    legacySource: normalizeLegacySource(item.legacySource)
  };
}

export function normalizeSet(item) {
  if (!item || typeof item !== "object") return null;
  const weightKg = safeNumber(item.weightKg, 0, 2000);
  const reps = safeNumber(item.reps, 0, 5000);
  if (weightKg == null && reps == null && !safeText(item.id, 80)) return null;
  return {
    id: safeText(item.id, 80) || makeId("set"),
    weightKg,
    reps
  };
}

function normalizeLibraryEntry(item) {
  if (!item || typeof item !== "object" || !safeText(item.name, 80)) return null;
  const name = safeText(item.name, 80);
  return {
    id: safeText(item.id, 100) || stableExerciseId(name),
    name,
    cues: safeText(item.cues, 1000),
    aliases: Array.isArray(item.aliases)
      ? [...new Set(item.aliases.map(alias => safeText(alias, 80)).filter(Boolean))].slice(0, 50)
      : [],
    updatedAt: safeText(item.updatedAt, 40) || new Date().toISOString()
  };
}

function normalizeMigration(item) {
  if (!item || typeof item !== "object") return undefined;
  return {
    fromSchemaVersion: safeNumber(item.fromSchemaVersion, 0, 100),
    migratedAt: safeText(item.migratedAt, 40),
    strategy: safeText(item.strategy, 500)
  };
}

function normalizeMigrations(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 50).map(item => ({
    fromSchemaVersion: safeNumber(item?.fromSchemaVersion, 0, 100),
    toSchemaVersion: safeNumber(item?.toSchemaVersion, 0, 100),
    migratedAt: safeText(item?.migratedAt, 40),
    strategy: safeText(item?.strategy, 500)
  })).filter(item => item.fromSchemaVersion != null || item.toSchemaVersion != null);
}

function normalizeSettings(item) {
  return {
    hydrationTargetMl: safeNumber(item?.hydrationTargetMl, 250, 10000) || 2000
  };
}

function normalizeLegacySource(item) {
  if (!item || typeof item !== "object") return undefined;
  const result = {};
  const textFields = ["id", "workoutId", "type", "time", "note", "createdAt"];
  const numberFields = ["schemaVersion", "sets", "reps", "weightKg", "durationMin"];
  textFields.forEach(key => {
    const value = safeText(item[key], key === "note" ? 500 : 100);
    if (value) result[key] = value;
  });
  numberFields.forEach(key => {
    const value = safeNumber(item[key], 0, key === "weightKg" ? 2000 : 100000);
    if (value != null) result[key] = value;
  });
  return Object.keys(result).length ? result : undefined;
}

export function rebuildExerciseLibrary(data) {
  const normalizedLibrary = {};
  Object.values(data.exerciseLibrary || {}).forEach(rawEntry => {
    const entry = normalizeLibraryEntry(rawEntry);
    if (entry) normalizedLibrary[entry.id] = entry;
  });
  data.exerciseLibrary = normalizedLibrary;

  const sessions = allSessions(data).sort((a, b) => sessionStamp(a).localeCompare(sessionStamp(b)));
  sessions.forEach(session => {
    session.exercises.forEach(exercise => {
      const matched = exercise.exerciseId ? data.exerciseLibrary[exercise.exerciseId] : findExerciseLibraryEntry(data, exercise.name);
      const id = matched?.id || exercise.exerciseId || stableExerciseId(exercise.name);
      const current = data.exerciseLibrary[id];
      const aliases = new Set(current?.aliases || []);
      if (current && exerciseKey(current.name) !== exerciseKey(exercise.name)) aliases.add(exercise.name);
      data.exerciseLibrary[id] = {
        id,
        name: current?.name || exercise.name,
        cues: exercise.cues || current?.cues || "",
        aliases: [...aliases].filter(Boolean),
        updatedAt: session.updatedAt || session.createdAt
      };
      exercise.exerciseId = id;
    });
  });
}

export function updateExerciseLibrary(data, exercises) {
  const now = new Date().toISOString();
  exercises.forEach(exercise => {
    if (!exerciseKey(exercise.name)) return;
    const matched = exercise.exerciseId ? data.exerciseLibrary[exercise.exerciseId] : findExerciseLibraryEntry(data, exercise.name);
    const id = matched?.id || exercise.exerciseId || stableExerciseId(exercise.name);
    const aliases = new Set(matched?.aliases || []);
    if (matched && exerciseKey(matched.name) !== exerciseKey(exercise.name)) aliases.add(exercise.name);
    data.exerciseLibrary[id] = {
      id,
      name: matched?.name || exercise.name,
      cues: exercise.cues,
      aliases: [...aliases].filter(Boolean),
      updatedAt: now
    };
    exercise.exerciseId = id;
  });
}

export function mergeData(currentSource, incomingSource) {
  const current = normalizeData(currentSource);
  const incoming = normalizeData(incomingSource);
  const knownIds = {
    meals: new Set(Object.values(current.days).flatMap(day => day.meals.map(item => item.id))),
    sessions: new Set(Object.values(current.days).flatMap(day => day.sessions.map(item => item.id))),
    hydration: new Set(Object.values(current.days).flatMap(day => (day.hydration || []).map(item => item.id))),
    coffees: new Set(Object.values(current.days).flatMap(day => (day.coffees || []).map(item => item.id)))
  };
  for (const [date, incomingDay] of Object.entries(incoming.days)) {
    const target = current.days[date] ||= { date, meals: [], sessions: [], hydration: [], coffees: [] };
    target.hydration ||= [];
    target.coffees ||= [];
    for (const key of ["meals", "sessions", "hydration", "coffees"]) {
      (incomingDay[key] || []).forEach(item => {
        if (knownIds[key].has(item.id)) return;
        target[key].push(item);
        knownIds[key].add(item.id);
      });
    }
  }
  for (const [key, entry] of Object.entries(incoming.exerciseLibrary)) {
    const currentEntry = current.exerciseLibrary[key];
    if (!currentEntry || (entry.updatedAt || "") >= (currentEntry.updatedAt || "")) {
      current.exerciseLibrary[key] = entry;
    }
  }
  current.updatedAt = new Date().toISOString();
  return current;
}

export function getDay(data, date) {
  const day = data.days[date];
  return day
    ? { ...day, hydration: day.hydration || [], coffees: day.coffees || [] }
    : { date, meals: [], sessions: [], hydration: [], coffees: [] };
}

export function dayTotals(day) {
  const calories = day.meals.reduce((sum, item) => sum + (item.calories ?? 0), 0);
  const protein = day.meals.reduce((sum, item) => sum + (item.proteinG ?? 0), 0);
  const duration = day.sessions.reduce((sum, item) => sum + (item.durationMin ?? 0), 0);
  const hydrationMl = (day.hydration || []).reduce((sum, item) => sum + (item.ml ?? 0), 0);
  const coffeeCount = (day.coffees || []).length;
  const exerciseCount = day.sessions.reduce((sum, item) => sum + item.exercises.length, 0);
  const setCount = day.sessions.reduce((sum, session) => sum + session.exercises.reduce((subtotal, exercise) => subtotal + exercise.sets.length, 0), 0);
  const volume = day.sessions.reduce((sum, session) => sum + session.exercises.reduce((subtotal, exercise) => subtotal + exercise.sets.reduce((setSum, set) => setSum + ((set.weightKg ?? 0) * (set.reps ?? 0)), 0), 0), 0);
  return { calories, protein, duration, hydrationMl, coffeeCount, exerciseCount, setCount, volume };
}

export function allSessions(data) {
  return Object.values(data.days).flatMap(day => day.sessions || []);
}

export function getExerciseNames(data) {
  return getExerciseLibraryEntries(data).map(item => item.name).sort((a, b) => a.localeCompare(b, "zh-CN"));
}

export function getExerciseLibraryEntries(data) {
  const stats = new Map();
  allSessions(data).forEach(session => session.exercises.forEach(exercise => {
    const entry = exercise.exerciseId ? data.exerciseLibrary?.[exercise.exerciseId] : findExerciseLibraryEntry(data, exercise.name);
    if (!entry) return;
    const current = stats.get(entry.id) || { usageCount: 0, lastUsedAt: "" };
    current.usageCount += 1;
    current.lastUsedAt = [current.lastUsedAt, sessionStamp(session)].sort().at(-1) || "";
    stats.set(entry.id, current);
  }));
  return Object.values(data.exerciseLibrary || {}).map(entry => ({
    ...entry,
    usageCount: stats.get(entry.id)?.usageCount || 0,
    lastUsedAt: stats.get(entry.id)?.lastUsedAt || ""
  })).sort((a, b) => b.usageCount - a.usageCount || b.lastUsedAt.localeCompare(a.lastUsedAt) || a.name.localeCompare(b.name, "zh-CN"));
}

export function findExerciseLibraryEntry(data, value) {
  const key = exerciseKey(value);
  if (!key) return null;
  return Object.values(data.exerciseLibrary || {}).find(entry =>
    exerciseKey(entry.name) === key || (entry.aliases || []).some(alias => exerciseKey(alias) === key)
  ) || null;
}

export function searchExerciseLibrary(data, query, limit = 6) {
  const needle = exerciseSearchKey(query);
  return getExerciseLibraryEntries(data)
    .filter(entry => !needle || [entry.name, ...(entry.aliases || [])].some(value => exerciseSearchKey(value).includes(needle)))
    .sort((a, b) => {
      const aPrefix = exerciseSearchKey(a.name).startsWith(needle) ? 0 : 1;
      const bPrefix = exerciseSearchKey(b.name).startsWith(needle) ? 0 : 1;
      return aPrefix - bPrefix || b.usageCount - a.usageCount || b.lastUsedAt.localeCompare(a.lastUsedAt);
    })
    .slice(0, limit);
}

export function findExerciseHistory(data, name, options = {}) {
  const key = exerciseKey(name);
  const matchedLibrary = options.exerciseId ? data.exerciseLibrary?.[options.exerciseId] : findExerciseLibraryEntry(data, name);
  const targetId = options.exerciseId || matchedLibrary?.id || "";
  if (!key && !targetId) return [];
  const beforeStamp = options.beforeDate ? `${options.beforeDate}T${options.beforeTime || "23:59"}` : null;
  return allSessions(data)
    .filter(session => session.id !== options.excludeSessionId)
    .filter(session => !beforeStamp || sessionStamp(session) <= beforeStamp)
    .flatMap(session => session.exercises
      .filter(exercise => targetId ? exercise.exerciseId === targetId : exerciseKey(exercise.name) === key)
      .map(exercise => ({
        date: session.date,
        startTime: session.startTime,
        sessionId: session.id,
        sessionNote: session.note,
        exercise
      })))
    .sort((a, b) => `${b.date}T${b.startTime}`.localeCompare(`${a.date}T${a.startTime}`));
}

export function exerciseKey(name) {
  return safeText(name, 80).toLocaleLowerCase("zh-CN").replace(/\s+/g, " ");
}

function exerciseSearchKey(name) {
  return exerciseKey(name).replace(/\s+/g, "");
}

export function stableExerciseId(name) {
  const key = exerciseKey(name);
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `exercise-library-${(hash >>> 0).toString(36)}`;
}

export function maxWeight(exercise) {
  const weights = exercise.sets.map(set => set.weightKg).filter(value => value != null);
  return weights.length ? Math.max(...weights) : null;
}

export function makeId(prefix = "item") {
  const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${token}`;
}

export function safeText(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

export function safeNumber(value, min, max) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

export function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function validTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function sessionStamp(session) {
  return `${session.date}T${session.startTime || "00:00"}`;
}
