import React, { useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_ITEMS = [
  "CARTON BOX NO.30",
  "CARTON BOX NO.38",
  "CARTON BOX NO.26",
  "CARTON BOX NO SCREEN",
  "CARTON BOX 40x40x20 cm.",
  "CARTON BOX NO.1 พิมพ์โลโก้ พิมพ์ NO.กล่อง",
];

const STORAGE_KEY = "autocomplete_items_v1";

function saveToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // fallback
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}

function normalize(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

export default function App() {
  const [items, setItems] = useState<string[]>(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try { return JSON.parse(raw); } catch {}
    }
    return DEFAULT_ITEMS;
  });
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [justCopied, setJustCopied] = useState<string | null>(null);
  const [newWord, setNewWord] = useState("");
  const [bulk, setBulk] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

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
      setTimeout(() => setJustCopied(null), 1500);
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
        requestAnimationFrame(() =>
          inputRef.current?.setSelectionRange(query.length, s.length)
        );
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

  return (
    <div className="container">
      <h1>ค้นหา + Auto-Complete และคัดลอก</h1>
      <p className="hint">
        พิมพ์คำ → เลือกด้วยปุ่มลูกศร ขึ้น/ลง → <b>Enter</b> เพื่อคัดลอก • <b>Tab</b> เพื่อเติมคำ
      </p>

      <div className="searchBox">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="พิมพ์เพื่อค้นหา… เช่น CARTON BOX NO."
        />
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
            title="คลิกเพื่อคัดลอก"
          >
            <div className="text">{s}</div>
            <button
              className="copyBtn"
              onClick={(e) => {
                e.stopPropagation();
                doCopy(s);
              }}
            >
              คัดลอก
            </button>
            <button
              className="removeBtn"
              onClick={(e) => {
                e.stopPropagation();
                removeItem(s);
              }}
              title="ลบออกจากรายการ"
            >
              ลบ
            </button>
          </div>
        ))}
      </div>

      {justCopied && (
        <div className="copied">คัดลอกแล้ว: <b>{justCopied}</b></div>
      )}

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
          <button
            onClick={() => {
              setItems(DEFAULT_ITEMS);
              setQuery("");
            }}
          >
            รีเซ็ตเป็นค่าเริ่มต้น
          </button>
        </div>
      </div>
    </div>
  );
}
