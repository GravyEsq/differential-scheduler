(() => {
  "use strict";

  const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי"];
  const PERIOD_TIMES = {
    0: { start: "07:45", end: "08:25" }, 1: { start: "08:30", end: "09:15" },
    2: { start: "09:15", end: "10:00" }, 3: { start: "10:20", end: "11:05" },
    4: { start: "11:05", end: "11:50" }, 5: { start: "12:05", end: "12:50" },
    6: { start: "12:50", end: "13:35" }, 7: { start: "14:00", end: "14:45" },
    8: { start: "14:45", end: "15:30" }, 9: { start: "15:40", end: "16:25" }
  };
  const STUDENT_REQUIRED_HEADERS = ["שם תלמיד", "כיתה", "מספר שעות", "יום", "שעה", "סוג זמינות", "מורה חובה", "מורה מועדפת"];
  const STUDENT_HEADERS = [...STUDENT_REQUIRED_HEADERS, "הסכמה לשיבוץ זוגי"];
  const TEACHER_REQUIRED_HEADERS = ["שם מורה", "מכסה מועדפת", "מכסה מרבית", "יום", "שעה", "סוג זמינות", "שכבות מותרות", "שכבות מועדפות", "שעות להימנע", "מקסימום רצוף"];
  const TEACHER_HEADERS = [...TEACHER_REQUIRED_HEADERS, "שעות הוראה קבועות ביום"];
  const activeProjectKey = "differential-active-project-v1";
  const MAX_CSV_BYTES = 5 * 1024 * 1024;
  const state = { students: [], teachers: null, studentErrors: [], teacherErrors: [], step: 0 };

  const elements = {
    form: document.querySelector("#projectForm"),
    school: document.querySelector("#schoolInput"),
    year: document.querySelector("#yearInput"),
    team: document.querySelector("#teamInput"),
    subject: document.querySelector("#subjectInput"),
    aliases: document.querySelector("#aliasesInput"),
    lastPeriod: document.querySelector("#lastPeriodInput"),
    avoidPeriods: document.querySelector("#avoidPeriodsInput"),
    studentFile: document.querySelector("#studentFileInput"),
    teacherFile: document.querySelector("#teacherFileInput"),
    studentStatus: document.querySelector("#studentFileStatus"),
    teacherStatus: document.querySelector("#teacherFileStatus"),
    review: document.querySelector("#setupReview"),
    create: document.querySelector("#createProjectButton"),
    next: document.querySelector("#wizardNextButton"),
    back: document.querySelector("#wizardBackButton"),
    progressText: document.querySelector("#wizardProgressText"),
    progressBar: document.querySelector("#wizardProgressBar"),
    message: document.querySelector("#wizardMessage"),
    toast: document.querySelector("#toast")
  };

  function esc(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function clean(value) {
    return String(value ?? "").replace(/^\uFEFF/, "").trim();
  }

  function splitList(value) {
    return clean(value).split(/[;,]/).map(clean).filter(Boolean);
  }

  function parsePeriods(value) {
    return splitList(value).map(Number).filter(Number.isInteger);
  }

  function parseYes(value) {
    return ["כן", "yes", "true", "1"].includes(clean(value).toLocaleLowerCase("he"));
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    const source = text.replace(/^\uFEFF/, "");
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (quoted) {
        if (char === '"' && source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else if (char === '"') quoted = false;
        else cell += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") {
        row.push(cell);
        cell = "";
      } else if (char === "\n") {
        row.push(cell.replace(/\r$/, ""));
        if (row.some(value => clean(value))) rows.push(row);
        row = [];
        cell = "";
      } else cell += char;
    }
    row.push(cell.replace(/\r$/, ""));
    if (row.some(value => clean(value))) rows.push(row);
    if (!rows.length) return [];
    const headers = rows[0].map(clean);
    return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, clean(values[index])])));
  }

  function csvHeaders(text) {
    const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] || "";
    return parseCsv(`${firstLine}\n`).length ? [] : firstLine.split(",").map(value => clean(value.replace(/^"|"$/g, "")));
  }

  function headerErrors(text, expected) {
    const present = csvHeaders(text);
    return expected.filter(header => !present.includes(header)).map(header => `חסרה העמודה „${header}”`);
  }

  function normalizeStudentCategory(value, aliases) {
    const category = clean(value);
    if (category === "במקום שיעור קיים") return "דריסת שיעור";
    if (["חלון", "קצה לפני", "קצה אחרי", "דריסת שיעור"].includes(category)) return category;
    if (category === "שיעור במקצוע" || aliases.some(alias => category.includes(alias))) return "שיעור במקצוע";
    return null;
  }

  function normalizeTeacherCategory(value) {
    const category = clean(value);
    if (category === "שעה פיקטיבית") return "שעה גמישה";
    if (["פנויה", "שעה גמישה", "חלון", "קצה לפני", "קצה אחרי"].includes(category)) return category;
    return null;
  }

  function readStudents(rows, meta) {
    const grouped = new Map();
    const errors = [];
    rows.forEach((row, index) => {
      const line = index + 2;
      const name = clean(row["שם תלמיד"]);
      const grade = clean(row["כיתה"]);
      const required = Number(row["מספר שעות"]);
      const day = clean(row["יום"]);
      const period = Number(row["שעה"]);
      const category = normalizeStudentCategory(row["סוג זמינות"], meta.aliases);
      if (!name) errors.push(`שורה ${line}: חסר שם תלמיד`);
      if (!grade) errors.push(`שורה ${line}: חסרה כיתה`);
      if (!Number.isFinite(required) || required <= 0 || !Number.isInteger(required)) errors.push(`שורה ${line}: מספר השעות חייב להיות מספר שלם וחיובי`);
      if (!DAYS.includes(day)) errors.push(`שורה ${line}: היום אינו מוכר`);
      if (!Number.isInteger(period) || period < 0 || period > meta.lastPeriod) errors.push(`שורה ${line}: השעה אינה בטווח שהוגדר`);
      if (!category) errors.push(`שורה ${line}: סוג הזמינות אינו מוכר`);
      if (!name || !grade || !Number.isInteger(required) || !DAYS.includes(day) || !Number.isInteger(period) || !category) return;
      const shareWilling = parseYes(row["הסכמה לשיבוץ זוגי"] || row["מוכן/ה לשעה משותפת"]);
      if (!grouped.has(name)) grouped.set(name, { student: name, grade, required, requiredTeacher: clean(row["מורה חובה"]), preferredTeacher: clean(row["מורה מועדפת"]), shareWilling, candidates: [] });
      const student = grouped.get(name);
      if (student.grade !== grade || student.required !== required) errors.push(`שורה ${line}: הכיתה או מספר השעות אינם תואמים לשורות הקודמות של ${name}`);
      if (student.requiredTeacher !== clean(row["מורה חובה"]) || student.preferredTeacher !== clean(row["מורה מועדפת"])) errors.push(`שורה ${line}: הגדרות המורה אינן אחידות אצל ${name}`);
      if (student.shareWilling !== shareWilling) errors.push(`שורה ${line}: ההסכמה לשיבוץ זוגי אינה אחידה אצל ${name}`);
      if (student.candidates.some(item => item.day === day && item.period === period)) errors.push(`שורה ${line}: האפשרות ${day} ${period} מופיעה פעמיים אצל ${name}`);
      student.candidates.push({ day, period, ...PERIOD_TIMES[period], category, avoid_if_possible: meta.avoidPeriods.includes(period) });
    });
    grouped.forEach(student => {
      if (!student.candidates.length) errors.push(`לא הוגדרה אף שעה אפשרית עבור ${student.student}`);
    });
    return { items: [...grouped.values()], errors };
  }

  function readTeachers(rows, meta) {
    const grouped = new Map();
    const errors = [];
    rows.forEach((row, index) => {
      const line = index + 2;
      const name = clean(row["שם מורה"]);
      const preferredQuota = Number(row["מכסה מועדפת"]);
      const quota = Number(row["מכסה מרבית"]);
      const day = clean(row["יום"]);
      const period = Number(row["שעה"]);
      const category = normalizeTeacherCategory(row["סוג זמינות"]);
      const allowedGrades = splitList(row["שכבות מותרות"]);
      const preferredGrades = splitList(row["שכבות מועדפות"]);
      const avoidPeriods = [...new Set([...meta.avoidPeriods, ...parsePeriods(row["שעות להימנע"])])];
      const maxConsecutive = clean(row["מקסימום רצוף"]) ? Number(row["מקסימום רצוף"]) : 7;
      const basePeriods = parsePeriods(row["שעות הוראה קבועות ביום"]);
      if (!name) errors.push(`שורה ${line}: חסר שם מורה`);
      if (!Number.isInteger(preferredQuota) || preferredQuota < 0) errors.push(`שורה ${line}: המכסה המועדפת אינה תקינה`);
      if (!Number.isInteger(quota) || quota <= 0 || preferredQuota > quota) errors.push(`שורה ${line}: המכסה המרבית אינה תקינה`);
      if (!DAYS.includes(day)) errors.push(`שורה ${line}: היום אינו מוכר`);
      if (!Number.isInteger(period) || period < 0 || period > meta.lastPeriod) errors.push(`שורה ${line}: השעה אינה בטווח שהוגדר`);
      if (!category) errors.push(`שורה ${line}: סוג הזמינות אינו מוכר`);
      if (!Number.isInteger(maxConsecutive) || maxConsecutive <= 0 || maxConsecutive > 7) errors.push(`שורה ${line}: המקסימום הרצוף חייב להיות בין 1 ל־7`);
      if (basePeriods.some(item => item < 0 || item > meta.lastPeriod)) errors.push(`שורה ${line}: שעות ההוראה הקבועות אינן בטווח שהוגדר`);
      if (!name || !Number.isInteger(preferredQuota) || !Number.isInteger(quota) || !DAYS.includes(day) || !Number.isInteger(period) || !category) return;
      if (!grouped.has(name)) grouped.set(name, { name, quota, preferred_quota: preferredQuota, optional_quota: preferredQuota < quota, allowed_student_grades: allowedGrades.length ? allowedGrades : null, preferred_student_grades: preferredGrades, avoid_periods: avoidPeriods, forbidden_periods: [], max_consecutive: maxConsecutive, base_commitments: [], candidates: [] });
      const teacher = grouped.get(name);
      const signature = JSON.stringify([quota, preferredQuota, allowedGrades, preferredGrades, avoidPeriods, maxConsecutive]);
      const existingSignature = JSON.stringify([teacher.quota, teacher.preferred_quota, teacher.allowed_student_grades || [], teacher.preferred_student_grades, teacher.avoid_periods, teacher.max_consecutive]);
      if (signature !== existingSignature) errors.push(`שורה ${line}: הגדרות המורה אינן אחידות אצל ${name}`);
      if (teacher.candidates.some(item => item.day === day && item.period === period)) errors.push(`שורה ${line}: האפשרות ${day} ${period} מופיעה פעמיים אצל ${name}`);
      basePeriods.forEach(basePeriod => {
        if (!teacher.base_commitments.some(item => item.day === day && item.period === basePeriod)) teacher.base_commitments.push({ day, period: basePeriod });
      });
      teacher.candidates.push({ day, period, ...PERIOD_TIMES[period], category, replaces: category === "שעה גמישה" ? "התחייבות גמישה" : null, avoid_if_possible: avoidPeriods.includes(period) });
    });
    return { items: [...grouped.values()], errors };
  }

  class MinCostFlow {
    constructor() { this.graph = []; }
    node() { this.graph.push([]); return this.graph.length - 1; }
    addEdge(from, to, cap, cost, meta = null) {
      const forward = { to, rev: this.graph[to].length, cap, cost, originalCap: cap, meta };
      const reverse = { to: from, rev: this.graph[from].length, cap: 0, cost: -cost, originalCap: 0, meta: null };
      this.graph[from].push(forward);
      this.graph[to].push(reverse);
      return forward;
    }
    run(source, sink) {
      let flow = 0;
      let cost = 0;
      while (true) {
        const dist = Array(this.graph.length).fill(Number.POSITIVE_INFINITY);
        const previous = Array(this.graph.length).fill(null);
        const inQueue = Array(this.graph.length).fill(false);
        const queue = [source];
        dist[source] = 0;
        inQueue[source] = true;
        for (let head = 0; head < queue.length; head += 1) {
          const here = queue[head];
          inQueue[here] = false;
          this.graph[here].forEach((edge, edgeIndex) => {
            if (edge.cap <= 0) return;
            const candidate = dist[here] + edge.cost;
            if (candidate >= dist[edge.to]) return;
            dist[edge.to] = candidate;
            previous[edge.to] = [here, edgeIndex];
            if (!inQueue[edge.to]) { queue.push(edge.to); inQueue[edge.to] = true; }
          });
        }
        if (!previous[sink]) break;
        let cursor = sink;
        while (cursor !== source) {
          const [parent, edgeIndex] = previous[cursor];
          const edge = this.graph[parent][edgeIndex];
          edge.cap -= 1;
          this.graph[cursor][edge.rev].cap += 1;
          cursor = parent;
        }
        flow += 1;
        cost += dist[sink];
      }
      return { flow, cost };
    }
  }

  function gradeGroup(grade) {
    if (grade.startsWith("יא")) return "יא";
    if (grade.startsWith("יב")) return "יב";
    if (grade.startsWith("י")) return "י";
    return grade;
  }

  function teacherAllows(teacher, student) {
    if (student.requiredTeacher && student.requiredTeacher !== teacher.name) return false;
    if (!teacher.allowed_student_grades) return true;
    const group = gradeGroup(student.grade);
    return teacher.allowed_student_grades.includes(student.grade) || teacher.allowed_student_grades.includes(group);
  }

  function optionCost(student, studentSlot, teacher, teacherSlot) {
    const studentCosts = { "חלון": 0, "שיעור במקצוע": 25, "קצה לפני": 70, "קצה אחרי": 70, "דריסת שיעור": 150 };
    const teacherCosts = { "פנויה": 0, "שעה גמישה": 0, "שעה פיקטיבית": 0, "חלון": 5, "קצה לפני": 12, "קצה אחרי": 12 };
    let cost = (studentCosts[studentSlot.category] ?? 100) + (teacherCosts[teacherSlot.category] ?? 20);
    if (studentSlot.period < 1 || studentSlot.period > 6) cost += 20;
    if (studentSlot.avoid_if_possible || teacherSlot.avoid_if_possible) cost += 120;
    if (studentSlot.period === 9) cost += 450;
    if (student.preferredTeacher && student.preferredTeacher !== teacher.name) cost += 60;
    const group = gradeGroup(student.grade);
    if (teacher.preferred_student_grades.length && !teacher.preferred_student_grades.includes(group) && !teacher.preferred_student_grades.includes(student.grade)) cost += 35;
    return cost;
  }

  function consecutiveViolation(assignments, teachers) {
    for (const teacher of teachers) {
      if (!teacher.max_consecutive) continue;
      for (const day of DAYS) {
        const periods = [...new Set([
          ...(teacher.base_commitments || []).filter(item => item.day === day).map(item => item.period),
          ...assignments.filter(item => item.teacher === teacher.name && item.day === day).map(item => item.period)
        ])].sort((a, b) => a - b);
        let run = [];
        for (const period of periods) {
          run = run.length && period === run[run.length - 1] + 1 ? [...run, period] : [period];
          if (run.length > teacher.max_consecutive) return { teacher: teacher.name, day, run };
        }
      }
    }
    return null;
  }

  function solveSchedule(students, teachers, meta, forbiddenTeacherSlots = new Set(), repairDepth = 0) {
    const flow = new MinCostFlow();
    const source = flow.node();
    const sink = flow.node();
    const teacherNodes = new Map(teachers.map(teacher => [teacher.name, flow.node()]));
    teachers.forEach(teacher => {
      const node = teacherNodes.get(teacher.name);
      flow.addEdge(node, sink, teacher.preferred_quota, 0);
      if (teacher.quota > teacher.preferred_quota) flow.addEdge(node, sink, teacher.quota - teacher.preferred_quota, 900);
    });
    const teacherSlotNodes = new Map();
    const teacherSlotData = new Map();
    teachers.forEach(teacher => teacher.candidates.forEach(candidate => {
      const key = `${teacher.name}|${candidate.day}|${candidate.period}`;
      if (forbiddenTeacherSlots.has(key)) return;
      const node = flow.node();
      teacherSlotNodes.set(key, node);
      teacherSlotData.set(key, candidate);
      flow.addEdge(node, teacherNodes.get(teacher.name), 1, 0);
    }));

    const assignmentEdges = [];
    students.forEach((student, studentIndex) => {
      const unitNodes = Array.from({ length: student.required }, (_, unit) => {
        const node = flow.node();
        flow.addEdge(source, node, 1, unit * 10000);
        return node;
      });
      student.candidates.forEach((studentSlot, candidateIndex) => {
        const matches = teachers.filter(teacher => teacherAllows(teacher, student) && teacherSlotNodes.has(`${teacher.name}|${studentSlot.day}|${studentSlot.period}`));
        if (!matches.length) return;
        const slotIn = flow.node();
        const slotOut = flow.node();
        unitNodes.forEach(unitNode => flow.addEdge(unitNode, slotIn, 1, 0));
        flow.addEdge(slotIn, slotOut, 1, 0);
        matches.forEach(teacher => {
          const key = `${teacher.name}|${studentSlot.day}|${studentSlot.period}`;
          const choice = flow.node();
          const edge = flow.addEdge(slotOut, choice, 1, optionCost(student, studentSlot, teacher, teacherSlotData.get(key)), { studentIndex, candidateIndex, teacher: teacher.name, key });
          assignmentEdges.push(edge);
          flow.addEdge(choice, teacherSlotNodes.get(key), 1, 0);
        });
      });
    });
    const result = flow.run(source, sink);
    const assignments = assignmentEdges.filter(edge => edge.originalCap === 1 && edge.cap === 0).map(edge => {
      const student = students[edge.meta.studentIndex];
      const studentSlot = student.candidates[edge.meta.candidateIndex];
      const teacherSlot = teacherSlotData.get(edge.meta.key);
      return { student: student.student, grade: student.grade, teacher: edge.meta.teacher, day: studentSlot.day, period: studentSlot.period, start: studentSlot.start, end: studentSlot.end, student_slot_type: studentSlot.category, teacher_slot_type: teacherSlot.category, replaces_for_teacher: teacherSlot.replaces || null, avoid_if_possible: Boolean(studentSlot.avoid_if_possible || teacherSlot.avoid_if_possible) };
    }).sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.period - b.period || a.teacher.localeCompare(b.teacher, "he"));
    const violation = consecutiveViolation(assignments, teachers);
    if (violation && repairDepth < 12) {
      const period = violation.run[Math.floor(violation.run.length / 2)];
      const nextForbidden = new Set(forbiddenTeacherSlots);
      nextForbidden.add(`${violation.teacher}|${violation.day}|${period}`);
      return solveSchedule(students, teachers, meta, nextForbidden, repairDepth + 1);
    }
    const byStudent = new Map();
    const byTeacher = new Map();
    assignments.forEach(item => {
      if (!byStudent.has(item.student)) byStudent.set(item.student, []);
      if (!byTeacher.has(item.teacher)) byTeacher.set(item.teacher, []);
      byStudent.get(item.student).push(item);
      byTeacher.get(item.teacher).push(item);
    });
    const studentSummary = students.map(student => {
      const lessons = byStudent.get(student.student) || [];
      return { student: student.student, grade: student.grade, required: student.required, shareWilling: student.shareWilling, assigned: lessons.length, missing: student.required - lessons.length, same_teacher: new Set(lessons.map(item => item.teacher)).size <= 1, lessons };
    });
    const teacherSummary = teachers.map(teacher => {
      const lessons = byTeacher.get(teacher.name) || [];
      return { teacher: teacher.name, quota: teacher.quota, preferred_quota: teacher.preferred_quota, assignment_limit: teacher.quota, assigned: lessons.length, remaining: teacher.quota - lessons.length, above_preferred_quota: Math.max(0, lessons.length - teacher.preferred_quota), over_base_quota: 0, lessons };
    });
    const requiredHours = students.reduce((sum, student) => sum + student.required, 0);
    return {
      schemaVersion: 2,
      status: "הצעה ראשונית",
      defaultLocks: Object.fromEntries(students.filter(student => student.requiredTeacher).map(student => [student.student, student.requiredTeacher])),
      rules_applied: { subject: meta.subject, aliases: meta.aliases, preferred_periods: "1-6", last_allowed_period: meta.lastPeriod, avoid_periods: meta.avoidPeriods, teacher_capacity_is_maximum: true },
      metrics: { assigned_hours: result.flow, missing_hours: requiredHours - result.flow, unserved_students: studentSummary.filter(item => !item.assigned).length, split_students: studentSummary.filter(item => !item.same_teacher).length, period9_assignments: assignments.filter(item => item.period === 9).length },
      assignments,
      students: studentSummary,
      teachers: teacherSummary
    };
  }

  function projectMeta() {
    const subject = clean(elements.subject.value);
    const aliases = [...new Set([subject, ...splitList(elements.aliases.value)])].filter(Boolean);
    return {
      id: `project-${Date.now()}-${subject.replace(/\s+/g, "-")}`,
      school: clean(elements.school.value), year: clean(elements.year.value), team: clean(elements.team.value) || `צוות ${subject}`, subject, aliases,
      lastPeriod: Number(elements.lastPeriod.value), avoidPeriods: parsePeriods(elements.avoidPeriods.value)
    };
  }

  async function loadStudentFile() {
    const [file] = elements.studentFile.files;
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) {
      state.students = [];
      state.studentErrors = ["הקובץ גדול מ־5MB. יש לפצל אותו או להסיר שורות שאינן נחוצות."];
      elements.studentStatus.className = "file-status error";
      elements.studentStatus.textContent = state.studentErrors[0];
      return updateReview();
    }
    const text = await file.text();
    const meta = projectMeta();
    const errors = headerErrors(text, STUDENT_REQUIRED_HEADERS);
    const parsed = errors.length ? { items: [], errors } : readStudents(parseCsv(text), meta);
    state.students = parsed.items;
    state.studentErrors = parsed.errors;
    elements.studentStatus.className = `file-status ${parsed.errors.length ? "error" : "ok"}`;
    elements.studentStatus.textContent = parsed.errors.length
      ? `${file.name}: ${parsed.errors[0]}${parsed.errors.length > 1 ? ` · ועוד ${parsed.errors.length - 1} בעיות שמפורטות בשלב הבדיקה` : ""}`
      : `${file.name}: נקלטו ${parsed.items.length} תלמידים בהצלחה.`;
    updateReview();
  }

  async function loadTeacherFile() {
    const [file] = elements.teacherFile.files;
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) {
      state.teachers = null;
      state.teacherErrors = ["הקובץ גדול מ־5MB. יש לפצל אותו או להסיר שורות שאינן נחוצות."];
      elements.teacherStatus.className = "file-status error";
      elements.teacherStatus.textContent = state.teacherErrors[0];
      return updateReview();
    }
    const text = await file.text();
    const meta = projectMeta();
    const errors = headerErrors(text, TEACHER_REQUIRED_HEADERS);
    const parsed = errors.length ? { items: [], errors } : readTeachers(parseCsv(text), meta);
    state.teachers = parsed.items;
    state.teacherErrors = parsed.errors;
    elements.teacherStatus.className = `file-status ${parsed.errors.length ? "error" : "ok"}`;
    elements.teacherStatus.textContent = parsed.errors.length
      ? `${file.name}: ${parsed.errors[0]}${parsed.errors.length > 1 ? ` · ועוד ${parsed.errors.length - 1} בעיות שמפורטות בשלב הבדיקה` : ""}`
      : `${file.name}: נקלטו ${parsed.items.length} מורים בהצלחה.`;
    updateReview();
  }

  function crossErrors() {
    if (!state.students || !state.teachers) return [];
    const errors = [];
    const teacherNames = new Set(state.teachers.map(item => item.name));
    state.students.forEach(student => {
      if (student.requiredTeacher && !teacherNames.has(student.requiredTeacher)) errors.push(`מורת החובה של ${student.student} אינה מופיעה בקובץ המורים`);
      if (student.preferredTeacher && !teacherNames.has(student.preferredTeacher)) errors.push(`המורה המועדפת של ${student.student} אינה מופיעה בקובץ המורים`);
      const hasMatch = student.candidates.some(slot => state.teachers.some(teacher => teacherAllows(teacher, student) && teacher.candidates.some(candidate => candidate.day === slot.day && candidate.period === slot.period)));
      if (!hasMatch) errors.push(`לא נמצאה חפיפת זמינות בין ${student.student} לבין מורה מתאימה`);
    });
    return errors;
  }

  function updateReview() {
    const errors = [...state.studentErrors, ...state.teacherErrors, ...crossErrors()];
    const formReady = Boolean(clean(elements.school.value) && clean(elements.subject.value) && state.teachers?.length && !errors.length);
    elements.create.disabled = !formReady;
    if (!state.teachers) {
      elements.review.textContent = "יש להשלים את קובץ המורים לפני פתיחת הפרויקט.";
      return;
    }
    const required = state.students.reduce((sum, item) => sum + item.required, 0);
    const capacity = state.teachers.reduce((sum, item) => sum + item.quota, 0);
    elements.review.innerHTML = `<div class="review-summary"><div><strong>${state.students.length}</strong><span>תלמידים שנקלטו</span></div><div><strong>${required}</strong><span>שעות נדרשות</span></div><div><strong>${capacity}</strong><span>מכסת צוות מרבית</span></div></div>${errors.length ? `<ul class="review-errors">${errors.slice(0, 12).map(error => `<li>${esc(error)}</li>`).join("")}${errors.length > 12 ? `<li>ועוד ${errors.length - 12} בעיות</li>` : ""}</ul>` : `<p class="review-note">${state.students.length ? "הנתונים תקינים. ניתן להפיק הצעת שיבוץ ראשונית." : "הפרויקט ייפתח ללא תלמידים. אפשר לקלוט אותם אחר כך מתוך מאגר התלמידים."}</p>`}`;
  }

  function showStep(index) {
    state.step = Math.max(0, Math.min(3, index));
    document.querySelectorAll(".wizard-step").forEach((step, stepIndex) => {
      const active = stepIndex === state.step;
      step.hidden = !active;
      step.classList.toggle("active", active);
    });
    elements.progressText.textContent = `שלב ${state.step + 1} מתוך 4`;
    elements.progressBar.style.width = `${(state.step + 1) * 25}%`;
    elements.back.hidden = state.step === 0;
    elements.next.hidden = state.step === 3;
    elements.create.hidden = state.step !== 3;
    elements.message.textContent = "";
    if (state.step === 3) updateReview();
    document.querySelector(`.wizard-step[data-step="${state.step}"] input:not([type="file"])`)?.focus();
  }

  function canContinue() {
    if (state.step === 0) {
      if (!clean(elements.subject.value) || !clean(elements.school.value)) {
        elements.message.textContent = "יש למלא את המקצוע ואת שם בית הספר כדי להמשיך.";
        elements.form.reportValidity();
        return false;
      }
    }
    if (state.step === 1 && state.studentErrors.length) {
      elements.message.textContent = state.studentErrors[0];
      elements.studentStatus.textContent = `יש לתקן את הקובץ לפני שממשיכים: ${state.studentErrors[0]}`;
      return false;
    }
    if (state.step === 2 && (!state.teachers?.length || state.teacherErrors.length)) {
      elements.message.textContent = state.teacherErrors[0] || "יש לבחור קובץ מורים תקין כדי להמשיך.";
      elements.teacherStatus.textContent = state.teacherErrors[0] || "יש לבחור קובץ מורים תקין כדי להמשיך.";
      elements.teacherStatus.className = "file-status error";
      return false;
    }
    return true;
  }

  function downloadCsv(filename, headers, rows) {
    const quote = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = `\uFEFF${[headers, ...rows].map(row => row.map(quote).join(",")).join("\r\n")}`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function studentTemplate() {
    downloadCsv("תבנית-תלמידים.csv", STUDENT_HEADERS, [
      ["תלמיד לדוגמה", "יא1", 2, "ראשון", 3, "חלון", "", "", "כן"],
      ["תלמיד לדוגמה", "יא1", 2, "שלישי", 4, "שיעור במקצוע", "", "", "כן"]
    ]);
  }

  function teacherTemplate() {
    downloadCsv("תבנית-מורים.csv", TEACHER_HEADERS, [
      ["מורה לדוגמה", 1, 2, "ראשון", 3, "שעה גמישה", "י;יא", "יא", "0;9", 7, "1;2;4;5"],
      ["מורה לדוגמה", 1, 2, "שלישי", 4, "פנויה", "י;יא", "יא", "0;9", 7, "1;2;3;5"]
    ]);
  }

  function createProject(event) {
    event.preventDefault();
    updateReview();
    if (elements.create.disabled) return;
    const meta = projectMeta();
    const schedule = solveSchedule(state.students, state.teachers, meta);
    const project = {
      kind: "differential-scheduling-project",
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      meta,
      schedule,
      studentAvailability: { schemaVersion: 2, status: "project", period_times: PERIOD_TIMES, students: state.students.map(student => ({ student: student.student, grade: student.grade, hebrew_entitlement: student.required, shareWilling: student.shareWilling, candidates: student.candidates })) },
      teacherAvailability: { schemaVersion: 2, status: "project", teachers: state.teachers }
    };
    try {
      const serialized = JSON.stringify(project);
      localStorage.setItem(activeProjectKey, serialized);
      window.name = `differential-project:${serialized}`;
      location.href = "app.html";
    } catch (_) {
      elements.message.textContent = "לא ניתן לשמור את הפרויקט במכשיר. מומלץ לפנות מקום בדפדפן ולנסות שוב.";
    }
  }

  elements.studentFile.addEventListener("change", loadStudentFile);
  elements.teacherFile.addEventListener("change", loadTeacherFile);
  elements.form.addEventListener("input", updateReview);
  [elements.subject, elements.aliases, elements.lastPeriod, elements.avoidPeriods].forEach(input => input.addEventListener("change", async () => {
    if (elements.studentFile.files.length) await loadStudentFile();
    if (elements.teacherFile.files.length) await loadTeacherFile();
  }));
  elements.form.addEventListener("submit", createProject);
  elements.next.addEventListener("click", () => { if (canContinue()) showStep(state.step + 1); });
  elements.back.addEventListener("click", () => showStep(state.step - 1));
  document.querySelector("#studentTemplateButton").addEventListener("click", studentTemplate);
  document.querySelector("#teacherTemplateButton").addEventListener("click", teacherTemplate);
  showStep(0);
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
