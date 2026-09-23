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
      try { localStorage.setItem(activeProjectKey, JSON.stringify(storedProject)); } catch (_) { /* The transferred project can still run for this session. */ }
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
  const constraintStorageKey = `differential-project-${projectId}-constraints-v1`;
  const shareStorageKey = `differential-project-${projectId}-share-v1`;
  const historyStorageKey = `differential-project-${projectId}-history-v1`;
  const dismissedWarningStorageKey = `differential-project-${projectId}-dismissed-warnings-v1`;
  const registryStorageKey = "differential-student-registry-v1";
  const lastBackupKey = "differential-last-backup-v1";
  const maxBackupBytes = 15 * 1024 * 1024;
  const defaultLocks = { ...(draft.defaultLocks || {}) };
  const originalAssignments = draft.assignments.map((item, index) => ({ ...item, id: `lesson-${index + 1}` }));
  let assignments = loadSavedAssignments();
  let activeLocks = loadSavedLocks();
  let activeConstraints = loadSavedConstraints();
  let shareWilling = loadShareWilling();
  let studentRegistry = loadStudentRegistry();
  let undoHistory = loadUndoHistory();
  let activeRegistryStudentId = null;
  let studentWizardStep = 0;
  let detailStudentId = null;
  let pendingRegistrySchedule = null;
  let shadowSchedule = null;
  let shadowMode = "blocked";
  let shadowDrawing = false;
  let shadowPaintedSlots = new Set();
  let activeAssignmentId = null;
  let activeView = "schedule";
  let toastTimer = null;
  let saveStateTimer = null;
  let isScheduling = false;
  let dismissedWarnings = loadDismissedWarnings();
  let pendingSchedulePlan = null;
  let teacherShadowSchedule = null;
  let teacherShadowMode = "blocked";
  let teacherShadowDrawing = false;
  let teacherShadowPaintedSlots = new Set();
  let activeTeacherEditorName = null;

  const elements = {
    teacherFilter: document.querySelector("#teacherFilter"),
    studentSearch: document.querySelector("#studentSearch"),
    grid: document.querySelector("#scheduleGrid"),
    missingList: document.querySelector("#missingList"),
    teacherLoads: document.querySelector("#teacherLoads"),
    validationList: document.querySelector("#validationList"),
    studentsView: document.querySelector("#studentsView"),
    teachersView: document.querySelector("#teachersView"),
    registryView: document.querySelector("#registryView"),
    toolbarTitle: document.querySelector("#toolbarTitle"),
    toolbarDescription: document.querySelector("#toolbarDescription"),
    searchControl: document.querySelector("#searchControl"),
    teacherFilterControl: document.querySelector("#teacherFilterControl"),
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
    recalculateDialog: document.querySelector("#recalculateDialog"),
    recalculateSummary: document.querySelector("#recalculateSummary"),
    applySchedulePlanButton: document.querySelector("#applySchedulePlanButton"),
    swapDialog: document.querySelector("#swapDialog"),
    swapStudentSelect: document.querySelector("#swapStudentSelect"),
    swapShowEdges: document.querySelector("#swapShowEdges"),
    swapSuggestions: document.querySelector("#swapSuggestions"),
    locksDialog: document.querySelector("#locksDialog"),
    locksList: document.querySelector("#locksList"),
    shareDialog: document.querySelector("#shareDialog"),
    shareWillingList: document.querySelector("#shareWillingList"),
    shareSuggestions: document.querySelector("#shareSuggestions"),
    constraintsDialog: document.querySelector("#constraintsDialog"),
    constraintsList: document.querySelector("#constraintsList"),
    constraintType: document.querySelector("#constraintType"),
    constraintPerson: document.querySelector("#constraintPerson"),
    constraintDay: document.querySelector("#constraintDay"),
    constraintPeriod: document.querySelector("#constraintPeriod"),
    nextActionPanel: document.querySelector("#nextActionPanel"),
    nextActionTitle: document.querySelector("#nextActionTitle"),
    nextActionDescription: document.querySelector("#nextActionDescription"),
    nextActionButton: document.querySelector("#nextActionButton"),
    reviewWarningsButton: document.querySelector("#reviewWarningsButton"),
    undoButton: document.querySelector("#undoButton"),
    saveStateText: document.querySelector("#saveStateText"),
    attentionPanel: document.querySelector("#attentionPanel"),
    studentRegistryDialog: document.querySelector("#studentRegistryDialog"),
    studentRegistryDialogTitle: document.querySelector("#studentRegistryDialogTitle"),
    registryStudentName: document.querySelector("#registryStudentName"),
    registryStudentGrade: document.querySelector("#registryStudentGrade"),
    requestRows: document.querySelector("#requestRows"),
    registryScheduleFile: document.querySelector("#registryScheduleFile"),
    registryScheduleStatus: document.querySelector("#registryScheduleStatus"),
    openShadowScheduleButton: document.querySelector("#openShadowScheduleButton"),
    shadowScheduleEditor: document.querySelector("#shadowScheduleEditor"),
    shadowScheduleGrid: document.querySelector("#shadowScheduleGrid"),
    shadowScheduleSummary: document.querySelector("#shadowScheduleSummary"),
    registryShareWilling: document.querySelector("#registryShareWilling"),
    saveRegistryStudentButton: document.querySelector("#saveRegistryStudentButton"),
    addRequestRowButton: document.querySelector("#addRequestRowButton"),
    studentWizardProgress: document.querySelector("#studentWizardProgress"),
    studentWizardBar: document.querySelector("#studentWizardBar"),
    studentWizardBack: document.querySelector("#studentWizardBack"),
    studentWizardNext: document.querySelector("#studentWizardNext"),
    studentWizardMessage: document.querySelector("#studentWizardMessage"),
    registryAllowOtherLessons: document.querySelector("#registryAllowOtherLessons"),
    registryNoPeriodZero: document.querySelector("#registryNoPeriodZero"),
    registryExceptionNotes: document.querySelector("#registryExceptionNotes"),
    studentDetailDialog: document.querySelector("#studentDetailDialog"),
    studentDetailTitle: document.querySelector("#studentDetailTitle"),
    studentDetailContent: document.querySelector("#studentDetailContent"),
    editStudentFromDetail: document.querySelector("#editStudentFromDetail"),
    settingsDialog: document.querySelector("#settingsDialog"),
    managementDialog: document.querySelector("#managementDialog"),
    teamManagerDialog: document.querySelector("#teamManagerDialog"),
    teamManagerList: document.querySelector("#teamManagerList"),
    teacherEditorDialog: document.querySelector("#teacherEditorDialog"),
    teacherEditorMessage: document.querySelector("#teacherEditorMessage"),
    newTeacherName: document.querySelector("#newTeacherName"),
    newTeacherPreferredQuota: document.querySelector("#newTeacherPreferredQuota"),
    newTeacherQuota: document.querySelector("#newTeacherQuota"),
    newTeacherMaxConsecutive: document.querySelector("#newTeacherMaxConsecutive"),
    newTeacherGrades: document.querySelector("#newTeacherGrades"),
    newTeacherPreferredGrades: document.querySelector("#newTeacherPreferredGrades"),
    teacherShadowGrid: document.querySelector("#teacherShadowGrid"),
    teacherShadowSummary: document.querySelector("#teacherShadowSummary"),
    teacherRulesDialog: document.querySelector("#teacherRulesDialog"),
    ruleTeacher: document.querySelector("#ruleTeacher"),
    reviewDialog: document.querySelector("#reviewDialog"),
    reviewList: document.querySelector("#reviewList"),
    schedulingBusy: document.querySelector("#schedulingBusy"),
    privacyDialog: document.querySelector("#privacyDialog"),
    lastBackupText: document.querySelector("#lastBackupText"),
    toast: document.querySelector("#toast")
  };

  const studentData = new Map(payload.studentAvailability.students.map(student => [student.student, student]));
  const teacherData = new Map(payload.teacherAvailability.teachers.map(teacher => [teacher.name, teacher]));
  const quotas = new Map(draft.teachers.map(teacher => [teacher.teacher, teacher.preferred_quota ?? teacher.quota]));
  const assignmentLimits = new Map(draft.teachers.map(teacher => [teacher.teacher, teacher.assignment_limit ?? teacher.quota]));

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

  function loadSavedConstraints() {
    try {
      const saved = JSON.parse(localStorage.getItem(constraintStorageKey));
      if (Array.isArray(saved)) return saved;
    } catch (_) {
      localStorage.removeItem(constraintStorageKey);
    }
    return Array.isArray(payload.constraints) ? payload.constraints : [];
  }

  function loadShareWilling() {
    const defaults = { ...Object.fromEntries(draft.students.map(student => [student.student, Boolean(student.shareWilling || payload.studentAvailability.students.find(item => item.student === student.student)?.shareWilling)])), ...(payload.shareWilling || {}) };
    try {
      const saved = JSON.parse(localStorage.getItem(shareStorageKey));
      if (saved && typeof saved === "object" && !Array.isArray(saved)) return { ...defaults, ...saved };
    } catch (_) {
      localStorage.removeItem(shareStorageKey);
    }
    return defaults;
  }

  function loadStudentRegistry() {
    let saved = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(registryStorageKey));
      if (Array.isArray(parsed)) saved = parsed;
    } catch (_) {
      localStorage.removeItem(registryStorageKey);
    }
    if (Array.isArray(payload.studentRegistry)) {
      const merged = new Map(payload.studentRegistry.map(item => [item.id || item.fullName, item]));
      saved.forEach(item => merged.set(item.id || item.fullName, item));
      saved = [...merged.values()];
    }
    const byName = new Map(saved.map(item => [item.fullName, item]));
    draft.students.forEach(student => {
      if (byName.has(student.student)) return;
      const availability = payload.studentAvailability.students.find(item => item.student === student.student);
      byName.set(student.student, {
        id: `imported-${student.student}`,
        fullName: student.student,
        grade: student.grade,
        requests: [{ subject: projectMeta.subject || "מקצוע", hours: student.required }],
        shareWilling: Boolean(student.shareWilling || availability?.shareWilling),
        schedule: null,
        progress: { [projectMeta.subject || "מקצוע"]: { assigned: student.assigned || 0 } },
        source: "project",
        projectStudentName: student.student,
        exceptions: { allowOtherLessons: false, noPeriodZero: false, notes: "" }
      });
    });
    return [...byName.values()];
  }

  function loadUndoHistory() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(historyStorageKey));
      if (Array.isArray(saved)) return saved.slice(-20);
    } catch (_) {
      sessionStorage.removeItem(historyStorageKey);
    }
    return [];
  }

  function loadDismissedWarnings() {
    try {
      const saved = JSON.parse(localStorage.getItem(dismissedWarningStorageKey));
      if (Array.isArray(saved)) return new Set(saved.filter(item => typeof item === "string"));
    } catch (_) {
      localStorage.removeItem(dismissedWarningStorageKey);
    }
    return new Set();
  }

  function warningId(item) {
    return `${item.level}|${item.text}`;
  }

  function saveDismissedWarnings() {
    if (safeLocalSet(dismissedWarningStorageKey, JSON.stringify([...dismissedWarnings]))) markSaved();
  }

  function currentSnapshot(label) {
    return {
      label,
      assignments: structuredClone(assignments),
      locks: structuredClone(activeLocks),
      constraints: structuredClone(activeConstraints),
      shareWilling: structuredClone(shareWilling),
      studentRegistry: structuredClone(studentRegistry)
    };
  }

  function captureUndo(label) {
    undoHistory.push(currentSnapshot(label));
    undoHistory = undoHistory.slice(-20);
    safeSessionSet(historyStorageKey, JSON.stringify(undoHistory));
    updateUndoButton();
  }

  function updateUndoButton() {
    const last = undoHistory.at(-1);
    elements.undoButton.disabled = !last;
    elements.undoButton.textContent = last ? `ביטול: ${last.label}` : "ביטול פעולה אחרונה";
  }

  function undoLastAction() {
    const snapshot = undoHistory.pop();
    if (!snapshot) return;
    assignments = snapshot.assignments;
    activeLocks = snapshot.locks;
    activeConstraints = snapshot.constraints;
    shareWilling = snapshot.shareWilling;
    studentRegistry = snapshot.studentRegistry || studentRegistry;
    safeSessionSet(historyStorageKey, JSON.stringify(undoHistory));
    saveAssignments();
    saveLocks();
    saveConstraints();
    saveShareWilling();
    saveStudentRegistry();
    updateUndoButton();
    renderAll();
    showToast(`הפעולה „${snapshot.label}” בוטלה.`);
  }

  function markSaved() {
    if (!elements.saveStateText) return;
    clearTimeout(saveStateTimer);
    elements.saveStateText.textContent = "השינויים נשמרו כעת במכשיר זה";
    saveStateTimer = setTimeout(() => { elements.saveStateText.textContent = "כל השינויים נשמרו במכשיר זה"; }, 3000);
  }

  function safeLocalSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (_) {
      showToast("לא ניתן לשמור במכשיר. מומלץ להוריד גיבוי ולפנות מקום בדפדפן.");
      return false;
    }
  }

  function safeSessionSet(key, value) {
    try {
      sessionStorage.setItem(key, value);
      return true;
    } catch (_) {
      showToast("היסטוריית הביטול מלאה. השינויים עצמם נשמרו כרגיל.");
      return false;
    }
  }

  function saveLocks() {
    if (safeLocalSet(lockStorageKey, JSON.stringify(activeLocks))) markSaved();
  }

  function saveAssignments() {
    if (safeLocalSet(storageKey, JSON.stringify(assignments))) markSaved();
  }

  function saveConstraints() {
    if (safeLocalSet(constraintStorageKey, JSON.stringify(activeConstraints))) markSaved();
  }

  function saveShareWilling() {
    if (safeLocalSet(shareStorageKey, JSON.stringify(shareWilling))) markSaved();
  }

  function saveStudentRegistry() {
    if (safeLocalSet(registryStorageKey, JSON.stringify(studentRegistry))) markSaved();
  }

  function assignmentCounts() {
    const byStudent = new Map();
    const byTeacher = new Map();
    const seenTeacherSlots = new Set();
    assignments.forEach(item => {
      byStudent.set(item.student, (byStudent.get(item.student) || 0) + 1);
      const teacherSlot = `${item.teacher}|${item.day}|${item.period}`;
      if (!seenTeacherSlots.has(teacherSlot)) byTeacher.set(item.teacher, (byTeacher.get(item.teacher) || 0) + 1);
      seenTeacherSlots.add(teacherSlot);
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

    const cells = [`<div class="grid-cell grid-head" role="columnheader">שעה</div>`];
    days.forEach(day => cells.push(`<div class="grid-cell grid-head" role="columnheader">${day}</div>`));
    for (let period = 0; period <= 9; period += 1) {
      cells.push(`<div class="grid-cell period-cell" role="rowheader"><strong>${period}</strong><small>${times[period]}</small></div>`);
      days.forEach(day => {
        const lessons = (bySlot.get(`${day}-${period}`) || []).sort((a, b) => a.teacher.localeCompare(b.teacher, "he"));
        const cards = lessons.map(item => {
          const gradeClass = item.grade.startsWith("יא") ? "" : "grade-yod";
          const edgeClass = item.student_slot_type.startsWith("קצה") ? "edge" : "";
          const shared = item.groupId ? " · שיבוץ זוגי" : "";
          const accessibleLabel = `${item.day}, שעה ${item.period}. ${item.student}, ${item.grade}, אצל ${item.teacher}${item.groupId ? ". שיבוץ זוגי" : ""}. לחצו לעריכה`;
          return `<button class="lesson-card ${gradeClass} ${edgeClass} ${item.groupId ? "shared" : ""}" data-assignment-id="${esc(item.id)}" type="button" aria-label="${esc(accessibleLabel)}" title="${esc(accessibleLabel)}"><strong>${esc(item.student)}</strong><span>${esc(item.teacher)} · ${esc(item.grade)}${shared}</span></button>`;
        }).join("");
        cells.push(`<div class="grid-cell" role="gridcell" aria-label="${esc(day)}, שעה ${period}">${cards}</div>`);
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

  function missingExplanation(student) {
    const availability = studentData.get(student.student)?.candidates || [];
    if (!availability.length) return "לא הוגדרו לתלמיד/ה שעות זמינות במערכת האישית.";
    const matchingTeacherSlots = availability.filter(slot => [...teacherData.values()].some(teacher => teacherAllows(teacher.name, student.student) && teacher.candidates.some(candidate => candidate.day === slot.day && candidate.period === slot.period)));
    if (!matchingTeacherSlots.length) return "אין חפיפה בין השעות האפשריות של התלמיד/ה לבין זמינות של מורה מתאימה.";
    const legal = legalOptionsForStudent(student.student);
    if (legal.length) return `נמצאו ${legal.length} אפשרויות חוקיות; לחצו על „הוספת שעה” או על „סידור מערכת” כדי לבחור ביניהן.`;
    const withQuotaException = legalOptionsForStudent(student.student, null, { includeOverQuota: true });
    if (withQuotaException.length) return "יש חפיפה בשעות, אך כל האפשרויות חורגות מהמכסה שהוגדרה למורות.";
    return "קיימת חפיפת שעות, אך כל האפשרויות נחסמות כרגע בגלל שיבוצים קיימים, נעילות או אילוצי רצף.";
  }

  function renderSidebar() {
    const missing = missingStudents();
    elements.missingList.innerHTML = missing.length
      ? missing.map(student => `<article class="missing-card"><strong>${esc(student.student)}</strong><span>${student.missingNow === 1 ? "חסרה שעה אחת" : `חסרות ${student.missingNow} שעות`}</span><small class="missing-explanation">${esc(missingExplanation(student))}</small><button class="secondary-button missing-action" data-add-student="${esc(student.student)}" type="button">הוספת שעה</button></article>`).join("")
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
    const activeTeachers = draft.teachers.filter(teacher => (byTeacher.get(teacher.teacher) || 0) > 0).length;
    document.querySelector("#teacherLoadStatus").textContent = `${activeTeachers}/${draft.teachers.length} פעילות`;
    const issues = scheduleWarnings().filter(item => item.level !== "ok");
    const validationStatus = document.querySelector("#validationStatus");
    const errors = issues.filter(item => item.level === "error").length;
    validationStatus.textContent = !issues.length ? "תקין" : errors ? `${errors} לתיקון` : `${issues.length} הערות`;
    validationStatus.className = errors ? "error" : issues.length ? "warning" : "";
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
      if (!candidateForStudent(item.student, item.day, item.period)) hardErrors.push(`השעה של ${item.student} אינה אפשרית לפי מערכת התלמיד/ה`);
      const teacherSlot = teacherData.get(item.teacher)?.candidates.find(candidate => candidate.day === item.day && candidate.period === item.period);
      if (!teacherSlot) hardErrors.push(`המועד אינו זמין במערכת של ${item.teacher}`);
      if ((teacherData.get(item.teacher)?.forbidden_periods || []).includes(item.period)) hardErrors.push(`השיבוץ של ${item.student} נקבע בשעה חסומה אצל ${item.teacher}`);
      if (!teacherAllows(item.teacher, item.student)) hardErrors.push(`השיבוץ של ${item.student} אינו תואם להגדרת הצוות: ${teacherStudentConstraintExplanation(item.teacher, item.student)}`);
      if (isConstrained("student", item.student, item.day, item.period)) hardErrors.push(`השיבוץ של ${item.student} אינו תואם לאילוץ זמינות שהוגדר`);
      if (isConstrained("teacher", item.teacher, item.day, item.period)) hardErrors.push(`השיבוץ של ${item.teacher} אינו תואם לאילוץ זמינות שהוגדר`);
      const registryRecord = studentRegistry.find(record => record.fullName === item.student);
      if (registryRecord?.exceptions?.noPeriodZero && item.period === 0) hardErrors.push(`ל${item.student} הוגדרה החרגה שאינה מאפשרת שיבוץ בשעה 0`);
    });
    const studentSlotKeys = new Set();
    const teacherSlots = new Map();
    assignments.forEach(item => {
      const studentKey = `${item.student}-${item.day}-${item.period}`;
      const teacherKey = `${item.teacher}-${item.day}-${item.period}`;
      if (studentSlotKeys.has(studentKey)) hardErrors.push(`התנגשות אצל ${item.student}`);
      studentSlotKeys.add(studentKey);
      if (!teacherSlots.has(teacherKey)) teacherSlots.set(teacherKey, []);
      teacherSlots.get(teacherKey).push(item);
    });
    teacherSlots.forEach((items, key) => {
      if (items.length === 1) return;
      const validShared = items.length === 2 && items.every(item => item.groupId && item.groupId === items[0].groupId && shareWilling[item.student]);
      if (!validShared) hardErrors.push(`התנגשות אצל ${items[0].teacher} (${items[0].day}, שעה ${items[0].period})`);
    });
    Object.entries(activeLocks).forEach(([studentName, teacherName]) => {
      if (assignments.some(item => item.student === studentName && item.teacher !== teacherName)) {
        hardErrors.push(`השיבוצים של ${studentName} אינם תואמים לשיוך הקבוע ל${teacherName}`);
      }
    });
    teacherData.forEach((teacher, teacherName) => {
      const limit = Math.min(7, teacher.max_consecutive || 7);
      days.forEach(day => {
        const periods = (teacher.base_commitments || []).filter(item => item.day === day).map(item => item.period);
        assignments.filter(item => item.teacher === teacherName && item.day === day).forEach(item => periods.push(item.period));
        if (maxConsecutive(periods) > limit) hardErrors.push(`ל${teacherName} יש יותר מ-${limit} שעות רצופות ביום ${day}`);
      });
    });

    [...new Set(hardErrors)].forEach(text => warnings.push({ level: "error", text }));
    if (splitStudents.length) warnings.push({ level: "warning", text: `${splitStudents.length} תלמידים משובצים אצל יותר ממורה אחד: ${splitStudents.map(item => item.student).join(", ")}` });
    if (late.length) warnings.push({ level: "warning", text: `${late.length} שיבוצים מתקיימים בשעה האחרונה` });
    if (edgeAssignments.length) warnings.push({ level: "warning", text: `${edgeAssignments.length} שיבוצים מתקיימים מחוץ למערכת הרגילה` });
    const sharedGroups = new Set(assignments.filter(item => item.groupId).map(item => item.groupId));
    if (sharedGroups.size) warnings.push({ level: "warning", text: `${sharedGroups.size} שעות משותפות לשני תלמידים` });
    Object.entries(defaultLocks).forEach(([studentName, teacherName]) => {
      if (!activeLocks[studentName]) warnings.push({ level: "warning", text: `השיוך הקבוע של ${studentName} ל${teacherName} אינו פעיל` });
    });
    if (overridden.length) warnings.push({ level: "warning", text: `${overridden.length} שיבוצים מתקיימים במקום שיעור קיים: ${overridden.map(item => `${item.student} (${item.day} ${item.period})`).join(", ")}` });
    draft.teachers.forEach(teacher => {
      const used = byTeacher.get(teacher.teacher) || 0;
      const assignmentLimit = assignmentLimits.get(teacher.teacher);
      if (assignmentLimit !== undefined && used > assignmentLimit) warnings.push({ level: "warning", text: `${teacher.teacher} משובצ/ת ל-${used} שעות, מעבר למכסה שנקבעה (${assignmentLimit})` });
      if (teacher.preferred_quota !== undefined && used > teacher.preferred_quota) {
        const approved = teacherData.get(teacher.teacher)?.allow_over_quota;
        warnings.push({ level: "warning", text: `${teacher.teacher} משובצ/ת ל-${used} שעות; היעד המועדף הוא ${teacher.preferred_quota}${approved ? " (חריגה מאושרת)" : ""}` });
      }
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
    const visible = scheduleWarnings().filter(item => item.level === "error" || !dismissedWarnings.has(warningId(item)));
    elements.validationList._items = visible;
    elements.validationList.innerHTML = visible.length
      ? visible.map((item, index) => `<div class="validation-item ${item.level === "ok" ? "" : item.level}"><span>${esc(item.text)}</span>${item.level === "warning" ? `<button class="dismiss-warning" data-dismiss-warning="${index}" type="button">הסתרה</button>` : ""}</div>`).join("")
      : `<div class="validation-empty">אין הערות פעילות במסך הראשי.</div>`;
  }

  function openReviewDialog() {
    const items = scheduleWarnings();
    elements.reviewList.innerHTML = items.map(item => {
      const dismissed = item.level !== "error" && dismissedWarnings.has(warningId(item));
      return `<div class="validation-item ${item.level === "ok" ? "" : item.level}"><span>${esc(item.text)}</span>${dismissed ? '<small class="dismissed-label">מוסתר במסך הראשי</small>' : ""}</div>`;
    }).join("");
    elements.reviewDialog.showModal();
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
        ? lessons.map(item => `<button class="text-button lesson-line" data-assignment-id="${esc(item.id)}" type="button">${esc(item.day)}, שעה ${item.period} · ${esc(item.teacher)}${item.groupId ? " · זוגי" : ""}</button>`).join("")
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
      const lines = lessons.map(item => `<li><strong>${esc(item.day)}, ${item.period}</strong> · ${esc(item.student)}${item.groupId ? " · זוגי" : ""}</li>`).join("");
      const target = teacher.preferred_quota !== undefined && teacher.preferred_quota !== teacher.quota ? ` · יעד ${teacher.preferred_quota}` : "";
      return `<article class="teacher-card"><div class="teacher-card-head"><h3>${esc(teacher.teacher)}</h3><strong>${lessons.length}/${teacher.quota}${target}</strong></div><ul>${lines || "<li>אין שיבוצים</li>"}</ul></article>`;
    }).join("");
    elements.teachersView.innerHTML = `<div class="teacher-cards">${cards || "<p class='empty-filter'>אין תוצאות להצגה.</p>"}</div>`;
  }

  function subjectMatchesProject(subject) {
    const normalized = String(subject || "").trim().toLocaleLowerCase("he");
    return [projectMeta.subject, ...(projectMeta.aliases || [])]
      .map(item => String(item || "").trim().toLocaleLowerCase("he"))
      .filter(Boolean)
      .includes(normalized);
  }

  function refreshRegistryProgress() {
    if (!projectMeta.subject) return;
    const { byStudent } = assignmentCounts();
    let changed = false;
    studentRegistry.forEach(record => {
      if (!record.requests?.some(request => subjectMatchesProject(request.subject))) return;
      record.progress ||= {};
      const assigned = byStudent.get(record.fullName) || 0;
      if (record.progress[projectMeta.subject]?.assigned !== assigned) {
        record.progress[projectMeta.subject] = { assigned };
        changed = true;
      }
    });
    if (changed) safeLocalSet(registryStorageKey, JSON.stringify(studentRegistry));
  }

  function renderRegistryView() {
    refreshRegistryProgress();
    const query = elements.studentSearch.value.trim().toLocaleLowerCase("he");
    const records = studentRegistry
      .filter(record => !query || `${record.fullName} ${record.grade} ${(record.requests || []).map(item => item.subject).join(" ")}`.toLocaleLowerCase("he").includes(query))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, "he"));
    const cards = records.map(record => {
      const chips = (record.requests || []).map(request => {
        const assigned = record.progress?.[request.subject]?.assigned ?? (subjectMatchesProject(request.subject) ? record.progress?.[projectMeta.subject]?.assigned : 0) ?? 0;
        return `<span class="basket-chip">${esc(request.subject)} · ${assigned}/${request.hours} שעות</span>`;
      }).join("");
      const scheduleText = record.schedule?.timetable?.length
        ? `<span class="schedule-ready">מערכת שעות נקלטה</span>`
        : `<span class="schedule-missing">נדרשת העלאת מערכת שעות</span>`;
      const exceptionLabels = [record.exceptions?.allowOtherLessons ? "אפשר שיבוץ על חשבון שיעור" : "", record.exceptions?.noPeriodZero ? "ללא שעה 0" : ""].filter(Boolean);
      return `<article class="registry-card"><div><div class="registry-name"><h3>${esc(record.fullName)}</h3><span>${esc(record.grade)}</span></div><div class="basket-chips">${chips || "<span class='basket-chip'>טרם הוגדר סל אישי</span>"}</div><p>${scheduleText}${record.shareWilling ? " · ניתן להציע שיבוץ זוגי" : ""}${exceptionLabels.length ? ` · ${esc(exceptionLabels.join(" · "))}` : ""}</p></div><div class="registry-actions"><button class="primary-button" data-view-registry="${esc(record.id)}" type="button">פתיחת כרטיס</button><button class="secondary-button" data-edit-registry="${esc(record.id)}" type="button">עריכת פרטים</button><button class="text-button" data-delete-registry="${esc(record.id)}" type="button">הסרה</button></div></article>`;
    }).join("");
    elements.registryView.innerHTML = `<section class="registry-view"><div class="registry-view-head"><p>ריכוז זכאויות, מערכות שעות ומצב המענה בכל המקצועות.</p><button class="primary-button" data-new-registry type="button">קליטת תלמיד/ה</button></div><div class="registry-list">${cards || "<div class='registry-empty'><strong>המאגר עדיין ריק.</strong><p>אפשר לקלוט תלמיד או תלמידה ולהעלות את מערכת השעות שלהם.</p></div>"}</div></section>`;
  }

  function renderActiveView() {
    const viewCopy = {
      schedule: ["מערכת שבועית", "מוצגים השיבוצים התואמים למסננים הפעילים."],
      students: ["שיבוצים לפי תלמידים", "מעקב אחר הזכאות והשעות שנקבעו לכל תלמיד ותלמידה."],
      teachers: ["שיבוצים לפי צוות", "עומס השעות והמערכת של כל מורה בפרויקט."],
      registry: ["מאגר תלמידים", "ניהול הסל האישי, מערכת השעות והחרגות השיבוץ."]
    };
    [elements.toolbarTitle.textContent, elements.toolbarDescription.textContent] = viewCopy[activeView];
    elements.searchControl.hidden = activeView === "teachers";
    elements.teacherFilterControl.hidden = !["schedule", "teachers"].includes(activeView);
    elements.scheduleView.hidden = activeView !== "schedule";
    elements.studentsView.hidden = activeView !== "students";
    elements.teachersView.hidden = activeView !== "teachers";
    elements.registryView.hidden = activeView !== "registry";
    elements.attentionPanel.hidden = activeView === "registry";
    document.querySelector("#workspaceSection").classList.toggle("registry-active", activeView === "registry");
    if (activeView === "schedule") renderGrid();
    if (activeView === "students") renderStudentsView();
    if (activeView === "teachers") renderTeachersView();
    if (activeView === "registry") renderRegistryView();
    document.querySelectorAll(".view-tab").forEach(button => button.setAttribute("aria-selected", String(button.dataset.view === activeView)));
  }

  function teacherAllows(teacherName, studentName) {
    if (activeLocks[studentName]) return teacherName === activeLocks[studentName];
    const teacher = teacherData.get(teacherName);
    if (!teacher) return false;
    const grade = draft.students.find(student => student.student === studentName)?.grade;
    const group = grade?.startsWith("יא") ? "יא" : grade?.startsWith("יב") ? "יב" : grade?.startsWith("י") ? "י" : grade;
    const matchesGrade = grades => grades.includes(grade) || grades.includes(group);
    const forbiddenGrades = teacher.forbidden_student_grades || teacher.excluded_student_grades || [];
    if (forbiddenGrades.length && matchesGrade(forbiddenGrades)) return false;
    if (!teacher.allowed_student_grades) return true;
    return matchesGrade(teacher.allowed_student_grades);
  }

  function teacherStudentConstraintExplanation(teacherName, studentName) {
    const student = draft.students.find(item => item.student === studentName);
    const grade = student?.grade || "השכבה של התלמיד/ה";
    const teacher = teacherData.get(teacherName);
    if (activeLocks[studentName]) return `${studentName} נעול/ה ל${activeLocks[studentName]}, ולכן אינו/ה יכול/ה להיות משובץ/ת אצל ${teacherName}`;
    if (!teacher) return `${teacherName} אינו/ה מופיע/ה בצוות הפרויקט`;
    const group = grade.startsWith("יא") ? "יא" : grade.startsWith("יב") ? "יב" : grade.startsWith("י") ? "י" : grade;
    const matchesGrade = grades => grades.includes(grade) || grades.includes(group);
    const forbidden = teacher.forbidden_student_grades || teacher.excluded_student_grades || [];
    if (forbidden.length && matchesGrade(forbidden)) return `אצל ${teacherName} שכבת ${grade} חסומה במפורש (שכבות חסומות: ${forbidden.join(", ")})`;
    const allowed = teacher.allowed_student_grades || [];
    if (allowed.length && !matchesGrade(allowed)) return `אצל ${teacherName} מוגדרות כשכבות מותרות רק: ${allowed.join(", ")}; התלמיד/ה בכיתה ${grade}`;
    return `הגדרה פעילה של ${teacherName} אינה מאפשרת שיבוץ עם תלמיד/ה מכיתה ${grade}`;
  }

  function teacherPreferencePenalty(teacherName, studentName) {
    const teacher = teacherData.get(teacherName);
    const preferredGrades = teacher?.preferred_student_grades || (teacher?.preferred_student_grade ? [teacher.preferred_student_grade] : []);
    if (!preferredGrades.length) return 0;
    const grade = draft.students.find(student => student.student === studentName)?.grade || "";
    const group = grade.startsWith("יא") ? "יא" : grade.startsWith("יב") ? "יב" : grade.startsWith("י") ? "י" : grade;
    return preferredGrades.includes(grade) || preferredGrades.includes(group) ? 0 : 3;
  }

  function isConstrained(type, name, day, period) {
    return activeConstraints.some(item => item.type === type && item.name === name && item.day === day && item.period === period);
  }

  function candidateForStudent(studentName, day, period) {
    return studentData.get(studentName)?.candidates.find(item => item.day === day && item.period === period) || null;
  }

  function candidateQuality(candidate) {
    const rank = { "חלון": 0, "שיעור במקצוע": 1, "קצה לפני": 3, "קצה אחרי": 3, "דריסת שיעור": 5 };
    (projectMeta.aliases || []).forEach(alias => { rank[alias] = 1; });
    return (rank[candidate?.category] ?? 8) + (candidate?.period === 9 ? 20 : 0);
  }

  function teacherSlotQuality(candidate) {
    const rank = { "חלון": 0, "פנויה": 1, "שעה גמישה": 2, "שעה פיקטיבית": 2, "קצה לפני": 4, "קצה אחרי": 4 };
    return (rank[candidate?.category] ?? 6) + (candidate?.avoid_if_possible ? 8 : 0);
  }

  function isExcludedFromSwapSuggestions(teacherName) {
    return Boolean(teacherData.get(teacherName)?.exclude_from_swap_suggestions);
  }

  function hasSwapEdgePeriod(suggestion) {
    return [...suggestion.firstDestinations, ...suggestion.secondDestinations].some(item => item.period === 0 || item.period === 8);
  }

  function quotaWarningsForSwap(teacherNames) {
    const counts = assignmentCounts().byTeacher;
    return [...new Set(teacherNames)].flatMap(teacherName => {
      const teacher = draft.teachers.find(item => item.teacher === teacherName);
      const assigned = counts.get(teacherName) || 0;
      return teacher && assigned > teacher.quota
        ? [`${teacherName} כבר חורג/ת מהמכסה (${assigned}/${teacher.quota})`]
        : [];
    });
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
    if (isExcludedFromSwapSuggestions(firstTeacher) || isExcludedFromSwapSuggestions(secondTeacher)) return null;
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
    if (edgeCount) warningParts.push(`${edgeCount} שעות מחוץ למערכת הרגילה`);
    if (overrideCount) warningParts.push(`${overrideCount} שיבוצים במקום שיעור קיים`);
    warningParts.push(...quotaWarningsForSwap([firstTeacher, secondTeacher]));

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
    const suggestions = findSwapSuggestions(studentName)
      .filter(item => elements.swapShowEdges.checked || !hasSwapEdgePeriod(item));
    elements.swapSuggestions._items = suggestions;
    if (!suggestions.length) {
      elements.swapSuggestions.innerHTML = `<div class="swap-empty"><strong>לא נמצאה החלפה מלאה שמתאימה לכללים שהוגדרו.</strong><br>ייתכן שקיים שיוך קבוע. אפשר לבחור תלמיד או תלמידה אחרים, או לעדכן שיבוץ יחיד דרך הלוח.</div>`;
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
    elements.swapShowEdges.checked = false;
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
    captureUndo("החלפת שיבוצים");
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
    const teachers = draft.teachers.map(item => item.teacher).sort((a, b) => a.localeCompare(b, "he"));
    elements.locksList.innerHTML = draft.students.slice().sort((a, b) => a.student.localeCompare(b.student, "he")).map(student => {
      const current = activeLocks[student.student] || "";
      const defaultTeacher = defaultLocks[student.student];
      const options = [`<option value="">ללא נעילה</option>`, ...teachers.map(teacher => `<option value="${esc(teacher)}" ${teacher === current ? "selected" : ""}>${esc(teacher)}</option>`)].join("");
      return `<div class="lock-row"><div class="lock-copy"><strong>${esc(student.student)}</strong><span>${esc(student.grade)}${defaultTeacher ? ` · שיוך ברירת מחדל: ${esc(defaultTeacher)}` : ""}</span></div><label class="lock-select"><span>מורה נעולה</span><select data-lock-student="${esc(student.student)}">${options}</select></label></div>`;
    }).join("");
    elements.locksDialog.showModal();
  }

  function commitLocks() {
    const nextLocks = {};
    elements.locksList.querySelectorAll("[data-lock-student]").forEach(input => {
      const studentName = input.dataset.lockStudent;
      if (input.value) nextLocks[studentName] = input.value;
    });
    const releasedCount = Object.keys(activeLocks).filter(studentName => !nextLocks[studentName]).length;
    if (JSON.stringify(nextLocks) === JSON.stringify(activeLocks)) {
      elements.locksDialog.close();
      showToast("לא בוצעו שינויים בשיוכים הקבועים.");
      return;
    }
    captureUndo("עדכון שיוכים קבועים");
    activeLocks = nextLocks;
    saveLocks();
    elements.locksDialog.close();
    renderAll();
    showToast(releasedCount ? `${releasedCount} נעילות שוחררו. יתר השיוכים נשמרו.` : "השיוכים הקבועים נשמרו.");
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
    if (!teacher) return false;
    const limit = Math.min(7, teacher.max_consecutive || 7);
    const periods = (teacher.base_commitments || []).filter(item => item.day === day).map(item => item.period);
    assignments.filter(item => item.id !== currentId && item.teacher === teacherName && item.day === day).forEach(item => periods.push(item.period));
    periods.push(period);
    return maxConsecutive(periods) <= limit;
  }

  function legalOptionsForStudent(studentName, currentAssignment = null, { includeOverQuota = false } = {}) {
    const student = studentData.get(studentName);
    if (!student) return [];
    const currentId = currentAssignment?.id || null;
    const occupiedByStudent = new Set(assignments.filter(item => item.id !== currentId && item.student === studentName).map(item => `${item.day}-${item.period}`));
    const occupiedByTeacher = new Set(assignments.filter(item => item.id !== currentId).map(item => `${item.teacher}-${item.day}-${item.period}`));
    const teacherCounts = assignmentCounts().byTeacher;
    const currentSlotStillUsed = currentAssignment && assignments.some(item => item.id !== currentId && item.teacher === currentAssignment.teacher && item.day === currentAssignment.day && item.period === currentAssignment.period);
    if (currentAssignment && !currentSlotStillUsed) teacherCounts.set(currentAssignment.teacher, (teacherCounts.get(currentAssignment.teacher) || 1) - 1);
    const options = [];

    student.candidates.forEach(studentSlot => {
      const slotKey = `${studentSlot.day}-${studentSlot.period}`;
      if (occupiedByStudent.has(slotKey)) return;
      if (isConstrained("student", studentName, studentSlot.day, studentSlot.period)) return;
      const registryRecord = studentRegistry.find(record => record.fullName === studentName);
      if (registryRecord?.exceptions?.noPeriodZero && studentSlot.period === 0) return;
      if (studentSlot.period > (projectMeta.lastPeriod ?? 9)) return;
      teacherData.forEach((teacher, teacherName) => {
        if (!teacherAllows(teacherName, studentName)) return;
        if ((teacher.forbidden_periods || []).includes(studentSlot.period)) return;
        if (isConstrained("teacher", teacherName, studentSlot.day, studentSlot.period)) return;
        const teacherSlot = teacher.candidates.find(item => item.day === studentSlot.day && item.period === studentSlot.period);
        if (!teacherSlot) return;
        if (occupiedByTeacher.has(`${teacherName}-${slotKey}`)) return;
        const assignmentLimit = assignmentLimits.get(teacherName);
        const preferredQuota = quotas.get(teacherName) ?? assignmentLimit;
        const projectedTeacherLoad = (teacherCounts.get(teacherName) || 0) + 1;
        const overQuota = assignmentLimit !== undefined && projectedTeacherLoad > assignmentLimit;
        const overPreferred = preferredQuota !== undefined && projectedTeacherLoad > preferredQuota;
        const allowOverPreferred = teacher.allow_over_quota ?? (assignmentLimit !== undefined && assignmentLimit > preferredQuota);
        if ((overQuota || (overPreferred && !allowOverPreferred)) && !includeOverQuota) return;
        if (!teacherConsecutiveOptionIsLegal(teacherName, studentSlot.day, studentSlot.period, currentId)) return;
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
          quality: candidateQuality(studentSlot) + teacherSlotQuality(teacherSlot) + teacherPreferencePenalty(teacherName, studentName),
          same,
          createsSplit,
          overQuota,
          overPreferred,
          allowOverPreferred,
          projectedTeacherLoad,
          assignmentLimit
        });
      });
    });
    return options.sort((a, b) => Number(b.same) - Number(a.same) || Number(a.overQuota) - Number(b.overQuota) || a.quality - b.quality || days.indexOf(a.day) - days.indexOf(b.day) || a.period - b.period || a.teacher.localeCompare(b.teacher, "he"));
  }

  function legalAlternatives(assignment) {
    return legalOptionsForStudent(assignment.student, assignment, { includeOverQuota: true });
  }

  function optionLabel(option) {
    const flags = [];
    if (option.same) flags.push("נוכחי");
    if (option.period === 9) flags.push("שעה 9");
    if (option.student_slot_type.startsWith("קצה")) flags.push("מחוץ למערכת הרגילה");
    if (option.student_slot_type === "דריסת שיעור") flags.push("במקום שיעור קיים");
    if (option.createsSplit) flags.push("מורה נוספת לתלמיד/ה");
    if (option.overQuota) flags.push("חריגת מכסה");
    else if (option.overPreferred) flags.push("מעבר ליעד המועדף");
    return `${option.day}, שעה ${option.period} · ${option.teacher}${flags.length ? ` — ${flags.join(", ")}` : ""}`;
  }

  function optionWarnings(option, currentAssignment = null, studentName = null) {
    const warnings = [];
    if (option.period === 9) warnings.push("זו שעה 9, שממנה ביקשת להימנע ככל האפשר");
    if (option.createsSplit) warnings.push("בעקבות השינוי התלמיד/ה ישובץ/תשובץ אצל יותר ממורה אחד");
    if (option.student_slot_type === "דריסת שיעור") warnings.push(`השיבוץ יתקיים במקום שיעור קיים${option.replaces_student_lesson ? `: ${option.replaces_student_lesson}` : ""}`);
    const counts = assignmentCounts().byTeacher;
    const teacherSummary = draft.teachers.find(item => item.teacher === option.teacher);
    const preferredQuota = teacherSummary?.preferred_quota ?? teacherSummary?.quota;
    const projectedTeacher = (counts.get(option.teacher) || 0) - (currentAssignment?.teacher === option.teacher ? 1 : 0) + 1;
    const assignmentLimit = assignmentLimits.get(option.teacher);
    if (assignmentLimit !== undefined && projectedTeacher > assignmentLimit) {
      warnings.push(`${option.teacher} תחרוג מהמכסה (${projectedTeacher}/${assignmentLimit})`);
    } else if (preferredQuota !== undefined && teacherSummary && projectedTeacher > preferredQuota && projectedTeacher <= assignmentLimit) {
      const approved = teacherData.get(option.teacher)?.allow_over_quota ?? assignmentLimit > preferredQuota;
      warnings.push(`${option.teacher} תחרוג מהיעד המועדף של ${preferredQuota} שעות, אך לא מהמכסה המרבית${approved ? " (חריגה מאושרת)" : ""}`);
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
    const alternatives = (elements.alternativeSelect._options || []).filter(item => !item.same);
    const quotaOnlyAlternatives = alternatives.length > 0 && alternatives.every(item => item.overQuota);
    if (quotaOnlyAlternatives) warnings.unshift("לא נמצאה חלופה אחרת שעומדת במכסה; האפשרויות המוצגות חוקיות מבחינת השעות והאילוצים, אך חורגות ממכסת מורה");
    const best = alternatives.reduce((result, item) => !result || item.quality < result.quality ? item : result, null);
    if (!option.same && best && option.quality > best.quality) warnings.unshift(`קיימת חלופה עדיפה: ${optionLabel(best)}`);
    elements.dialogNote.textContent = warnings.length
      ? `לתשומת לבך: ${warnings.join("; ")}.`
      : "החלופה עומדת בכללים שהוגדרו ואינה מוסיפה התראה.";
  }

  function openEditor(assignmentId) {
    const assignment = assignments.find(item => item.id === assignmentId);
    if (!assignment) return;
    activeAssignmentId = assignmentId;
    elements.dialogStudent.textContent = assignment.student;
    elements.dialogCurrent.innerHTML = `<strong>השיבוץ הנוכחי:</strong> ${esc(assignment.day)}, שעה ${assignment.period} (${esc(assignment.start)}–${esc(assignment.end)}) אצל ${esc(assignment.teacher)}.${assignment.groupId ? " <strong>זהו שיבוץ זוגי; העברה תבטל את הצימוד.</strong>" : ""}`;
    const options = legalAlternatives(assignment);
    elements.alternativeSelect.innerHTML = options.map((option, index) => `<option value="${index}">${esc(optionLabel(option))}</option>`).join("");
    elements.alternativeSelect._options = options;
    elements.saveMoveButton.disabled = options.length === 0;
    if (options.length) updateDialogOptionNote();
    else elements.dialogNote.textContent = "לא נמצאה כרגע חלופה שמתאימה לכללים שהוגדרו.";
    elements.dialog.showModal();
  }

  function saveMove() {
    const assignment = assignments.find(item => item.id === activeAssignmentId);
    const option = elements.alternativeSelect._options?.[Number(elements.alternativeSelect.value)];
    if (!assignment || !option) return;
    if (option.same) {
      elements.dialog.close();
      showToast("השיבוץ נשאר ללא שינוי.");
      return;
    }
    captureUndo("עדכון שיבוץ");
    if (assignment.groupId && !option.same) dissolveSharedGroup(assignment.groupId);
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
      elements.addDialogNote.textContent = "לא נמצא מועד זמין שמתאים לאילוצי התלמיד/ה והצוות.";
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
    const best = (elements.addOptionSelect._options || [])[0];
    if (best && option.quality > best.quality) warnings.unshift(`קיימת חלופה עדיפה: ${optionLabel(best)}`);
    const assigned = lessonsForStudent(studentName).length;
    if (assigned >= student.required) warnings.unshift("הוספת השעה תיצור שיבוץ מעבר לזכאות הרשומה");
    elements.addDialogNote.textContent = warnings.length
      ? `לתשומת לבך: ${warnings.join("; ")}.`
      : "המועד זמין ועומד באילוצים שהוגדרו.";
  }

  function addAssignment() {
    const studentName = elements.addStudentSelect.value;
    const student = draft.students.find(item => item.student === studentName);
    const option = elements.addOptionSelect._options?.[Number(elements.addOptionSelect.value)];
    if (!student || !option) return;
    const assigned = lessonsForStudent(studentName).length;
    if (assigned >= student.required && !confirm(`${studentName} כבר קיבל/ה את מלוא הזכאות. להוסיף שעה עודפת בכל זאת?`)) return;
    captureUndo("יצירת שיבוץ");
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

  function autoAssignmentFromOption(studentName, option, id) {
    const student = draft.students.find(item => item.student === studentName);
    return {
      id,
      student: studentName,
      grade: student?.grade || "",
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
    };
  }

  function assignmentProblems(item) {
    const problems = [];
    const teacher = teacherData.get(item.teacher);
    const registryRecord = studentRegistry.find(record => record.fullName === item.student);
    if (!candidateForStudent(item.student, item.day, item.period)) problems.push("אינה אפשרית במערכת התלמיד/ה");
    if (!(teacher?.candidates || []).some(candidate => candidate.day === item.day && candidate.period === item.period)) problems.push("אינה זמינה במערכת המורה");
    if ((teacher?.forbidden_periods || []).includes(item.period)) problems.push("נחסמה למורה בשעה זו");
    if (!teacherAllows(item.teacher, item.student)) problems.push(teacherStudentConstraintExplanation(item.teacher, item.student));
    if (isConstrained("student", item.student, item.day, item.period) || isConstrained("teacher", item.teacher, item.day, item.period)) problems.push("סותרת אילוץ זמינות פעיל");
    if (registryRecord?.exceptions?.noPeriodZero && item.period === 0) problems.push("סותרת החרגה של התלמיד/ה לגבי שעה 0");
    if (item.period > (projectMeta.lastPeriod ?? 9)) problems.push("אחרי השעה האחרונה שהוגדרה לפרויקט");
    return problems;
  }

  function assignmentsToRepair() {
    const repairs = new Map();
    const addRepair = (item, reason) => {
      if (!repairs.has(item.id)) repairs.set(item.id, { item, reasons: new Set() });
      repairs.get(item.id).reasons.add(reason);
    };
    const keepFirst = items => items.slice().sort((a, b) => {
      const lockedDelta = Number(activeLocks[b.student] === b.teacher) - Number(activeLocks[a.student] === a.teacher);
      return lockedDelta || String(a.id).localeCompare(String(b.id));
    })[0];

    assignments.forEach(item => assignmentProblems(item).forEach(reason => addRepair(item, reason)));

    const studentSlots = new Map();
    const teacherSlots = new Map();
    assignments.forEach(item => {
      const studentKey = `${item.student}|${item.day}|${item.period}`;
      const teacherKey = `${item.teacher}|${item.day}|${item.period}`;
      studentSlots.set(studentKey, [...(studentSlots.get(studentKey) || []), item]);
      teacherSlots.set(teacherKey, [...(teacherSlots.get(teacherKey) || []), item]);
    });
    studentSlots.forEach(items => {
      if (items.length < 2) return;
      const kept = keepFirst(items);
      items.filter(item => item.id !== kept.id).forEach(item => addRepair(item, "מתנגש עם שיבוץ אחר של אותו תלמיד/ה"));
    });
    teacherSlots.forEach(items => {
      const validShared = items.length === 2 && items.every(item => item.groupId && item.groupId === items[0].groupId && shareWilling[item.student]);
      if (items.length < 2 || validShared) return;
      const kept = keepFirst(items);
      items.filter(item => item.id !== kept.id).forEach(item => addRepair(item, "מתנגש עם שיבוץ אחר של אותה מורה"));
    });

    teacherData.forEach((teacher, teacherName) => {
      const limit = Math.min(7, teacher.max_consecutive || 7);
      days.forEach(day => {
        let planned = assignments.filter(item => item.teacher === teacherName && item.day === day && !repairs.has(item.id));
        let periods = () => (teacher.base_commitments || []).filter(item => item.day === day).map(item => item.period).concat(planned.map(item => item.period));
        while (maxConsecutive(periods()) > limit) {
          const candidate = planned.slice().sort((a, b) => b.period - a.period || String(b.id).localeCompare(String(a.id)))[0];
          if (!candidate) break;
          addRepair(candidate, `יוצר/ת רצף של יותר מ-${limit} שעות למורה`);
          planned = planned.filter(item => item.id !== candidate.id);
        }
      });
    });
    return [...repairs.values()];
  }

  function showSchedulePreview({ additions, repaired, remaining, searchStopped }) {
    const repairedText = repaired.length
      ? `<section class="plan-section"><h3>${repaired.length === 1 ? "שיבוץ אחד ישתחרר" : `${repaired.length} שיבוצים ישתחררו`} כי הם סותרים אילוץ</h3><ul>${repaired.map(({ item, reasons }) => `<li><strong>${esc(item.student)}</strong> · ${esc(item.day)}, שעה ${item.period}, אצל ${esc(item.teacher)} — ${esc([...reasons].join("; "))}</li>`).join("")}</ul></section>`
      : "";
    const addedText = additions.length
      ? `<section class="plan-section"><h3>${additions.length === 1 ? "שיבוץ חדש אחד יתווסף" : `${additions.length} שיבוצים חדשים יתווספו`}</h3><ul>${additions.map(item => `<li><strong>${esc(item.student)}</strong> · ${esc(item.day)}, שעה ${item.period} · אצל ${esc(item.teacher)}${item.student_slot_type === "שיעור במקצוע" ? " · בזמן שיעור המקצוע" : ""}</li>`).join("")}</ul></section>`
      : "";
    const unchangedText = !additions.length && !repaired.length
      ? "<p><strong>לא נמצאו שינויים שאפשר לבצע אוטומטית.</strong></p>"
      : "";
    const remainingText = remaining.length
      ? `<section class="plan-section remaining"><h3>${searchStopped ? "לא נמצאה בחיפוש שבוצע" : "לא נמצאה"} חלופה חוקית לשעות הבאות</h3><ul>${remaining.map(student => `<li><strong>${esc(student.student)}</strong> — ${student.missingNow === 1 ? "חסרה שעה אחת" : `חסרות ${student.missingNow} שעות`}<small>${esc(missingExplanation(student))}</small></li>`).join("")}</ul></section>`
      : "<p class=\"plan-success\"><strong>לאחר ההחלה, כל שעות הזכאות יהיו משובצות.</strong></p>";
    const stoppedText = searchStopped
      ? "<p>נבדקו חלופות רבות, והחיפוש הופסק כדי לא לעכב את העבודה. אפשר לנסות שוב לאחר שינוי באילוצים או בשיבוצים.</p>"
      : "";
    elements.recalculateSummary.innerHTML = `<p class="plan-intro">בדקו את השינויים לפני ההחלה. שום דבר עדיין לא שונה במערכת.</p>${repairedText}${addedText}${unchangedText}${remainingText}${stoppedText}`;
    elements.applySchedulePlanButton.hidden = !additions.length && !repaired.length;
    elements.recalculateDialog.showModal();
  }

  function setSchedulingBusy(busy) {
    document.body.classList.toggle("is-scheduling", busy);
    elements.schedulingBusy.hidden = !busy;
    document.querySelector("#recalculateButton").disabled = busy;
    elements.nextActionButton.disabled = busy;
  }

  function buildSchedulePlan() {
    const originalAssignments = assignments;
    const repaired = assignmentsToRepair();
    const repairedIds = new Set(repaired.map(({ item }) => item.id));
    assignments = originalAssignments.filter(item => !repairedIds.has(item.id));
    const fixedAssignments = assignments;
    const initialMissing = missingStudents();
    const totalMissing = initialMissing.reduce((sum, item) => sum + item.missingNow, 0);
    if (!totalMissing) {
      assignments = originalAssignments;
      assignments = fixedAssignments;
      const remaining = missingStudents();
      assignments = originalAssignments;
      return { originalAssignments, finalAssignments: fixedAssignments, additions: [], repaired, remaining, searchStopped: false };
    }

    const requirements = initialMissing.flatMap(student => Array.from({ length: student.missingNow }, () => student.student));
    const workingAdditions = [];
    let bestAdditions = [];
    let visitedNodes = 0;
    let searchStopped = false;
    const maxNodes = 30000;
    const runId = Date.now();

    function chooseRequirement(pending) {
      let chosen = null;
      pending.forEach((studentName, index) => {
        if (chosen?.options.length === 0) return;
        const options = legalOptionsForStudent(studentName);
        if (!chosen || options.length < chosen.options.length || (options.length === chosen.options.length && studentName.localeCompare(chosen.studentName, "he") < 0)) {
          chosen = { studentName, index, options };
        }
      });
      return chosen;
    }

    function search(pending) {
      if (visitedNodes >= maxNodes) {
        searchStopped = true;
        return false;
      }
      visitedNodes += 1;
      if (workingAdditions.length > bestAdditions.length) bestAdditions = structuredClone(workingAdditions);
      if (!pending.length) return true;
      if (workingAdditions.length + pending.length <= bestAdditions.length) return false;

      const choice = chooseRequirement(pending);
      if (!choice) return false;
      const nextPending = pending.filter((_, index) => index !== choice.index);
      for (const option of choice.options) {
        const added = autoAssignmentFromOption(choice.studentName, option, `auto-${runId}-${visitedNodes}-${workingAdditions.length}`);
        assignments.push(added);
        workingAdditions.push(added);
        const completed = search(nextPending);
        workingAdditions.pop();
        assignments.pop();
        if (completed) return true;
        if (searchStopped) return false;
      }
      return search(nextPending);
    }

    search(requirements);
    const finalAssignments = fixedAssignments.concat(bestAdditions);
    assignments = originalAssignments;
    assignments = finalAssignments;
    const remaining = missingStudents();
    assignments = originalAssignments;
    return { originalAssignments, finalAssignments, additions: bestAdditions, repaired, remaining, searchStopped };
  }

  async function recalculateMissingAssignments() {
    if (isScheduling) return;
    isScheduling = true;
    setSchedulingBusy(true);
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    try {
      pendingSchedulePlan = buildSchedulePlan();
      showSchedulePreview(pendingSchedulePlan);
    } finally {
      isScheduling = false;
      setSchedulingBusy(false);
    }
  }

  function applySchedulePlan() {
    const plan = pendingSchedulePlan;
    if (!plan || (!plan.additions.length && !plan.repaired.length)) return;
    captureUndo("סידור מערכת");
    assignments = plan.finalAssignments;
    saveAssignments();
    pendingSchedulePlan = null;
    elements.recalculateDialog.close();
    renderAll();
    showToast("השינויים שאישרת הוחלו על המערכת.");
  }

  function deleteAssignment() {
    const assignment = assignments.find(item => item.id === activeAssignmentId);
    if (!assignment) return;
    const remaining = lessonsForStudent(assignment.student).length - 1;
    const student = draft.students.find(item => item.student === assignment.student);
    const shortage = Math.max(0, (student?.required || 0) - remaining);
    const warning = shortage ? ` לאחר ההסרה יחסרו לתלמיד/ה ${shortage} שעות.` : "";
    if (!confirm(`להסיר את השיבוץ של ${assignment.student} ביום ${assignment.day}, שעה ${assignment.period}, אצל ${assignment.teacher}?${warning}`)) return;
    captureUndo("ביטול שיבוץ");
    const formerGroupId = assignment.groupId;
    assignments = assignments.filter(item => item.id !== activeAssignmentId);
    if (formerGroupId) dissolveSharedGroup(formerGroupId);
    activeAssignmentId = null;
    saveAssignments();
    elements.dialog.close();
    renderAll();
    showToast("השעה הוסרה. המערכת מציגה כעת את החוסר שנוצר.");
  }

  function dissolveSharedGroup(groupId) {
    assignments.forEach(item => {
      if (item.groupId === groupId) delete item.groupId;
    });
  }

  function openShareDialog() {
    elements.shareWillingList.innerHTML = draft.students
      .slice()
      .sort((a, b) => a.student.localeCompare(b.student, "he"))
      .map(student => `<label class="share-toggle"><input type="checkbox" data-share-student="${esc(student.student)}" ${shareWilling[student.student] ? "checked" : ""}><span><strong>${esc(student.student)}</strong><small>${esc(student.grade)}</small></span></label>`)
      .join("");
    renderShareSuggestions();
    elements.shareDialog.showModal();
  }

  function commitShareWilling() {
    const next = {};
    elements.shareWillingList.querySelectorAll("[data-share-student]").forEach(input => { next[input.dataset.shareStudent] = input.checked; });
    if (JSON.stringify(next) === JSON.stringify(shareWilling)) {
      showToast("לא בוצעו שינויים בהעדפות השיבוץ הזוגי.");
      return;
    }
    captureUndo("עדכון העדפות שיבוץ זוגי");
    shareWilling = next;
    saveShareWilling();
    renderShareSuggestions();
    renderAll();
    showToast("העדפות השיתוף נשמרו.");
  }

  function findShareSuggestions() {
    const missing = new Set(missingStudents().map(item => item.student));
    const occupiedStudents = new Set(assignments.map(item => `${item.student}|${item.day}|${item.period}`));
    const suggestions = [];
    assignments.filter(item => !item.groupId && shareWilling[item.student]).forEach(host => {
      draft.students.forEach(student => {
        if (student.student === host.student || !shareWilling[student.student] || !missing.has(student.student)) return;
        if (occupiedStudents.has(`${student.student}|${host.day}|${host.period}`)) return;
        if (!teacherAllows(host.teacher, student.student)) return;
        if (isConstrained("student", student.student, host.day, host.period) || isConstrained("teacher", host.teacher, host.day, host.period)) return;
        const candidate = candidateForStudent(student.student, host.day, host.period);
        if (!candidate) return;
        suggestions.push({ host, partner: student, candidate, quality: candidateQuality(candidate) });
      });
    });
    return suggestions.sort((a, b) => a.quality - b.quality || days.indexOf(a.host.day) - days.indexOf(b.host.day) || a.host.period - b.host.period || a.partner.student.localeCompare(b.partner.student, "he")).slice(0, 30);
  }

  function renderShareSuggestions() {
    const suggestions = findShareSuggestions();
    elements.shareSuggestions._items = suggestions;
    elements.shareSuggestions.innerHTML = suggestions.length ? suggestions.map((item, index) => {
      const note = item.candidate.category === "חלון" ? "ניצול שעת חלון" : item.candidate.category === "שיעור במקצוע" ? "בזמן שיעור המקצוע" : "מחוץ למערכת הרגילה";
      return `<article class="share-card"><div><strong>${esc(item.host.student)} + ${esc(item.partner.student)}</strong><span>${esc(item.host.teacher)} · ${esc(item.host.day)}, שעה ${item.host.period} · ${esc(note)}</span></div><button class="primary-button" data-share-index="${index}" type="button">אישור השיבוץ</button></article>`;
    }).join("") : `<div class="swap-empty"><strong>אין כרגע הצעה לשיבוץ זוגי.</strong><br>יש לסמן לפחות שני תלמידים, ולפחות לאחד מהם צריכה להיות שעת זכאות שטרם שובצה ומתאימה למועד קיים של האחר.</div>`;
  }

  function applyShareSuggestion(suggestion) {
    if (!suggestion) return;
    const { host, partner, candidate } = suggestion;
    if (!confirm(`לשבץ את ${host.student} ואת ${partner.student} יחד אצל ${host.teacher}, ביום ${host.day} בשעה ${host.period}?`)) return;
    const liveHost = assignments.find(item => item.id === host.id && !item.groupId);
    if (!liveHost) return showToast("השיבוץ השתנה. יש לרענן את ההצעות.");
    captureUndo("יצירת שיבוץ זוגי");
    const groupId = `shared-${Date.now()}`;
    liveHost.groupId = groupId;
    assignments.push({
      id: `manual-${Date.now()}-${assignments.length + 1}`,
      groupId,
      student: partner.student,
      grade: partner.grade,
      teacher: host.teacher,
      day: host.day,
      period: host.period,
      start: candidate.start,
      end: candidate.end,
      student_slot_type: candidate.category,
      teacher_slot_type: host.teacher_slot_type,
      replaces_for_teacher: host.replaces_for_teacher || null,
      replaces_student_lesson: candidate.replaces_student_lesson || null,
      avoid_if_possible: Boolean(candidate.avoid_if_possible)
    });
    saveAssignments();
    renderShareSuggestions();
    renderAll();
    showToast("השיבוץ הזוגי נוסף בהצלחה.");
  }

  function refreshConstraintPeople() {
    const items = elements.constraintType.value === "student"
      ? draft.students.map(item => item.student)
      : draft.teachers.map(item => item.teacher);
    elements.constraintPerson.innerHTML = items.sort((a, b) => a.localeCompare(b, "he")).map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join("");
  }

  function renderConstraints() {
    elements.constraintsList.innerHTML = activeConstraints.length ? activeConstraints.map((item, index) => `<div class="constraint-row"><span><strong>${item.type === "student" ? "תלמיד/ה" : "מורה"}: ${esc(item.name)}</strong><small>${esc(item.day)}, שעה ${item.period}</small></span><button class="danger-button" data-remove-constraint="${index}" type="button">הסרה</button></div>`).join("") : `<p class="swap-empty">לא הוגדרו אילוצי זמינות נוספים.</p>`;
  }

  function openConstraintsDialog() {
    elements.constraintDay.innerHTML = days.map(day => `<option value="${day}">${day}</option>`).join("");
    elements.constraintPeriod.innerHTML = Object.keys(times).map(period => `<option value="${period}">שעה ${period} · ${times[period]}</option>`).join("");
    refreshConstraintPeople();
    renderConstraints();
    elements.constraintsDialog.showModal();
  }

  function addConstraint() {
    const item = { type: elements.constraintType.value, name: elements.constraintPerson.value, day: elements.constraintDay.value, period: Number(elements.constraintPeriod.value) };
    if (!item.name) return;
    if (activeConstraints.some(existing => JSON.stringify(existing) === JSON.stringify(item))) {
      showToast("האילוץ כבר קיים.");
      return;
    }
    captureUndo("הוספת אילוץ");
    activeConstraints.push(item);
    saveConstraints();
    renderConstraints();
    renderAll();
    showToast("האילוץ נוסף ונכלל בבדיקת השיבוצים.");
  }

  function removeConstraint(index) {
    if (!activeConstraints[index]) return;
    captureUndo("הסרת אילוץ");
    activeConstraints.splice(index, 1);
    saveConstraints();
    renderConstraints();
    renderAll();
    showToast("האילוץ הוסר.");
  }

  function renderNextAction() {
    if (isEmptyProject || activeView === "registry") {
      elements.nextActionPanel.hidden = true;
      return;
    }
    const missing = missingStudents();
    const warningItems = scheduleWarnings();
    const warningCount = warningItems.filter(item => item.level !== "ok").length;
    const hardErrorCount = warningItems.filter(item => item.level === "error").length;
    elements.nextActionPanel.hidden = !hardErrorCount && !missing.length;
    elements.reviewWarningsButton.hidden = warningCount === 0;
    elements.reviewWarningsButton.textContent = warningCount ? `הצגת ${warningCount} נושאים לבדיקה` : "הצגת נושאים לבדיקה";
    if (hardErrorCount) {
      elements.nextActionTitle.textContent = `נמצאו ${hardErrorCount} שיבוצים שדורשים תיקון`;
      elements.nextActionDescription.textContent = "המערכת יכולה לשחרר שיבוצים שסותרים אילוץ פעיל ולחפש להם חלופה חוקית, בלי לשנות שיבוצים תקינים.";
      elements.nextActionButton.textContent = "סידור מערכת";
      elements.nextActionButton.dataset.action = "recalculate";
      return;
    }
    if (missing.length) {
      const missingHours = missing.reduce((sum, item) => sum + item.missingNow, 0);
      elements.nextActionTitle.textContent = `נותרו ${missingHours} שעות זכאות לשיבוץ`;
      elements.nextActionDescription.textContent = `${missing.length} תלמידים עדיין אינם מקבלים את מלוא שעות הזכאות שלהם. המערכת תתקן גם שיבוצים שסותרים אילוץ פעיל, ואז תנסה להשלים את כל החוסרים.`;
      elements.nextActionButton.textContent = "סידור מערכת";
      elements.nextActionButton.dataset.action = "recalculate";
      return;
    }
  }

  function focusAttentionPanel() {
    elements.attentionPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    elements.attentionPanel.focus({ preventScroll: true });
  }

  function handleNextAction() {
    const action = elements.nextActionButton.dataset.action;
    if (action === "recalculate") return recalculateMissingAssignments();
    if (action === "warnings") return openReviewDialog();
    if (action === "report") openDeputyReport();
  }

  function requestRowHtml(request = { subject: "", hours: 1 }) {
    return `<div class="request-row"><label><span>מקצוע</span><input data-request-subject value="${esc(request.subject)}" placeholder="לדוגמה: מתמטיקה" /></label><label><span>מספר שעות</span><input data-request-hours type="number" min="1" max="20" step="1" value="${esc(request.hours || 1)}" /></label><button class="icon-button" data-remove-request type="button" aria-label="הסרת מקצוע">×</button></div>`;
  }

  function addRequestRow(request) {
    elements.requestRows.insertAdjacentHTML("beforeend", requestRowHtml(request));
  }

  function openRegistryDialog(recordId = null) {
    const record = studentRegistry.find(item => item.id === recordId);
    activeRegistryStudentId = record?.id || null;
    pendingRegistrySchedule = record?.schedule ? structuredClone(record.schedule) : null;
    shadowSchedule = null;
    shadowMode = "blocked";
    shadowDrawing = false;
    elements.shadowScheduleEditor.hidden = true;
    elements.studentRegistryDialogTitle.textContent = record ? "עריכת פרטי תלמיד/ה" : "קליטת תלמיד/ה";
    elements.registryStudentName.value = record?.fullName || "";
    elements.registryStudentGrade.value = record?.grade || "";
    elements.registryShareWilling.checked = Boolean(record?.shareWilling);
    elements.registryAllowOtherLessons.checked = Boolean(record?.exceptions?.allowOtherLessons);
    elements.registryNoPeriodZero.checked = Boolean(record?.exceptions?.noPeriodZero);
    elements.registryExceptionNotes.value = record?.exceptions?.notes || "";
    elements.requestRows.innerHTML = "";
    const requests = record?.requests?.length ? record.requests : [{ subject: projectMeta.subject === "שיבוצים" ? "" : projectMeta.subject, hours: 1 }];
    requests.forEach(addRequestRow);
    elements.registryScheduleFile.value = "";
    elements.registryScheduleStatus.textContent = pendingRegistrySchedule
      ? `המערכת שנקלטה: ${pendingRegistrySchedule.fileName || "קובץ Excel"}`
      : "טרם נבחר קובץ או מערכת צל.";
    elements.registryScheduleStatus.className = `file-status${pendingRegistrySchedule ? " ok" : ""}`;
    showStudentWizardStep(0);
    elements.studentRegistryDialog.showModal();
    elements.registryStudentName.focus();
  }

  function showStudentWizardStep(index) {
    studentWizardStep = Math.max(0, Math.min(5, index));
    document.querySelectorAll("[data-student-step]").forEach((step, stepIndex) => {
      const active = stepIndex === studentWizardStep;
      step.hidden = !active;
      step.classList.toggle("active", active);
    });
    elements.studentWizardProgress.textContent = `שלב ${studentWizardStep + 1} מתוך 6`;
    elements.studentWizardBar.style.width = `${((studentWizardStep + 1) / 6) * 100}%`;
    elements.studentWizardBack.hidden = studentWizardStep === 0;
    elements.studentWizardNext.hidden = studentWizardStep === 5;
    elements.saveRegistryStudentButton.hidden = studentWizardStep !== 5;
    elements.studentWizardMessage.textContent = "";
    document.querySelector(`[data-student-step="${studentWizardStep}"] input:not([type="file"])`)?.focus();
  }

  function studentWizardCanContinue() {
    if (studentWizardStep === 0 && !elements.registryStudentName.value.trim()) {
      elements.studentWizardMessage.textContent = "יש להזין שם מלא כדי להמשיך.";
      elements.registryStudentName.focus();
      return false;
    }
    if (studentWizardStep === 1 && !elements.registryStudentGrade.value.trim()) {
      elements.studentWizardMessage.textContent = "יש להזין כיתה כדי להמשיך.";
      elements.registryStudentGrade.focus();
      return false;
    }
    if (studentWizardStep === 2) {
      try { readRegistryRequests(); } catch (error) { elements.studentWizardMessage.textContent = error.message; return false; }
    }
    if (studentWizardStep === 3 && !pendingRegistrySchedule && !activeRegistryStudentId) {
      elements.studentWizardMessage.textContent = "יש להעלות מערכת שעות או לבנות מערכת צל כדי להמשיך.";
      return false;
    }
    return true;
  }

  function readRegistryRequests() {
    const rows = [...elements.requestRows.querySelectorAll(".request-row")];
    const requests = rows.map(row => ({
      subject: row.querySelector("[data-request-subject]").value.trim(),
      hours: Number(row.querySelector("[data-request-hours]").value)
    }));
    if (!requests.length) throw new Error("יש להוסיף לפחות מקצוע אחד לסל האישי.");
    if (requests.some(item => !item.subject || !Number.isInteger(item.hours) || item.hours < 1)) throw new Error("יש להזין מקצוע ומספר שעות תקין בכל שורה.");
    const normalized = requests.map(item => item.subject.toLocaleLowerCase("he"));
    if (new Set(normalized).size !== normalized.length) throw new Error("אותו מקצוע מופיע יותר מפעם אחת בסל האישי.");
    return requests;
  }

  function timeRangeForPeriod(period, timetable) {
    const row = timetable.find(item => item.period === period);
    const raw = String(row?.time || "").trim();
    const matches = raw.match(/(\d{1,2}:\d{2}).*?(\d{1,2}:\d{2})/);
    if (matches) {
      const [start, end] = [matches[1], matches[2]].sort();
      return { start, end };
    }
    const start = raw.match(/\d{1,2}:\d{2}/)?.[0] || payload.studentAvailability.period_times?.[period]?.start || times[period] || "";
    const nextStart = timetable.find(item => item.period === period + 1)?.time?.match(/\d{1,2}:\d{2}/)?.[0]
      || payload.studentAvailability.period_times?.[period]?.end || times[period + 1] || "";
    return { start, end: nextStart };
  }

  function shadowSubjectTerms() {
    return [projectMeta.subject, ...(projectMeta.aliases || [])]
      .map(item => String(item || "").trim().toLocaleLowerCase("he")).filter(Boolean);
  }

  function shadowSlotKey(day, period) {
    return `${day}|${period}`;
  }

  function shadowStateFromTimetable(schedule) {
    const next = {};
    days.forEach(day => {
      for (let period = 0; period <= 9; period += 1) next[shadowSlotKey(day, period)] = "free";
    });
    const subjectTerms = shadowSubjectTerms();
    (schedule?.timetable || []).forEach(row => {
      if (!Number.isInteger(row.period) || row.period < 0 || row.period > 9) return;
      days.forEach(day => {
        const lesson = String(row.lessons?.[day] || "").trim();
        if (!lesson) return;
        next[shadowSlotKey(day, row.period)] = subjectTerms.some(term => lesson.toLocaleLowerCase("he").includes(term)) ? "subject" : "blocked";
      });
    });
    return next;
  }

  function shadowTimetable() {
    return Array.from({ length: 10 }, (_, period) => ({
      period,
      time: `${times[period] || ""}`,
      lessons: Object.fromEntries(days.map(day => {
        const state = shadowSchedule?.[shadowSlotKey(day, period)] || "free";
        const lesson = state === "subject" ? (projectMeta.subject || "שיעור המקצוע") : state === "blocked" ? "שיעור אחר" : "";
        return [day, lesson];
      }))
    }));
  }

  function updateShadowSchedulePending() {
    pendingRegistrySchedule = { source: "shadow", fileName: "מערכת צל ידנית", timetable: shadowTimetable() };
    const states = Object.values(shadowSchedule || {});
    const blocked = states.filter(state => state === "blocked").length;
    const subject = states.filter(state => state === "subject").length;
    elements.shadowScheduleSummary.textContent = `${blocked} חסומות · ${subject} שעות מקצוע`;
    elements.registryScheduleStatus.textContent = `מערכת הצל נשמרת אוטומטית · ${blocked} שעות חסומות, ${subject} שעות מקצוע.`;
    elements.registryScheduleStatus.className = "file-status ok";
  }

  function renderShadowSchedule() {
    if (!shadowSchedule) return;
    const cells = [`<div class="shadow-grid-head">שעה</div>`, ...days.map(day => `<div class="shadow-grid-head">${esc(day)}</div>`)];
    for (let period = 0; period <= 9; period += 1) {
      cells.push(`<div class="shadow-period"><strong>${period}</strong><small>${esc(times[period])}</small></div>`);
      days.forEach(day => {
        const state = shadowSchedule[shadowSlotKey(day, period)] || "free";
        const label = state === "blocked" ? "חסום" : state === "subject" ? "שיעור מקצוע" : "חלון פנוי";
        cells.push(`<button class="shadow-cell ${state}" data-shadow-day="${esc(day)}" data-shadow-period="${period}" type="button" aria-label="${esc(day)}, שעה ${period}: ${label}"><span>${state === "subject" ? "מקצוע" : state === "blocked" ? "חסום" : ""}</span></button>`);
      });
    }
    elements.shadowScheduleGrid.innerHTML = cells.join("");
    elements.shadowScheduleEditor.querySelectorAll("[data-shadow-mode]").forEach(button => button.classList.toggle("active", button.dataset.shadowMode === shadowMode));
    updateShadowSchedulePending();
  }

  function openShadowScheduleEditor() {
    shadowSchedule = shadowStateFromTimetable(pendingRegistrySchedule);
    shadowMode = "blocked";
    elements.shadowScheduleEditor.hidden = false;
    renderShadowSchedule();
  }

  function paintShadowSlot(button) {
    if (!button || !shadowSchedule) return;
    const day = button.dataset.shadowDay;
    const period = Number(button.dataset.shadowPeriod);
    if (!days.includes(day) || !Number.isInteger(period)) return;
    const key = shadowSlotKey(day, period);
    if (shadowPaintedSlots.has(key)) return;
    shadowPaintedSlots.add(key);
    const nextState = shadowMode === "erase" ? "free" : shadowMode;
    if (shadowSchedule[key] === nextState) return;
    shadowSchedule[key] = nextState;
    renderShadowSchedule();
  }

  function refreshTeacherFilter() {
    const selected = elements.teacherFilter.value;
    const names = draft.teachers.map(item => item.teacher).sort((a, b) => a.localeCompare(b, "he"));
    elements.teacherFilter.innerHTML = `<option value="all">כל הצוות</option>${names.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join("")}`;
    elements.teacherFilter.value = names.includes(selected) ? selected : "all";
  }

  function openManagementDialog() {
    elements.managementDialog.showModal();
  }

  function closeManagementDialog() {
    elements.managementDialog.close();
  }

  function openTeamManager() {
    renderTeamManager();
    elements.teamManagerDialog.showModal();
  }

  function renderTeamManager() {
    const { byTeacher } = assignmentCounts();
    const rows = draft.teachers.slice().sort((a, b) => a.teacher.localeCompare(b.teacher, "he")).map(teacher => {
      const source = teacherData.get(teacher.teacher);
      const used = byTeacher.get(teacher.teacher) || 0;
      const flexible = source?.candidates?.filter(item => item.category === "שעה גמישה" || item.category === "שעה פיקטיבית").length || 0;
      const available = source?.candidates?.length || 0;
      return `<article class="team-manager-card"><div><h3>${esc(teacher.teacher)}</h3><p>${used}/${teacher.quota} שעות משובצות · ${available} שעות זמינות${flexible ? ` · ${flexible} גמישות` : ""}</p><small>${(source?.allowed_student_grades || []).length ? `שכבות: ${esc(source.allowed_student_grades.join(", "))}` : "כל השכבות"}</small></div><div><button class="secondary-button" data-edit-team-teacher="${esc(teacher.teacher)}" type="button">עריכת מורה</button><button class="text-button" data-rules-team-teacher="${esc(teacher.teacher)}" type="button">מדיניות מתקדמת</button><button class="text-button" data-remove-team-teacher="${esc(teacher.teacher)}" type="button">הסרה</button></div></article>`;
    }).join("");
    elements.teamManagerList.innerHTML = rows || `<div class="registry-empty"><strong>עדיין אין צוות בפרויקט.</strong><p>אפשר להוסיף מורה באמצעות מערכת הצל.</p></div>`;
  }

  function resetTeacherShadowEditor(source = null) {
    teacherShadowSchedule = {};
    days.forEach(day => {
      for (let period = 0; period <= 9; period += 1) teacherShadowSchedule[shadowSlotKey(day, period)] = source ? "blocked" : "free";
    });
    (source?.candidates || []).forEach(slot => {
      if (days.includes(slot.day) && Number.isInteger(slot.period)) teacherShadowSchedule[shadowSlotKey(slot.day, slot.period)] = slot.category === "שעה גמישה" || slot.category === "שעה פיקטיבית" ? "flexible" : "free";
    });
    (source?.base_commitments || []).forEach(slot => {
      if (days.includes(slot.day) && Number.isInteger(slot.period)) teacherShadowSchedule[shadowSlotKey(slot.day, slot.period)] = "fixed";
    });
    teacherShadowMode = "blocked";
    teacherShadowDrawing = false;
    renderTeacherShadowEditor();
  }

  function renderTeacherShadowEditor() {
    if (!teacherShadowSchedule) return;
    const cells = [`<div class="shadow-grid-head">שעה</div>`, ...days.map(day => `<div class="shadow-grid-head">${esc(day)}</div>`)];
    for (let period = 0; period <= 9; period += 1) {
      cells.push(`<div class="shadow-period"><strong>${period}</strong><small>${esc(times[period])}</small></div>`);
      days.forEach(day => {
        const state = teacherShadowSchedule[shadowSlotKey(day, period)] || "free";
        const label = state === "blocked" ? "חסום" : state === "fixed" ? "שיעור קבוע" : state === "flexible" ? "שעה גמישה" : "פנויה";
        cells.push(`<button class="shadow-cell teacher-${state}" data-teacher-shadow-day="${esc(day)}" data-teacher-shadow-period="${period}" type="button" aria-label="${esc(day)}, שעה ${period}: ${label}"><span>${state === "fixed" ? "קבוע" : state === "flexible" ? "גמיש" : state === "blocked" ? "חסום" : ""}</span></button>`);
      });
    }
    elements.teacherShadowGrid.innerHTML = cells.join("");
    elements.teacherEditorDialog.querySelectorAll("[data-teacher-shadow-mode]").forEach(button => button.classList.toggle("active", button.dataset.teacherShadowMode === teacherShadowMode));
    const values = Object.values(teacherShadowSchedule);
    const count = state => values.filter(value => value === state).length;
    elements.teacherShadowSummary.textContent = `${count("blocked")} חסומות · ${count("fixed")} קבועות · ${count("flexible")} גמישות`;
  }

  function paintTeacherShadowSlot(button) {
    if (!button || !teacherShadowSchedule) return;
    const day = button.dataset.teacherShadowDay;
    const period = Number(button.dataset.teacherShadowPeriod);
    if (!days.includes(day) || !Number.isInteger(period)) return;
    const key = shadowSlotKey(day, period);
    if (teacherShadowPaintedSlots.has(key)) return;
    teacherShadowPaintedSlots.add(key);
    const next = teacherShadowMode === "erase" ? "free" : teacherShadowMode;
    if (teacherShadowSchedule[key] === next) return;
    teacherShadowSchedule[key] = next;
    renderTeacherShadowEditor();
  }

  function openTeacherEditor(existingName = null) {
    activeTeacherEditorName = existingName;
    const source = existingName ? teacherData.get(existingName) : null;
    const summary = existingName ? draft.teachers.find(item => item.teacher === existingName) : null;
    elements.teacherEditorMessage.textContent = "";
    elements.teacherEditorDialog.querySelector("h2").textContent = source ? `עריכת ${existingName}` : "הוספת מורה";
    document.querySelector("#saveNewTeacherButton").textContent = source ? "שמירת שינויים" : "הוספת המורה לצוות";
    elements.newTeacherName.value = existingName || "";
    elements.newTeacherName.readOnly = Boolean(source);
    elements.newTeacherPreferredQuota.value = summary?.preferred_quota ?? source?.preferred_quota ?? "1";
    elements.newTeacherQuota.value = summary?.assignment_limit ?? summary?.quota ?? source?.quota ?? "2";
    elements.newTeacherMaxConsecutive.value = source?.max_consecutive ?? "7";
    elements.newTeacherGrades.value = (source?.allowed_student_grades || []).join(", ");
    elements.newTeacherPreferredGrades.value = (source?.preferred_student_grades || []).join(", ");
    resetTeacherShadowEditor(source);
    elements.teacherEditorDialog.showModal();
    elements.newTeacherName.focus();
  }

  function saveNewTeacher() {
    const name = elements.newTeacherName.value.trim();
    const preferred = Number(elements.newTeacherPreferredQuota.value);
    const quota = Number(elements.newTeacherQuota.value);
    const maxConsecutive = Number(elements.newTeacherMaxConsecutive.value);
    const allowedGrades = parseList(elements.newTeacherGrades.value);
    const preferredGrades = parseList(elements.newTeacherPreferredGrades.value);
    if (!name) { elements.teacherEditorMessage.textContent = "יש להזין שם מלא."; return; }
    if (teacherData.has(name) && name !== activeTeacherEditorName) { elements.teacherEditorMessage.textContent = "מורה בשם זה כבר קיימת בצוות."; return; }
    if (!Number.isInteger(preferred) || preferred < 0 || !Number.isInteger(quota) || quota <= 0 || preferred > quota) { elements.teacherEditorMessage.textContent = "יש להזין יעד מועדף ומכסה מרבית תקינים."; return; }
    if (!Number.isInteger(maxConsecutive) || maxConsecutive < 1 || maxConsecutive > 7) { elements.teacherEditorMessage.textContent = "מספר השעות הרצופות חייב להיות בין 1 ל־7."; return; }
    const candidates = [];
    const baseCommitments = [];
    days.forEach(day => {
      for (let period = 0; period <= (projectMeta.lastPeriod ?? 9); period += 1) {
        const state = teacherShadowSchedule?.[shadowSlotKey(day, period)] || "free";
        if (state === "fixed") baseCommitments.push({ day, period });
        if (state !== "free" && state !== "flexible") continue;
        const category = state === "flexible" ? "שעה גמישה" : "פנויה";
        candidates.push({ day, period, start: times[period], end: times[period + 1] || "", category, replaces: category === "שעה גמישה" ? "התחייבות גמישה" : null, avoid_if_possible: (projectMeta.avoidPeriods || []).includes(period) });
      }
    });
    if (!candidates.length) { elements.teacherEditorMessage.textContent = "לא נותרה אף שעה פנויה או גמישה למורה."; return; }
    const source = { ...(teacherData.get(name) || {}), name, quota, preferred_quota: preferred, allowed_student_grades: allowedGrades.length ? allowedGrades : null, preferred_student_grades: preferredGrades, forbidden_periods: teacherData.get(name)?.forbidden_periods || [], max_consecutive: maxConsecutive, base_commitments: baseCommitments, candidates };
    const summary = draft.teachers.find(item => item.teacher === name);
    if (summary) Object.assign(summary, { quota, preferred_quota: preferred, assignment_limit: quota });
    else draft.teachers.push({ teacher: name, quota, preferred_quota: preferred, assignment_limit: quota, assigned: 0, remaining: quota });
    teacherData.set(name, source);
    quotas.set(name, preferred);
    assignmentLimits.set(name, quota);
    payload.schedule = draft;
    payload.teacherAvailability.teachers = [...teacherData.values()];
    if (safeLocalSet(activeProjectKey, JSON.stringify(payload))) markSaved();
    refreshTeacherFilter();
    elements.teacherEditorDialog.close();
    renderTeamManager();
    renderAll();
    showToast(activeTeacherEditorName ? `הגדרות ${name} עודכנו.` : `${name} נוספה לצוות.`);
  }

  function removeTeamTeacher(name) {
    const linked = assignments.filter(item => item.teacher === name);
    const note = linked.length ? ` למורה יש ${linked.length} שיבוצים שיימחקו מהלוח.` : "";
    if (!confirm(`להסיר את ${name} מהצוות?${note}`)) return;
    assignments = assignments.filter(item => item.teacher !== name);
    for (let index = originalAssignments.length - 1; index >= 0; index -= 1) {
      if (originalAssignments[index].teacher === name) originalAssignments.splice(index, 1);
    }
    draft.teachers = draft.teachers.filter(item => item.teacher !== name);
    teacherData.delete(name);
    quotas.delete(name);
    assignmentLimits.delete(name);
    Object.entries(activeLocks).forEach(([student, teacher]) => { if (teacher === name) delete activeLocks[student]; });
    activeConstraints = activeConstraints.filter(item => !(item.type === "teacher" && item.name === name));
    payload.schedule = draft;
    payload.teacherAvailability.teachers = [...teacherData.values()];
    safeLocalSet(activeProjectKey, JSON.stringify(payload));
    saveAssignments();
    saveLocks();
    saveConstraints();
    refreshTeacherFilter();
    renderTeamManager();
    renderAll();
    showToast(`${name} הוסרה מהצוות.`);
  }

  function availabilityFromRegistry(record, request) {
    const timetable = record.schedule?.timetable || [];
    const subjectTerms = [request.subject, projectMeta.subject, ...(projectMeta.aliases || [])]
      .map(item => String(item || "").trim().toLocaleLowerCase("he")).filter(Boolean);
    const candidates = [];
    if (record.schedule?.source === "shadow") {
      days.forEach(day => {
        timetable.filter(row => row.period >= 0 && row.period <= 9).forEach(row => {
          const lesson = String(row.lessons?.[day] || "").trim();
          const lessonNormalized = lesson.toLocaleLowerCase("he");
          const category = !lesson ? "חלון" : subjectTerms.some(term => lessonNormalized.includes(term)) ? "שיעור במקצוע" : null;
          if (!category || (record.exceptions?.noPeriodZero && row.period === 0)) return;
          const range = timeRangeForPeriod(row.period, timetable);
          candidates.push({ day, period: row.period, ...range, category, replaces_student_lesson: category === "שיעור במקצוע" ? lesson : null });
        });
      });
      return { student: record.fullName, grade: record.grade, shareWilling: record.shareWilling, candidates };
    }
    days.forEach(day => {
      const rows = timetable.filter(row => row.period >= 0 && row.period <= 9).sort((a, b) => a.period - b.period);
      const occupied = rows.filter(row => String(row.lessons?.[day] || "").trim()).map(row => row.period);
      if (!occupied.length) return;
      const first = Math.min(...occupied);
      const last = Math.max(...occupied);
      rows.forEach(row => {
        const lesson = String(row.lessons?.[day] || "").trim();
        const lessonNormalized = lesson.toLocaleLowerCase("he");
        let category = null;
        if (lesson && subjectTerms.some(term => lessonNormalized.includes(term))) category = "שיעור במקצוע";
        else if (!lesson && row.period > first && row.period < last) category = "חלון";
        else if (!lesson && row.period === first - 1) category = "קצה לפני";
        else if (!lesson && row.period === last + 1) category = "קצה אחרי";
        else if (lesson && record.exceptions?.allowOtherLessons) category = "דריסת שיעור";
        if (!category) return;
        if (record.exceptions?.noPeriodZero && row.period === 0) return;
        const range = timeRangeForPeriod(row.period, timetable);
        candidates.push({ day, period: row.period, ...range, category, replaces_student_lesson: category === "שיעור במקצוע" ? lesson : null });
      });
    });
    return { student: record.fullName, grade: record.grade, shareWilling: record.shareWilling, candidates };
  }

  function renameProjectStudent(oldName, newName) {
    if (!oldName || oldName === newName) return;
    assignments = assignments.map(item => item.student === oldName ? { ...item, student: newName } : item);
    originalAssignments.forEach(item => { if (item.student === oldName) item.student = newName; });
    const student = draft.students.find(item => item.student === oldName);
    if (student) student.student = newName;
    const availability = payload.studentAvailability.students.find(item => item.student === oldName);
    if (availability) availability.student = newName;
    studentData.delete(oldName);
    if (availability) studentData.set(newName, availability);
    if (activeLocks[oldName]) {
      activeLocks[newName] = activeLocks[oldName];
      delete activeLocks[oldName];
    }
    if (defaultLocks[oldName]) {
      defaultLocks[newName] = defaultLocks[oldName];
      delete defaultLocks[oldName];
    }
    if (Object.hasOwn(shareWilling, oldName)) {
      shareWilling[newName] = shareWilling[oldName];
      delete shareWilling[oldName];
    }
    activeConstraints.forEach(item => { if (item.type === "student" && item.name === oldName) item.name = newName; });
  }

  function stripStudentGradeSuffix(name) {
    return String(name || "").trim().replace(/\s+י\s*["'׳״]?\s*[אב]?\s*\d{1,2}$/u, "").trim();
  }

  function normalizeStudentNames() {
    const names = new Set([
      ...draft.students.map(item => item.student),
      ...payload.studentAvailability.students.map(item => item.student),
      ...studentRegistry.map(item => item.fullName)
    ].filter(Boolean));
    const remapStudentKeys = source => {
      Object.keys(source).forEach(oldName => {
        const cleaned = stripStudentGradeSuffix(oldName);
        if (!cleaned || cleaned === oldName || !names.has(cleaned)) return;
        if (!Object.hasOwn(source, cleaned)) source[cleaned] = source[oldName];
        delete source[oldName];
      });
    };
    remapStudentKeys(activeLocks);
    remapStudentKeys(defaultLocks);
    remapStudentKeys(shareWilling);
    activeConstraints.forEach(item => {
      if (item.type !== "student") return;
      const cleaned = stripStudentGradeSuffix(item.name);
      if (cleaned && names.has(cleaned)) item.name = cleaned;
    });
    const targets = new Map();
    names.forEach(name => {
      const cleaned = stripStudentGradeSuffix(name);
      if (cleaned && cleaned !== name) targets.set(name, cleaned);
    });
    const targetCounts = new Map();
    targets.forEach(target => targetCounts.set(target, (targetCounts.get(target) || 0) + 1));
    const safeTargets = [...targets].filter(([, target]) => targetCounts.get(target) === 1 && !names.has(target));
    safeTargets.forEach(([oldName, newName]) => {
      renameProjectStudent(oldName, newName);
      studentRegistry.forEach(record => {
        if (record.fullName === oldName) record.fullName = newName;
        if (record.projectStudentName === oldName) record.projectStudentName = newName;
      });
    });
    if (!safeTargets.length) return 0;
    payload.schedule = draft;
    saveAssignments();
    saveLocks();
    saveConstraints();
    saveShareWilling();
    saveStudentRegistry();
    safeLocalSet(activeProjectKey, JSON.stringify(payload));
    return safeTargets.length;
  }

  function syncRecordWithCurrentProject(record, oldName = null, persist = true) {
    const request = record.requests.find(item => subjectMatchesProject(item.subject));
    if (!request) return false;
    renameProjectStudent(oldName, record.fullName);
    const currentStudent = draft.students.find(item => item.student === record.fullName);
    const assigned = assignments.filter(item => item.student === record.fullName).length;
    if (currentStudent) Object.assign(currentStudent, { grade: record.grade, required: request.hours, assigned, shareWilling: record.shareWilling });
    else draft.students.push({ student: record.fullName, grade: record.grade, required: request.hours, assigned, shareWilling: record.shareWilling });
    if (record.schedule?.timetable?.length) {
      const availability = availabilityFromRegistry(record, request);
      const currentAvailability = payload.studentAvailability.students.find(item => item.student === record.fullName);
      if (currentAvailability) Object.assign(currentAvailability, availability);
      else payload.studentAvailability.students.push(availability);
      studentData.set(record.fullName, availability);
    }
    shareWilling[record.fullName] = record.shareWilling;
    if (persist) {
      saveAssignments();
      saveLocks();
      saveShareWilling();
    }
    return true;
  }

  async function readRegistrySchedule(file) {
    if (!file) return;
    elements.registryScheduleStatus.textContent = "קורא את מערכת השעות…";
    elements.registryScheduleStatus.className = "file-status";
    try {
      const parsed = await window.XlsxScheduleReader.parseStudentSchedule(file);
      pendingRegistrySchedule = { fileName: parsed.fileName, timetable: parsed.timetable };
      shadowSchedule = null;
      elements.shadowScheduleEditor.hidden = true;
      if (!elements.registryStudentName.value.trim() && parsed.name) elements.registryStudentName.value = parsed.name;
      if (!elements.registryStudentGrade.value.trim() && parsed.grade) elements.registryStudentGrade.value = parsed.grade;
      elements.registryScheduleStatus.textContent = `הקובץ נקלט בהצלחה · ${parsed.timetable.length} שורות של שעות לימוד`;
      elements.registryScheduleStatus.className = "file-status ok";
    } catch (error) {
      pendingRegistrySchedule = null;
      elements.registryScheduleFile.value = "";
      elements.registryScheduleStatus.textContent = error instanceof Error ? error.message : "לא ניתן לקרוא את הקובץ.";
      elements.registryScheduleStatus.className = "file-status error";
    }
  }

  function saveRegistryStudent() {
    try {
      const fullName = elements.registryStudentName.value.trim();
      const grade = elements.registryStudentGrade.value.trim();
      if (!fullName || !grade) throw new Error("יש להזין שם מלא וכיתה.");
      const duplicate = studentRegistry.find(item => item.fullName === fullName && item.id !== activeRegistryStudentId);
      if (duplicate) throw new Error("תלמיד/ה בשם זה כבר קיימ/ת במאגר.");
      const existing = studentRegistry.find(item => item.id === activeRegistryStudentId);
      if (!pendingRegistrySchedule && !existing) throw new Error("בקליטת תלמיד/ה חדש/ה יש להעלות מערכת שעות אישית או לבנות מערכת צל.");
      const requests = readRegistryRequests();
      captureUndo(existing ? "עריכת פרטי תלמיד/ה" : "קליטת תלמיד/ה");
      const record = {
        id: existing?.id || `student-${Date.now()}`,
        fullName,
        grade,
        requests,
        shareWilling: elements.registryShareWilling.checked,
        schedule: pendingRegistrySchedule,
        progress: existing?.progress || {},
        source: existing?.source || "registry",
        projectStudentName: existing?.projectStudentName || (existing?.source === "project" ? existing.fullName : null),
        exceptions: {
          allowOtherLessons: elements.registryAllowOtherLessons.checked,
          noPeriodZero: elements.registryNoPeriodZero.checked,
          notes: elements.registryExceptionNotes.value.trim()
        }
      };
      if (existing) studentRegistry[studentRegistry.indexOf(existing)] = record;
      else studentRegistry.push(record);
      const synced = syncRecordWithCurrentProject(record, existing?.fullName);
      saveStudentRegistry();
      elements.studentRegistryDialog.close();
      renderAll();
      showToast(synced ? "התלמיד/ה נקלט/ה ונוספ/ה לפרויקט השיבוץ הנוכחי." : "פרטי התלמיד/ה נשמרו במאגר.");
    } catch (error) {
      alert(error instanceof Error ? error.message : "לא ניתן לשמור את פרטי התלמיד/ה.");
    }
  }

  function deleteRegistryStudent(recordId) {
    const record = studentRegistry.find(item => item.id === recordId);
    if (!record) return;
    const projectStudent = draft.students.find(item => item.student === record.fullName);
    const assignmentCount = assignments.filter(item => item.student === record.fullName).length;
    const projectNote = projectStudent ? ` התלמיד/ה יוסר/תוסר גם מהפרויקט${assignmentCount ? ` ומערכת השעות תסיר ${assignmentCount} שיבוצים` : ""}.` : "";
    if (!confirm(`להסיר את ${record.fullName} ממאגר התלמידים?${projectNote}`)) return;
    studentRegistry = studentRegistry.filter(item => item.id !== recordId);
    if (projectStudent) {
      assignments = assignments.filter(item => item.student !== record.fullName);
      for (let index = originalAssignments.length - 1; index >= 0; index -= 1) {
        if (originalAssignments[index].student === record.fullName) originalAssignments.splice(index, 1);
      }
      draft.students = draft.students.filter(item => item.student !== record.fullName);
      payload.studentAvailability.students = payload.studentAvailability.students.filter(item => item.student !== record.fullName);
      studentData.delete(record.fullName);
      delete activeLocks[record.fullName];
      delete defaultLocks[record.fullName];
      delete shareWilling[record.fullName];
    }
    payload.schedule = draft;
    safeLocalSet(activeProjectKey, JSON.stringify(payload));
    saveAssignments();
    saveLocks();
    saveShareWilling();
    saveStudentRegistry();
    renderAll();
    showToast(`${record.fullName} הוסר/ה מהמאגר${projectStudent ? " ומהפרויקט" : ""}.`);
  }

  function openStudentDetail(recordId) {
    const record = studentRegistry.find(item => item.id === recordId);
    if (!record) return;
    detailStudentId = record.id;
    elements.studentDetailTitle.textContent = `${record.fullName} · ${record.grade}`;
    const studentAssignments = lessonsForStudent(record.fullName);
    const assignmentBySlot = new Map(studentAssignments.map(item => [`${item.day}-${item.period}`, item]));
    const timetable = record.schedule?.timetable || [];
    const timetableByPeriod = new Map(timetable.map(row => [row.period, row]));
    const rows = [...Array(10).keys()].map(period => {
      const row = timetableByPeriod.get(period);
      const cells = days.map(day => {
        const lesson = row?.lessons?.[day] || "";
        const support = assignmentBySlot.get(`${day}-${period}`);
        return `<td class="${support ? "support-cell" : ""}">${support ? `<strong>${esc(projectMeta.subject)}</strong><small>${esc(support.teacher)}</small>` : esc(lesson) || "—"}</td>`;
      }).join("");
      return `<tr><th>שעה ${period}<small>${esc(timeRangeForPeriod(period, timetable).start)}</small></th>${cells}</tr>`;
    }).join("");
    const requests = (record.requests || []).map(request => {
      const assigned = record.progress?.[request.subject]?.assigned ?? (subjectMatchesProject(request.subject) ? record.progress?.[projectMeta.subject]?.assigned : 0) ?? 0;
      return `<li><strong>${esc(request.subject)}</strong><span>${assigned} מתוך ${request.hours} שעות שובצו</span></li>`;
    }).join("");
    const assignmentsList = studentAssignments.length ? studentAssignments.map(item => `<li>${esc(item.day)}, שעה ${item.period} · ${esc(item.teacher)}</li>`).join("") : "<li>טרם נקבעו שעות בפרויקט הנוכחי.</li>";
    const exceptions = [record.exceptions?.allowOtherLessons ? "ניתן לשבץ על חשבון שיעורים אחרים" : "", record.exceptions?.noPeriodZero ? "שעה 0 חסומה" : "", record.exceptions?.notes || ""].filter(Boolean);
    elements.studentDetailContent.innerHTML = `<section class="detail-summary"><div><h3>בקשות מהסל האישי</h3><ul>${requests || "<li>לא הוגדרו בקשות.</li>"}</ul></div><div><h3>שיבוצים בפרויקט הנוכחי</h3><ul>${assignmentsList}</ul></div></section>${exceptions.length ? `<section class="detail-exceptions"><h3>החרגות והערות</h3><p>${esc(exceptions.join(" · "))}</p></section>` : ""}<section class="detail-timetable"><h3>מערכת שבועית</h3>${timetable.length ? `<div class="detail-table-wrap"><table><thead><tr><th>שעה</th>${days.map(day => `<th>${day}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>` : "<p>טרם הועלתה מערכת שעות אישית.</p>"}</section>`;
    elements.studentDetailDialog.showModal();
  }

  function openSettingsDialog() {
    document.querySelector("#settingsSchool").value = projectMeta.school || "";
    document.querySelector("#settingsYear").value = projectMeta.year || "";
    document.querySelector("#settingsTeam").value = projectMeta.team || "";
    document.querySelector("#settingsSubject").value = projectMeta.subject || "";
    document.querySelector("#settingsAliases").value = (projectMeta.aliases || []).filter(item => item !== projectMeta.subject).join(", ");
    document.querySelector("#settingsLastPeriod").value = projectMeta.lastPeriod ?? 9;
    document.querySelector("#settingsAvoidPeriods").value = (projectMeta.avoidPeriods || []).join(", ");
    elements.settingsDialog.showModal();
  }

  function saveProjectSettings() {
    const subject = document.querySelector("#settingsSubject").value.trim();
    if (!subject) return alert("יש להזין מקצוע.");
    projectMeta.school = document.querySelector("#settingsSchool").value.trim();
    projectMeta.year = document.querySelector("#settingsYear").value.trim();
    projectMeta.team = document.querySelector("#settingsTeam").value.trim();
    projectMeta.subject = subject;
    projectMeta.aliases = [...new Set([subject, ...document.querySelector("#settingsAliases").value.split(",").map(item => item.trim()).filter(Boolean)])];
    projectMeta.lastPeriod = Number(document.querySelector("#settingsLastPeriod").value) || 9;
    projectMeta.avoidPeriods = document.querySelector("#settingsAvoidPeriods").value.split(",").map(Number).filter(Number.isInteger);
    payload.meta = projectMeta;
    safeLocalSet(activeProjectKey, JSON.stringify(payload));
    document.querySelector("#projectEyebrow").textContent = `${projectMeta.school || "בית הספר"} · ${projectMeta.year || ""}`;
    document.querySelector("#projectTitle").textContent = `שיבוצי ${projectMeta.subject} דיפרנציאליים`;
    elements.settingsDialog.close();
    renderAll();
    showToast("הגדרות הפרויקט נשמרו.");
  }

  function parseList(value) {
    return String(value || "").split(/[,\n]/).map(item => item.trim()).filter(Boolean);
  }

  function parsePeriods(value) {
    return [...new Set(parseList(value).map(Number).filter(period => Number.isInteger(period) && period >= 0 && period <= 9))].sort((a, b) => a - b);
  }

  function selectedTeacherRule() {
    const teacherName = elements.ruleTeacher.value;
    return {
      teacherName,
      summary: draft.teachers.find(item => item.teacher === teacherName),
      source: teacherData.get(teacherName)
    };
  }

  function refreshTeacherRules() {
    const { summary, source } = selectedTeacherRule();
    if (!summary || !source) return;
    const preferred = summary.preferred_quota ?? summary.quota ?? 0;
    const maximum = summary.assignment_limit ?? summary.quota ?? preferred;
    document.querySelector("#rulePreferredQuota").value = preferred;
    document.querySelector("#ruleAssignmentLimit").value = maximum;
    document.querySelector("#ruleAllowOverQuota").checked = source.allow_over_quota ?? maximum > preferred;
    document.querySelector("#ruleMaxConsecutive").value = source.max_consecutive || "";
    document.querySelector("#ruleForbiddenPeriods").value = (source.forbidden_periods || []).join(", ");
    document.querySelector("#ruleAllowedGrades").value = (source.allowed_student_grades || []).join(", ");
    document.querySelector("#ruleForbiddenGrades").value = (source.forbidden_student_grades || source.excluded_student_grades || []).join(", ");
    const preferredGrades = source.preferred_student_grades || (source.preferred_student_grade ? [source.preferred_student_grade] : []);
    document.querySelector("#rulePreferredGrades").value = preferredGrades.join(", ");
  }

  function openTeacherRulesDialog(requestedTeacher = null) {
    const current = requestedTeacher || elements.ruleTeacher.value;
    const names = draft.teachers.map(item => item.teacher).sort((a, b) => a.localeCompare(b, "he"));
    elements.ruleTeacher.innerHTML = names.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join("");
    if (names.includes(current)) elements.ruleTeacher.value = current;
    refreshTeacherRules();
    elements.teacherRulesDialog.showModal();
  }

  function saveTeacherRules() {
    const { teacherName, summary, source } = selectedTeacherRule();
    if (!teacherName || !summary || !source) return;
    const preferred = Number(document.querySelector("#rulePreferredQuota").value);
    const maximum = Number(document.querySelector("#ruleAssignmentLimit").value);
    if (!Number.isInteger(preferred) || preferred < 0 || !Number.isInteger(maximum) || maximum < preferred) {
      alert("יש להזין יעד שעות ומכסה מרבית תקינים. המכסה המרבית אינה יכולה להיות נמוכה מהיעד המועדף.");
      return;
    }
    summary.preferred_quota = preferred;
    summary.quota = maximum;
    summary.assignment_limit = maximum;
    source.allow_over_quota = document.querySelector("#ruleAllowOverQuota").checked;
    const maxConsecutive = Number(document.querySelector("#ruleMaxConsecutive").value);
    if (Number.isInteger(maxConsecutive) && maxConsecutive >= 1) source.max_consecutive = Math.min(7, maxConsecutive);
    else delete source.max_consecutive;
    source.forbidden_periods = parsePeriods(document.querySelector("#ruleForbiddenPeriods").value);
    source.allowed_student_grades = parseList(document.querySelector("#ruleAllowedGrades").value);
    source.forbidden_student_grades = parseList(document.querySelector("#ruleForbiddenGrades").value);
    delete source.excluded_student_grades;
    source.preferred_student_grades = parseList(document.querySelector("#rulePreferredGrades").value);
    delete source.preferred_student_grade;
    quotas.set(teacherName, preferred);
    assignmentLimits.set(teacherName, maximum);
    payload.schedule = draft;
    payload.teacherAvailability.teachers = [...teacherData.values()];
    if (safeLocalSet(activeProjectKey, JSON.stringify(payload))) markSaved();
    elements.teacherRulesDialog.close();
    renderAll();
    showToast(`הגדרות ${teacherName} נשמרו ונכללות בסידור המערכת.`);
  }

  function updateBackupMessage() {
    const value = localStorage.getItem(lastBackupKey);
    elements.lastBackupText.textContent = value
      ? `הגיבוי האחרון הורד ב־${new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(new Date(value))}.`
      : "טרם הורד גיבוי מהמכשיר הזה.";
    const backupAge = value ? Date.now() - new Date(value).getTime() : Number.POSITIVE_INFINITY;
    const badge = document.querySelector("#privacyButton");
    badge.classList.toggle("backup-due", backupAge > 7 * 24 * 60 * 60 * 1000);
    badge.textContent = backupAge > 7 * 24 * 60 * 60 * 1000 ? "מומלץ להוריד גיבוי" : "הנתונים נשמרים במכשיר בלבד";
  }

  function renderAll() {
    refreshRegistryProgress();
    renderSummary();
    renderSidebar();
    renderActiveView();
    renderNextAction();
    updateUndoButton();
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
    const reportDate = new Intl.DateTimeFormat("he-IL", { dateStyle: "long" }).format(new Date());
    const rows = draft.students.map(student => {
      const lessons = lessonsForStudent(student.student).sort((a, b) => days.indexOf(a.day) - days.indexOf(b.day) || a.period - b.period || a.teacher.localeCompare(b.teacher, "he"));
      const missing = Math.max(0, student.required - lessons.length);
      const lessonText = lessons.length
        ? `<div class="lesson-list">${lessons.map(item => `<span>${esc(item.day)} · שעה ${item.period} · <strong>${esc(item.teacher)}</strong>${item.groupId ? " · שיבוץ זוגי" : ""}</span>`).join("")}</div>`
        : "לא שובץ";
      return `<tr><td class="student-name"><strong>${esc(student.student)}</strong></td><td>${esc(student.grade)}</td><td class="centered">${student.required}</td><td>${lessonText}</td><td class="status ${missing ? "problem" : "ok"}">${missing ? `חסרה ${missing}` : "מלא"}</td></tr>`;
    }).join("");
    reportWindow.document.write(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>דו״ח שיבוצי ${esc(projectMeta.subject)} דיפרנציאליים</title><style>
      @page{size:A4 landscape;margin:10mm 12mm 12mm}*{box-sizing:border-box}html{background:#edf1f4}body{margin:0;padding:28px;color:#172a40;background:#edf1f4;font-family:Arial,"Noto Sans Hebrew",sans-serif;font-size:14px;line-height:1.45}.report-page{width:min(1120px,100%);margin:0 auto;padding:36px 42px 30px;background:#fff;box-shadow:0 12px 38px rgba(28,58,91,.16)}header{display:flex;justify-content:space-between;gap:24px;align-items:flex-end;padding:0 0 16px;border-bottom:3px solid #1d4f7a}h1{margin:0 0 5px;font-size:27px;line-height:1.2;color:#143a61}p{margin:0;color:#5d6d7e}.report-date{white-space:nowrap;font-size:12px}.actions{margin:17px 0}.actions button{padding:10px 16px;border:0;border-radius:6px;color:#fff;background:#1e5a91;font:inherit;font-weight:700;cursor:pointer}.print-guide{display:inline-block;margin-right:10px;color:#647487;font-size:12px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{padding:9px 10px;text-align:right;vertical-align:top;border:1px solid #d5dee7;line-height:1.45}th{color:#fff;background:#1a527f;font-size:12px;font-weight:700}th:nth-child(1){width:22%}th:nth-child(2){width:8%}th:nth-child(3){width:8%}th:nth-child(4){width:48%}th:nth-child(5){width:14%}tbody tr:nth-child(even){background:#f7f9fb}.student-name{color:#183b62}.centered,.status{text-align:center}.lesson-list{display:grid;gap:2px}.lesson-list span{position:relative;padding-right:10px}.lesson-list span::before{content:"";position:absolute;top:.62em;right:0;width:4px;height:4px;border-radius:50%;background:#5a8ab0}.status{font-weight:700;white-space:nowrap}.ok{color:#126b61}.problem{color:#9b4f00}@media(max-width:700px){body{padding:0;background:#fff}.report-page{padding:24px 18px;box-shadow:none}header{align-items:flex-start;flex-direction:column}.print-guide{display:none}th,td{padding:7px 6px;font-size:12px}th:nth-child(1){width:25%}th:nth-child(2),th:nth-child(3){width:9%}th:nth-child(4){width:42%}th:nth-child(5){width:15%}}@media print{html,body{width:100%;height:auto;background:#fff}body{padding:0;color:#111;font-size:10.5pt}.report-page{width:100%;margin:0;padding:0;box-shadow:none}h1{font-size:22pt}.actions,.print-guide{display:none}th,td{padding:6px 7px;font-size:10pt}thead{display:table-header-group}tr,header{break-inside:avoid;page-break-inside:avoid}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body><main class="report-page"><header><div><h1>דו״ח שיבוצי ${esc(projectMeta.subject)} דיפרנציאליים</h1><p>${esc(projectMeta.school)} · ${esc(projectMeta.year)}</p></div><p class="report-date">הופק בתאריך ${esc(reportDate)}</p></header><div class="actions"><button onclick="window.print()">הדפסה או שמירה כ־PDF</button><span class="print-guide">מותאם ל־A4 לרוחב</span></div><table><thead><tr><th>שם התלמיד/ה</th><th>כיתה</th><th>זכאות</th><th>שעות ומורה</th><th>מצב</th></tr></thead><tbody>${rows}</tbody></table></main></body></html>`);
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
      constraints: activeConstraints,
      shareWilling,
      studentRegistry,
      missingStudents: missingStudents().map(student => ({ student: student.student, missing: student.missingNow }))
    };
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `פרויקט-שיבוצי-${projectMeta.subject || "דיפרנציאלי"}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    safeLocalSet(lastBackupKey, new Date().toISOString());
    updateBackupMessage();
    showToast("הגיבוי הורד למחשב בהצלחה.");
  }

  function validateBackupFile(data) {
    if (!data || !Array.isArray(data.assignments)) {
      throw new Error("הקובץ אינו קובץ פרויקט תקין של מערכת השיבוצים.");
    }
    const knownStudents = new Set(draft.students.map(student => student.student));
    const knownTeachers = new Set(draft.teachers.map(teacher => teacher.teacher));
    data.assignments.forEach((item, index) => {
      if (!item || !knownStudents.has(item.student)) throw new Error(`בשיבוץ מספר ${index + 1} מופיע תלמיד שאינו קיים במערכת: ${JSON.stringify(item?.student)}`);
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
      throw new Error("נתוני השיוכים הקבועים בקובץ אינם תקינים.");
    }
    const restored = {};
    const knownStudents = new Set(draft.students.map(item => item.student));
    const knownTeachers = new Set(draft.teachers.map(item => item.teacher));
    Object.entries(data.locks).forEach(([studentName, teacherName]) => {
      if (!knownStudents.has(studentName) || !knownTeachers.has(teacherName)) throw new Error("הקובץ כולל שיוך קבוע שאינו מוכר למערכת.");
      restored[studentName] = teacherName;
    });
    return restored;
  }

  async function importDraft(file) {
    try {
      if (file.size > maxBackupBytes) throw new Error("קובץ הגיבוי גדול מ־15MB ולכן לא ניתן לקרוא אותו בבטחה.");
      const parsed = JSON.parse(await file.text());
      if (parsed?.kind === "differential-scheduling-project" && parsed.schedule && parsed.studentAvailability && parsed.teacherAvailability) {
        const projectName = parsed.meta?.team || parsed.meta?.subject || "הפרויקט החדש";
        if (!confirm(`לטעון את ${projectName} במקום הפרויקט המוצג כעת?`)) return;
        if (Array.isArray(parsed.studentRegistry)) safeLocalSet(registryStorageKey, JSON.stringify(parsed.studentRegistry));
        const importedProjectId = String(parsed.meta?.id || `${parsed.meta?.school || "school"}-${parsed.meta?.subject || "subject"}`).replace(/[^a-zA-Z0-9א-ת_-]+/g, "-");
        const importedAssignmentStorageKey = `differential-project-${importedProjectId}-assignments-v1`;
        const importedLockStorageKey = `differential-project-${importedProjectId}-locks-v1`;
        const importedDismissedWarningStorageKey = `differential-project-${importedProjectId}-dismissed-warnings-v1`;
        safeLocalSet(importedAssignmentStorageKey, JSON.stringify(parsed.schedule.assignments));
        if (parsed.locks && typeof parsed.locks === "object" && !Array.isArray(parsed.locks)) safeLocalSet(importedLockStorageKey, JSON.stringify(parsed.locks));
        else localStorage.removeItem(importedLockStorageKey);
        localStorage.removeItem(importedDismissedWarningStorageKey);
        safeLocalSet(activeProjectKey, JSON.stringify(parsed));
        location.reload();
        return;
      }
      const importedAssignments = validateBackupFile(parsed);
      const importedLocks = locksFromBackup(parsed);
      const shouldReplace = confirm(`קובץ הפרויקט כולל ${importedAssignments.length} שיבוצים. לטעון אותו במקום הגרסה הנוכחית?`);
      if (!shouldReplace) return;
      captureUndo("ייבוא פרויקט");
      assignments = importedAssignments;
      activeLocks = importedLocks;
      activeConstraints = Array.isArray(parsed.constraints) ? parsed.constraints : [];
      shareWilling = parsed.shareWilling && typeof parsed.shareWilling === "object" ? parsed.shareWilling : loadShareWilling();
      if (Array.isArray(parsed.studentRegistry)) studentRegistry = parsed.studentRegistry;
      dismissedWarnings = new Set();
      localStorage.removeItem(dismissedWarningStorageKey);
      saveAssignments();
      saveLocks();
      saveConstraints();
      saveShareWilling();
      saveStudentRegistry();
      renderAll();
      const issues = scheduleWarnings().filter(item => item.level !== "ok").length;
      showToast(issues ? `הפרויקט נטען. נמצאו ${issues} התראות לבדיקה.` : "הפרויקט נטען בהצלחה ולא נמצאו בעיות.");
    } catch (error) {
      alert(error instanceof Error ? error.message : "לא ניתן לקרוא את קובץ הפרויקט.");
    }
  }

  function resetLocalChanges() {
    if (!confirm("לשחזר את הגרסה הראשונית ולבטל את כל השינויים המקומיים?")) return;
    captureUndo("שחזור גרסה ראשונית");
    assignments = originalAssignments.map(item => ({ ...item }));
    activeLocks = { ...defaultLocks };
    activeConstraints = [];
    shareWilling = Object.fromEntries(draft.students.map(student => [student.student, Boolean(student.shareWilling)]));
    localStorage.removeItem(storageKey);
    localStorage.removeItem(lockStorageKey);
    localStorage.removeItem(constraintStorageKey);
    localStorage.removeItem(shareStorageKey);
    localStorage.removeItem(dismissedWarningStorageKey);
    dismissedWarnings = new Set();
    renderAll();
    showToast("הגרסה הראשונית שוחזרה.");
  }

  function clearBoard() {
    if (!assignments.length) {
      showToast("הלוח כבר ריק משיבוצים.");
      return;
    }
    const confirmed = confirm(`לנקות את הלוח מכל ${assignments.length} השיבוצים הקיימים?\n\nנתוני התלמידים, הצוות, הנעילות והאילוצים יישמרו. ניתן יהיה לבטל את הפעולה מיד באמצעות „ביטול פעולה אחרונה”.`);
    if (!confirmed) return;
    captureUndo("ניקוי לוח");
    assignments = [];
    saveAssignments();
    renderAll();
    showToast("הלוח נוקה. נתוני הפרויקט וההגדרות נשמרו.");
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

  refreshTeacherFilter();

  const isEmptyProject = draft.students.length === 0 && draft.teachers.length === 0;
  document.querySelector("#projectEyebrow").textContent = isEmptyProject ? "מערכת שיבוצים דיפרנציאליים" : `${projectMeta.school || "בית הספר"} · ${projectMeta.year || ""}`;
  document.querySelector("#projectTitle").textContent = isEmptyProject ? "פרויקט חדש" : `שיבוצי ${projectMeta.subject || "דיפרנציאליים"} דיפרנציאליים`;
  document.title = isEmptyProject ? "מערכת שיבוצים דיפרנציאליים" : `${projectMeta.subject || "שיבוצים"} — ${projectMeta.school || "מערכת דיפרנציאלית"}`;
  document.querySelector("#emptyProjectState").hidden = !isEmptyProject;
  document.querySelector("#summarySection").hidden = isEmptyProject;
  document.querySelector("#viewTabs").hidden = isEmptyProject;
  document.querySelector("#workspaceSection").hidden = isEmptyProject;
  const defaultProjectButton = document.querySelector("#defaultProjectButton");
  defaultProjectButton.hidden = !storedProject;
  defaultProjectButton.addEventListener("click", () => {
    if (!confirm("לסגור את הפרויקט הנוכחי ולחזור למסך הריק? מומלץ לייצא את הפרויקט לפני המעבר.")) return;
    localStorage.removeItem(activeProjectKey);
    location.reload();
  });

  const viewTabs = [...document.querySelectorAll(".view-tab")];
  function activateViewTab(button) {
    activeView = button.dataset.view;
    viewTabs.forEach(tab => {
      tab.classList.toggle("active", tab === button);
      tab.setAttribute("aria-selected", String(tab === button));
      tab.tabIndex = tab === button ? 0 : -1;
    });
    renderActiveView();
  }
  viewTabs.forEach((button, index) => {
    button.addEventListener("click", () => activateViewTab(button));
    button.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? viewTabs.length - 1 : event.key === "ArrowLeft" ? (index + 1) % viewTabs.length : (index - 1 + viewTabs.length) % viewTabs.length;
      activateViewTab(viewTabs[nextIndex]);
      viewTabs[nextIndex].focus();
    });
  });
  elements.teacherFilter.addEventListener("change", renderActiveView);
  elements.studentSearch.addEventListener("input", renderActiveView);
  document.body.addEventListener("click", event => {
    const newRegistryTarget = event.target.closest("[data-new-registry]");
    if (newRegistryTarget) {
      openRegistryDialog();
      return;
    }
    const editRegistryTarget = event.target.closest("[data-edit-registry]");
    if (editRegistryTarget) {
      openRegistryDialog(editRegistryTarget.dataset.editRegistry);
      return;
    }
    const deleteRegistryTarget = event.target.closest("[data-delete-registry]");
    if (deleteRegistryTarget) {
      deleteRegistryStudent(deleteRegistryTarget.dataset.deleteRegistry);
      return;
    }
    const viewRegistryTarget = event.target.closest("[data-view-registry]");
    if (viewRegistryTarget) {
      openStudentDetail(viewRegistryTarget.dataset.viewRegistry);
      return;
    }
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
  document.querySelector("#recalculateButton").addEventListener("click", recalculateMissingAssignments);
  elements.applySchedulePlanButton.addEventListener("click", applySchedulePlan);
  elements.addStudentSelect.addEventListener("change", refreshAddDialog);
  elements.addOptionSelect.addEventListener("change", updateAddDialogNote);
  elements.addAssignmentButton.addEventListener("click", addAssignment);
  document.querySelector("#managementMenuButton").addEventListener("click", openManagementDialog);
  document.querySelector("#closeManagementButton").addEventListener("click", closeManagementDialog);
  elements.managementDialog.addEventListener("click", event => {
    if (event.target === elements.managementDialog || event.target.closest("[data-close-management]")) closeManagementDialog();
    const action = event.target.closest("[data-management-action]")?.dataset.managementAction;
    if (!action) return;
    if (action === "team") { closeManagementDialog(); openTeamManager(); }
    if (action === "students") { closeManagementDialog(); activateViewTab(document.querySelector("#registryTab")); }
    if (action === "settings") { closeManagementDialog(); openSettingsDialog(); }
    if (action === "constraints") { closeManagementDialog(); openConstraintsDialog(); }
    if (action === "locks") { closeManagementDialog(); openLocksDialog(); }
    if (action === "swaps") { closeManagementDialog(); openSwapDialog(); }
    if (action === "share") { closeManagementDialog(); openShareDialog(); }
    if (action === "backup") { exportDraft(); }
    if (action === "restore") { closeManagementDialog(); document.querySelector("#importFile").click(); }
    if (action === "clear") { closeManagementDialog(); clearBoard(); }
    if (action === "reset") { closeManagementDialog(); resetLocalChanges(); }
  });
  document.querySelector("#openTeacherEditorButton").addEventListener("click", openTeacherEditor);
  document.querySelector("#saveNewTeacherButton").addEventListener("click", saveNewTeacher);
  elements.teamManagerList.addEventListener("click", event => {
    const teacherName = event.target.closest("[data-edit-team-teacher]")?.dataset.editTeamTeacher;
    if (teacherName) { elements.teamManagerDialog.close(); openTeacherEditor(teacherName); }
    const rulesName = event.target.closest("[data-rules-team-teacher]")?.dataset.rulesTeamTeacher;
    if (rulesName) { elements.teamManagerDialog.close(); openTeacherRulesDialog(rulesName); }
    const removeName = event.target.closest("[data-remove-team-teacher]")?.dataset.removeTeamTeacher;
    if (removeName) removeTeamTeacher(removeName);
  });
  elements.teacherEditorDialog.addEventListener("click", event => {
    const tool = event.target.closest("[data-teacher-shadow-mode]");
    if (tool) { teacherShadowMode = tool.dataset.teacherShadowMode; renderTeacherShadowEditor(); }
  });
  elements.teacherShadowGrid.addEventListener("pointerdown", event => {
    const cell = event.target.closest("[data-teacher-shadow-day]");
    if (!cell) return;
    event.preventDefault();
    teacherShadowDrawing = true;
    teacherShadowPaintedSlots = new Set();
    paintTeacherShadowSlot(cell);
  });
  elements.teacherShadowGrid.addEventListener("pointermove", event => {
    if (!teacherShadowDrawing) return;
    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-teacher-shadow-day]");
    paintTeacherShadowSlot(cell);
  });
  document.addEventListener("pointerup", () => { teacherShadowDrawing = false; teacherShadowPaintedSlots = new Set(); });
  document.addEventListener("pointercancel", () => { teacherShadowDrawing = false; teacherShadowPaintedSlots = new Set(); });
  elements.swapStudentSelect.addEventListener("change", renderSwapSuggestions);
  elements.swapShowEdges.addEventListener("change", renderSwapSuggestions);
  elements.swapSuggestions.addEventListener("click", event => {
    const button = event.target.closest("[data-swap-index]");
    if (button) applySwap(elements.swapSuggestions._items?.[Number(button.dataset.swapIndex)]);
  });
  document.querySelector("#saveLocksButton").addEventListener("click", commitLocks);
  elements.ruleTeacher.addEventListener("change", refreshTeacherRules);
  document.querySelector("#saveTeacherRulesButton").addEventListener("click", saveTeacherRules);
  document.querySelector("#saveShareWillingButton").addEventListener("click", commitShareWilling);
  elements.shareSuggestions.addEventListener("click", event => {
    const button = event.target.closest("[data-share-index]");
    if (button) applyShareSuggestion(elements.shareSuggestions._items?.[Number(button.dataset.shareIndex)]);
  });
  elements.constraintType.addEventListener("change", refreshConstraintPeople);
  document.querySelector("#addConstraintButton").addEventListener("click", addConstraint);
  elements.constraintsList.addEventListener("click", event => {
    const button = event.target.closest("[data-remove-constraint]");
    if (button) removeConstraint(Number(button.dataset.removeConstraint));
  });
  document.querySelector("#reportButton").addEventListener("click", openDeputyReport);
  const importFile = document.querySelector("#importFile");
  document.querySelector("#emptyImportButton").addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", async () => {
    const [file] = importFile.files;
    if (file) await importDraft(file);
    importFile.value = "";
  });
  elements.undoButton.addEventListener("click", undoLastAction);
  elements.nextActionButton.addEventListener("click", handleNextAction);
  elements.reviewWarningsButton.addEventListener("click", openReviewDialog);
  elements.validationList.addEventListener("click", event => {
    const button = event.target.closest("[data-dismiss-warning]");
    const item = button && elements.validationList._items?.[Number(button.dataset.dismissWarning)];
    if (!item || item.level === "error") return;
    dismissedWarnings.add(warningId(item));
    saveDismissedWarnings();
    renderAll();
    showToast("ההערה הוסתרה מהמסך הראשי. היא נשארה זמינה במסך הבקרה.");
  });
  document.querySelector("#restoreWarningsButton").addEventListener("click", () => {
    dismissedWarnings = new Set();
    saveDismissedWarnings();
    renderAll();
    elements.reviewDialog.close();
    openReviewDialog();
    showToast("כל ההערות הוחזרו למסך הראשי.");
  });
  elements.addRequestRowButton.addEventListener("click", () => addRequestRow());
  elements.requestRows.addEventListener("click", event => {
    const button = event.target.closest("[data-remove-request]");
    if (button) button.closest(".request-row").remove();
  });
  elements.registryScheduleFile.addEventListener("change", async () => {
    const [file] = elements.registryScheduleFile.files;
    await readRegistrySchedule(file);
  });
  elements.openShadowScheduleButton.addEventListener("click", openShadowScheduleEditor);
  elements.shadowScheduleEditor.addEventListener("click", event => {
    const tool = event.target.closest("[data-shadow-mode]");
    if (!tool) return;
    shadowMode = tool.dataset.shadowMode;
    elements.shadowScheduleEditor.querySelectorAll("[data-shadow-mode]").forEach(button => button.classList.toggle("active", button === tool));
  });
  elements.shadowScheduleGrid.addEventListener("pointerdown", event => {
    const cell = event.target.closest("[data-shadow-day]");
    if (!cell) return;
    event.preventDefault();
    shadowDrawing = true;
    shadowPaintedSlots = new Set();
    paintShadowSlot(cell);
  });
  elements.shadowScheduleGrid.addEventListener("pointermove", event => {
    if (!shadowDrawing) return;
    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-shadow-day]");
    paintShadowSlot(cell);
  });
  document.addEventListener("pointerup", () => { shadowDrawing = false; shadowPaintedSlots = new Set(); });
  document.addEventListener("pointercancel", () => { shadowDrawing = false; shadowPaintedSlots = new Set(); });
  elements.studentWizardNext.addEventListener("click", () => { if (studentWizardCanContinue()) showStudentWizardStep(studentWizardStep + 1); });
  elements.studentWizardBack.addEventListener("click", () => showStudentWizardStep(studentWizardStep - 1));
  elements.saveRegistryStudentButton.addEventListener("click", saveRegistryStudent);
  elements.editStudentFromDetail.addEventListener("click", () => {
    elements.studentDetailDialog.close();
    openRegistryDialog(detailStudentId);
  });
  document.querySelector("#saveSettingsButton").addEventListener("click", saveProjectSettings);
  document.querySelector("#privacyButton").addEventListener("click", () => { updateBackupMessage(); elements.privacyDialog.showModal(); });
  document.querySelector("#privacyBackupButton").addEventListener("click", exportDraft);

  const normalizedStudentCount = normalizeStudentNames();
  let registryHydratedProject = false;
  studentRegistry.forEach(record => { registryHydratedProject = syncRecordWithCurrentProject(record, record.projectStudentName, false) || registryHydratedProject; });
  if (registryHydratedProject) {
    saveAssignments();
    saveLocks();
    saveShareWilling();
  }
  updateBackupMessage();
  renderAll();
  if (normalizedStudentCount) showToast(`הוסרו סיומות כיתה מ־${normalizedStudentCount} שמות תלמידים.`);
  registerWebMcpTools();
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js?v=7").catch(() => {});
  window.addEventListener?.("offline", () => showToast("אין כרגע חיבור לרשת. אפשר להמשיך לעבוד; הנתונים יישמרו במכשיר."));
  window.addEventListener?.("online", () => showToast("החיבור לרשת חזר."));
})();
