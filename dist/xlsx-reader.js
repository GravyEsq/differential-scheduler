(() => {
  "use strict";

  const utf8 = new TextDecoder("utf-8");

  function findEndOfCentralDirectory(view) {
    const minimum = Math.max(0, view.byteLength - 65557);
    for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
      if (view.getUint32(offset, true) === 0x06054b50) return offset;
    }
    throw new Error("קובץ ה-Excel אינו במבנה נתמך.");
  }

  function readZipEntries(buffer) {
    const view = new DataView(buffer);
    const endOffset = findEndOfCentralDirectory(view);
    const entryCount = view.getUint16(endOffset + 10, true);
    if (entryCount > 2000) throw new Error("קובץ ה-Excel מורכב מדי לקריאה בטוחה.");
    let offset = view.getUint32(endOffset + 16, true);
    const entries = new Map();
    let totalUncompressedSize = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("לא ניתן לקרוא את תוכן קובץ ה-Excel.");
      const compression = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const uncompressedSize = view.getUint32(offset + 24, true);
      totalUncompressedSize += uncompressedSize;
      if (uncompressedSize > 20 * 1024 * 1024 || totalUncompressedSize > 60 * 1024 * 1024) throw new Error("קובץ ה-Excel גדול מדי לאחר פתיחה.");
      const fileNameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const fileName = utf8.decode(new Uint8Array(buffer, offset + 46, fileNameLength)).replaceAll("\\", "/");
      entries.set(fileName, { compression, compressedSize, localOffset });
      offset += 46 + fileNameLength + extraLength + commentLength;
    }
    return entries;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== "function") throw new Error("הדפדפן אינו תומך בקריאת Excel ישירה. מומלץ להשתמש ב-Chrome או Edge עדכניים.");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readEntry(buffer, entries, name) {
    const entry = entries.get(name.replace(/^\//, ""));
    if (!entry) return null;
    const view = new DataView(buffer);
    const nameLength = view.getUint16(entry.localOffset + 26, true);
    const extraLength = view.getUint16(entry.localOffset + 28, true);
    const start = entry.localOffset + 30 + nameLength + extraLength;
    const bytes = new Uint8Array(buffer, start, entry.compressedSize);
    if (entry.compression === 0) return bytes;
    if (entry.compression === 8) return inflateRaw(bytes);
    throw new Error("קובץ ה-Excel משתמש בשיטת דחיסה שאינה נתמכת.");
  }

  async function readXml(buffer, entries, name) {
    const bytes = await readEntry(buffer, entries, name);
    if (!bytes) return null;
    const document = new DOMParser().parseFromString(utf8.decode(bytes), "application/xml");
    if (document.querySelector("parsererror")) throw new Error("אחד מרכיבי קובץ ה-Excel אינו תקין.");
    return document;
  }

  function textOf(node, localName) {
    return [...node.getElementsByTagNameNS("*", localName)].map(item => item.textContent || "").join("");
  }

  function parseSharedStrings(document) {
    if (!document) return [];
    return [...document.getElementsByTagNameNS("*", "si")].map(item => textOf(item, "t"));
  }

  function resolveFirstSheet(workbook, relationships) {
    const firstSheet = workbook.getElementsByTagNameNS("*", "sheet")[0];
    if (!firstSheet) throw new Error("לא נמצא גיליון בקובץ ה-Excel.");
    const relationshipId = firstSheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || firstSheet.getAttribute("r:id");
    const relation = [...relationships.getElementsByTagNameNS("*", "Relationship")].find(item => item.getAttribute("Id") === relationshipId);
    if (!relation) throw new Error("לא ניתן לאתר את גיליון מערכת השעות.");
    const target = relation.getAttribute("Target") || "";
    if (target.startsWith("/")) return target.slice(1);
    return target.startsWith("xl/") ? target : `xl/${target.replace(/^\.\//, "")}`;
  }

  function cellValues(sheet, sharedStrings) {
    const values = new Map();
    [...sheet.getElementsByTagNameNS("*", "c")].forEach(cell => {
      const reference = cell.getAttribute("r");
      if (!reference) return;
      const type = cell.getAttribute("t");
      let value = "";
      if (type === "inlineStr") value = textOf(cell, "t");
      else {
        const raw = cell.getElementsByTagNameNS("*", "v")[0]?.textContent || "";
        value = type === "s" && /^\d+$/.test(raw) ? (sharedStrings[Number(raw)] || "") : raw;
      }
      values.set(reference, String(value).trim());
    });
    return values;
  }

  function identityFromFileName(fileName) {
    const base = fileName.replace(/\.xlsx$/i, "").replace(/\s*-\s*מערכת שעות שבועית\s*$/i, "").trim();
    const gradeMatch = base.match(/(?:^|\s)((?:י|יא|יב)["״']?\d+)\s*$/);
    const grade = gradeMatch?.[1]?.replace(/["״']/g, "") || "";
    const name = gradeMatch ? base.slice(0, gradeMatch.index).trim() : base;
    return { name, grade };
  }

  async function parseStudentSchedule(file) {
    if (!file?.name?.toLowerCase().endsWith(".xlsx")) throw new Error("יש לבחור קובץ Excel מסוג xlsx.");
    if (file.size > 10 * 1024 * 1024) throw new Error("קובץ ה-Excel גדול מ־10MB. יש להעלות מערכת שעות בלבד.");
    const buffer = await file.arrayBuffer();
    const entries = readZipEntries(buffer);
    const [workbook, relationships, sharedDocument] = await Promise.all([
      readXml(buffer, entries, "xl/workbook.xml"),
      readXml(buffer, entries, "xl/_rels/workbook.xml.rels"),
      readXml(buffer, entries, "xl/sharedStrings.xml")
    ]);
    if (!workbook || !relationships) throw new Error("קובץ ה-Excel אינו כולל מבנה גיליונות תקין.");
    const firstSheetPath = resolveFirstSheet(workbook, relationships);
    const sheet = await readXml(buffer, entries, firstSheetPath);
    if (!sheet) throw new Error("לא ניתן לקרוא את גיליון מערכת השעות.");
    const cells = cellValues(sheet, parseSharedStrings(sharedDocument));
    const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי"];
    const columns = ["C", "D", "E", "F", "G", "H"];
    const timetable = [];
    for (let row = 4; row <= 30; row += 1) {
      const periodText = cells.get(`A${row}`) || "";
      if (!/^\d+$/.test(periodText)) continue;
      const period = Number(periodText);
      const lessons = {};
      days.forEach((day, index) => { lessons[day] = cells.get(`${columns[index]}${row}`) || ""; });
      timetable.push({ period, time: cells.get(`B${row}`) || "", lessons });
    }
    if (!timetable.length) throw new Error("לא נמצאו שורות של שעות לימוד. המערכת מצפה למספרי שעות בעמודה הראשונה החל משורה 4.");
    return { ...identityFromFileName(file.name), fileName: file.name, timetable };
  }

  window.XlsxScheduleReader = { parseStudentSchedule };
})();
