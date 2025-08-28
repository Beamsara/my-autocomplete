import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * ฟีเจอร์หลัก
 * - ค้นหา + แนะนำอัตโนมัติ (ArrowUp/Down, Enter คัดลอก, Tab เติมคำ)
 * - เมื่อคัดลอกแต่ละครั้ง จะเพิ่มลง "ตารางผลลัพธ์" เป็นแถว ๆ แบบ Excel
 * - ปุ่ม "คัดลอกทั้งหมด (คอลัมน์)" -> วางใน Excel จะลงทีละแถว 1 คอลัมน์
 * - ปุ่ม "คัดลอกทั้งหมด (แถวเดียว)" -> วางใน Excel จะเป็น 1 แถว หลายคอลัมน์ (คั่นด้วย Tab)
 * - ปุ่มล้างตารางผลลัพธ์
 * - ปุ่มล้างช่องค้นหา (ไอคอน X ในช่อง)
 * - ปุ่ม "แสดงคำที่เพิ่มเอง" (ดู/ค้นหา/คัดลอกรวดเดียว/บันทึกไฟล์/ลบเป็นรายบรรทัด/ลบทั้งหมด)
 * - แก้ปัญหาโมดัลเลื่อนยากด้วย: โมดัลสูงสุด 90vh + ส่วนเนื้อหาเลื่อนแยกได้ และล็อคการเลื่อนพื้นหลัง
 */

const DEFAULT_ITEMS = [
  "CARTON BOX NO.30",
  "CARTON BOX NO.38",
  "CARTON BOX NO.26",
  "CARTON BOX NO SCREEN",
  "CARTON BOX 40x40x20 cm.",
  "CARTON BOX NO.1 พิมพ์โลโก้ พิมพ์ NO.กล่อง",
];

const STORAGE_KEY_ITEMS = "autocomplete_items_v1";
const STORAGE_KEY_ROWS = "autocomplete_rows_v1";

// ปิดการเลื่อนพื้นหลังเมื่อเปิดโมดัล (scroll lock)
function lockBodyScroll(lock: boolean) {
  if (typeof document === "undefined") return;
  if (lock) {
    const original = document.documentElement.style.overflow;
    document.documentElement.setAttribute("data-overflow", original || "");
    document.documentElement.style.overflow = "hidden";
  } else {
    const original = document.documentElement.getAttribute("data-overflow") || "";
    (document.documentElement.style.overflow as any) = original;
  }
}

// ดาวน์โหลดไฟล์แบบ client-side
function downloadFile(filename: string, content: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function saveToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      resolve();
    } catch (e) { reject(e); }
  });
}

