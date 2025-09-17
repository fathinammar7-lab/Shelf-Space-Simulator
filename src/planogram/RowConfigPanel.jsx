import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { sanitizeConfig, computeMetrics } from './validators.js';
import { useDebounced } from './hooks.js';
import DimensionPreview from './DimensionPreview.jsx';

export default function RowConfigPanel({
  open,
  types,
  initialTypeId,
  initial,
  shelfDims, // { width, height, depth }
  pxPerCm,
  onApply,
  onCancel,
}) {
  const [typeId, setTypeId] = useState(initialTypeId || (types[0]?.id ?? null));
  // Raw input strings to avoid cursor jumps
  const [facingStr, setFacingStr] = useState(String(initial?.facing ?? 1));
  const [gapStr, setGapStr] = useState(String(initial?.gapPx ?? 0));
  const [capStr, setCapStr] = useState(String(initial?.capacity ?? 1));
  const [stackStr, setStackStr] = useState(String(initial?.stack ?? 1));
  useEffect(() => setTypeId(initialTypeId || (types[0]?.id ?? null)), [initialTypeId, types]);
  const openedOnceRef = useRef(false);
  useEffect(() => {
    if (open && !openedOnceRef.current) {
      setFacingStr(String(initial?.facing ?? 1));
      setGapStr(String(initial?.gapPx ?? 0));
      setCapStr(String(initial?.capacity ?? 1));
      setStackStr(String(initial?.stack ?? 1));
      openedOnceRef.current = true;
    }
    if (!open) openedOnceRef.current = false;
  }, [open, initial]);

  const product = useMemo(() => {
    const t = types.find(tt => tt.id === typeId) || null;
    if (!t) return null;
    return { w: t.w, h: t.h, d: t.d, color: t.color, img: t.img, name: t.name };
  }, [types, typeId]);

  const toInt = (s, fallback) => { const n = parseInt(s, 10); return Number.isFinite(n) ? n : fallback; };
  const draft = useMemo(() => sanitizeConfig({
    facing: toInt(facingStr, 1),
    gapPx: Math.max(0, toInt(gapStr, 0)),
    capacity: toInt(capStr, 1),
    stack: toInt(stackStr, 1),
  }), [facingStr, gapStr, capStr, stackStr]);
  const debounced = useDebounced({ draft, product }, 200);
  const m = useMemo(() => {
    if (!product) return { totalUnits: 0, usedWcm: 0, usedHcm: 0, usedDcm: 0, validW: false, validH: false, validD: false };
    return computeMetrics(debounced.draft, product, shelfDims, pxPerCm);
  }, [debounced, product, shelfDims, pxPerCm]);

  const idType = useId();
  const idFacing = useId();
  const idGap = useId();
  const idCap = useId();
  const idStack = useId();

  if (!open) return null;

  const canApply = product && m.validW && m.validH && m.validD;

  return (
    <div role="dialog" aria-modal="true" aria-label="Configure row placement" style={styles.container}>
      <style>{`
        [role="dialog"] input[type=number]::-webkit-outer-spin-button,
        [role="dialog"] input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        [role="dialog"] input[type=number] { -moz-appearance: textfield; }
      `}</style>
      <div style={styles.header}>
        <div style={{ fontWeight: 600 }}>Auto-Configure (Row)</div>
        <button onClick={onCancel} aria-label="Close" style={styles.iconBtn}>✕</button>
      </div>

      <div style={styles.section}>
        <div style={styles.row}>
          <label htmlFor={idType}>Product</label>
          <select id={idType} value={typeId || ''} onChange={(e) => setTypeId(e.target.value)}>
            {types.map(t => (
              <option key={t.id} value={t.id}>{t.name} ({t.w}×{t.h}×{t.d}cm)</option>
            ))}
          </select>
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.row}>
          <label htmlFor={idFacing}>Facing</label>
          <input id={idFacing} type="number" min={1} inputMode="numeric" value={facingStr}
            onChange={(e) => setFacingStr(e.target.value)}
            aria-invalid={!m.validW}
            aria-describedby={!m.validW ? `${idFacing}-err` : undefined}
          />
        </div>
        <div style={styles.row}>
          <label htmlFor={idGap}>Gap between items (px)</label>
          <input id={idGap} type="number" min={0} inputMode="numeric" value={gapStr}
            onChange={(e) => setGapStr(e.target.value)}
            aria-invalid={!m.validW}
            aria-describedby={!m.validW ? `${idFacing}-err` : undefined}
          />
        </div>
        {!m.validW && (
          <div id={`${idFacing}-err`} style={styles.error}>Width exceeded: Used {m.usedWcm.toFixed(1)}cm vs Shelf {shelfDims.width}cm</div>
        )}
      </div>

      <div style={styles.section}>
        <div style={styles.row}>
          <label htmlFor={idCap}>Capacity (depth)</label>
          <input id={idCap} type="number" min={1} inputMode="numeric" value={capStr}
            onChange={(e) => setCapStr(e.target.value)}
            aria-invalid={!m.validD}
            aria-describedby={!m.validD ? `${idCap}-err` : undefined}
          />
        </div>
        {!m.validD && (
          <div id={`${idCap}-err`} style={styles.error}>Depth exceeded: Used {m.usedDcm.toFixed(1)}cm vs Shelf {shelfDims.depth}cm</div>
        )}
      </div>

      <div style={styles.section}>
        <div style={styles.row}>
          <label htmlFor={idStack}>Stack (height)</label>
          <input id={idStack} type="number" min={1} inputMode="numeric" value={stackStr}
            onChange={(e) => setStackStr(e.target.value)}
            aria-invalid={!m.validH}
            aria-describedby={!m.validH ? `${idStack}-err` : undefined}
          />
        </div>
        {!m.validH && (
          <div id={`${idStack}-err`} style={styles.error}>Height exceeded: Used {m.usedHcm.toFixed(1)}cm vs Shelf {shelfDims.height}cm</div>
        )}
      </div>

      {product && (
        <div style={styles.section}>
          <div style={styles.badges}>
            <span style={styles.badge}>Total Units: <b>{m.totalUnits}</b></span>
            <span style={styles.badge}>Used W/H/D: {m.usedWcm.toFixed(1)}/{m.usedHcm.toFixed(1)}/{m.usedDcm.toFixed(1)}cm</span>
            <span style={styles.badge}>Shelf W/H/D: {shelfDims.width}/{shelfDims.height}/{shelfDims.depth}cm</span>
          </div>
          <DimensionPreview ariaLabel="Shelf arrangement preview" cfg={draft} product={product} shelf={shelfDims} pxPerCm={pxPerCm} />
        </div>
      )}

      <div style={styles.footer}>
        <button style={styles.btn} onClick={onCancel}>Cancel</button>
        <button style={{ ...styles.btn, ...(canApply ? styles.btnPrimary : styles.btnDisabled) }} onClick={() => canApply && onApply({ cfg: draft, typeId })} disabled={!canApply} aria-disabled={!canApply}>
          Apply
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: {
    position: 'fixed', right: 0, top: 0, bottom: 0, width: 360,
    background: 'linear-gradient(180deg, #121622, #0f121b)',
    borderLeft: '1px solid #1d2333', padding: 14, zIndex: 5000000,
    color: '#e7ecf3', display: 'flex', flexDirection: 'column', gap: 10,
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  section: { border: '1px dashed #232a3f', borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'center' },
  error: { color: '#ff9aa8', fontSize: 12 },
  badges: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#9aacbf' },
  badge: { background: '#0b0f17', border: '1px solid #22304a', borderRadius: 8, padding: '6px 8px' },
  footer: { marginTop: 'auto', display: 'flex', justifyContent: 'flex-end', gap: 8 },
  btn: { cursor: 'pointer', border: '1px solid #2b344a', background: '#1a2030', color: '#e7ecf3', padding: '8px 10px', borderRadius: 10, fontSize: 12 },
  btnPrimary: { borderColor: '#1a6146', background: '#103226' },
  btnDisabled: { opacity: 0.6, cursor: 'not-allowed' },
  iconBtn: { cursor: 'pointer', border: '1px solid #2b344a', background: '#1a2030', color: '#e7ecf3', borderRadius: 8, width: 28, height: 28 },
};
