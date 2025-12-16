// client/src/components/XenyaStudyReader.jsx
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Document, Page, pdfjs } from "react-pdf";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import Dexie from "dexie";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

import XenyaNoteCard from "./XenyaNoteCard.jsx";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

/* ------------------------- IndexedDB (Dexie) ------------------------- */
const db = new Dexie("XenyaReaderDB");

// v1
db.version(1).stores({
  notes: "++id,page,x,y,text",
  highlights: "++id,page,x,y,width,height",
  bookmarks: "++id,page",
});

// v2
db.version(2)
  .stores({
    notes: "++id,page,x,y,text",
    highlights: "++id,page,x,y,width,height,color",
    bookmarks: "++id,page",
  })
  .upgrade(async (tx) => {
    const table = tx.table("highlights");
    await table.toCollection().modify((h) => {
      if (!h.color) h.color = "rgba(250,204,21,0.55)";
    });
  });

// v3
db.version(3).stores({
  notes: "++id,page,x,y,html,collapsed,w,h,paperColor",
  highlights: "++id,page,x,y,width,height,color",
  bookmarks: "++id,page",
});

// v4
db.version(4)
  .stores({
    notes: "++id,page,x,y,body,bgColor,textColor,z",
    highlights: "++id,page,x,y,width,height,color",
    bookmarks: "++id,page",
  })
  .upgrade(async (tx) => {
    const table = tx.table("notes");
    await table.toCollection().modify((n) => {
      if (!("body" in n)) {
        if (typeof n.html === "string") {
          const text = n.html.replace(/<[^>]+>/g, " ").trim();
          n.body = text;
        } else if (typeof n.text === "string") {
          n.body = n.text;
        } else {
          n.body = "";
        }
      }
      if (!("bgColor" in n)) n.bgColor = "#111827";
      if (!("textColor" in n)) n.textColor = "#e5e7eb";
      if (!("z" in n)) n.z = 1;
      if (!("page" in n)) n.page = 1;
      if (!("x" in n)) n.x = 40;
      if (!("y" in n)) n.y = 40;
    });
  });

/* ------------------------ UI helpers / palettes ------------------------ */
const HIGHLIGHT_COLORS = [
  { name: "Yellow", value: "rgba(250,204,21,0.4)" },
  { name: "Green", value: "rgba(34,197,94,0.35)" },
  { name: "Blue", value: "rgba(59,130,246,0.35)" },
  { name: "Pink", value: "rgba(236,72,153,0.35)" },
];

const topbarButtonBase = {
  borderRadius: 999,
  padding: "6px 12px",
  border: "1px solid rgba(148,163,184,0.5)",
  background: "rgba(15,23,42,0.75)",
  color: "#e5e7eb",
  fontSize: 13,
  cursor: "pointer",
};

const subtleIconButton = {
  borderRadius: 999,
  padding: "4px 10px",
  border: "1px solid rgba(148,163,184,0.5)",
  background: "rgba(15,23,42,0.7)",
  color: "#e5e7eb",
  fontSize: 12,
  cursor: "pointer",
};

const ToolbarButton = ({ title, onClick, children, disabled }) => (
  <button
    type="button"
    title={title}
    disabled={disabled}
    onClick={onClick}
    style={{
      ...subtleIconButton,
      opacity: disabled ? 0.3 : 1,
      cursor: disabled ? "default" : "pointer",
    }}
  >
    {children}
  </button>
);