function normalize(s: string) {
  // ลบเครื่องหมายกำกับเสียง/วรรณยุกต์จากตัวอักษรที่ normalize แล้ว
  return s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

export default function App() {
  const [items, setItems] = useState<string[]>(() => {
    const raw = localStorage.getItem(STORAGE_KEY_ITEMS);
    if (raw) { try { return JSON.parse(raw); } catch {}
    }
    return DEFAULT_ITEMS;
  });
  const [rows, setRows] = useState<string[]>(() => {
    const raw = localStorage.getItem(STORAGE_KEY_ROWS);
    if (raw) { try { return JSON.parse(raw); } catch {}
    }
    return [];
  });

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [justCopied, setJustCopied] = useState<string | null>(null);
  const [newWord, setNewWord] = useState("");
  const [bulk, setBulk] = useState("");
  const [showCustomPanel, setShowCustomPanel] = useState(false);
  const [modalQuery, setModalQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // คำนวณ "รายการที่เพิ่มเอง" (ทุกอย่างที่ไม่ได้อยู่ใน DEFAULT_ITEMS)
  const customItems = useMemo(() => items.filter(x => !DEFAULT_ITEMS.includes(x)), [items]);
  const filteredCustomItems = useMemo(() => {
    if (!modalQuery.trim()) return customItems;
    const q = normalize(modalQuery);
    return customItems.filter(t => normalize(t).includes(q));
  }, [customItems, modalQuery]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_ITEMS, JSON.stringify(items));
  }, [items]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_ROWS, JSON.stringify(rows));
  }, [rows]);

  // lock/unlock body scroll เมื่อเปิด/ปิดโมดัล + ปิดด้วย Esc
  useEffect(() => {
    lockBodyScroll(showCustomPanel);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowCustomPanel(false);
    }
    if (showCustomPanel) window.addEventListener("keydown", onKey);
    return () => { lockBodyScroll(false); window.removeEventListener("keydown", onKey); };
  }, [showCustomPanel]);

  const suggestions = useMemo(() => {
    if (!query.trim()) return items.slice(0, 25);
    const nQuery = normalize(query);
    const scored = items
      .map((text) => {
        const nt = normalize(text);
        const starts = nt.startsWith(nQuery);
        const includes = !starts && nt.includes(nQuery);
        let score = -Infinity;
        if (starts) score = 1000 - nt.length;
        else if (includes) score = 500 - nt.indexOf(nQuery);
        return { text, score };
      })
      .filter((x) => x.score > -Infinity)
      .sort((a, b) => b.score - a.score)
      .slice(0, 25)
      .map((x) => x.text);
    return scored;
  }, [items, query]);

  useEffect(() => {
    setSelectedIndex(suggestions.length ? 0 : -1);
  }, [suggestions.length]);

  async function doCopy(text: string) {
    try {
      await saveToClipboard(text);
      setJustCopied(text);
      setRows(prev => [...prev, text]); // ➕ เพิ่มลงตารางผลลัพธ์ทันที
      setTimeout(() => setJustCopied(null), 1200);
    } catch (e) {
      alert("คัดลอกไม่สำเร็จ\n" + (e as Error).message);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!suggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex >= 0) doCopy(suggestions[selectedIndex]);
    } else if (e.key === "Tab") {
      if (selectedIndex >= 0) {
        e.preventDefault();
        const s = suggestions[selectedIndex];
        setQuery(s);
        requestAnimationFrame(() => inputRef.current?.setSelectionRange(query.length, s.length));
      }
    }
  }

  function addWord() {
    const w = newWord.trim();
    if (!w) return;
    setItems((prev) => (prev.includes(w) ? prev : [w, ...prev]));
    setNewWord("");
  }

  function importBulk() {
    const lines = bulk.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return;
    const set = new Set(items);
    lines.forEach((l) => set.add(l));
    setItems(Array.from(set));
    setBulk("");
  }

  function removeItem(text: string) {
    setItems((prev) => prev.filter((x) => x !== text));
  }

  function removeRowAt(i: number) {
    setRows(prev => prev.filter((_, idx) => idx !== i));
  }

  async function copyAllAsColumn() {
    const payload = rows.join("\n");
    await saveToClipboard(payload);
    alert("คัดลอกทั้งหมดแบบคอลัมน์แล้ว (วางใน Excel จะลงเป็นหลายแถว)");
  }

  async function copyAllAsRow() {
    const payload = rows.join("\t"); // คั่นด้วยแท็บ -> 1 แถว หลายคอลัมน์
    await saveToClipboard(payload);
    alert("คัดลอกทั้งหมดแบบแถวเดียวแล้ว (คั่นด้วยแท็บ)");
  }

  async function copyCustomAll() {
    const payload = filteredCustomItems.join("\n");
    await saveToClipboard(payload);
    alert("คัดลอกเฉพาะรายการที่เพิ่มเอง (แบบคอลัมน์) แล้ว");
  }

  function exportCustomTxt() {
    const payload = filteredCustomItems.join("\n");
    const date = new Date().toISOString().slice(0,10);
    downloadFile(`custom-items-${date}.txt`, payload, "text/plain;charset=utf-8");
  }

  function exportCustomCsv() {
    // คอลัมน์เดียว รายการละแถว — escape double quotes
    const rowsCsv = filteredCustomItems.map(v => '"' + v.replace(/"/g, '""') + '"');
    const csv = rowsCsv.join("\n");
    const date = new Date().toISOString().slice(0,10);
    downloadFile(`custom-items-${date}.csv`, csv, "text/csv;charset=utf-8");
  }

  function clearAllCustom() {
    if (!customItems.length) return;
    if (confirm(`ต้องการลบคำที่เพิ่มเองทั้งหมด ${customItems.length} รายการหรือไม่?`)) {
      setItems(prev => prev.filter(x => DEFAULT_ITEMS.includes(x)));
    }
  }

  function clearRows() { setRows([]); }
  function clearQuery() { setQuery(""); inputRef.current?.focus(); }

  // ✅ Self-tests (ง่าย ๆ) — เพื่อกัน regression ของอักขระพิเศษ/การแยกบรรทัด/แท็บ
  function runSelfTests() {
    try {
      const cases = [
        { name: "join-\\n", pass: ["A","B"].join("\n") === "A\nB" },
        { name: "join-\\t", pass: ["A","B"].join("\t") === "A\tB" },
        { name: "split-CRLF", pass: "A\nB\r\nC".split(/\r?\n/).length === 3 },
        { name: "normalize-diacritics", pass: normalize("café") === "cafe" },
      ];
      const failed = cases.filter(c => !c.pass);
      if (failed.length) {
        console.warn("Self-tests failed:", failed.map(f => f.name));
      }
    } catch (err) {
      console.warn("Self-tests error:", err);
    }
  }

  useEffect(() => { runSelfTests(); }, []);

  return (
    <div className="container">
      <h1>ค้นหา + Auto-Complete และคัดลอก</h1>
      <p className="hint">
        พิมพ์คำ → เลือกด้วยลูกศรขึ้น/ลง → <b>Enter</b> คัดลอก • <b>Tab</b> เติมคำ • เมื่อคัดลอกแล้วจะถูกเพิ่มลงตารางด้านล่างอัตโนมัติ
      </p>

      <div className="searchBox">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="พิมพ์เพื่อค้นหา… เช่น CARTON BOX NO."
        />
        {query && (
          <button className="clearBtn" onClick={clearQuery} title="ล้างช่องค้นหา">×</button>
        )}
      </div>

      <div className="list">
        {suggestions.length === 0 && (
          <div className="empty">ไม่พบบันทึกที่ตรงกับคำค้น</div>
        )}
        {suggestions.map((s, i) => (
          <div
            key={s}
            className={"row" + (i === selectedIndex ? " selected" : "")}
            onClick={() => doCopy(s)}
            title="คลิกเพื่อคัดลอกและเพิ่มลงตาราง"
          >
            <div className="text">{s}</div>
            <div className="btns">
              <button className="copyBtn" onClick={(e) => { e.stopPropagation(); doCopy(s); }}>คัดลอก</button>
              <button className="removeBtn" onClick={(e) => { e.stopPropagation(); removeItem(s); }} title="ลบออกจากรายการ">ลบ</button>
            </div>
          </div>
        ))}
      </div>

      {justCopied && (
        <div className="copied">คัดลอกแล้ว: <b>{justCopied}</b></div>
      )}

      <h2>ตารางผลลัพธ์ (เหมือน Excel)</h2>
      <div className="tableActions">
        <div className="left">จำนวนแถว: <b>{rows.length}</b></div>
        <div className="right">
          <button onClick={copyAllAsColumn}>คัดลอกทั้งหมด (คอลัมน์)</button>
          <button onClick={copyAllAsRow}>คัดลอกทั้งหมด (แถวเดียว)</button>
          <button onClick={clearRows}>ล้างตาราง</button>
        </div>
      </div>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th style={{width: 64}}>#</th>
              <th>รายการ</th>
              <th style={{width: 96}}>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="emptyCell">ยังไม่มีข้อมูล (คลิกคัดลอกจากรายการด้านบนเพื่อเพิ่ม)</td>
              </tr>
            ) : rows.map((r, i) => (
              <tr key={i}>
                <td className="index">{i + 1}</td>
                <td className="value" title={r}>{r}</td>
                <td>
                  <button className="removeBtn small" onClick={() => removeRowAt(i)}>ลบ</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>จัดการคำทั้งหมด (เพิ่ม/นำเข้า)</h2>
      <div className="addRow">
        <input
          value={newWord}
          onChange={(e) => setNewWord(e.target.value)}
          placeholder="เพิ่มคำใหม่ 1 บรรทัด"
        />
        <button onClick={addWord}>เพิ่ม</button>
      </div>

      <textarea
        value={bulk}
        onChange={(e) => setBulk(e.target.value)}
        placeholder={"วางรายการหลายบรรทัดที่นี่ แล้วกด \"นำเข้า\"\nตัวอย่าง:\nCARTON BOX NO.30\nCARTON BOX NO.38\n…"}
      />
      <div className="footerBar">
        <div>จำนวนทั้งหมดในระบบ: <b>{items.length}</b> รายการ</div>
        <div className="actions">
          <button onClick={importBulk}>นำเข้า</button>
          <button onClick={() => { setItems(DEFAULT_ITEMS); setQuery(""); }}>รีเซ็ตเป็นค่าเริ่มต้น</button>
          <button onClick={() => setShowCustomPanel(true)}>แสดงคำที่เพิ่มเอง ({customItems.length})</button>
        </div>
      </div>

      {/* ✅ Modal รายการที่เพิ่มเอง */}
      {showCustomPanel && (
        <div className="modalOverlay" onClick={() => setShowCustomPanel(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div className="title">คำที่เพิ่มเอง</div>
              <button className="closeBtn" onClick={() => setShowCustomPanel(false)} aria-label="ปิด">×</button>
            </div>
            <div className="modalToolbar">
              <input
                className="modalSearch"
                value={modalQuery}
                onChange={(e) => setModalQuery(e.target.value)}
                placeholder="ค้นหาในรายการที่เพิ่มเอง…"
              />
              <div className="actions">
                <button onClick={copyCustomAll}>คัดลอกทั้งหมด (คอลัมน์)</button>
                <button onClick={exportCustomTxt}>บันทึกเป็น .txt</button>
                <button onClick={exportCustomCsv}>บันทึกเป็น .csv</button>
                <button className="danger" onClick={clearAllCustom}>ลบทั้งหมดที่เพิ่มเอง</button>
              </div>
            </div>
            <div className="modalBody" role="region" aria-label="รายการที่เพิ่มเอง">
              <div className="count">จำนวน: <b>{filteredCustomItems.length}</b> รายการ</div>
              <div className="tableWrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{width: 64}}>#</th>
                      <th>รายการ</th>
                      <th style={{width: 96}}>จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCustomItems.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="emptyCell">ไม่พบรายการ</td>
                      </tr>
                    ) : filteredCustomItems.map((t, i) => (
                      <tr key={t}>
                        <td className="index">{i + 1}</td>
                        <td className="value" title={t}>{t}</td>
                        <td>
                          <button className="removeBtn small" onClick={() => removeItem(t)}>ลบ</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="modalFooter">
              <button onClick={() => setShowCustomPanel(false)}>ปิด</button>
            </div>
          </div>
        </div>
      )}

      {/* สไตล์พื้นฐาน (inline) — คัดลอกไปไว้ใน src/index.css ก็ได้ */}
      <style>
        {`
        * { box-sizing: border-box; }
        body { margin: 0; }
        .container { max-width: 980px; margin: 32px auto; padding: 0 16px; font-family: system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Thai",Arial,sans-serif; color:#0f172a; }
        h1 { margin: 0 0 6px; }
        h2 { margin: 26px 0 10px; }
        .hint { color: #667085; margin: 0 0 16px; }
        .searchBox { position: relative; }
        .searchBox input { width:100%; padding:14px 44px 14px 14px; font-size:16px; border:1px solid #d0d5dd; border-radius:12px; background:#fff; }
        .searchBox .clearBtn { position:absolute; right:8px; top:50%; transform: translateY(-50%); width:28px; height:28px; border:1px solid #d0d5dd; background:#fff; border-radius:8px; cursor:pointer; font-size:18px; line-height:24px; }
        .list { margin-top: 12px; border:1px solid #e5e7eb; border-radius:12px; overflow:hidden; background:#fff; }
        .empty { padding:12px 14px; color: #6b7280; font-size:14px; }
        .row { display:flex; align-items:center; gap:8px; padding:10px 12px; border-top:1px solid #f1f5f9; cursor:pointer; }
        .row:first-child { border-top:0; }
        .row:hover { background:#f9fafb; }
        .row.selected { background:#eef2ff; }
        .text { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .btns { display:flex; gap:6px; }
        .copyBtn, .removeBtn, .actions button, .addRow button, .tableActions .right button, .modalFooter button {
          border:1px solid #d0d5dd; background:#fff; padding:8px 10px; border-radius:10px; cursor:pointer; font-size:14px;
        }
        .removeBtn { color:#b42318; border-color:#f2b8b5; }
        .removeBtn:hover { background:#fee2e2; }
        .copied { margin: 10px 2px 16px; color:#047857; font-size:14px; }
        .addRow { display:flex; gap:8px; margin:8px 0 10px; }
        .addRow input { flex:1; padding:10px 12px; border:1px solid #d0d5dd; border-radius:10px; background:#fff; }
        textarea { width:100%; min-height:140px; padding:10px 12px; border:1px solid #d0d5dd; border-radius:10px; resize:vertical; background:#fff; }
        .footerBar { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:12px; margin-top:8px; color:#667085; }
        .actions { display:flex; gap:8px; flex-wrap:wrap; }
        .tableActions { display:flex; justify-content:space-between; align-items:center; }
        .tableWrap { overflow:auto; border:1px solid #e5e7eb; border-radius:12px; background:#fff; }
        table { width:100%; border-collapse:collapse; }
        thead th { background:#f8fafc; font-weight:600; text-align:left; padding:10px 12px; border-bottom:1px solid #e5e7eb; }
        tbody td { padding:10px 12px; border-top:1px solid #f1f5f9; }
        .index { width:64px; color:#475569; }
        .value { max-width: 1px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .small { padding:6px 8px; font-size:13px; }
        .emptyCell { color:#6b7280; text-align:center; }
        /* Modal */
        .modalOverlay { position:fixed; inset:0; background:rgba(2,6,23,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:50; }
        .modal { max-width: 920px; width:100%; max-height: 90vh; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 10px 30px rgba(0,0,0,.2); display:flex; flex-direction:column; }
        .modalHeader { display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid #e5e7eb; background:#f8fafc; flex:0 0 auto; }
        .modalHeader .title { font-weight:600; }
        .modalToolbar { display:flex; gap:8px; align-items:center; padding:10px 16px; border-bottom:1px solid #eef2f7; flex:0 0 auto; }
        .modalToolbar .actions { display:flex; gap:8px; flex-wrap:wrap; }
        .modalSearch { flex:1; padding:9px 12px; border:1px solid #d0d5dd; border-radius:10px; }
        .modalBody { padding:12px 16px; overflow:auto; flex:1 1 auto; }
        .modalFooter { display:flex; justify-content:flex-end; gap:8px; padding:12px 16px; border-top:1px solid #e5e7eb; background:#fff; flex:0 0 auto; }
        .closeBtn { border:1px solid #d0d5dd; background:#fff; width:28px; height:28px; border-radius:8px; font-size:18px; cursor:pointer; }
        .danger { color:#b42318; border-color:#f2b8b5; }
        `}
      </style>
    </div>
  );
}
