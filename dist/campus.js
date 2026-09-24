(() => {
  "use strict";

  const CAMPUS_KEY = "differential-campus-v1";
  const LEGACY_REGISTRY_KEY = "differential-student-registry-v1";
  const SUBJECT_ALIASES = new Map([
    ["עברית", ["עברית", "לשון", "שפה"]],
    ["אנגלית", ["אנגלית"]], ["מתמטיקה", ["מתמטיקה"]], ["ספרות", ["ספרות"]],
    ["היסטוריה", ["היסטוריה"]], ["אזרחות", ["אזרחות"]], ["ביולוגיה", ["ביולוגיה"]],
    ["פיזיקה", ["פיזיקה"]], ["כימיה", ["כימיה"]]
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

  function defaultCampus() { return { schemaVersion: 1, school: "", year: "", subjects: [], students: [], assignments: [], archives: [], updatedAt: null }; }
  function loadCampus() {
    let storedCampus = null;
    try {
      const saved = JSON.parse(localStorage.getItem(CAMPUS_KEY));
      if (saved && typeof saved === "object") storedCampus = { ...defaultCampus(), ...saved, subjects: Array.isArray(saved.subjects) ? saved.subjects : [], students: Array.isArray(saved.students) ? saved.students : [], assignments: Array.isArray(saved.assignments) ? saved.assignments : [], archives: Array.isArray(saved.archives) ? saved.archives : [] };
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
    elements.subjectList.innerHTML = campus.subjects.length ? campus.subjects.sort((a, b) => a.name.localeCompare(b.name, "he")).map(subject => `<article class="subject-chip"><strong>${esc(subject.name)}</strong>${subject.aliases?.length ? `<small>${esc(subject.aliases.join(" · "))}</small>` : ""}<span>${subject.suggestedTeachers?.length ? `${subject.suggestedTeachers.map(item => esc(item.name)).join(" · ")}` : "טרם זוהו מורות"}</span><button class="text-button" data-open-subject="${esc(subject.id)}" type="button">פתיחת מקצוע</button></article>`).join("") : "<p class=\"empty-note\">המקצועות שזוהו במערכות יופיעו כאן. אפשר גם להוסיף אחד ידנית.</p>";
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
  function inferLesson(raw) {
    const text = clean(raw.replace(/\r/g, " "));
    if (!text) return null;
    const lines = text.split(/\n+/).map(clean).filter(Boolean);
    const normalized = text.replace(/\n+/g, " · ");
    const teacherMatch = normalized.match(/(?:\bעם\b|מורה\s*:|בהנחיית)\s*([א-ת][א-ת\s׳״'\-]{1,40})/);
    const dashParts = normalized.split(/\s*(?:—|–|-|:)\s*/).map(clean).filter(Boolean);
    let subjectText = teacherMatch ? normalized.slice(0, teacherMatch.index) : lines[0] || dashParts[0];
    subjectText = clean(subjectText.replace(/\b(?:עם|מורה)\b.*$/u, "").replace(/\([^)]*\)/g, ""));
    if (!subjectText || subjectText.length > 45 || /^(חלון|הפסקה|חופשי|ללא)/.test(subjectText)) return null;
    const lineTeacher = lines.length === 2 && /^[א-ת][א-ת\s׳״'\-]{1,40}$/.test(lines[1]) ? lines[1] : null;
    const teacher = teacherMatch?.[1] ? clean(teacherMatch[1]) : lineTeacher;
    return { raw: normalized, subject: canonicalSubject(subjectText).name, teacher, confidence: teacher ? "certain" : "review" };
  }
  function knownSubjectIn(text) {
    const source = key(text);
    const options = [...campus.subjects.flatMap(subject => [subject.name, ...(subject.aliases || [])]), "עברית", "לשון", "שפה"];
    const match = options.find(subject => source.includes(key(subject)));
    return match ? canonicalSubject(match).name : null;
  }
  function oldFormatChanges(tables) {
    const found = new Map(); const unknownRows = [];
    tables.forEach(table => table.forEach(row => {
      const joined = row.join(" · "); const student = campus.students.find(item => key(joined).includes(key(item.fullName)));
      if (!student) { if (/עברית|לשון|שפה/.test(joined)) unknownRows.push(joined); return; }
      const subject = knownSubjectIn(joined); const hours = Number((joined.match(/(?:עברית|לשון|שפה|ספרות|היסטוריה|מתמטיקה|אנגלית)[^\d]{0,24}(\d+)\s*(?:שעות?|שעו?ת)?/i) || [])[1]);
      if (subject && Number.isInteger(hours) && hours > 0) found.set(`${student.id}|${subject}`, { kind: "request", student, subject, hours });
      const day = ["ראשון", "שני", "שלישי", "רביעי", "חמישי"].find(item => joined.includes(item)); const period = Number((joined.match(/(?:שעה|שעור)\s*([0-8])/i) || [])[1]);
      if (subject && day && Number.isInteger(period)) found.set(`${student.id}|${subject}|${day}|${period}`, { kind: "reservation", student, subject, day, period });
    }));
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
    pendingLegacyImport.changes.forEach((change, index) => { if (!selected.has(index)) return; if (change.kind === "request") { const other = (change.student.requests || []).filter(item => key(item.subject) !== key(change.subject)); change.student.requests = [...other, { subject: change.subject, hours: change.hours }]; addSubject(change.subject); } else { const known = (campus.assignments || []).find(item => item.student === change.student.fullName && item.subject === change.subject); campus.assignments = [...(campus.assignments || []).filter(item => !(item.legacyReservation && item.student === change.student.fullName && item.subject === change.subject && item.day === change.day && item.period === change.period)), { id: `legacy-${Date.now()}-${index}`, campusProjectId: "legacy-format", legacyReservation: true, student: change.student.fullName, grade: change.student.grade, teacher: known?.teacher || "יש לשייך מורה", subject: change.subject, day: change.day, period: change.period, updatedAt: new Date().toISOString() }]; } });
    saveCampus(); pendingLegacyImport = null; elements.legacyPreview.hidden = true; render(); showToast("השינויים שנבחרו מהפורמט הישן נשמרו במאגר.");
  }
  async function scanSchedules() {
    const files = [...elements.files.files];
    if (!files.length) return showToast("בחרו לפחות מערכת שעות אחת.");
    elements.scan.disabled = true; elements.scanStatus.textContent = "קורא את המערכות ומאתר מקצועות…"; elements.scanStatus.className = "file-status";
    try {
      const results = await Promise.all(files.map(file => window.XlsxScheduleReader.parseStudentSchedule(file)));
      const parsedStudents = results.map(result => ({ id: `student-${Date.now()}-${Math.random().toString(16).slice(2)}`, fullName: result.name || result.fileName.replace(/\.xlsx$/i, ""), grade: result.grade || "", schedule: { fileName: result.fileName, timetable: result.timetable }, requests: [], shareWilling: false, progress: {}, source: "campus-import" }));
      const lessons = results.flatMap(result => result.timetable.flatMap(row => Object.values(row.lessons || {}).map(inferLesson).filter(Boolean)));
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
    elements.scanPreview.hidden = false;
    elements.scanPreview.innerHTML = `<div class="preview-head"><div><h3>תצוגה מקדימה — לא נשמר עדיין</h3><p>${pendingImport.students.length} תלמידים ייקלטו עם מערכת שעות אחת לכל תלמיד. נמצאו ${subjects.length} מקצועות.</p></div></div><div class="scan-subjects">${subjects.map(([subject, lessons]) => { const teachers = [...new Set(lessons.map(item => item.teacher).filter(Boolean))]; return `<article><label><input type="checkbox" data-import-subject="${esc(subject)}" checked /> <strong>${esc(subject)}</strong></label><span>${lessons.length} הופעות במערכות</span><small>${teachers.length ? `הצעת צוות: ${esc(teachers.join(" · "))}` : "לא זוהה שם מורה בוודאות"}</small></article>`; }).join("")}</div><div class="preview-actions"><button id="applyScheduleImport" class="primary-button" type="button">אישור וקליטת הנתונים</button><button id="discardScheduleImport" class="secondary-button" type="button">ביטול</button></div>`;
    document.querySelector("#discardScheduleImport").addEventListener("click", () => { pendingImport = null; elements.scanPreview.hidden = true; showToast("ההצעה בוטלה; דבר לא נשמר."); });
    document.querySelector("#applyScheduleImport").addEventListener("click", applyScheduleImport);
  }
  function applyScheduleImport() {
    const selected = new Set([...elements.scanPreview.querySelectorAll("[data-import-subject]:checked")].map(input => input.dataset.importSubject));
    pendingImport.students.forEach(student => {
      const previous = campus.students.find(item => key(item.fullName) === key(student.fullName));
      if (previous) Object.assign(previous, { grade: student.grade || previous.grade, schedule: student.schedule, source: "campus-import" });
      else campus.students.push(student);
    });
    [...pendingImport.bySubject.entries()].filter(([subject]) => selected.has(subject)).forEach(([subject, lessons]) => {
      addSubject(subject);
      const record = campus.subjects.find(item => key(item.name) === key(canonicalSubject(subject).name));
      const teachers = [...new Set(lessons.map(item => item.teacher).filter(Boolean))];
      record.suggestedTeachers = [...new Map([...(record.suggestedTeachers || []).map(item => [key(item.name), item]), ...teachers.map(name => [key(name), { name, confidence: "certain", source: "מערכת תלמידים" }])]).values()];
    });
    saveCampus(); pendingImport = null; elements.scanPreview.hidden = true; render(); showToast("הנתונים אושרו ונשמרו במאגר התיכון.");
  }
  function archiveYear() {
    if (!campus.students.length && !campus.subjects.length) return showToast("אין עדיין נתונים לשמירה בצילום שנתי.");
    if (!confirm(`ליצור צילום לקריאה בלבד של ${campus.school} · ${campus.year}? המאגר הפעיל לא ישתנה.`)) return;
    campus.archives.unshift({ id: `archive-${Date.now()}`, school: campus.school, year: campus.year, createdAt: new Date().toISOString(), students: structuredClone(campus.students), subjects: structuredClone(campus.subjects), assignments: structuredClone(campus.assignments || []) });
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
    const backup = { kind: "differential-campus-backup", schemaVersion: 1, exportedAt: new Date().toISOString(), campus };
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" })); link.download = `מאגר-${campus.school || "תיכון"}-${campus.year || "ללא-שנה"}.json`; link.click(); URL.revokeObjectURL(link.href); showToast("גיבוי מלא של המאגר הורד למחשב.");
  }
  async function restoreCampus(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data?.kind !== "differential-campus-backup" || !data.campus || !Array.isArray(data.campus.students) || !Array.isArray(data.campus.subjects)) throw new Error("זה אינו קובץ גיבוי תקין של מאגר התיכון.");
      const next = { ...defaultCampus(), ...data.campus, students: data.campus.students, subjects: data.campus.subjects, assignments: Array.isArray(data.campus.assignments) ? data.campus.assignments : [], archives: Array.isArray(data.campus.archives) ? data.campus.archives : [] };
      const preview = `תצוגה מקדימה לשחזור:\n${next.school || "ללא שם"} · ${next.year || "ללא שנה"}\n${next.students.length} תלמידים, ${next.subjects.length} מקצועות ו־${next.assignments.length} שיבוצים דיפרנציאליים.\n\nהמאגר המקומי הנוכחי יוחלף. להמשיך?`;
      if (!confirm(preview)) return;
      campus = next; saveCampus(); render(); showToast("הגיבוי שוחזר בהצלחה.");
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
  elements.manualForm.addEventListener("submit", event => { event.preventDefault(); const name = clean(elements.manualName.value); if (!name) return showToast("יש להזין שם מקצוע."); addSubject(name, split(elements.manualAliases.value)); saveCampus(); elements.manualName.value = ""; elements.manualAliases.value = ""; render(); showToast("המקצוע נוסף למאגר."); });
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
  elements.subjectList.addEventListener("click", event => { const button = event.target.closest("[data-open-subject]"); if (!button) return; const subject = campus.subjects.find(item => item.id === button.dataset.openSubject); if (!subject) return; localStorage.setItem("differential-new-project-subject-v1", JSON.stringify({ name: subject.name, aliases: subject.aliases || [], teachers: subject.suggestedTeachers || [] })); location.href = "setup.html"; });
  elements.archives.addEventListener("click", event => { const button = event.target.closest("[data-view-archive]"); if (button) viewArchive(button.dataset.viewArchive); });
  render();
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js?v=19").catch(() => {});
})();
