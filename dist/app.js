(() => {
  "use strict";

  const activeProjectKey = "differential-active-project-v1";
  const bundledPayload = window.SCHEDULE_DATA;
  let storedProject = null;
  try {
    const transferPrefix = "differential-project:";
    if (window.name.startsWith(transferPrefix)) {
      storedProject = JSON.parse(window.name.slice(transferPrefix.length));
      window.name = "";
      localStorage.setItem(activeProjectKey, JSON.stringify(storedProject));
    } else {
      storedProject = JSON.parse(localStorage.getItem(activeProjectKey));
    }
  } catch (_) {
    window.name = "";
    localStorage.removeItem(activeProjectKey);
  }
  const payload = storedProject?.schedule && storedProject?.studentAvailability && storedProject?.teacherAvailability
    ? storedProject
    : bundledPayload;
  const projectMeta = payload.meta || {
    id: "empty-project",
    school: "",
    year: "",
    team: "",
    subject: "שיבוצים",
    aliases: []
  };
  const draft = payload.schedule;
  const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי"];
  const times = {
    0: "07:45", 1: "08:30", 2: "09:15", 3: "10:20", 4: "11:05",
    5: "12:05", 6: "12:50", 7: "14:00", 8: "14:45", 9: "15:30"
  };
  const projectId = String(projectMeta.id || `${projectMeta.school || "school"}-${projectMeta.subject || "subject"}`).replace(/[^a-zA-Z0-9א-ת_-]+/g, "-");
  const storageKey = `differential-project-${projectId}-assignments-v1`;
  const lockStorageKey = `differential-project-${projectId}-locks-v1`;
  const defaultLocks = { ...(draft.defaultLocks || {}) };
  const originalAssignments = draft.assignments.map((item, index) => ({ ...item, id: `lesson-${index + 1}` }));
  let assignments = loadSavedAssignments();
  let activeLocks = loadSavedLocks();
  let activeAssignmentId = null;
  let activeView = "schedule";
  let toastTimer = null;

  const elements = {
    teacherFilter: document.querySelector("#teacherFilter"),
    studentSearch: document.querySelector("#studentSearch"),
    grid: document.querySelector("#scheduleGrid"),
    missingList: document.querySelector("#missingList"),
    teacherLoads: document.querySelector("#teacherLoads"),
    validationList: document.querySelector("#validationList"),
    studentsView: document.querySelector("#studentsView"),
    teachersView: document.querySelector("#teachersView"),
    scheduleView: document.querySelector("#scheduleView"),
    dialog: document.querySelector("#editDialog"),
    dialogStudent: document.querySelector("#dialogStudent"),
    dialogCurrent: document.querySelector("#dialogCurrent"),
    alternativeSelect: document.querySelector("#alternativeSelect"),
    dialogNote: document.querySelector("#dialogNote"),
    saveMoveButton: document.querySelector("#saveMoveButton"),
    deleteAssignmentButton: document.querySelector("#deleteAssignmentButton"),
    addDialog: document.querySelector("#addDialog"),
    addStudentSelect: document.querySelector("#addStudentSelect"),
    addStudentStatus: document.querySelector("#addStudentStatus"),
    addOptionSelect: document.querySelector("#addOptionSelect"),
    addDialogNote: document.querySelector("#addDialogNote"),
    addAssignmentButton: document.querySelector("#addAssignmentButton"),
    swapDialog: document.querySelector("#swapDialog"),
    swapStudentSelect: document.querySelector("#swapStudentSelect"),
    swapSuggestions: document.querySelector("#swapSuggestions"),
    locksDialog: document.querySelector("#locksDialog"),
    locksList: document.querySelector("#locksList"),
    toast: document.querySelector("#toast")
  };

  const studentData = new Map(payload.studentAvailability.students.map(student => [student.student, student]));
  const teacherData = new Map(payload.teacherAvailability.teachers.map(teacher => [teacher.name, teacher]));
  const quotas = new Map(draft.teachers.map(teacher => [teacher.teacher, teacher.quota]));
  const assignmentLimits = new Map(draft.teachers.map(teacher => [teacher.teacher, teacher.assignment_limit || teacher.quota]));

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function loadSavedAssignments() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (Array.isArray(saved) && saved.length) return saved;
    } catch (_) {
      localStorage.removeItem(storageKey);
    }
    return originalAssignments.map(item => ({ ...item }));
  }

  function loadSavedLocks() {
    try {
      const saved = JSON.parse(localStorage.getItem(lockStorageKey));
      if (saved && typeof saved === "object" && !Array.isArray(saved)) return saved;
    } catch (_) {
      localStorage.removeItem(lockStorageKey);
    }
    return { ...defaultLocks };
  }

  function saveLocks() {
    localStorage.setItem(lockStorageKey, JSON.stringify(activeLocks));
  }

  function saveAssignments() {
    localStorage.setItem(storageKey, JSON.stringify(assignments));
  }

  function assignmentCounts() {
    const byStudent = new Map();
    const byTeacher = new Map();
    assignments.forEach(item => {
      byStudent.set(item.student, (byStudent.get(item.student) || 0) + 1);
      byTeacher.set(item.teacher, (byTeacher.get(item.teacher) || 0) + 1);
    });
    return { byStudent, byTeacher };
  }

  function currentMetrics() {
    const { byStudent } = assignmentCounts();
    return {
      assigned: assignments.length,
      coveredStudents: draft.students.filter(student => (byStudent.get(student.student) || 0) > 0).length,
      missing: draft.students.reduce((sum, student) => sum + Math.max(0, student.required - (byStudent.get(student.student) || 0)), 0),
      late: assignments.filter(item => item.period === 9).length
    };
  }

  function renderSummary() {
    const metrics = currentMetrics();
    document.querySelector("#assignedCount").textContent = metrics.assigned;
    document.querySelector("#studentCount").textContent = metrics.coveredStudents;
    document.querySelector("#missingCount").textContent = metrics.missing;
    document.querySelector("#lateCount").textContent = metrics.late;
  }

  function filteredAssignments() {
    const selectedTeacher = elements.teacherFilter.value;
    const query = elements.studentSearch.value.trim().toLocaleLowerCase("he");
    return assignments.filter(item => {
      const teacherMatches = selectedTeacher === "all" || item.teacher === selectedTeacher;
      const queryMatches = !query || item.student.toLocaleLowerCase("he").includes(query);
      return teacherMatches && queryMatches;
    });
  }

  function renderGrid() {
    const bySlot = new Map();
    filteredAssignments().forEach(item => {
      const key = `${item.day}-${item.period}`;
      if (!bySlot.has(key)) bySlot.set(key, []);
      bySlot.get(key).push(item);
    });

    const cells = [`<div class="grid-cell grid-head">שעה</div>`];
    days.forEach(day => cells.push(`<div class="grid-cell grid-head">${day}</div>`));
    for (let period = 0; period <= 9; period += 1) {
      cells.push(`<div class="grid-cell period-cell"><strong>${period}</strong><small>${times[period]}</small></div>`);
      days.forEach(day => {
        const lessons = (bySlot.get(`${day}-${period}`) || []).sort((a, b) => a.teacher.localeCompare(b.teacher, "he"));
        const cards = lessons.map(item => {
          const gradeClass = item.grade.startsWith("יא") ? "" : "grade-yod";
          const edgeClass = item.student_slot_type.startsWith("קצה") ? "edge" : "";
          return `<button class="lesson-card ${gradeClass} ${edgeClass}" data-assignment-id="${esc(item.id)}" type="button"><strong>${esc(item.student)}</strong><span>${esc(item.teacher)} · ${esc(item.grade)}</span></button>`;
        }).join("");
        cells.push(`<div class="grid-cell">${cards}</div>`);
      });
    }
    elements.grid.innerHTML = cells.join("");
  }

  function missingStudents() {
    const { byStudent } = assignmentCounts();
    return draft.students.map(student => ({
      ...student,
      assignedNow: byStudent.get(student.student) || 0,
      missingNow: Math.max(0, student.required - (byStudent.get(student.student) || 0))
    })).filter(student => student.missingNow > 0);
  }

  function renderSidebar() {
    const missing = missingStudents();
    elements.missingList.innerHTML = missing.length
      ? missing.map(student => `<article class="missing-card"><strong>${esc(student.student)}</strong><span>${student.missingNow === 1 ? "חסרה שעה אחת" : `חסרות ${student.missingNow} שעות`}</span><button class="secondary-button missing-action" data-add-student="${esc(student.student)}" type="button">הוספת שעה</button></article>`).join("")
      : `<article class="missing-card"><strong>הכול משובץ</strong><span>לא נותרו שעות ללא מענה.</span></article>`;

    const { byTeacher } = assignmentCounts();
    elements.teacherLoads.innerHTML = draft.teachers.map(teacher => {
      const used = byTeacher.get(teacher.teacher) || 0;
      const percentage = Math.min(100, Math.round(used / teacher.quota * 100));
      const optional = (teacher.preferred_quota ?? teacher.quota) < teacher.quota ? "optional" : "";
      const overflow = Math.max(0, used - teacher.quota);
      const preferred = teacher.preferred_quota !== undefined && teacher.preferred_quota !== teacher.quota ? ` · יעד ${teacher.preferred_quota}` : "";
      return `<div class="load-row ${optional}"><div class="load-label"><strong>${esc(teacher.teacher)}</strong><span>${used}/${teacher.quota}${preferred}${overflow ? ` · עודף ${overflow}` : ""}</span></div><div class="load-track"><i style="width:${percentage}%"></i></div></div>`;
    }).join("");
    renderValidation();
  }

  function scheduleWarnings() {
    const warnings = [];
    const { byStudent, byTeacher } = assignmentCounts();
    const splitStudents = draft.students.filter(student => {
      const teachers = new Set(assignments.filter(item => item.student === student.student).map(item => item.teacher));
      return teachers.size > 1;
    });
    const late = assignments.filter(item => item.period === 9);
    const edgeAssignments = assignments.filter(item => item.student_slot_type.startsWith("קצה"));
    const overridden = assignments.filter(item => item.student_slot_type === "דריסת שיעור");
    const hardErrors = [];

    assignments.forEach(item => {
      const teacherLimit = assignmentLimits.get(item.teacher) || 0;
      if ((byTeacher.get(item.teacher) || 0) > teacherLimit) hardErrors.push(`${item.teacher} חורג/ת ממכסת השעות המותרת`);
      if (!candidateForStudent(item.student, item.day, item.period)) hardErrors.push(`השעה של ${item.student} אינה אפשרית לפי מערכת התלמיד/ה`);
      const teacherSlot = teacherData.get(item.teacher)?.candidates.find(candidate => candidate.day === item.day && candidate.period === item.period);
      if (!teacherSlot) hardErrors.push(`השעה של ${item.teacher} אינה פנויה לפי מערכת המורה`);
    });
    const studentSlotKeys = new Set();
    const teacherSlotKeys = new Set();
    assignments.forEach(item => {
      const studentKey = `${item.student}-${item.day}-${item.period}`;
      const teacherKey = `${item.teacher}-${item.day}-${item.period}`;
      if (studentSlotKeys.has(studentKey)) hardErrors.push(`התנגשות אצל ${item.student}`);
      if (teacherSlotKeys.has(teacherKey)) hardErrors.push(`התנגשות אצל ${item.teacher}`);
      studentSlotKeys.add(studentKey);
      teacherSlotKeys.add(teacherKey);
    });
    Object.entries(activeLocks).forEach(([studentName, teacherName]) => {
      if (assignments.some(item => item.student === studentName && item.teacher !== teacherName)) {
        hardErrors.push(`${studentName} אינו/ה משובץ/ת רק אצל ${teacherName}`);
      }
    });
    teacherData.forEach((teacher, teacherName) => {
      if (!teacher.max_consecutive) return;
      days.forEach(day => {
        const periods = (teacher.base_commitments || []).filter(item => item.day === day).map(item => item.period);
        assignments.filter(item => item.teacher === teacherName && item.day === day).forEach(item => periods.push(item.period));
        if (maxConsecutive(periods) > teacher.max_consecutive) hardErrors.push(`ל${teacherName} יש יותר מ-${teacher.max_consecutive} שעות רצופות ביום ${day}`);
      });
    });

    [...new Set(hardErrors)].forEach(text => warnings.push({ level: "error", text }));
    if (splitStudents.length) warnings.push({ level: "warning", text: `${splitStudents.length} תלמידים מפוצלים בין מורות: ${splitStudents.map(item => item.student).join(", ")}` });
    if (late.length) warnings.push({ level: "warning", text: `${late.length} שיבוצים נמצאים בשעה 9` });
    if (edgeAssignments.length) warnings.push({ level: "warning", text: `${edgeAssignments.length} שיבוצים משתמשים בשעת קצה` });
    Object.entries(defaultLocks).forEach(([studentName, teacherName]) => {
      if (!activeLocks[studentName]) warnings.push({ level: "warning", text: `הנעילה ${studentName} ← ${teacherName} משוחררת` });
    });
    if (overridden.length) warnings.push({ level: "warning", text: `${overridden.length} שיבוצים דורסים שיעור רגיל: ${overridden.map(item => `${item.student} (${item.day} ${item.period})`).join(", ")}` });
    draft.teachers.forEach(teacher => {
      const used = byTeacher.get(teacher.teacher) || 0;
      if (teacher.preferred_quota !== undefined && used > teacher.preferred_quota) warnings.push({ level: "warning", text: `${teacher.teacher} משובצ/ת ל-${used} שעות; היעד המועדף הוא ${teacher.preferred_quota}` });
      const source = teacherData.get(teacher.teacher);
      const preferredGrades = source?.preferred_student_grades || (source?.preferred_student_grade ? [source.preferred_student_grade] : []);
      if (!preferredGrades.length) return;
      const mismatches = assignments.filter(item => {
        if (item.teacher !== teacher.teacher) return false;
        const group = item.grade.startsWith("יא") ? "יא" : item.grade.startsWith("יב") ? "יב" : item.grade.startsWith("י") ? "י" : item.grade;
        return !preferredGrades.includes(group) && !preferredGrades.includes(item.grade);
      });
      if (mismatches.length) warnings.push({ level: "warning", text: `ל${teacher.teacher} יש ${mismatches.length} שיבוצים שאינם בשכבות המועדפות` });
    });
    const overAssigned = draft.students.filter(student => (byStudent.get(student.student) || 0) > student.required);
    if (overAssigned.length) warnings.push({ level: "warning", text: `יש שיבוץ מעבר לזכאות אצל: ${overAssigned.map(item => item.student).join(", ")}` });
    const missing = draft.students.reduce((sum, student) => sum + Math.max(0, student.required - (byStudent.get(student.student) || 0)), 0);
    if (missing) warnings.push({ level: "warning", text: `${missing} שעות זכאות עדיין אינן משובצות` });
    if (!warnings.length) warnings.push({ level: "ok", text: "לא נמצאו בעיות או חריגות" });
    return warnings;
  }

  function renderValidation() {
    elements.validationList.innerHTML = scheduleWarnings().map(item => `<div class="validation-item ${item.level === "ok" ? "" : item.level}">${esc(item.text)}</div>`).join("");
  }

  function lessonsForStudent(studentName) {
    return assignments.filter(item => item.student === studentName)
      .sort((a, b) => days.indexOf(a.day) - days.indexOf(b.day) || a.period - b.period);
  }

  function renderStudentsView() {
    const query = elements.studentSearch.value.trim().toLocaleLowerCase("he");
    const rows = draft.students.filter(student => !query || student.student.toLocaleLowerCase("he").includes(query)).map(student => {
      const lessons = lessonsForStudent(student.student);
      const missing = Math.max(0, student.required - lessons.length);
      const lessonLines = lessons.length
        ? lessons.map(item => `<button class="text-button lesson-line" data-assignment-id="${esc(item.id)}" type="button">${esc(item.day)}, שעה ${item.period} · ${esc(item.teacher)}</button>`).join("")
        : "—";
      return `<tr><td><strong>${esc(student.student)}</strong><br><small>${esc(student.grade)}</small></td><td>${student.required}</td><td>${lessonLines}<button class="inline-add-button" data-add-student="${esc(student.student)}" type="button">הוספת שעה</button></td><td><span class="status-badge ${missing ? "warning" : ""}">${missing ? `חסרה ${missing}` : "מלא"}</span></td></tr>`;
    }).join("");
    elements.studentsView.innerHTML = `<div class="list-view"><table class="data-table"><thead><tr><th>תלמיד/ה</th><th>זכאות</th><th>שיבוצים</th><th>מצב</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function renderTeachersView() {
    const selected = elements.teacherFilter.value;
    const cards = draft.teachers.filter(teacher => selected === "all" || teacher.teacher === selected).map(teacher => {
      const lessons = assignments.filter(item => item.teacher === teacher.teacher)
        .sort((a, b) => days.indexOf(a.day) - days.indexOf(b.day) || a.period - b.period);
      const lines = lessons.map(item => `<li><strong>${esc(item.day)}, ${item.period}</strong> · ${esc(item.student)}</li>`).join("");
      const target = teacher.preferred_quota !== undefined && teacher.preferred_quota !== teacher.quota ? ` · יעד ${teacher.preferred_quota}` : "";
      return `<article class="teacher-card"><div class="teacher-card-head"><h3>${esc(teacher.teacher)}</h3><strong>${lessons.length}/${teacher.quota}${target}</strong></div><ul>${lines || "<li>אין שיבוצים</li>"}</ul></article>`;
    }).join("");
    elements.teachersView.innerHTML = `<div class="teacher-cards">${cards || "<p class='empty-filter'>אין תוצאות להצגה.</p>"}</div>`;
  }

  function renderActiveView() {
    elements.scheduleView.hidden = activeView !== "schedule";
    elements.studentsView.hidden = activeView !== "students";
    elements.teachersView.hidden = activeView !== "teachers";
    if (activeView === "schedule") renderGrid();
    if (activeView === "students") renderStudentsView();
    if (activeView === "teachers") renderTeachersView();
  }

  function teacherAllows(teacherName, studentName) {
    if (activeLocks[studentName]) return teacherName === activeLocks[studentName];
    const teacher = teacherData.get(teacherName);
    if (!teacher.allowed_student_grades) return true;
    const grade = draft.students.find(student => student.student === studentName)?.grade;
    const group = grade?.startsWith("יא") ? "יא" : grade?.startsWith("יב") ? "יב" : grade?.startsWith("י") ? "י" : grade;
    return teacher.allowed_student_grades.includes(grade) || teacher.allowed_student_grades.includes(group);
  }

  function candidateForStudent(studentName, day, period) {
    return studentData.get(studentName)?.candidates.find(item => item.day === day && item.period === period) || null;
  }

  function candidateQuality(candidate) {
    const rank = { "חלון": 0, "שיעור במקצוע": 1, "קצה לפני": 3, "קצה אחרי": 3, "דריסת שיעור": 5 };
    (projectMeta.aliases || []).forEach(alias => { rank[alias] = 1; });
    return (rank[candidate?.category] ?? 8) + (candidate?.period === 9 ? 20 : 0);
  }

  function buildSwapSuggestion(firstStudent, secondStudent) {
    const firstLessons = lessonsForStudent(firstStudent);
    const secondLessons = lessonsForStudent(secondStudent);
    if (!firstLessons.length || firstLessons.length !== secondLessons.length) return null;
    const firstTeachers = new Set(firstLessons.map(item => item.teacher));
    const secondTeachers = new Set(secondLessons.map(item => item.teacher));
    if (firstTeachers.size !== 1 || secondTeachers.size !== 1) return null;
    const [firstTeacher] = firstTeachers;
    const [secondTeacher] = secondTeachers;
    if (firstTeacher === secondTeacher) return null;
    if (!teacherAllows(secondTeacher, firstStudent) || !teacherAllows(firstTeacher, secondStudent)) return null;

    const firstDestinations = secondLessons.map(item => candidateForStudent(firstStudent, item.day, item.period));
    const secondDestinations = firstLessons.map(item => candidateForStudent(secondStudent, item.day, item.period));
    if (firstDestinations.some(item => !item) || secondDestinations.some(item => !item)) return null;

    const newQuality = [...firstDestinations, ...secondDestinations].reduce((sum, item) => sum + candidateQuality(item), 0);
    const oldQuality = [...firstLessons, ...secondLessons].reduce((sum, item) => sum + candidateQuality({ category: item.student_slot_type, period: item.period }), 0);
    const warningParts = [];
    const allDestinations = [...firstDestinations, ...secondDestinations];
    const lateCount = allDestinations.filter(item => item.period === 9).length;
    const edgeCount = allDestinations.filter(item => item.category.startsWith("קצה")).length;
    const overrideCount = allDestinations.filter(item => item.category === "דריסת שיעור").length;
    if (lateCount) warningParts.push(`${lateCount} שעות בשעה 9`);
    if (edgeCount) warningParts.push(`${edgeCount} שעות קצה`);
    if (overrideCount) warningParts.push(`${overrideCount} דריסות של שיעור רגיל`);

    return {
      firstStudent,
      secondStudent,
      firstTeacher,
      secondTeacher,
      firstLessonIds: firstLessons.map(item => item.id),
      secondLessonIds: secondLessons.map(item => item.id),
      firstDestinations,
      secondDestinations,
      score: newQuality,
      qualityDelta: newQuality - oldQuality,
      warnings: warningParts,
      firstRoute: secondLessons.map(item => `${item.day} ${item.period}`).join(", "),
      secondRoute: firstLessons.map(item => `${item.day} ${item.period}`).join(", ")
    };
  }

  function findSwapSuggestions(studentName) {
    return draft.students
      .map(item => item.student)
      .filter(name => name !== studentName)
      .map(name => buildSwapSuggestion(studentName, name))
      .filter(Boolean)
      .sort((a, b) => a.score - b.score || a.qualityDelta - b.qualityDelta || a.secondStudent.localeCompare(b.secondStudent, "he"));
  }

  function renderSwapSuggestions() {
    const studentName = elements.swapStudentSelect.value;
    const suggestions = findSwapSuggestions(studentName);
    elements.swapSuggestions._items = suggestions;
    if (!suggestions.length) {
      elements.swapSuggestions.innerHTML = `<div class="swap-empty"><strong>לא נמצאה החלפה מלאה וחוקית.</strong><br>ייתכן שהמורה נעולה לפי כלל שהוגדר. אפשר לנסות תלמיד/ה אחר/ת או לשנות שעה בודדת דרך כרטיסי השיבוץ.</div>`;
      return;
    }
    elements.swapSuggestions.innerHTML = suggestions.map((item, index) => {
      const qualityLabel = item.qualityDelta <= 0 ? "התאמה טובה" : "אפשרי עם פשרה";
      const warningText = item.warnings.length ? item.warnings.join(" · ") : "ללא אזהרות חדשות";
      return `<article class="swap-card"><div class="swap-card-head"><h3>החלפה עם ${esc(item.secondStudent)}</h3><span class="swap-score">${qualityLabel}</span></div><div class="swap-route"><div><strong>${esc(item.firstStudent)} ← ${esc(item.secondTeacher)}</strong>${esc(item.firstRoute)}</div><div><strong>${esc(item.secondStudent)} ← ${esc(item.firstTeacher)}</strong>${esc(item.secondRoute)}</div></div><p class="swap-warnings">${esc(warningText)}</p><button class="primary-button swap-apply" data-swap-index="${index}" type="button">ביצוע ההחלפה</button></article>`;
    }).join("");
  }

  function openSwapDialog() {
    const names = draft.students.map(item => item.student).filter(name => {
      const lessons = lessonsForStudent(name);
      return lessons.length && new Set(lessons.map(item => item.teacher)).size === 1;
    }).sort((a, b) => a.localeCompare(b, "he"));
    elements.swapStudentSelect.innerHTML = names.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join("");
    const firstWithSuggestion = names.find(name => findSwapSuggestions(name).length);
    if (firstWithSuggestion) elements.swapStudentSelect.value = firstWithSuggestion;
    renderSwapSuggestions();
    elements.swapDialog.showModal();
  }

  function assignmentWithNewStudent(assignment, studentName) {
    const candidate = candidateForStudent(studentName, assignment.day, assignment.period);
    const grade = draft.students.find(item => item.student === studentName)?.grade || "";
    return {
      ...assignment,
      student: studentName,
      grade,
      start: candidate.start,
      end: candidate.end,
      student_slot_type: candidate.category,
      avoid_if_possible: Boolean(candidate.avoid_if_possible),
      replaces_student_lesson: candidate.replaces_student_lesson || null
    };
  }

  function applySwap(suggestion) {
    if (!suggestion) return;
    const approved = confirm(`להחליף את כל השעות בין ${suggestion.firstStudent} לבין ${suggestion.secondStudent}?`);
    if (!approved) return;
    const firstIds = new Set(suggestion.firstLessonIds);
    const secondIds = new Set(suggestion.secondLessonIds);
    assignments = assignments.map(item => {
      if (firstIds.has(item.id)) return assignmentWithNewStudent(item, suggestion.secondStudent);
      if (secondIds.has(item.id)) return assignmentWithNewStudent(item, suggestion.firstStudent);
      return item;
    });
    saveAssignments();
    elements.swapDialog.close();
    renderAll();
    showToast("ההחלפה בוצעה ונשמרה במחשב הזה.");
  }

  function openLocksDialog() {
    elements.locksList.innerHTML = Object.entries(defaultLocks).map(([studentName, teacherName]) => {
      const checked = activeLocks[studentName] === teacherName ? "checked" : "";
      return `<div class="lock-row"><div class="lock-copy"><strong>${esc(studentName)}</strong><span>מורה נעולה: ${esc(teacherName)}</span></div><label class="lock-toggle"><span>נעילה פעילה</span><input type="checkbox" data-lock-student="${esc(studentName)}" ${checked}></label></div>`;
    }).join("");
    elements.locksDialog.showModal();
  }

  function commitLocks() {
    const nextLocks = {};
    elements.locksList.querySelectorAll("[data-lock-student]").forEach(input => {
      const studentName = input.dataset.lockStudent;
      if (input.checked) nextLocks[studentName] = defaultLocks[studentName];
    });
    const releasedCount = Object.keys(defaultLocks).length - Object.keys(nextLocks).length;
    activeLocks = nextLocks;
    saveLocks();
    elements.locksDialog.close();
    renderAll();
    showToast(releasedCount ? `${releasedCount} נעילות משוחררות כעת.` : "כל הנעילות פעילות.");
  }

  function maxConsecutive(periods) {
    const sorted = [...new Set(periods)].sort((a, b) => a - b);
    let best = 0;
    let current = 0;
    let previous = null;
    sorted.forEach(period => {
      current = previous !== null && period === previous + 1 ? current + 1 : 1;
      best = Math.max(best, current);
      previous = period;
    });
    return best;
  }

  function teacherConsecutiveOptionIsLegal(teacherName, day, period, currentId) {
    const teacher = teacherData.get(teacherName);
    if (!teacher?.max_consecutive) return true;
    const periods = (teacher.base_commitments || []).filter(item => item.day === day).map(item => item.period);
    assignments.filter(item => item.id !== currentId && item.teacher === teacherName && item.day === day).forEach(item => periods.push(item.period));
    periods.push(period);
    return maxConsecutive(periods) <= teacher.max_consecutive;
  }

  function legalOptionsForStudent(studentName, currentAssignment = null) {
    const student = studentData.get(studentName);
    if (!student) return [];
    const currentId = currentAssignment?.id || null;
    const occupiedByStudent = new Set(assignments.filter(item => item.id !== currentId && item.student === studentName).map(item => `${item.day}-${item.period}`));
    const occupiedByTeacher = new Set(assignments.filter(item => item.id !== currentId).map(item => `${item.teacher}-${item.day}-${item.period}`));
    const teacherCounts = assignmentCounts().byTeacher;
    if (currentAssignment) teacherCounts.set(currentAssignment.teacher, (teacherCounts.get(currentAssignment.teacher) || 1) - 1);
    const options = [];

    student.candidates.forEach(studentSlot => {
      const slotKey = `${studentSlot.day}-${studentSlot.period}`;
      if (occupiedByStudent.has(slotKey)) return;
      teacherData.forEach((teacher, teacherName) => {
        if (!teacherAllows(teacherName, studentName)) return;
        if (teacher.forbidden_periods.includes(studentSlot.period)) return;
        const teacherSlot = teacher.candidates.find(item => item.day === studentSlot.day && item.period === studentSlot.period);
        if (!teacherSlot) return;
        if (occupiedByTeacher.has(`${teacherName}-${slotKey}`)) return;
        if ((teacherCounts.get(teacherName) || 0) >= assignmentLimits.get(teacherName)) return;
        if (!teacherConsecutiveOptionIsLegal(teacherName, studentSlot.day, studentSlot.period, currentId)) return;
        if (studentSlot.period > 9) return;
        const same = Boolean(currentAssignment) && teacherName === currentAssignment.teacher && studentSlot.day === currentAssignment.day && studentSlot.period === currentAssignment.period;
        const siblingTeachers = new Set(assignments.filter(item => item.id !== currentId && item.student === studentName).map(item => item.teacher));
        const createsSplit = siblingTeachers.size > 0 && !siblingTeachers.has(teacherName);
        options.push({
          teacher: teacherName,
          day: studentSlot.day,
          period: studentSlot.period,
          start: studentSlot.start,
          end: studentSlot.end,
          student_slot_type: studentSlot.category,
          teacher_slot_type: teacherSlot.category,
          replaces_for_teacher: teacherSlot.replaces,
          replaces_student_lesson: studentSlot.replaces_student_lesson || null,
          avoid_if_possible: Boolean(studentSlot.avoid_if_possible),
          same,
          createsSplit
        });
      });
    });
    return options.sort((a, b) => Number(b.same) - Number(a.same) || Number(a.period === 9) - Number(b.period === 9) || days.indexOf(a.day) - days.indexOf(b.day) || a.period - b.period || a.teacher.localeCompare(b.teacher, "he"));
  }

  function legalAlternatives(assignment) {
    return legalOptionsForStudent(assignment.student, assignment);
  }

  function optionLabel(option) {
    const flags = [];
    if (option.same) flags.push("נוכחי");
    if (option.period === 9) flags.push("שעה 9");
    if (option.student_slot_type.startsWith("קצה")) flags.push("קצה");
    if (option.student_slot_type === "דריסת שיעור") flags.push("דריסת שיעור רגיל");
    if (option.createsSplit) flags.push("פיצול מורה");
    return `${option.day}, שעה ${option.period} · ${option.teacher}${flags.length ? ` — ${flags.join(", ")}` : ""}`;
  }

  function optionWarnings(option, currentAssignment = null, studentName = null) {
    const warnings = [];
    if (option.period === 9) warnings.push("זו שעה 9, שממנה ביקשת להימנע ככל האפשר");
    if (option.createsSplit) warnings.push("השינוי יפצל את התלמיד/ה בין שתי מורות");
    if (option.student_slot_type === "דריסת שיעור") warnings.push(`השינוי ידרוס שיעור רגיל${option.replaces_student_lesson ? `: ${option.replaces_student_lesson}` : ""}`);
    const counts = assignmentCounts().byTeacher;
    const teacherSummary = draft.teachers.find(item => item.teacher === option.teacher);
    const preferredQuota = teacherSummary?.preferred_quota ?? teacherSummary?.quota;
    const projectedTeacher = (counts.get(option.teacher) || 0) - (currentAssignment?.teacher === option.teacher ? 1 : 0) + 1;
    if (preferredQuota !== undefined && teacherSummary && projectedTeacher > preferredQuota && projectedTeacher <= teacherSummary.quota) {
      warnings.push(`${option.teacher} תחרוג מהיעד המועדף של ${preferredQuota} שעות, אך לא מהמכסה המרבית`);
    }
    const selectedStudent = studentName || currentAssignment?.student;
    const selectedGrade = draft.students.find(item => item.student === selectedStudent)?.grade || "";
    const preferredGrades = teacherData.get(option.teacher)?.preferred_student_grades || (teacherData.get(option.teacher)?.preferred_student_grade ? [teacherData.get(option.teacher).preferred_student_grade] : []);
    const selectedGroup = selectedGrade.startsWith("יא") ? "יא" : selectedGrade.startsWith("יב") ? "יב" : selectedGrade.startsWith("י") ? "י" : selectedGrade;
    if (preferredGrades.length && !preferredGrades.includes(selectedGrade) && !preferredGrades.includes(selectedGroup)) {
      warnings.push(`השכבה של התלמיד/ה אינה בין השכבות המועדפות אצל ${option.teacher}`);
    }
    return warnings;
  }

  function updateDialogOptionNote() {
    const option = elements.alternativeSelect._options?.[Number(elements.alternativeSelect.value)];
    if (!option) return;
    const current = assignments.find(item => item.id === activeAssignmentId);
    const warnings = optionWarnings(option, current);
    elements.dialogNote.textContent = warnings.length
      ? `לתשומת לבך: ${warnings.join("; ")}.`
      : "האפשרות עומדת באילוצים ואינה מוסיפה חריגה.";
  }

  function openEditor(assignmentId) {
    const assignment = assignments.find(item => item.id === assignmentId);
    if (!assignment) return;
    activeAssignmentId = assignmentId;
    elements.dialogStudent.textContent = assignment.student;
    elements.dialogCurrent.innerHTML = `<strong>השיבוץ הנוכחי:</strong> ${esc(assignment.day)}, שעה ${assignment.period} (${esc(assignment.start)}–${esc(assignment.end)}) אצל ${esc(assignment.teacher)}.`;
    const options = legalAlternatives(assignment);
    elements.alternativeSelect.innerHTML = options.map((option, index) => `<option value="${index}">${esc(optionLabel(option))}</option>`).join("");
    elements.alternativeSelect._options = options;
    elements.saveMoveButton.disabled = options.length === 0;
    if (options.length) updateDialogOptionNote();
    else elements.dialogNote.textContent = "לא נמצאה כרגע אפשרות חלופית חוקית.";
    elements.dialog.showModal();
  }

  function saveMove() {
    const assignment = assignments.find(item => item.id === activeAssignmentId);
    const option = elements.alternativeSelect._options?.[Number(elements.alternativeSelect.value)];
    if (!assignment || !option) return;
    Object.assign(assignment, option);
    saveAssignments();
    elements.dialog.close();
    renderAll();
    showToast("השיבוץ עודכן ונשמר במחשב הזה.");
  }

  function openAddDialog(preselectedStudent = null) {
    const missing = new Map(missingStudents().map(item => [item.student, item.missingNow]));
    const names = draft.students.map(item => item.student).sort((a, b) => {
      const missingDelta = (missing.get(b) || 0) - (missing.get(a) || 0);
      return missingDelta || a.localeCompare(b, "he");
    });
    elements.addStudentSelect.innerHTML = names.map(name => {
      const suffix = missing.has(name) ? ` — חסרות ${missing.get(name)}` : "";
      return `<option value="${esc(name)}">${esc(name + suffix)}</option>`;
    }).join("");
    if (preselectedStudent && names.includes(preselectedStudent)) elements.addStudentSelect.value = preselectedStudent;
    else if (missing.size) elements.addStudentSelect.value = names.find(name => missing.has(name));
    refreshAddDialog();
    elements.addDialog.showModal();
  }

  function refreshAddDialog() {
    const studentName = elements.addStudentSelect.value;
    const student = draft.students.find(item => item.student === studentName);
    if (!student) return;
    const assigned = lessonsForStudent(studentName).length;
    const missing = Math.max(0, student.required - assigned);
    elements.addStudentStatus.innerHTML = `<strong>מצב נוכחי:</strong> ${assigned} מתוך ${student.required} שעות משובצות${missing ? ` · חסרות ${missing}` : " · הזכאות מלאה"}.`;
    const options = legalOptionsForStudent(studentName);
    elements.addOptionSelect.innerHTML = options.map((option, index) => `<option value="${index}">${esc(optionLabel(option))}</option>`).join("");
    elements.addOptionSelect._options = options;
    elements.addAssignmentButton.disabled = options.length === 0;
    if (!options.length) {
      elements.addDialogNote.textContent = "לא נמצאה אפשרות פנויה שעומדת באילוצי התלמיד/ה והמורות.";
      return;
    }
    updateAddDialogNote();
  }

  function updateAddDialogNote() {
    const studentName = elements.addStudentSelect.value;
    const student = draft.students.find(item => item.student === studentName);
    const option = elements.addOptionSelect._options?.[Number(elements.addOptionSelect.value)];
    if (!student || !option) return;
    const warnings = optionWarnings(option, null, studentName);
    const assigned = lessonsForStudent(studentName).length;
    if (assigned >= student.required) warnings.unshift("הוספת השעה תיצור שיבוץ מעבר לזכאות הרשומה");
    elements.addDialogNote.textContent = warnings.length
      ? `לתשומת לבך: ${warnings.join("; ")}.`
      : "האפשרות פנויה ועומדת באילוצים שהוגדרו.";
  }

  function addAssignment() {
    const studentName = elements.addStudentSelect.value;
    const student = draft.students.find(item => item.student === studentName);
    const option = elements.addOptionSelect._options?.[Number(elements.addOptionSelect.value)];
    if (!student || !option) return;
    const assigned = lessonsForStudent(studentName).length;
    if (assigned >= student.required && !confirm(`${studentName} כבר קיבל/ה את מלוא הזכאות. להוסיף שעה עודפת בכל זאת?`)) return;
    assignments.push({
      id: `manual-${Date.now()}-${assignments.length + 1}`,
      student: studentName,
      grade: student.grade,
      teacher: option.teacher,
      day: option.day,
      period: option.period,
      start: option.start,
      end: option.end,
      student_slot_type: option.student_slot_type,
      teacher_slot_type: option.teacher_slot_type,
      replaces_for_teacher: option.replaces_for_teacher || null,
      replaces_student_lesson: option.replaces_student_lesson || null,
      avoid_if_possible: Boolean(option.avoid_if_possible)
    });
    saveAssignments();
    elements.addDialog.close();
    renderAll();
    showToast(`נוספה שעה עבור ${studentName}.`);
  }

  function deleteAssignment() {
    const assignment = assignments.find(item => item.id === activeAssignmentId);
    if (!assignment) return;
    const remaining = lessonsForStudent(assignment.student).length - 1;
    const student = draft.students.find(item => item.student === assignment.student);
    const shortage = Math.max(0, (student?.required || 0) - remaining);
    const warning = shortage ? ` לאחר ההסרה יחסרו לתלמיד/ה ${shortage} שעות.` : "";
    if (!confirm(`להסיר את השיבוץ של ${assignment.student} ביום ${assignment.day}, שעה ${assignment.period}, אצל ${assignment.teacher}?${warning}`)) return;
    assignments = assignments.filter(item => item.id !== activeAssignmentId);
    activeAssignmentId = null;
    saveAssignments();
    elements.dialog.close();
    renderAll();
    showToast("השעה הוסרה. המערכת מציגה כעת את החוסר שנוצר.");
  }

  function renderAll() {
    renderSummary();
    renderSidebar();
    renderActiveView();
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2600);
  }

  function openDeputyReport() {
    const reportWindow = window.open("", "_blank");
    if (!reportWindow) {
      showToast("הדפדפן חסם את פתיחת הדו״ח. יש לאפשר חלונות קופצים ולנסות שוב.");
      return;
    }
    const metrics = currentMetrics();
    const reportDate = new Intl.DateTimeFormat("he-IL", { dateStyle: "long" }).format(new Date());
    const rows = draft.students.map(student => {
      const lessons = lessonsForStudent(student.student);
      const missing = Math.max(0, student.required - lessons.length);
      const lessonText = lessons.length
        ? lessons.map(item => `${item.day}, שעה ${item.period} (${item.start}–${item.end}) — ${item.teacher}`).join("<br>")
        : "לא שובץ";
      return `<tr><td><strong>${esc(student.student)}</strong></td><td>${esc(student.grade)}</td><td>${student.required}</td><td>${lessonText}</td><td class="${missing ? "problem" : "ok"}">${missing ? `חסרה ${missing}` : "מלא"}</td></tr>`;
    }).join("");
    const warnings = scheduleWarnings().map(item => `<li>${esc(item.text)}</li>`).join("");
    reportWindow.document.write(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>דו״ח שיבוצי ${esc(projectMeta.subject)} דיפרנציאליים</title><style>
      @page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{margin:0;color:#15243a;font-family:Arial,"Noto Sans Hebrew",sans-serif;font-size:12px}header{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:12px;border-bottom:3px solid #1c426d}h1{margin:0 0 5px;font-size:24px}p{margin:0;color:#5d6b7e}.actions{margin:16px 0}.actions button{padding:9px 14px;border:0;border-radius:6px;color:white;background:#1f5fae;font:inherit;font-weight:700;cursor:pointer}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}.summary div{padding:10px;border:1px solid #d9e0e9;border-radius:7px}.summary strong{display:block;font-size:18px;color:#183b65}.summary span{color:#647287}table{width:100%;border-collapse:collapse}th,td{padding:7px 8px;text-align:right;vertical-align:top;border:1px solid #d9e0e9;line-height:1.45}th{background:#edf3f9;color:#183b65}.ok{color:#126b61;font-weight:700}.problem{color:#9b4f00;font-weight:700}.notes{margin-top:14px;padding:10px 13px;background:#f5f7fa;border-radius:7px}.notes h2{margin:0 0 7px;font-size:14px}.notes ul{margin:0;padding-right:18px}.notes li{margin:3px 0}.footer{margin-top:9px;color:#6d798a;font-size:10px}@media print{.actions{display:none}thead{display:table-header-group}tr{break-inside:avoid}}
    </style></head><body><header><div><h1>דו״ח שיבוצי ${esc(projectMeta.subject)} דיפרנציאליים</h1><p>${esc(projectMeta.school)} · ${esc(projectMeta.year)}</p></div><p>הופק בתאריך ${esc(reportDate)}</p></header><div class="actions"><button onclick="window.print()">הדפסה / שמירה כ־PDF</button></div><section class="summary"><div><strong>${metrics.assigned}</strong><span>שעות משובצות</span></div><div><strong>${metrics.coveredStudents}</strong><span>תלמידים שקיבלו מענה</span></div><div><strong>${metrics.missing}</strong><span>שעות חסרות</span></div><div><strong>${metrics.late}</strong><span>שיבוצים בשעה 9</span></div></section><table><thead><tr><th>שם התלמיד/ה</th><th>כיתה</th><th>זכאות</th><th>שעות ומורה</th><th>מצב</th></tr></thead><tbody>${rows}</tbody></table><section class="notes"><h2>הערות ובקרות</h2><ul>${warnings}</ul></section><p class="footer">הדו״ח משקף את הטיוטה השמורה במחשב בעת הפקתו.</p></body></html>`);
    reportWindow.document.close();
  }

  function exportDraft() {
    const exportPayload = {
      kind: "differential-scheduling-project",
      schemaVersion: 1,
      title: `טיוטת שיבוצי ${projectMeta.subject} דיפרנציאליים`,
      exportedAt: new Date().toISOString(),
      meta: projectMeta,
      schedule: { ...draft, assignments },
      studentAvailability: payload.studentAvailability,
      teacherAvailability: payload.teacherAvailability,
      metrics: currentMetrics(),
      assignments,
      locks: activeLocks,
      missingStudents: missingStudents().map(student => ({ student: student.student, missing: student.missingNow }))
    };
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `פרויקט-שיבוצי-${projectMeta.subject || "דיפרנציאלי"}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast("הטיוטה הורדה כקובץ JSON.");
  }

  function validateBackupFile(data) {
    if (!data || !Array.isArray(data.assignments)) {
      throw new Error("הקובץ אינו גיבוי תקין של מערכת השיבוצים.");
    }
    const knownStudents = new Set(draft.students.map(student => student.student));
    const knownTeachers = new Set(draft.teachers.map(teacher => teacher.teacher));
    data.assignments.forEach((item, index) => {
      if (!item || !knownStudents.has(item.student)) throw new Error(`בשיבוץ מספר ${index + 1} מופיע תלמיד שאינו קיים במערכת.`);
      if (!knownTeachers.has(item.teacher)) throw new Error(`בשיבוץ מספר ${index + 1} מופיעה מורה שאינה קיימת במערכת.`);
      if (!days.includes(item.day) || !Number.isInteger(item.period) || item.period < 0 || item.period > 9) {
        throw new Error(`בשיבוץ מספר ${index + 1} היום או השעה אינם תקינים.`);
      }
    });
    return data.assignments.map((item, index) => ({ ...item, id: item.id || `imported-${Date.now()}-${index + 1}` }));
  }

  function locksFromBackup(data) {
    if (data.locks === undefined) return { ...defaultLocks };
    if (!data.locks || typeof data.locks !== "object" || Array.isArray(data.locks)) {
      throw new Error("נתוני הנעילות בגיבוי אינם תקינים.");
    }
    const restored = {};
    Object.entries(data.locks).forEach(([studentName, teacherName]) => {
      if (defaultLocks[studentName] !== teacherName) throw new Error("הגיבוי כולל נעילה שאינה מוכרת למערכת.");
      restored[studentName] = teacherName;
    });
    return restored;
  }

  async function importDraft(file) {
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed?.kind === "differential-scheduling-project" && parsed.schedule && parsed.studentAvailability && parsed.teacherAvailability) {
        const projectName = parsed.meta?.team || parsed.meta?.subject || "הפרויקט החדש";
        if (!confirm(`לטעון את ${projectName} במקום הפרויקט המוצג כעת?`)) return;
        localStorage.setItem(activeProjectKey, JSON.stringify(parsed));
        location.reload();
        return;
      }
      const importedAssignments = validateBackupFile(parsed);
      const importedLocks = locksFromBackup(parsed);
      const shouldReplace = confirm(`הגיבוי כולל ${importedAssignments.length} שיבוצים. לטעון אותו במקום הטיוטה הנוכחית?`);
      if (!shouldReplace) return;
      assignments = importedAssignments;
      activeLocks = importedLocks;
      saveAssignments();
      saveLocks();
      renderAll();
      const issues = scheduleWarnings().filter(item => item.level !== "ok").length;
      showToast(issues ? `הגיבוי נטען. נמצאו ${issues} התראות לבדיקה.` : "הגיבוי נטען בהצלחה ולא נמצאו בעיות.");
    } catch (error) {
      alert(error instanceof Error ? error.message : "לא ניתן לקרוא את קובץ הגיבוי.");
    }
  }

  function resetLocalChanges() {
    if (!confirm("לאפס את כל השינויים המקומיים ולחזור לטיוטה המקורית?")) return;
    assignments = originalAssignments.map(item => ({ ...item }));
    activeLocks = { ...defaultLocks };
    localStorage.removeItem(storageKey);
    localStorage.removeItem(lockStorageKey);
    renderAll();
    showToast("השינויים המקומיים אופסו.");
  }

  function registerWebMcpTools() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const controller = new AbortController();
    const register = tool => Promise.resolve(context.registerTool(tool, { signal: controller.signal })).catch(() => {});
    register({
      name: "read_schedule_summary",
      title: "קריאת סיכום השיבוץ",
      description: "מחזיר סיכום עדכני של שעות משובצות, שעות חסרות ומכסות הצוות, ללא שינוי במערכת.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute() {
        return { metrics: currentMetrics(), missingStudentCount: missingStudents().length };
      }
    });
    register({
      name: "filter_schedule_by_teacher",
      title: "סינון המערכת לפי מורה",
      description: "מציג במערכת השבועית רק את השיבוצים של מורה אחת, או מחזיר לתצוגת כל הצוות.",
      inputSchema: {
        type: "object",
        properties: { teacher: { type: "string", description: "שם המורה, או 'הכול'" } },
        required: ["teacher"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const requested = input?.teacher;
        const value = requested === "הכול" ? "all" : requested;
        if (!["all", ...teacherData.keys()].includes(value)) throw new Error("שם המורה אינו קיים במערכת");
        elements.teacherFilter.value = value;
        activeView = "schedule";
        document.querySelectorAll(".view-tab").forEach(button => button.classList.toggle("active", button.dataset.view === activeView));
        renderActiveView();
        return { shownTeacher: value === "all" ? "כל הצוות" : value, assignmentsShown: filteredAssignments().length };
      }
    });
  }

  draft.teachers.forEach(({ teacher }) => {
    const option = document.createElement("option");
    option.value = teacher;
    option.textContent = teacher;
    elements.teacherFilter.append(option);
  });

  const isEmptyProject = draft.students.length === 0 && draft.teachers.length === 0;
  document.querySelector("#projectEyebrow").textContent = isEmptyProject ? "מערכת שיבוצים דיפרנציאליים" : `${projectMeta.school || "בית הספר"} · ${projectMeta.year || ""}`;
  document.querySelector("#projectTitle").textContent = isEmptyProject ? "פרויקט חדש" : `שיבוצי ${projectMeta.subject || "דיפרנציאליים"} דיפרנציאליים`;
  document.title = isEmptyProject ? "מערכת שיבוצים דיפרנציאליים" : `${projectMeta.subject || "שיבוצים"} — ${projectMeta.school || "מערכת דיפרנציאלית"}`;
  document.querySelector("#emptyProjectState").hidden = !isEmptyProject;
  const defaultProjectButton = document.querySelector("#defaultProjectButton");
  defaultProjectButton.hidden = !storedProject;
  defaultProjectButton.addEventListener("click", () => {
    if (!confirm("לסגור את הפרויקט הנוכחי ולחזור למסך הריק? מומלץ לייצא גיבוי לפני המעבר.")) return;
    localStorage.removeItem(activeProjectKey);
    location.reload();
  });

  document.querySelectorAll(".view-tab").forEach(button => button.addEventListener("click", () => {
    activeView = button.dataset.view;
    document.querySelectorAll(".view-tab").forEach(tab => tab.classList.toggle("active", tab === button));
    renderActiveView();
  }));
  elements.teacherFilter.addEventListener("change", renderActiveView);
  elements.studentSearch.addEventListener("input", renderActiveView);
  document.body.addEventListener("click", event => {
    const addTarget = event.target.closest("[data-add-student]");
    if (addTarget) {
      openAddDialog(addTarget.dataset.addStudent);
      return;
    }
    const target = event.target.closest("[data-assignment-id]");
    if (target) openEditor(target.dataset.assignmentId);
  });
  elements.saveMoveButton.addEventListener("click", saveMove);
  elements.deleteAssignmentButton.addEventListener("click", deleteAssignment);
  elements.alternativeSelect.addEventListener("change", updateDialogOptionNote);
  document.querySelector("#manualButton").addEventListener("click", () => openAddDialog());
  elements.addStudentSelect.addEventListener("change", refreshAddDialog);
  elements.addOptionSelect.addEventListener("change", updateAddDialogNote);
  elements.addAssignmentButton.addEventListener("click", addAssignment);
  document.querySelector("#swapButton").addEventListener("click", openSwapDialog);
  elements.swapStudentSelect.addEventListener("change", renderSwapSuggestions);
  elements.swapSuggestions.addEventListener("click", event => {
    const button = event.target.closest("[data-swap-index]");
    if (button) applySwap(elements.swapSuggestions._items?.[Number(button.dataset.swapIndex)]);
  });
  document.querySelector("#locksButton").addEventListener("click", openLocksDialog);
  document.querySelector("#saveLocksButton").addEventListener("click", commitLocks);
  document.querySelector("#reportButton").addEventListener("click", openDeputyReport);
  document.querySelector("#exportButton").addEventListener("click", exportDraft);
  const importFile = document.querySelector("#importFile");
  document.querySelector("#importButton").addEventListener("click", () => importFile.click());
  document.querySelector("#emptyImportButton").addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", async () => {
    const [file] = importFile.files;
    if (file) await importDraft(file);
    importFile.value = "";
  });
  document.querySelector("#resetButton").addEventListener("click", resetLocalChanges);

  renderAll();
  registerWebMcpTools();
})();
