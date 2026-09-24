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
    title: document.querySelector("#campusTitle"), description: document.querySelector("#campusDescription"), archive: document.querySelector("#archiveYearButton"),
    studentCount: document.querySelector("#campusStudentCount"), subjectCount: document.querySelector("#campusSubjectCount"), teacherCount: document.querySelector("#campusTeacherCount"), archiveCount: document.querySelector("#campusArchiveCount"),
    manualForm: document.querySelector("#manualSubjectForm"), manualName: document.querySelector("#manualSubjectName"), manualAliases: document.querySelector("#manualSubjectAliases"), listForm: document.querySelector("#listSubjectForm"), list: document.querySelector("#subjectList"), subjectPreview: document.querySelector("#subjectPreview"), subjectList: document.querySelector("#subjectListView"),
    files: document.querySelector("#scheduleFiles"), scan: document.querySelector("#scanSchedulesButton"), scanStatus: document.querySelector("#scanStatus"), scanPreview: document.querySelector("#scanPreview"), students: document.querySelector("#campusStudentsView"), archives: document.querySelector("#archiveList"), toast: document.querySelector("#campusToast")
  };
  let campus = loadCampus();
  let pendingImport = null;
  let toastTimer = null;

  function defaultCampus() { return { schemaVersion: 1, school: "", year: "", subjects: [], students: [], archives: [], updatedAt: null }; }
  function loadCampus() {
    let storedCampus = null;
    try {
      const saved = JSON.parse(localStorage.getItem(CAMPUS_KEY));
      if (saved && typeof saved === "object") storedCampus = { ...defaultCampus(), ...saved, subjects: Array.isArray(saved.subjects) ? saved.subjects : [], students: Array.isArray(saved.students) ? saved.students : [], archives: Array.isArray(saved.archives) ? saved.archives : [] };
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
    campus.updatedAt = new Date().toISOString();
    localStorage.setItem(CAMPUS_KEY, JSON.stringify(campus));
    localStorage.setItem(LEGACY_REGISTRY_KEY, JSON.stringify(campus.students));
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
    elements.archive.hidden = !isReady;
    elements.title.textContent = isReady ? `${campus.school} · ${campus.year}` : "התחילו את מאגר התיכון";
    elements.description.textContent = isReady ? "המאגר המשותף כולל מערכת שעות אחת לכל תלמיד, בקשות תגבור ומקצועות פעילים." : "כאן נשמרים התלמידים, המערכות, המקצועות והצעות הצוות של שנת הלימודים הפעילה.";
    elements.school.value = campus.school; elements.year.value = campus.year;
    elements.studentCount.textContent = campus.students.length; elements.subjectCount.textContent = campus.subjects.length;
    elements.teacherCount.textContent = new Set(campus.subjects.flatMap(subject => (subject.suggestedTeachers || []).map(item => item.name))).size;
    elements.archiveCount.textContent = campus.archives.length;
    elements.subjectList.innerHTML = campus.subjects.length ? campus.subjects.sort((a, b) => a.name.localeCompare(b.name, "he")).map(subject => `<article class="subject-chip"><strong>${esc(subject.name)}</strong>${subject.aliases?.length ? `<small>${esc(subject.aliases.join(" · "))}</small>` : ""}<span>${subject.suggestedTeachers?.length ? `${subject.suggestedTeachers.map(item => esc(item.name)).join(" · ")}` : "טרם זוהו מורות"}</span><button class="text-button" data-open-subject="${esc(subject.id)}" type="button">פתיחת פרויקט</button></article>`).join("") : "<p class=\"empty-note\">טרם נוספו מקצועות.</p>";
    elements.students.innerHTML = campus.students.length ? campus.students.sort((a, b) => a.fullName.localeCompare(b.fullName, "he")).map(student => `<article class="campus-student"><div><strong>${esc(student.fullName)}</strong><span>${esc(student.grade || "כיתה לא הוגדרה")} · ${student.schedule?.timetable?.length ? "מערכת שעות נקלטה" : "ללא מערכת שעות"}</span></div><small>${student.requests?.length ? esc(student.requests.map(request => `${request.subject}: ${request.hours}`).join(" · ")) : "טרם הוגשו בקשות תגבור"}</small></article>`).join("") : "<p class=\"empty-note\">טרם נקלטו תלמידים למאגר.</p>";
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
    campus.archives.unshift({ id: `archive-${Date.now()}`, school: campus.school, year: campus.year, createdAt: new Date().toISOString(), students: structuredClone(campus.students), subjects: structuredClone(campus.subjects) });
    saveCampus(); render(); showToast("צילום סוף השנה נשמר לקריאה בלבד.");
  }
  function viewArchive(id) {
    const archive = campus.archives.find(item => item.id === id); if (!archive) return;
    alert(`${archive.school} · ${archive.year}\n\n${archive.students.length} תלמידים\n${archive.subjects.length} מקצועות\n\nהצילום נשמר לקריאה בלבד.`);
  }
  elements.save.addEventListener("click", () => { const school = clean(elements.school.value); const year = clean(elements.year.value); if (!school || !year) return showToast("יש למלא את שם התיכון ואת שנת הלימודים."); campus.school = school; campus.year = year; saveCampus(); render(); showToast("מאגר התיכון הוגדר ונשמר."); });
  elements.manualForm.addEventListener("submit", event => { event.preventDefault(); const name = clean(elements.manualName.value); if (!name) return showToast("יש להזין שם מקצוע."); addSubject(name, split(elements.manualAliases.value)); saveCampus(); elements.manualName.value = ""; elements.manualAliases.value = ""; render(); showToast("המקצוע נוסף למאגר."); });
  elements.listForm.addEventListener("submit", event => { event.preventDefault(); const values = split(elements.list.value); if (!values.length) return showToast("הדביקו לפחות מקצוע אחד."); prepareSubjects(values, "הצעת מקצועות מהרשימה"); });
  elements.scan.addEventListener("click", scanSchedules); elements.archive.addEventListener("click", archiveYear);
  elements.subjectList.addEventListener("click", event => { const button = event.target.closest("[data-open-subject]"); if (!button) return; const subject = campus.subjects.find(item => item.id === button.dataset.openSubject); if (!subject) return; localStorage.setItem("differential-new-project-subject-v1", JSON.stringify({ name: subject.name, aliases: subject.aliases || [], teachers: subject.suggestedTeachers || [] })); location.href = "setup.html"; });
  elements.archives.addEventListener("click", event => { const button = event.target.closest("[data-view-archive]"); if (button) viewArchive(button.dataset.viewArchive); });
  render();
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js?v=14").catch(() => {});
})();
