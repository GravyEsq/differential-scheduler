(() => {
  "use strict";

  const CAMPUS_KEY = "differential-campus-v1";
  const LEGACY_REGISTRY_KEY = "differential-student-registry-v1";
  const SUBJECT_ALIASES = new Map([
    ["עברית", ["עברית", "לשון", "שפה"]],
    ["אנגלית", ["אנגלית"]], ["מתמטיקה", ["מתמטיקה"]], ["ספרות", ["ספרות"]],
    ["היסטוריה", ["היסטוריה"]], ["אזרחות", ["אזרחות"]], ["ביולוגיה", ["ביולוגיה"]],
    ["פיזיקה", ["פיזיקה", "פיסיקה"]], ["כימיה", ["כימיה"]]
  ]);
  const elements = {
    setup: document.querySelector("#campusSetup"), dashboard: document.querySelector("#campusDashboard"), school: document.querySelector("#campusSchool"), year: document.querySelector("#campusYear"), save: document.querySelector("#saveCampusButton"),
    title: document.querySelector("#campusTitle"), description: document.querySelector("#campusDescription"), archive: document.querySelector("#archiveYearButton"), report: document.querySelector("#globalReportButton"), export: document.querySelector("#exportCampusButton"), restore: document.querySelector("#restoreCampusFile"),
    manualForm: document.querySelector("#manualSubjectForm"), manualName: document.querySelector("#manualSubjectName"), manualAliases: document.querySelector("#manualSubjectAliases"), listForm: document.querySelector("#listSubjectForm"), list: document.querySelector("#subjectList"), subjectPreview: document.querySelector("#subjectPreview"), subjectList: document.querySelector("#subjectListView"),
    files: document.querySelector("#scheduleFiles"), scan: document.querySelector("#scanSchedulesButton"), scanStatus: document.querySelector("#scanStatus"), scanPreview: document.querySelector("#scanPreview"), legacyCard: document.querySelector("#legacyImportCard"), legacyLocked: document.querySelector("#legacyImportLocked"), legacyFile: document.querySelector("#legacyDocumentFile"), legacyScan: document.querySelector("#scanLegacyDocumentButton"), legacyStatus: document.querySelector("#legacyDocumentStatus"), legacyPreview: document.querySelector("#legacyDocumentPreview"), subjectCard: document.querySelector(".campus-subject-card"), studentsCard: document.querySelector(".campus-students-card"), archiveCard: document.querySelector(".campus-archive-card"), students: document.querySelector("#campusStudentsView"), archives: document.querySelector("#archiveList"), toast: document.querySelector("#campusToast"), requestsDialog: document.querySelector("#requestsDialog"), requestsTitle: document.querySelector("#requestsDialogTitle"), requestRows: document.querySelector("#campusRequestRows"), addRequestRow: document.querySelector("#addCampusRequestRow"), saveRequests: document.querySelector("#saveCampusRequests")
  };
  let campus = loadCampus();
  let pendingImport = null;
  let pendingLegacyImport = null;
  let toastTimer = null;

  function defaultCampus() { return { schemaVersion: 2, school: "", year: "", subjects: [], students: [], assignments: [], projects: [], archives: [], updatedAt: null }; }
  function loadCampus() {
    let storedCampus = null;
    try {
      const saved = JSON.parse(localStorage.getItem(CAMPUS_KEY));
      if (saved && typeof saved === "object") storedCampus = { ...defaultCampus(), ...saved, subjects: Array.isArray(saved.subjects) ? saved.subjects : [], students: Array.isArray(saved.students) ? saved.students : [], assignments: Array.isArray(saved.assignments) ? saved.assignments : [], projects: Array.isArray(saved.projects) ? saved.projects : [], archives: Array.isArray(saved.archives) ? saved.archives : [] };
    } catch (_) { /* Start with a clean local shell. */ }
    try {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_REGISTRY_KEY));
      if (Array.isArray(legacy)) {
        const campus = storedCampus || defaultCampus();
        const merged = new Map(campus.students.map(item => [item.id || item.fullName, item]));
        legacy.forEach(item => merged.set(item.id || item.fullName, item));
        return { ...campus, students: [...merged.values()] };
      }
    } catch (_) { /* No previous registry. */ }
    return storedCampus || defaultCampus();
  }
  function saveCampus() {
    try {
      campus.updatedAt = new Date().toISOString();
      localStorage.setItem(CAMPUS_KEY, JSON.stringify(campus));
      localStorage.setItem(LEGACY_REGISTRY_KEY, JSON.stringify(campus.students));
      return true;
    } catch (_) { showToast("לא ניתן לשמור במכשיר. הורידו גיבוי, בדקו שיש מקום פנוי בדפדפן ונסו שוב."); return false; }
  }
  function esc(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
  function showToast(text) { elements.toast.textContent = text; elements.toast.classList.add("visible"); clearTimeout(toastTimer); toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 3500); }
  function clean(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
  function split(value) { return String(value || "").split(/[\n,;]+/).map(clean).filter(Boolean); }
  function key(value) { return clean(value).toLocaleLowerCase("he").replace(/["׳״'`.,:;()\[\]{}]/g, "").replace(/[-–—]/g, " "); }
  function canonicalSubject(value) {
    const normalized = clean(value);
    const valueKey = key(normalized);
    for (const [canonical, aliases] of SUBJECT_ALIASES) if (aliases.some(alias => key(alias) === valueKey)) return { name: canonical, aliases, confidence: "certain" };
    const existing = campus.subjects.find(subject => [subject.name, ...(subject.aliases || [])].some(alias => key(alias) === valueKey));
    return { name: existing?.name || normalized, aliases: existing?.aliases || [], confidence: existing ? "certain" : "review" };
  }
  function addSubject(name, aliases = []) {
    const canonical = canonicalSubject(name);
    const existing = campus.subjects.find(subject => key(subject.name) === key(canonical.name));
    const allAliases = [...new Set([...(existing?.aliases || []), ...canonical.aliases, ...aliases].map(clean).filter(Boolean))].filter(alias => key(alias) !== key(canonical.name));
    if (existing) existing.aliases = allAliases;
    else campus.subjects.push({ id: `subject-${Date.now()}-${campus.subjects.length}`, name: canonical.name, aliases: allAliases, suggestedTeachers: [] });
  }
  function projectForSubject(subject) {
    return (campus.projects || []).find(project => key(project?.meta?.subject) === key(subject.name));
  }
  function activateProject(project) {
    const projectId = String(project?.meta?.id || `${project?.meta?.school || "school"}-${project?.meta?.subject || "subject"}`).replace(/[^a-zA-Z0-9א-ת_-]+/g, "-");
    localStorage.setItem("differential-active-project-v1", JSON.stringify(project));
    localStorage.setItem(`differential-project-${projectId}-assignments-v1`, JSON.stringify(project?.schedule?.assignments || []));
    localStorage.setItem(`differential-project-${projectId}-locks-v1`, JSON.stringify(project?.locks || {}));
    localStorage.setItem(`differential-project-${projectId}-constraints-v1`, JSON.stringify(project?.constraints || []));
    localStorage.setItem(`differential-project-${projectId}-share-v1`, JSON.stringify(project?.shareWilling || {}));
    location.href = "app.html";
  }
  function render() {
    const isReady = Boolean(campus.school && campus.year);
    elements.setup.hidden = isReady; elements.dashboard.hidden = !isReady;
    const hasStudents = campus.students.length > 0;
    elements.archive.hidden = !isReady;
    elements.legacyCard.hidden = !hasStudents;
    elements.legacyLocked.hidden = hasStudents;
    elements.subjectCard.hidden = !hasStudents;
    elements.studentsCard.hidden = !hasStudents;
    elements.archiveCard.hidden = !hasStudents;
    elements.title.textContent = isReady ? `${campus.school} · ${campus.year}` : "התחילו את מאגר התיכון";
    elements.description.textContent = isReady ? (hasStudents ? "המאגר מוכן. עכשיו אפשר להוסיף מקצוע, לפתוח אותו ולבנות צוות." : "השלב הראשון הוא קליטת מערכות התלמידים. לאחר מכן נפתח את אפשרויות העבודה הבאות.") : "נתחיל בהגדרת התיכון ושנת הלימודים. אחר כך נקלט את מערכות התלמידים.";
    elements.school.value = campus.school; elements.year.value = campus.year;
    elements.subjectList.innerHTML = campus.subjects.length ? campus.subjects.sort((a, b) => a.name.localeCompare(b.name, "he")).map(subject => { const existingProject = projectForSubject(subject); return `<article class="subject-chip"><strong>${esc(subject.name)}</strong>${subject.aliases?.length ? `<small>${esc(subject.aliases.join(" · "))}</small>` : ""}<span>${existingProject ? `${existingProject.schedule?.assignments?.length || 0} שעות משובצות · סביבת עבודה קיימת` : subject.suggestedTeachers?.length ? subject.suggestedTeachers.map(item => esc(item.name)).join(" · ") : "טרם הוגדר צוות"}</span><button class="text-button" data-open-subject="${esc(subject.id)}" type="button">${existingProject ? "המשך עבודה" : "הקמת מקצוע"}</button></article>`; }).join("") : "<p class=\"empty-note\">המקצועות שזוהו במערכות יופיעו כאן. אפשר גם להוסיף אחד ידנית.</p>";
    elements.students.innerHTML = campus.students.length ? campus.students.sort((a, b) => a.fullName.localeCompare(b.fullName, "he")).map(student => `<article class="campus-student"><div><strong>${esc(student.fullName)}</strong><span>${esc(student.grade || "כיתה לא הוגדרה")} · ${student.schedule?.timetable?.length ? "מערכת שעות נקלטה" : "ללא מערכת שעות"}</span></div><small>${student.requests?.length ? esc(student.requests.map(request => `${request.subject}: ${request.hours}`).join(" · ")) : "טרם הוגשו בקשות תגבור"}</small><button class="text-button" data-edit-requests="${esc(student.id)}" type="button">עריכת זכאויות</button></article>`).join("") : "<p class=\"empty-note\">טרם נקלטו תלמידים למאגר.</p>";
    elements.archives.innerHTML = campus.archives.length ? campus.archives.map(archive => `<article class="archive-row"><div><strong>${esc(archive.school)} · ${esc(archive.year)}</strong><span>${archive.students.length} תלמידים · ${archive.subjects.length} מקצועות</span></div><button class="text-button" data-view-archive="${esc(archive.id)}" type="button">צפייה</button></article>`).join("") : "<p class=\"empty-note\">עדיין לא נשמר צילום של שנה קודמת.</p>";
  }
  function prepareSubjects(names, sourceLabel) {
    const suggestions = [...new Map(names.map(name => { const item = canonicalSubject(name); return [key(item.name), item]; })).values()];
    elements.subjectPreview.hidden = false;
    elements.subjectPreview.innerHTML = `<div><strong>${sourceLabel}</strong><p>המערכת מציעה ${suggestions.length} מקצועות. שום דבר לא יישמר לפני אישור.</p></div><div class="preview-chip-list">${suggestions.map(item => `<label><input type="checkbox" data-preview-subject="${esc(item.name)}" checked /> <span>${esc(item.name)}${item.confidence === "review" ? " · לבדיקה" : ""}</span></label>`).join("")}</div><button id="applySubjectPreview" class="primary-button" type="button">אישור והוספת המקצועות</button>`;
    document.querySelector("#applySubjectPreview").addEventListener("click", () => {
      [...elements.subjectPreview.querySelectorAll("[data-preview-subject]:checked")].forEach(input => addSubject(input.dataset.previewSubject));
      saveCampus(); elements.subjectPreview.hidden = true; render(); showToast("המקצועות שנבחרו נוספו למאגר.");
    });
  }
  function inferLessons(raw) {
    const source = String(raw || "").replace(/\r/g, "\n");
    const compact = clean(source);
    const rosterPattern = /((?:יא|יב|י|ט)\d+(?:\s*[-–]\s*(?:יא|יב|י|ט)\d+)?)\s+([^\[\]]{1,80}?)\s+\[(\d+)\]/gu;
    const matches = [...compact.matchAll(rosterPattern)];
    if (matches.length) {
      let previousEnd = 0;
      return matches.map(match => {
        let subjectText = compact.slice(previousEnd, match.index);
        if (previousEnd) subjectText = subjectText.slice(subjectText.lastIndexOf(",") + 1);
        subjectText = clean(subjectText.replace(/^\([^)]*\)\s*,?\s*/u, "").replace(/^חדר\s*:[^,]*,?\s*/u, ""));
        previousEnd = match.index + match[0].length;
        return { raw: match[0], subject: canonicalSubject(subjectText).name, teacher: clean(match[2]), classGroup: clean(match[1]), groupNumber: match[3], confidence: "certain" };
      }).filter(item => item.subject && !/^(חלון|הפסקה|חופשי|ללא)/.test(item.subject));
    }
    const lines = source.split(/\n+|\s*·\s*/).map(clean).filter(Boolean).filter(line => !/^\[?\d+\]?$/.test(line) && !/^חדר\s*:/u.test(line));
    if (!lines.length) return [];
    const normalized = lines.join(" · ");
    const teacherMatch = normalized.match(/(?:\bעם\b|מורה\s*:|בהנחיית)\s*([א-ת][א-ת\s׳״'\-]{1,40})/);
    let subjectText = teacherMatch ? normalized.slice(0, teacherMatch.index) : lines[0];
    subjectText = clean(subjectText.replace(/\b(?:עם|מורה)\b.*$/u, "").replace(/\([^)]*\)/g, "").replace(/\s+(?:יא|יב|י|ט)\d*\s*[-–]\s*(?:יא|יב|י|ט)\d*.*$/u, ""));
    if (!subjectText || subjectText.length > 45 || /^(חלון|הפסקה|חופשי|ללא)/.test(subjectText)) return [];
    const lineTeacher = lines.slice(1).find(line => /^[א-ת][א-ת\s׳״'\-]{1,40}$/.test(line) && !/^(חדר|כיתה)/.test(line)) || null;
    const teacher = teacherMatch?.[1] ? clean(teacherMatch[1]) : lineTeacher;
    return [{ raw: normalized, subject: canonicalSubject(subjectText).name, teacher, confidence: teacher ? "certain" : "review" }];
  }
  function observedCommitmentsFor(allLessons, teacherName) {
    const slots = new Map();
    allLessons.filter(lesson => key(lesson.teacher) === key(teacherName) && lesson.day && Number.isInteger(lesson.period)).forEach(lesson => {
      const slotKey = `${lesson.day}|${lesson.period}`;
      const existing = slots.get(slotKey) || { day: lesson.day, period: lesson.period, subjects: [], source: "מערכות תלמידים" };
      if (lesson.subject && !existing.subjects.some(subject => key(subject) === key(lesson.subject))) existing.subjects.push(lesson.subject);
      slots.set(slotKey, existing);
    });
    return [...slots.values()].sort((first, second) => ["ראשון", "שני", "שלישי", "רביעי", "חמישי"].indexOf(first.day) - ["ראשון", "שני", "שלישי", "רביעי", "חמישי"].indexOf(second.day) || first.period - second.period);
  }
  function lessonsFromStoredSchedules() {
    return campus.students.flatMap(student => (student.schedule?.timetable || []).flatMap(row => Object.entries(row.lessons || {}).flatMap(([day, raw]) => inferLessons(raw).map(lesson => ({ ...lesson, day, period: row.period })))));
  }
  function refreshTeacherDraftsFromStoredSchedules() {
    const allLessons = lessonsFromStoredSchedules();
    if (!allLessons.length || !campus.subjects.length) return;
    let changed = false;
    campus.subjects.forEach(subjectRecord => {
      const subjectNames = [subjectRecord.name, ...(subjectRecord.aliases || [])];
      const teachers = [...new Set(allLessons.filter(lesson => subjectNames.some(name => key(name) === key(lesson.subject))).map(lesson => lesson.teacher).filter(Boolean))];
      teachers.forEach(name => {
        const observedCommitments = observedCommitmentsFor(allLessons, name);
        const existing = (subjectRecord.suggestedTeachers || []).find(item => key(item.name) === key(name));
        if (existing) {
          if (JSON.stringify(existing.observedCommitments || []) !== JSON.stringify(observedCommitments)) { existing.observedCommitments = observedCommitments; changed = true; }
        } else {
          subjectRecord.suggestedTeachers = [...(subjectRecord.suggestedTeachers || []), { name, confidence: "certain", source: "מערכות תלמידים", observedCommitments }];
          changed = true;
        }
      });
    });
    if (changed) saveCampus();
  }
  function knownSubjectIn(text) {
    const source = key(text);
    const requestSubjects = campus.students.flatMap(student => (student.requests || []).map(request => request.subject));
    const options = [...campus.subjects.flatMap(subject => [subject.name, ...(subject.aliases || [])]), ...requestSubjects, ...[...SUBJECT_ALIASES.values()].flat()]
      .filter(Boolean).sort((first, second) => key(second).length - key(first).length);
    const match = options.find(subject => source.includes(key(subject)));
    return match ? canonicalSubject(match).name : null;
  }
  function studentFromLegacyCell(cell) {
    const sourceTokens = new Set(key(cell).split(/\s+/).filter(token => token.length > 1));
    const ranked = campus.students.map(student => {
      const tokens = key(student.fullName).split(/\s+/).filter(token => token.length > 1);
      return { student, score: tokens.filter(token => sourceTokens.has(token)).length };
    }).filter(item => item.score >= 2).sort((first, second) => second.score - first.score);
    return ranked.length && (!ranked[1] || ranked[0].score > ranked[1].score) ? ranked[0].student : null;
  }
  function oldFormatChanges(tables) {
    const found = new Map(); const unknownRows = [];
    const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי"];
    tables.forEach(table => {
      let currentStudent = null; let currentSubject = null;
      table.forEach(row => {
        const cells = row.map(clean); const joined = cells.join(" · ");
        const explicitStudent = cells.filter(Boolean).map(studentFromLegacyCell).find(Boolean);
        if (explicitStudent) currentStudent = explicitStudent;
        else if (cells[0] && !/שם\s*התלמיד/u.test(cells[0])) currentStudent = null;
        const supportCell = cells[1] || cells.find(cell => knownSubjectIn(cell) && /^\s*\d+\s+/u.test(cell));
        const detectedSubject = supportCell ? knownSubjectIn(supportCell) : null;
        if (detectedSubject) currentSubject = detectedSubject;
        if (!currentStudent || !currentSubject) { if (/עברית|לשון|שפה/.test(joined)) unknownRows.push(joined); return; }
        if (supportCell && detectedSubject) {
          const hoursMatch = supportCell.match(/^\s*(\d+)\s+/u) || supportCell.match(/(\d+)\s*(?:שעות?|שעו?ת)/u) || supportCell.match(/(?:שעות?|שעו?ת)\s*(\d+)/u);
          const hours = Number(hoursMatch?.[1]);
          if (Number.isInteger(hours) && hours > 0) found.set(`${currentStudent.id}|${currentSubject}`, { kind: "request", student: currentStudent, subject: currentSubject, hours });
          else unknownRows.push(joined);
        }
        const dayCellIndex = cells.findIndex(cell => days.some(day => cell.includes(day)));
        if (dayCellIndex < 0) return;
        const rowDays = [...cells[dayCellIndex].matchAll(/ראשון|שני|שלישי|רביעי|חמישי/gu)].map(match => match[0]);
        const periodCell = cells[dayCellIndex + 1] || "";
        const periods = [...periodCell.matchAll(/(?:^|\D)([0-8])(?=\D|$)/gu)].map(match => Number(match[1]));
        const teacher = clean((cells[dayCellIndex + 2] || "").replace(/\s*\([^)]*\).*$/u, "").replace(/\s+עח\b.*$/u, ""));
        rowDays.forEach((day, index) => {
          const period = periods[index] ?? (periods.length === 1 ? periods[0] : null);
          if (Number.isInteger(period)) found.set(`${currentStudent.id}|${currentSubject}|${day}|${period}`, { kind: "reservation", student: currentStudent, subject: currentSubject, day, period, teacher });
        });
      });
    });
    return { changes: [...found.values()], unknownRows };
  }
  async function scanLegacyDocument() {
    const [file] = elements.legacyFile.files; if (!file) return showToast("בחרו קובץ Word שהורד מהמסמך הישן.");
    if (!campus.students.length) { const message = "לפני ייבוא מהפורמט הישן יש לקלוט תלמידים למאגר, כדי שהמערכת תוכל לזהות אותם בבטחה."; elements.legacyStatus.textContent = message; elements.legacyStatus.className = "file-status error"; return showToast(message); }
    if (!window.DocxTableReader?.parseTables) { elements.legacyStatus.textContent = "רכיב קריאת Word לא נטען. רעננו את הדף ונסו שוב."; elements.legacyStatus.className = "file-status error"; return; }
    elements.legacyScan.disabled = true; elements.legacyStatus.textContent = "קורא את הטבלאות ומכין תצוגה מקדימה…"; elements.legacyStatus.className = "file-status";
    try {
      const { tables } = await window.DocxTableReader.parseTables(file); const result = oldFormatChanges(tables); pendingLegacyImport = result;
      const requests = result.changes.filter(item => item.kind === "request"); const reservations = result.changes.filter(item => item.kind === "reservation");
      elements.legacyPreview.hidden = false; elements.legacyPreview.innerHTML = `<div class="preview-head"><div><h3>תצוגה מקדימה — הפורמט הישן</h3><p>זוהו ${requests.length} עדכוני זכאות ו־${reservations.length} שעות דיפרנציאליות. השעות יישמרו כהזמנות מהפורמט הישן עד לשיוך שלהן במקצוע המתאים.</p></div></div><div class="legacy-change-list">${result.changes.map((item, index) => `<label><input type="checkbox" data-legacy-change="${index}" checked /> <span><strong>${esc(item.student.fullName)}</strong> · ${esc(item.subject)} · ${item.kind === "request" ? `${item.hours} שעות` : `${item.day}, שעה ${item.period}`}</span></label>`).join("") || "<p>לא זוהו שורות חד־משמעיות. אפשר להמשיך לעבוד מהמאגר ולערוך ידנית.</p>"}${result.unknownRows.length ? `<small>${result.unknownRows.length} שורות נותרו לבדיקה ולא ייובאו.</small>` : ""}</div><div class="preview-actions"><button id="applyLegacyImport" class="primary-button" type="button" ${result.changes.length ? "" : "disabled"}>אישור והחלת השינויים</button><button id="discardLegacyImport" class="secondary-button" type="button">ביטול</button></div>`;
      document.querySelector("#discardLegacyImport").addEventListener("click", () => { pendingLegacyImport = null; elements.legacyPreview.hidden = true; }); document.querySelector("#applyLegacyImport")?.addEventListener("click", applyLegacyImport);
      elements.legacyStatus.textContent = result.changes.length ? `נמצאו ${tables.length} טבלאות ו־${result.changes.length} שינויים אפשריים. שום דבר לא נשמר לפני אישור.` : `נמצאו ${tables.length} טבלאות, אך לא זוהו שורות חד־משמעיות. בדקו שהקובץ הוא ההורדה העדכנית מהמסמך ושהתלמידים כבר נקלטו במאגר.`; elements.legacyStatus.className = result.changes.length ? "file-status ok" : "file-status error";
    } catch (error) { elements.legacyStatus.textContent = error instanceof Error ? error.message : "לא ניתן לקרוא את הקובץ."; elements.legacyStatus.className = "file-status error"; }
    finally { elements.legacyScan.disabled = false; }
  }
  function applyLegacyImport() {
    if (!pendingLegacyImport) return; const selected = new Set([...elements.legacyPreview.querySelectorAll("[data-legacy-change]:checked")].map(input => Number(input.dataset.legacyChange)));
    pendingLegacyImport.changes.forEach((change, index) => { if (!selected.has(index)) return; if (change.kind === "request") { const other = (change.student.requests || []).filter(item => key(item.subject) !== key(change.subject)); change.student.requests = [...other, { subject: change.subject, hours: change.hours }]; addSubject(change.subject); } else { const known = (campus.assignments || []).find(item => item.student === change.student.fullName && item.subject === change.subject); campus.assignments = [...(campus.assignments || []).filter(item => !(item.legacyReservation && item.student === change.student.fullName && item.subject === change.subject && item.day === change.day && item.period === change.period)), { id: `legacy-${Date.now()}-${index}`, campusProjectId: "legacy-format", legacyReservation: true, student: change.student.fullName, grade: change.student.grade, teacher: change.teacher || known?.teacher || "יש לשייך מורה", subject: change.subject, day: change.day, period: change.period, updatedAt: new Date().toISOString() }]; } });
    saveCampus(); pendingLegacyImport = null; elements.legacyPreview.hidden = true; render(); showToast("השינויים שנבחרו מהפורמט הישן נשמרו במאגר.");
  }
  async function scanSchedules() {
    const files = [...elements.files.files];
    if (!files.length) return showToast("בחרו לפחות מערכת שעות אחת.");
    elements.scan.disabled = true; elements.scanStatus.textContent = "קורא את המערכות ומאתר מקצועות…"; elements.scanStatus.className = "file-status";
    try {
      const results = await Promise.all(files.map(file => window.XlsxScheduleReader.parseStudentSchedule(file)));
      const parsedStudents = results.map(result => ({ id: `student-${Date.now()}-${Math.random().toString(16).slice(2)}`, fullName: result.name || result.fileName.replace(/\.xlsx$/i, ""), grade: result.grade || "", schedule: { fileName: result.fileName, timetable: result.timetable }, requests: [], shareWilling: false, progress: {}, source: "campus-import" }));
      const lessons = results.flatMap(result => result.timetable.flatMap(row =>
        Object.entries(row.lessons || {}).flatMap(([day, raw]) =>
          inferLessons(raw).map(lesson => ({ ...lesson, day, period: row.period }))
        )
      ));
      const bySubject = new Map();
      lessons.forEach(item => { if (!bySubject.has(item.subject)) bySubject.set(item.subject, []); bySubject.get(item.subject).push(item); });
      pendingImport = { students: parsedStudents, bySubject };
      renderScanPreview();
      elements.scanStatus.textContent = `${files.length} מערכות נקראו. בדקו את ההצעה לפני שמירה.`; elements.scanStatus.className = "file-status ok";
    } catch (error) {
      elements.scanStatus.textContent = error instanceof Error ? error.message : "לא ניתן לקרוא את הקבצים."; elements.scanStatus.className = "file-status error";
    } finally { elements.scan.disabled = false; }
  }
  function renderScanPreview() {
    if (!pendingImport) return;
    const subjects = [...pendingImport.bySubject.entries()].sort(([first], [second]) => first.localeCompare(second, "he"));
    const mergeOptions = [...new Set([...campus.subjects.map(subject => subject.name), ...subjects.map(([subject]) => canonicalSubject(subject).name)])].sort((first, second) => first.localeCompare(second, "he"));
    elements.scanPreview.hidden = false;
    elements.scanPreview.innerHTML = `<div class="preview-head"><div><h3>תצוגה מקדימה — לא נשמר עדיין</h3><p>${pendingImport.students.length} תלמידים ייקלטו עם מערכת שעות אחת לכל תלמיד. נמצאו ${subjects.length} מקצועות. אפשר לבטל מקצוע או למזג אותו באמצעות בחירת אותו שם יעד.</p></div></div><datalist id="mergeSubjectOptions">${mergeOptions.map(subject => `<option value="${esc(subject)}"></option>`).join("")}</datalist><div class="scan-subjects">${subjects.map(([subject, lessons]) => { const teachers = [...new Set(lessons.map(item => item.teacher).filter(Boolean))]; const target = canonicalSubject(subject).name; return `<article><label class="scan-subject-title"><input type="checkbox" data-import-subject="${esc(subject)}" checked /> <strong>${esc(subject)}</strong></label><span>${lessons.length} הופעות במערכות</span><small>${teachers.length ? `צוות שזוהה: ${esc(teachers.join(" · "))}` : "לא זוהה שם מורה בוודאות"}</small><label class="merge-subject-control"><span>שמירה או מיזוג אל</span><input data-import-target="${esc(subject)}" value="${esc(target)}" list="mergeSubjectOptions" aria-label="שם היעד עבור ${esc(subject)}" /></label></article>`; }).join("")}</div><div class="preview-actions"><button id="applyScheduleImport" class="primary-button" type="button">אישור וקליטת הנתונים</button><button id="discardScheduleImport" class="secondary-button" type="button">ביטול</button></div>`;
    document.querySelector("#discardScheduleImport").addEventListener("click", () => { pendingImport = null; elements.scanPreview.hidden = true; showToast("ההצעה בוטלה; דבר לא נשמר."); });
    document.querySelector("#applyScheduleImport").addEventListener("click", applyScheduleImport);
  }
  function applyScheduleImport() {
    const selected = [...elements.scanPreview.querySelectorAll("[data-import-subject]:checked")].map(input => {
      const source = input.dataset.importSubject;
      const target = clean(elements.scanPreview.querySelector(`[data-import-target="${CSS.escape(source)}"]`)?.value);
      return { source, target };
    });
    const missingTarget = selected.find(item => !item.target);
    if (missingTarget) return showToast(`יש לבחור שם יעד עבור „${missingTarget.source}”, או לבטל את הסימון שלו.`);
    pendingImport.students.forEach(student => {
      const previous = campus.students.find(item => key(item.fullName) === key(student.fullName));
      if (previous) Object.assign(previous, { grade: student.grade || previous.grade, schedule: student.schedule, source: "campus-import" });
      else campus.students.push(student);
    });
    const allLessons = [...pendingImport.bySubject.values()].flat();
    selected.forEach(({ source, target }) => {
      const lessons = pendingImport.bySubject.get(source) || [];
      addSubject(target, key(source) === key(target) ? [] : [source]);
      const record = campus.subjects.find(item => key(item.name) === key(canonicalSubject(target).name));
      const teachers = [...new Set(lessons.map(item => item.teacher).filter(Boolean))];
      record.suggestedTeachers = [...new Map([...(record.suggestedTeachers || []).map(item => [key(item.name), item]), ...teachers.map(name => [key(name), { name, confidence: "certain", source: "מערכות תלמידים", observedCommitments: observedCommitmentsFor(allLessons, name) }])]).values()];
    });
    saveCampus(); pendingImport = null; elements.scanPreview.hidden = true; render(); showToast("הנתונים אושרו ונשמרו במאגר התיכון.");
  }
  function archiveYear() {
    if (!campus.students.length && !campus.subjects.length) return showToast("אין עדיין נתונים לשמירה בצילום שנתי.");
    if (!confirm(`ליצור צילום לקריאה בלבד של ${campus.school} · ${campus.year}? המאגר הפעיל לא ישתנה.`)) return;
    campus.archives.unshift({ id: `archive-${Date.now()}`, school: campus.school, year: campus.year, createdAt: new Date().toISOString(), students: structuredClone(campus.students), subjects: structuredClone(campus.subjects), assignments: structuredClone(campus.assignments || []), projects: structuredClone(campus.projects || []) });
    saveCampus(); render(); showToast("צילום סוף השנה נשמר לקריאה בלבד.");
  }
  function viewArchive(id) {
    const archive = campus.archives.find(item => item.id === id); if (!archive) return;
    alert(`${archive.school} · ${archive.year}\n\n${archive.students.length} תלמידים\n${archive.subjects.length} מקצועות\n\nהצילום נשמר לקריאה בלבד.`);
  }
  function requestRow(request = { subject: "", hours: 1 }) {
    return `<div class="request-row"><label><span>מקצוע</span><input data-campus-request-subject value="${esc(request.subject)}" list="campusSubjects" /></label><label><span>שעות</span><input data-campus-request-hours type="number" min="1" max="20" value="${Number(request.hours) || 1}" /></label><button class="text-button" data-remove-campus-request type="button">הסרה</button></div>`;
  }
  function openRequests(studentId) {
    const student = campus.students.find(item => item.id === studentId); if (!student) return;
    elements.requestsDialog.dataset.studentId = studentId;
    elements.requestsTitle.textContent = `זכאויות — ${student.fullName}`;
    elements.requestRows.innerHTML = `<datalist id="campusSubjects">${campus.subjects.map(subject => `<option value="${esc(subject.name)}"></option>`).join("")}</datalist>${(student.requests?.length ? student.requests : [{ subject: "", hours: 1 }]).map(requestRow).join("")}`;
    elements.requestsDialog.showModal();
  }
  function saveRequests() {
    const student = campus.students.find(item => item.id === elements.requestsDialog.dataset.studentId); if (!student) return;
    const requests = [...elements.requestRows.querySelectorAll(".request-row")].map(row => ({ subject: clean(row.querySelector("[data-campus-request-subject]").value), hours: Number(row.querySelector("[data-campus-request-hours]").value) })).filter(request => request.subject || request.hours);
    if (!requests.length || requests.some(request => !request.subject || !Number.isInteger(request.hours) || request.hours < 1)) return showToast("יש למלא מקצוע ומספר שעות תקין בכל שורה.");
    if (new Set(requests.map(request => key(request.subject))).size !== requests.length) return showToast("אותו מקצוע מופיע יותר מפעם אחת.");
    student.requests = requests; requests.forEach(request => addSubject(request.subject));
    saveCampus(); elements.requestsDialog.close(); render(); showToast("הזכאויות נשמרו במאגר.");
  }
  function exportCampus() {
    const backup = { kind: "differential-campus-backup", schemaVersion: 2, exportedAt: new Date().toISOString(), campus };
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" })); link.download = `מאגר-${campus.school || "תיכון"}-${campus.year || "ללא-שנה"}.json`; link.click(); URL.revokeObjectURL(link.href); showToast(`גיבוי מלא הורד: ${campus.students.length} תלמידים ו־${(campus.projects || []).length} מקצועות פעילים.`);
  }
  async function restoreCampus(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data?.kind !== "differential-campus-backup" || !data.campus || !Array.isArray(data.campus.students) || !Array.isArray(data.campus.subjects)) throw new Error("זה אינו קובץ גיבוי תקין של מאגר התיכון.");
      const next = { ...defaultCampus(), ...data.campus, students: data.campus.students, subjects: data.campus.subjects, assignments: Array.isArray(data.campus.assignments) ? data.campus.assignments : [], projects: Array.isArray(data.campus.projects) ? data.campus.projects : [], archives: Array.isArray(data.campus.archives) ? data.campus.archives : [] };
      const preview = `תצוגה מקדימה לשחזור:\n${next.school || "ללא שם"} · ${next.year || "ללא שנה"}\n${next.students.length} תלמידים, ${next.subjects.length} מקצועות, ${next.projects.length} סביבות עבודה ו־${next.assignments.length} שיבוצים דיפרנציאליים.\n\nהמאגר המקומי הנוכחי יוחלף. להמשיך?`;
      if (!confirm(preview)) return;
      campus = next; localStorage.removeItem("differential-active-project-v1"); saveCampus(); render(); showToast("הגיבוי המלא שוחזר. פתחו מקצוע מהרשימה כדי להמשיך לעבוד בו.");
    } catch (error) { showToast(error instanceof Error ? error.message : "לא ניתן לשחזר את הקובץ."); }
    finally { elements.restore.value = ""; }
  }
  function globalReport() {
    const assignmentsByStudent = new Map();
    (campus.assignments || []).forEach(item => { if (!assignmentsByStudent.has(item.student)) assignmentsByStudent.set(item.student, []); assignmentsByStudent.get(item.student).push(item); });
    const rows = campus.students.map(student => { const lessons = (assignmentsByStudent.get(student.fullName) || []).sort((a, b) => a.day.localeCompare(b.day, "he") || a.period - b.period); return `<tr><td>${esc(student.fullName)}</td><td>${esc(student.grade || "—")}</td><td>${esc((student.requests || []).map(request => `${request.subject}: ${request.hours}`).join(" · ") || "—")}</td><td>${lessons.length ? lessons.map(item => `${esc(item.subject || "מקצוע")} · ${esc(item.day)} ${item.period} · ${esc(item.teacher)}`).join("<br>") : "טרם שובץ"}</td></tr>`; }).join("");
    const report = window.open("", "_blank"); if (!report) return showToast("הדפדפן חסם את פתיחת הדו״ח.");
    report.document.write(`<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><title>דו״ח כולל</title><style>@page{size:A4 landscape;margin:12mm}body{font:14px Arial;color:#17345f}h1{margin:0 0 5px}p{color:#607287}table{width:100%;border-collapse:collapse;margin-top:22px}th,td{padding:9px;border:1px solid #cfd9e6;text-align:right;vertical-align:top}th{background:#1f4d7b;color:#fff}@media print{button{display:none}}</style><body><button onclick="print()">הדפסה או שמירה כ־PDF</button><h1>דו״ח דיפרנציאלי כולל</h1><p>${esc(campus.school)} · ${esc(campus.year)}</p><table><thead><tr><th>תלמיד/ה</th><th>כיתה</th><th>זכאויות</th><th>שיבוצים בכל המקצועות</th></tr></thead><tbody>${rows}</tbody></table></body></html>`); report.document.close();
  }
  elements.save.addEventListener("click", () => { const school = clean(elements.school.value); const year = clean(elements.year.value); if (!school || !year) return showToast("יש למלא את שם התיכון ואת שנת הלימודים."); campus.school = school; campus.year = year; saveCampus(); render(); showToast("מאגר התיכון הוגדר ונשמר."); });
  elements.manualForm.addEventListener("submit", event => {
    event.preventDefault();
    const name = clean(elements.manualName.value);
    if (!name) return showToast("יש להזין שם מקצוע.");
    const canonical = canonicalSubject(name);
    const existing = campus.subjects.find(subject => key(subject.name) === key(canonical.name));
    if (existing) {
      const project = projectForSubject(existing);
      if (project && confirm(`המקצוע „${existing.name}” כבר קיים.\n\nאישור — מעבר לסביבת העבודה הקיימת\nביטול — חזרה ובחירת שם חדש`)) return activateProject(project);
      elements.manualName.focus();
      return showToast(`השם „${existing.name}” כבר בשימוש. בחרו שם של מקצוע חדש${project ? " או פתחו את המקצוע הקיים מהרשימה" : ""}.`);
    }
    addSubject(name, split(elements.manualAliases.value)); saveCampus(); elements.manualName.value = ""; elements.manualAliases.value = ""; render(); showToast("המקצוע נוסף למאגר.");
  });
  elements.listForm.addEventListener("submit", event => { event.preventDefault(); const values = split(elements.list.value); if (!values.length) return showToast("הדביקו לפחות מקצוע אחד."); prepareSubjects(values, "הצעת מקצועות מהרשימה"); });
  elements.scan.addEventListener("click", scanSchedules); elements.archive.addEventListener("click", archiveYear);
  elements.legacyScan.addEventListener("click", scanLegacyDocument);
  elements.legacyFile.addEventListener("change", () => {
    const [file] = elements.legacyFile.files;
    elements.legacyPreview.hidden = true;
    if (!file) { elements.legacyScan.disabled = true; elements.legacyStatus.textContent = "בחרו קובץ Word שהורד מהמסמך הישן. מיד לאחר הבחירה תתחיל הקריאה המקומית."; elements.legacyStatus.className = "file-status"; return; }
    elements.legacyScan.disabled = false;
    elements.legacyStatus.textContent = `נבחר הקובץ „${file.name}”. מתחיל לקרוא אותו במכשיר…`;
    elements.legacyStatus.className = "file-status";
    scanLegacyDocument();
  });
  elements.report.addEventListener("click", globalReport); elements.export.addEventListener("click", exportCampus); elements.restore.addEventListener("change", event => restoreCampus(event.target.files[0]));
  elements.students.addEventListener("click", event => { const button = event.target.closest("[data-edit-requests]"); if (button) openRequests(button.dataset.editRequests); });
  elements.addRequestRow.addEventListener("click", () => elements.requestRows.insertAdjacentHTML("beforeend", requestRow()));
  elements.requestRows.addEventListener("click", event => { const button = event.target.closest("[data-remove-campus-request]"); if (button && elements.requestRows.querySelectorAll(".request-row").length > 1) button.closest(".request-row").remove(); });
  elements.saveRequests.addEventListener("click", saveRequests);
  elements.subjectList.addEventListener("click", event => {
    const button = event.target.closest("[data-open-subject]"); if (!button) return;
    const subject = campus.subjects.find(item => item.id === button.dataset.openSubject); if (!subject) return;
    const existingProject = projectForSubject(subject);
    if (existingProject) {
      activateProject(existingProject);
      return;
    }
    localStorage.setItem("differential-new-project-subject-v1", JSON.stringify({ name: subject.name, aliases: subject.aliases || [], teachers: subject.suggestedTeachers || [] }));
    location.href = `setup.html?subject=${encodeURIComponent(subject.id)}`;
  });
  elements.archives.addEventListener("click", event => { const button = event.target.closest("[data-view-archive]"); if (button) viewArchive(button.dataset.viewArchive); });
  refreshTeacherDraftsFromStoredSchedules();
  render();
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js?v=26").catch(() => {});
})();