/* --------------------------------- Reader --------------------------------- */
export default function XenyaStudyReader() {
  const navigate = useNavigate();
  const viewportRef = useRef(null);

  // PDF state
  const [pdfFile, setPdfFile] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);

  // Annotations
  const [highlights, setHighlights] = useState([]);
  const [notes, setNotes] = useState([]);
  const [bookmarks, setBookmarks] = useState([]);

  // Selection toolbar state
  const [selectionText, setSelectionText] = useState("");
  const [selectionRange, setSelectionRange] = useState(null);
  const [selectionPage, setSelectionPage] = useState(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  // Highlight colors + erase mode
  const [selectedColor, setSelectedColor] = useState(
    HIGHLIGHT_COLORS[0].value
  );
  const [eraseMode, setEraseMode] = useState(false);

  // z-index tracking for notes
  const [maxZ, setMaxZ] = useState(1);

  /* ------------------------- Load existing data ------------------------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [savedNotes, savedHighlights, savedBookmarks] = await Promise.all(
          [db.notes.toArray(), db.highlights.toArray(), db.bookmarks.toArray()]
        );
        if (cancelled) return;
        setNotes(savedNotes || []);
        setHighlights(savedHighlights || []);
        setBookmarks(savedBookmarks || []);
        const zMax = (savedNotes || []).reduce(
          (m, n) => Math.max(m, n.z || 1),
          1
        );
        setMaxZ(zMax || 1);
      } catch (err) {
        console.error("Failed to load annotations:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* --------------------------- PDF lifecycle --------------------------- */
  const onDocumentLoad = useCallback(({ numPages: n }) => {
    setNumPages(n || 0);
    setCurrentPage(1);
  }, []);

  const handleFileSelect = (e) => {
    const f = e.target.files?.[0];
    if (f) {
      setPdfFile(f);
      setNumPages(0);
      setCurrentPage(1);
      clearSelection();
    }
  };

  const goHome = () => navigate("/");

  const goPrev = () => {
    setCurrentPage((p) => (p > 1 ? p - 1 : 1));
  };

  const goNext = () => {
    setCurrentPage((p) => (p < numPages ? p + 1 : numPages || 1));
  };

  const bookmarkPage = async () => {
    if (!currentPage) return;
    if (bookmarks.some((b) => b.page === currentPage)) return;
    try {
      const id = await db.bookmarks.add({ page: currentPage });
      setBookmarks((prev) => [...prev, { id, page: currentPage }]);
    } catch (err) {
      console.error("Failed to bookmark page:", err);
    }
  };

  /* ---------------------------- Selection logic ---------------------------- */
  const clearSelection = useCallback(() => {
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        sel.removeAllRanges();
      }
    } catch {
      // ignore
    }
    setSelectionText("");
    setSelectionRange(null);
    setSelectionPage(null);
  }, []);

  const handleTextSelect = (pageNum) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      clearSelection();
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect) {
      clearSelection();
      return;
    }
    const viewportEl = viewportRef.current;
    const viewportRect = viewportEl?.getBoundingClientRect();
    const baseX = viewportRect ? rect.left - viewportRect.left : rect.left;
    const baseY = viewportRect ? rect.bottom - viewportRect.top : rect.bottom;

    setSelectionText(sel.toString());
    setSelectionRange(range);
    setSelectionPage(pageNum);
    setMenuPos({
      x: baseX + rect.width / 2,
      y: baseY + 8,
    });
  };

  /* ------------------------ Highlights ------------------------ */
  const highlightSelection = async () => {
    if (!selectionRange || selectionPage == null) return;

    const container = document.getElementById(
      `pageContainer-${selectionPage}`
    );
    if (!container) {
      clearSelection();
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const segments = selectionRange.getClientRects();
    if (!segments || segments.length === 0) {
      clearSelection();
      return;
    }

    const batched = [];
    for (const r of segments) {
      batched.push({
        page: selectionPage,
        x: r.left - containerRect.left,
        y: r.top - containerRect.top,
        width: r.width,
        height: r.height,
        color: selectedColor,
      });
    }

    if (!batched.length) {
      clearSelection();
      return;
    }

    try {
      const ids = await db.highlights.bulkAdd(batched, { allKeys: true });
      const withIds = batched.map((h, i) => ({ id: ids[i], ...h }));
      setHighlights((prev) => [...prev, ...withIds]);
    } catch (err) {
      console.error("Failed to save highlights:", err);
    }

    clearSelection();
  };

  const eraseHighlight = async (hl) => {
    if (!hl) return;
    try {
      if (hl.id != null) {
        await db.highlights.delete(hl.id);
        setHighlights((prev) => prev.filter((h) => h.id !== hl.id));
        return;
      }
      const tol = 0.5;
      const cand = await db.highlights
        .where("page")
        .equals(hl.page)
        .filter(
          (h) =>
            Math.abs(h.x - hl.x) < tol &&
            Math.abs(h.y - hl.y) < tol &&
            Math.abs(h.width - hl.width) < tol &&
            Math.abs(h.height - hl.height) < tol
        )
        .first();
      if (cand) await db.highlights.delete(cand.id);
      setHighlights((prev) =>
        prev.filter(
          (h) =>
            !(
              h.page === hl.page &&
              Math.abs(h.x - hl.x) < tol &&
              Math.abs(h.y - hl.y) < tol &&
              Math.abs(h.width - hl.width) < tol &&
              Math.abs(h.height - hl.height) < tol
            )
        )
      );
    } catch (err) {
      console.error("Failed to erase highlight:", err);
    }
  };

  const clearPageHighlights = async () => {
    try {
      await db.highlights.where("page").equals(currentPage).delete();
      setHighlights((prev) => prev.filter((h) => h.page !== currentPage));
    } catch (err) {
      console.error("Failed to clear page highlights:", err);
    }
  };

  const clearAllHighlights = async () => {
    try {
      await db.highlights.clear();
      setHighlights([]);
    } catch (err) {
      console.error("Failed to clear all highlights:", err);
    }
  };

  /* ----------------------------- Notes logic ----------------------------- */

  const createBaseNote = (pageNum, x, y, initialBody = "") => ({
    page: pageNum,
    x,
    y,
    body: initialBody,
    bgColor: "#020617",
    textColor: "#e5e7eb",
    z: maxZ + 1,
  });

  const addNoteTopBar = async () => {
    if (!currentPage) return;
    let pageNum = currentPage;
    let x = 40;
    let y = 40;

    const container = document.getElementById(`pageContainer-${pageNum}`);
    if (!container) return;

    if (selectionRange && selectionPage != null) {
      const rect = selectionRange.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      pageNum = selectionPage;
      x = rect.left - containerRect.left;
      y = rect.top - containerRect.top;
    } else {
      const canvas = container.querySelector("canvas");
      const pw = canvas ? canvas.offsetWidth || canvas.width || 860 : 860;
      const ph = canvas ? canvas.offsetHeight || canvas.height || 1200 : 1200;
      x = pw - 280; // tuck near right side
      y = 40;
    }

    const base = createBaseNote(pageNum, x, y);
    try {
      const id = await db.notes.add(base);
      const note = { id, ...base };
      setNotes((prev) => [...prev, note]);
      setMaxZ((z) => Math.max(z, note.z));
    } catch (err) {
      console.error("Failed to add note:", err);
    }

    clearSelection();
  };

  const addNoteFromSelection = async () => {
    if (!selectionRange || selectionPage == null) return;
    const container = document.getElementById(
      `pageContainer-${selectionPage}`
    );
    if (!container) {
      clearSelection();
      return;
    }

    const rect = selectionRange.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const initialBody = selectionText || "";

    const base = createBaseNote(
      selectionPage,
      rect.left - containerRect.left,
      rect.top - containerRect.top,
      initialBody
    );

    try {
      const id = await db.notes.add(base);
      const note = { id, ...base };
      setNotes((prev) => [...prev, note]);
      setMaxZ((z) => Math.max(z, note.z));
    } catch (err) {
      console.error("Failed to add note from selection:", err);
    }

    clearSelection();
  };

  // IMPORTANT: instant UI update; DB fire-and-forget
  const handleBodyChange = (id, body) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, body } : n)));
    db.notes.update(id, { body }).catch((err) => {
      console.error("Failed to update note body:", err);
    });
  };

  const handleMoveEnd = (id, nx, ny) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, x: nx, y: ny } : n))
    );
    db.notes.update(id, { x: nx, y: ny }).catch((err) => {
      console.error("Failed to move note:", err);
    });
  };

  const handleDeleteNote = (id) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    db.notes.delete(id).catch((err) => {
      console.error("Failed to delete note:", err);
    });
  };

  const handleBringToFront = (id) => {
    const newZ = maxZ + 1;
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, z: newZ } : n))
    );
    setMaxZ(newZ);
    db.notes.update(id, { z: newZ }).catch((err) => {
      console.error("Failed to update note z-index:", err);
    });
  };

  const handleColorChange = (id, patch) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, ...patch } : n))
    );
    db.notes.update(id, patch).catch((err) => {
      console.error("Failed to change note color:", err);
    });
  };

  /* ---------------------------------------------------------------------- */

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#020617",
        color: "#e5e7eb",
        position: "relative",
      }}
    >
      {eraseMode && (
        <style>{`
          .react-pdf__Page__textContent { 
            pointer-events: none !important; 
          }
        `}</style>
      )}

      {/* Glass top bar */}
      <div
        style={{
          padding: "10px 18px",
          borderBottom: "1px solid rgba(31,41,55,0.9)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          background: "rgba(15,23,42,0.9)",
          backdropFilter: "blur(18px)",
          boxShadow: "0 16px 40px rgba(0,0,0,0.55)",
          zIndex: 50,
        }}
      >
        <button
          type="button"
          onClick={goHome}
          style={{
            ...topbarButtonBase,
            background: "rgba(56,189,248,0.12)",
            border: "1px solid rgba(56,189,248,0.6)",
            color: "#e0f2fe",
            fontWeight: 500,
          }}
        >
          🏠 Home
        </button>

        {!pdfFile ? (
          <label
            style={{
              ...topbarButtonBase,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span>📂 Open PDF</span>
            <input
              type="file"
              accept="application/pdf"
              onChange={handleFileSelect}
              style={{ display: "none" }}
            />
          </label>
        ) : (
          <>
            <button
              type="button"
              onClick={goPrev}
              disabled={currentPage <= 1}
              style={{
                ...topbarButtonBase,
                opacity: currentPage <= 1 ? 0.35 : 1,
                cursor: currentPage <= 1 ? "default" : "pointer",
              }}
            >
              ← Prev
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={currentPage >= numPages}
              style={{
                ...topbarButtonBase,
                opacity: currentPage >= numPages ? 0.35 : 1,
                cursor: currentPage >= numPages ? "default" : "pointer",
              }}
            >
              Next →
            </button>

            <span
              style={{
                fontSize: 13,
                opacity: 0.7,
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid rgba(51,65,85,0.9)",
                background: "rgba(15,23,42,0.7)",
              }}
            >
              Page {currentPage} / {numPages || 0}
            </span>

            <button
              type="button"
              onClick={bookmarkPage}
              style={{
                ...topbarButtonBase,
                background: "rgba(251,191,36,0.1)",
                border: "1px solid rgba(251,191,36,0.6)",
                color: "#facc15",
              }}
            >
              🔖 Bookmark
            </button>

            <button
              type="button"
              onClick={addNoteTopBar}
              style={{
                ...topbarButtonBase,
                background: "rgba(56,189,248,0.12)",
                border: "1px solid rgba(56,189,248,0.7)",
                color: "#e0f2fe",
                fontWeight: 500,
              }}
              title="Add note (uses selection if any, otherwise places near right edge)"
            >
              📝 Note
            </button>

            {/* Erase/Clear */}
            <button
              type="button"
              onClick={() => setEraseMode((v) => !v)}
              style={{
                ...subtleIconButton,
                background: eraseMode
                  ? "rgba(248,113,113,0.16)"
                  : "rgba(15,23,42,0.75)",
                border: eraseMode
                  ? "1px solid rgba(248,113,113,0.8)"
                  : "1px solid rgba(75,85,99,0.9)",
                color: eraseMode ? "#fecaca" : "#e5e7eb",
              }}
            >
              🧽 {eraseMode ? "Erasing" : "Erase"}
            </button>
            <button
              type="button"
              onClick={clearPageHighlights}
              style={subtleIconButton}
            >
              🧹 Clear Page
            </button>
            <button
              type="button"
              onClick={clearAllHighlights}
              style={subtleIconButton}
            >
              🗑️ Clear All
            </button>

            {/* Highlighter controls */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginLeft: "auto",
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  opacity: 0.6,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                Highlighter
              </span>
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  title={c.name}
                  onClick={() => setSelectedColor(c.value)}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 999,
                    border:
                      selectedColor === c.value
                        ? "2px solid #38bdf8"
                        : "1px solid rgba(75,85,99,0.8)",
                    background: c.value,
                    cursor: "pointer",
                  }}
                />
              ))}
              <ToolbarButton
                title={
                  selectionText
                    ? "Highlight selection"
                    : "Select text to highlight"
                }
                onClick={highlightSelection}
                disabled={!selectionText}
              >
                🖍 Apply
              </ToolbarButton>
            </div>
          </>
        )}
      </div>

      {/* PDF viewport */}
      <div
        ref={viewportRef}
        style={{
          flex: 1,
          overflow: "auto",
          position: "relative",
          padding: "18px 0 18px 0",
          display: "flex",
          justifyContent: "center",
        }}
      >
        {pdfFile ? (
          <Document
            file={pdfFile}
            onLoadSuccess={onDocumentLoad}
            onLoadError={(err) => console.error("PDF load error:", err)}
            loading={
              <p style={{ color: "#9ca3af", marginTop: 40 }}>Loading…</p>
            }
          >
            <div
              id={`pageContainer-${currentPage}`}
              style={{
                position: "relative",
                margin: "0 auto",
                width: "fit-content",
                padding: 16,
                borderRadius: 18,
                background: "#020617",
              }}
              onMouseUp={(e) => {
                // ignore mouseup from note cards
                const inNote = e.target.closest('[data-note-card="true"]');
                if (inNote) return;
                handleTextSelect(currentPage);
              }}
            >
              <Page
                pageNumber={currentPage}
                width={860}
                renderTextLayer
                renderAnnotationLayer={false}
              />

              {/* Highlights */}
              {highlights
                .filter((h) => h.page === currentPage)
                .map((hl) => (
                  <div
                    key={
                      hl.id ??
                      `${hl.page}-${hl.x}-${hl.y}-${hl.width}-${hl.height}`
                    }
                    onMouseDown={(e) => {
                      if (eraseMode) e.stopPropagation();
                    }}
                    onClick={(e) => {
                      if (!eraseMode) return;
                      e.stopPropagation();
                      eraseHighlight(hl);
                    }}
                    title={eraseMode ? "Click to erase highlight" : undefined}
                    style={{
                      position: "absolute",
                      background: hl.color || "rgba(250,204,21,0.4)",
                      top: hl.y,
                      left: hl.x,
                      width: hl.width,
                      height: hl.height,
                      borderRadius: 4,
                      pointerEvents: eraseMode ? "auto" : "none",
                      cursor: eraseMode ? "pointer" : "default",
                      boxShadow: eraseMode
                        ? "0 0 0 2px rgba(248,113,113,0.8) inset"
                        : "none",
                      zIndex: 40,
                    }}
                  />
                ))}

              {/* Notes */}
              {notes
                .filter((n) => n.page === currentPage)
                .map((note) => (
                  <XenyaNoteCard
                    key={note.id}
                    id={note.id}
                    x={note.x}
                    y={note.y}
                    body={note.body || ""}
                    bgColor={note.bgColor || "#020617"}
                    textColor={note.textColor || "#e5e7eb"}
                    z={note.z || 1}
                    width={260}
                    onBodyChange={handleBodyChange}
                    onMoveEnd={handleMoveEnd}
                    onDelete={handleDeleteNote}
                    onBringToFront={handleBringToFront}
                    onColorChange={handleColorChange}
                  />
                ))}
            </div>
          </Document>
        ) : (
          <div
            style={{
              textAlign: "center",
              marginTop: 64,
              color: "#9ca3af",
              fontSize: 14,
            }}
          >
            <p style={{ opacity: 0.9 }}>No document loaded.</p>
            <p style={{ opacity: 0.7, marginTop: 4 }}>
              Click <strong>Open PDF</strong> in the top bar to start reading.
            </p>
          </div>
        )}

        {/* Selection popover */}
        {selectionText && (
          <div
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: "absolute",
              top: menuPos.y,
              left: menuPos.x,
              transform: "translateX(-50%)",
              background: "rgba(15,23,42,0.96)",
              border: "1px solid rgba(55,65,81,0.9)",
              padding: "6px 8px",
              borderRadius: 999,
              display: "flex",
              gap: 6,
              alignItems: "center",
              boxShadow: "0 16px 40px rgba(0,0,0,0.6)",
              zIndex: 9999,
              userSelect: "none",
              backdropFilter: "blur(10px)",
            }}
          >
            <ToolbarButton title="Highlight" onClick={highlightSelection}>
              🖍
            </ToolbarButton>
            <ToolbarButton
              title="Note from selection"
              onClick={addNoteFromSelection}
            >
              📝
            </ToolbarButton>
            <ToolbarButton
              title="Dictionary"
              onClick={() => {
                const q = encodeURIComponent(selectionText.trim());
                if (q) {
                  window.open(
                    `https://www.dictionary.com/browse/${q}`,
                    "_blank",
                    "noopener,noreferrer"
                  );
                }
                clearSelection();
              }}
            >
              📖
            </ToolbarButton>
            <ToolbarButton
              title="Web search"
              onClick={() => {
                const q = encodeURIComponent(selectionText.trim());
                if (q) {
                  window.open(
                    `https://www.google.com/search?q=${q}`,
                    "_blank",
                    "noopener,noreferrer"
                  );
                }
                clearSelection();
              }}
            >
              🔎
            </ToolbarButton>
          </div>
        )}
      </div>

      {/* Bookmarks peek */}
      {bookmarks.length > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 16,
            right: 16,
            background: "rgba(15,23,42,0.92)",
            border: "1px solid rgba(51,65,85,0.9)",
            padding: 10,
            borderRadius: 14,
            fontSize: 13,
            boxShadow: "0 16px 40px rgba(0,0,0,0.6)",
            backdropFilter: "blur(12px)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              opacity: 0.65,
              marginBottom: 4,
            }}
          >
            Bookmarks
          </div>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              lineHeight: 1.5,
              maxHeight: 140,
              overflowY: "auto",
            }}
          >
            {bookmarks.map((b, i) => (
              <li
                key={b.id ?? i}
                style={{
                  cursor: "pointer",
                  padding: "2px 4px",
                  borderRadius: 6,
                  opacity: currentPage === b.page ? 1 : 0.75,
                  background:
                    currentPage === b.page
                      ? "rgba(56,189,248,0.15)"
                      : "transparent",
                }}
                onClick={() => setCurrentPage(b.page)}
              >
                Page {b.page}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
