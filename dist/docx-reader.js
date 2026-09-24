(() => {
  "use strict";
  const utf8 = new TextDecoder("utf-8");

  function centralDirectory(view) {
    for (let offset = view.byteLength - 22; offset >= Math.max(0, view.byteLength - 65557); offset -= 1) if (view.getUint32(offset, true) === 0x06054b50) return offset;
    throw new Error("קובץ Word אינו במבנה נתמך.");
  }
  async function documentXml(file) {
    if (!file?.name?.toLowerCase().endsWith(".docx")) throw new Error("יש לבחור קובץ Word מסוג docx.");
    if (file.size > 12 * 1024 * 1024) throw new Error("קובץ Word גדול מדי לקריאה מקומית.");
    const buffer = await file.arrayBuffer(); const view = new DataView(buffer); const end = centralDirectory(view); const count = view.getUint16(end + 10); let offset = view.getUint32(end + 16); let entry = null;
    for (let index = 0; index < count; index += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("לא ניתן לקרוא את קובץ Word.");
      const compressed = view.getUint32(offset + 20, true); const compression = view.getUint16(offset + 10); const nameLength = view.getUint16(offset + 28, true); const extraLength = view.getUint16(offset + 30, true); const commentLength = view.getUint16(offset + 32, true); const localOffset = view.getUint32(offset + 42, true); const name = utf8.decode(new Uint8Array(buffer, offset + 46, nameLength));
      if (name === "word/document.xml") entry = { compressed, compression, localOffset };
      offset += 46 + nameLength + extraLength + commentLength;
    }
    if (!entry) throw new Error("לא נמצאה טבלה במסמך Word.");
    const localNameLength = view.getUint16(entry.localOffset + 26); const localExtraLength = view.getUint16(entry.localOffset + 28); const bytes = new Uint8Array(buffer, entry.localOffset + 30 + localNameLength + localExtraLength, entry.compressed);
    const xmlBytes = entry.compression === 0 ? bytes : entry.compression === 8 ? new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()) : null;
    if (!xmlBytes) throw new Error("שיטת הדחיסה בקובץ Word אינה נתמכת.");
    const xml = new DOMParser().parseFromString(utf8.decode(xmlBytes), "application/xml"); if (xml.querySelector("parsererror")) throw new Error("לא ניתן לקרוא את תוכן המסמך."); return xml;
  }
  function cellText(cell) { return [...cell.getElementsByTagNameNS("*", "p")].map(paragraph => [...paragraph.getElementsByTagNameNS("*", "t")].map(node => node.textContent || "").join("").trim()).filter(Boolean).join(" · "); }
  async function parseTables(file) {
    const xml = await documentXml(file);
    const tables = [...xml.getElementsByTagNameNS("*", "tbl")].map(table => [...table.children].filter(row => row.localName === "tr").map(row => [...row.children].filter(cell => cell.localName === "tc").map(cellText)).filter(row => row.some(Boolean))).filter(table => table.length);
    if (!tables.length) throw new Error("לא נמצאו טבלאות במסמך. יש להוריד את המסמך כ־Word עם הטבלה בפנים.");
    return { tables };
  }
  window.DocxTableReader = { parseTables };
})();
