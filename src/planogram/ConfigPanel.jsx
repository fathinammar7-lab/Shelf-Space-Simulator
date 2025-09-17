import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { computeMetrics, sanitizeConfig } from './validators';
import { useDebounced } from './hooks';
import DimensionPreview from './DimensionPreview';

// If `types` is provided, this panel will allow selecting a product type.
// Otherwise, it behaves like before, using the provided `product` dims.
export default function ConfigPanel({ open, initial, product, types, selectedTypeId, shelf, pxPerCm, onApply, onCancel }) {
  // Raw string inputs to avoid fighting while typing
  const [facingStr, setFacingStr] = useState(String(initial?.facing ?? 1));
  const [gapStr, setGapStr] = useState(String(initial?.gapPx ?? 0));
  const [capStr, setCapStr] = useState(String(initial?.capacity ?? 1));
  const [stackStr, setStackStr] = useState(String(initial?.stack ?? 1));
  const [typeId, setTypeId] = useState(selectedTypeId || (types && types[0] ? types[0].id : null));
  // Queue of previously configured products to keep them in preview
  const [queued, setQueued] = useState([]); // [{ typeId, cfg }]

  const openedOnceRef = useRef(false);
  useEffect(() => {
    // Initialize values only when panel first opens, not on every parent re-render
    if (open && !openedOnceRef.current) {
      setFacingStr(String(initial?.facing ?? 1));
      setGapStr(String(initial?.gapPx ?? 0));
      setCapStr(String(initial?.capacity ?? 1));
      setStackStr(String(initial?.stack ?? 1));
      openedOnceRef.current = true;
    }
    if (!open) {
      openedOnceRef.current = false;
    }
  }, [open, initial]);

  const toInt = (s, fallback) => {
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : fallback;
  };
  const draftNumeric = useMemo(() => sanitizeConfig({
    facing: toInt(facingStr, 1),
    gapPx: Math.max(0, toInt(gapStr, 0)),
    capacity: toInt(capStr, 1),
    stack: toInt(stackStr, 1),
  }), [facingStr, gapStr, capStr, stackStr]);

  // Determine which product dims to preview: from `types` (if provided) or the `product` prop
  const currentProduct = useMemo(() => {
    if (Array.isArray(types) && types.length) {
      const t = types.find(tt => tt.id === typeId) || types[0];
      return t ? { w: t.w, h: t.h, d: t.d, color: t.color, img: t.img, name: t.name } : product;
    }
    return product;
  }, [types, typeId, product]);

  const debounced = useDebounced(draftNumeric, 200);
  const m = useMemo(() => computeMetrics(debounced, currentProduct, shelf, pxPerCm), [debounced, currentProduct, shelf, pxPerCm]);
  const canApply = m.validW && m.validH && m.validD;

  const idFacing = useId();
  const idGap = useId();
  const idCap = useId();
  const idStack = useId();

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Auto-configure product arrangement" style={panelStyles.container}>
      <style>{`
        /* Hide default spinner controls for number inputs */
        [role="dialog"] input[type=number]::-webkit-outer-spin-button,
        [role="dialog"] input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        [role="dialog"] input[type=number] { -moz-appearance: textfield; }
      `}</style>
      <div style={panelStyles.header}>
        <div style={{ fontWeight: 600 }}>Auto-Configure</div>
        <button onClick={onCancel} aria-label="Close" style={panelStyles.iconBtn}>✕</button>
      </div>

      {Array.isArray(types) && types.length > 0 && (
        <div style={panelStyles.section}>
          <div style={panelStyles.row}>
            <label htmlFor={idFacing + '-type'}>Product</label>
            <select
              id={idFacing + '-type'}
              value={typeId || ''}
              onChange={(e) => {
                // When switching product, keep the previous selection in the preview queue
                const prevTypeId = typeId;
                const prevCfg = draftNumeric;
                if (prevTypeId) {
                  setQueued(q => [...q, { typeId: prevTypeId, cfg: prevCfg }]);
                }
                setTypeId(e.target.value);
              }}
            >
              {types.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.w}×{t.h}×{t.d}cm)</option>
              ))}
            </select>
          </div>
          {queued.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {queued.map((q, idx) => {
                const t = types.find(tt => tt.id === q.typeId);
                return (
                  <span key={idx} style={{ background: '#0b0f17', border: '1px solid #22304a', borderRadius: 8, padding: '4px 6px', fontSize: 11 }}>
                    {(t?.name || 'Product')} · {q.cfg.facing}×{q.cfg.capacity}×{q.cfg.stack}
                    <button aria-label="Remove" onClick={() => setQueued(qq => qq.filter((_,i)=>i!==idx))} style={{ marginLeft: 6, border: 'none', background: 'transparent', color: '#9aacbf', cursor: 'pointer' }}>✕</button>
                  </span>
                );
              })}
              <button className="btn" style={{ marginLeft: 'auto', padding: '4px 8px', borderRadius: 8, border: '1px solid #22304a', background: '#131a28', color: '#e7ecf3', fontSize: 11 }} onClick={() => setQueued([])}>Clear</button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn" style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #22304a', background: '#0f141f', color: '#e7ecf3', fontSize: 12 }}
              onClick={() => setQueued(q => [...q, { typeId: typeId, cfg: draftNumeric }])}
            >Add to plan</button>
          </div>
        </div>
      )}

      <div style={panelStyles.section}>
        <div style={panelStyles.row}>
          <label htmlFor={idFacing}>Facing</label>
          <input id={idFacing} type="number" min={1} inputMode="numeric" value={facingStr}
            onChange={(e) => setFacingStr(e.target.value)}
            aria-invalid={!m.validW}
            aria-describedby={!m.validW ? `${idFacing}-err` : undefined}
          />
        </div>
        <div style={panelStyles.row}>
          <label htmlFor={idGap}>Gap between items (px)</label>
          <input id={idGap} type="number" min={0} inputMode="numeric" value={gapStr}
            onChange={(e) => setGapStr(e.target.value)}
            aria-invalid={!m.validW}
            aria-describedby={!m.validW ? `${idFacing}-err` : undefined}
          />
        </div>
        {!m.validW && (
          <div id={`${idFacing}-err`} style={panelStyles.error}>Width exceeded: Used {m.usedWcm.toFixed(1)}cm vs Shelf {shelf.width}cm</div>
        )}
      </div>

      <div style={panelStyles.section}>
        <div style={panelStyles.row}>
          <label htmlFor={idCap}>Capacity (depth)</label>
          <input id={idCap} type="number" min={1} inputMode="numeric" value={capStr}
            onChange={(e) => setCapStr(e.target.value)}
            aria-invalid={!m.validD}
            aria-describedby={!m.validD ? `${idCap}-err` : undefined}
          />
        </div>
        {!m.validD && (
          <div id={`${idCap}-err`} style={panelStyles.error}>Depth exceeded: Used {m.usedDcm.toFixed(1)}cm vs Shelf {shelf.depth}cm</div>
        )}
      </div>

      <div style={panelStyles.section}>
        <div style={panelStyles.row}>
          <label htmlFor={idStack}>Stack (height)</label>
          <input id={idStack} type="number" min={1} inputMode="numeric" value={stackStr}
            onChange={(e) => setStackStr(e.target.value)}
            aria-invalid={!m.validH}
            aria-describedby={!m.validH ? `${idStack}-err` : undefined}
          />
        </div>
        {!m.validH && (
          <div id={`${idStack}-err`} style={panelStyles.error}>Height exceeded: Used {m.usedHcm.toFixed(1)}cm vs Shelf {shelf.height}cm</div>
        )}
      </div>

      <div style={panelStyles.section}>
        <div style={panelStyles.badges}>
          <span style={panelStyles.badge}>Total Units: <b>{m.totalUnits}</b></span>
          <span style={panelStyles.badge}>Used W/H/D: {m.usedWcm.toFixed(1)}/{m.usedHcm.toFixed(1)}/{m.usedDcm.toFixed(1)}cm</span>
          <span style={panelStyles.badge}>Shelf W/H/D: {shelf.width}/{shelf.height}/{shelf.depth}cm</span>
        </div>
        {/* Render preview for queued items first, then current selection */}
        {queued.map((q, idx) => {
          const t = Array.isArray(types) ? types.find(tt => tt.id === q.typeId) : null;
          const prod = t ? { w: t.w, h: t.h, d: t.d, color: t.color, img: t.img, name: t.name } : currentProduct;
          return (
            <div key={`queued-${idx}`} style={{ marginBottom: 8 }}>
              <DimensionPreview ariaLabel={`Queued preview ${idx+1}`} cfg={q.cfg} product={prod} shelf={shelf} pxPerCm={pxPerCm} />
            </div>
          );
        })}
        <DimensionPreview ariaLabel="Current selection preview" cfg={debounced} product={currentProduct} shelf={shelf} pxPerCm={pxPerCm} />
      </div>

      <div style={panelStyles.footer}>
        <button style={panelStyles.btn} onClick={onCancel}>Cancel</button>
        <button
          style={{ ...panelStyles.btn, ...(canApply ? panelStyles.btnPrimary : panelStyles.btnDisabled) }}
          onClick={() => {
            if (Array.isArray(types) && types.length) {
              const batch = [...queued, { typeId: typeId || (types[0] && types[0].id), cfg: draftNumeric }];
              onApply({ batch });
            } else {
              onApply(draftNumeric);
            }
          }}
          aria-disabled={!canApply}
          disabled={!canApply}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

const panelStyles = {
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
