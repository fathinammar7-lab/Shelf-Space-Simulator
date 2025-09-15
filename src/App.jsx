import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const LS_KEYS = {
  CONFIG: 'shelfSim.config.v1',
  TYPES: 'shelfSim.types.v1',
  ITEMS: 'shelfSim.items.v1'
};

const defaultShelf = {
  width: 200,
  rows: [
    { height: 40, depth: 50 },
    { height: 40, depth: 50 },
    { height: 50, depth: 50 },
    { height: 50, depth: 50 },
  ]
};

const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const App = () => {
  const [scale, setScale] = useState(4);
  const [shelf, setShelf] = useState(defaultShelf);
  const [types, setTypes] = useState([]);
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('Ready');
  const [toast, setToast] = useState('');

  const [hoverRow, setHoverRow] = useState(null); // { index, invalid }
  // Collapsible sidebars
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  // Local input states to avoid fighting while typing
  const [widthInput, setWidthInput] = useState('200');
  const [depthInput, setDepthInput] = useState('50');
  const [rowCountInput, setRowCountInput] = useState('4');
  const hudRef = useRef({ visible: false, x: 0, y: 0, text: '' });
  const [, forceHud] = useState(0);

  const rowsRef = useRef(new Map()); // index -> HTMLElement
  const itemNodesRef = useRef(new Map()); // id -> HTMLElement
  const dragRef = useRef(null); // { id, startX, startY, dx, dy }

  const cm2px = useCallback((cm) => cm * scale, [scale]);
  const px2cm = useCallback((px) => px / scale, [scale]);

  // Load state from localStorage
  useEffect(() => {
    try {
      const cfg = JSON.parse(localStorage.getItem(LS_KEYS.CONFIG) || 'null');
      const tps = JSON.parse(localStorage.getItem(LS_KEYS.TYPES) || 'null');
      const its = JSON.parse(localStorage.getItem(LS_KEYS.ITEMS) || 'null');
      if (cfg) { setScale(cfg.scale ?? 4); setShelf(cfg.shelf ?? defaultShelf); }
      if (tps) setTypes(tps);
      if (its) setItems(its);
    } catch (e) { /* noop */ }
  }, []);

  // Initialize input mirrors after shelf loads
  useEffect(() => {
    setWidthInput(String(shelf.width));
    setRowCountInput(String(shelf.rows.length));
    // prefer majority depth of existing rows
    const md = shelf.rows.length ? Math.round(
      shelf.rows.reduce((a, r) => a + r.depth, 0) / shelf.rows.length
    ) : 50;
    setDepthInput(String(md));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep inputs in sync when shelf changes externally (e.g., Reset)
  useEffect(() => {
    setWidthInput(String(shelf.width));
  }, [shelf.width]);

  const saveAll = useCallback(() => {
    const cfg = { scale, shelf };
    localStorage.setItem(LS_KEYS.CONFIG, JSON.stringify(cfg));
    localStorage.setItem(LS_KEYS.TYPES, JSON.stringify(types));
    localStorage.setItem(LS_KEYS.ITEMS, JSON.stringify(items));
    setStatus('Saved');
    setToast('Layout saved to your browser');
    setTimeout(() => setToast(''), 1600);
  }, [scale, shelf, types, items]);

  const majorityDepth = useCallback(() => {
    if (!shelf.rows.length) return 50;
    const map = new Map();
    shelf.rows.forEach(r => map.set(r.depth, (map.get(r.depth) || 0) + 1));
    let best = shelf.rows[0].depth, bestN = 0;
    for (const [k, v] of map) if (v > bestN) { best = k; bestN = v; }
    return best;
  }, [shelf.rows]);

  // Sync depth and row count inputs when rows change
  useEffect(() => {
    setRowCountInput(String(shelf.rows.length));
    setDepthInput(String(majorityDepth()));
  }, [shelf.rows, majorityDepth]);

  const totalShelfHeight = useMemo(() => shelf.rows.reduce((a, r) => a + r.height, 0), [shelf.rows]);

  const rectOverlap = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.z1 < b.z2 && a.z2 > b.z1;

  const fitsInRow = useCallback((item, rowIndex, x, z) => {
    const t = types.find(tt => tt.id === item.typeId); if (!t) return false;
    const row = shelf.rows[rowIndex]; if (!row) return false;
    if (t.h > row.height) return false;
    if (t.w > shelf.width) return false;
    if (t.d > row.depth) return false;
    if (x < 0 || z < 0) return false;
    if (x + t.w > shelf.width) return false;
    if (z + t.d > row.depth) return false;
    const target = { x1: x, x2: x + t.w, z1: z, z2: z + t.d };
    for (const other of items) {
      if (other.id === item.id) continue; if (other.row !== rowIndex) continue;
      const to = types.find(tt => tt.id === other.typeId); if (!to) continue;
      const r = { x1: other.x, x2: other.x + to.w, z1: other.z, z2: other.z + to.d };
      if (rectOverlap(target, r)) return false;
    }
    return true;
  }, [items, shelf.rows, shelf.width, types]);

  // Compute the nearest available depth (z) position for an item at x-range without overlapping others
  const findAvailableZ = useCallback((rowIndex, x, wCm, dCm, excludeId) => {
    const row = shelf.rows[rowIndex]; if (!row) return null;
    const x1 = x, x2 = x + wCm;
    // Collect occupied depth segments for items that overlap in x-range
    const occ = [];
    for (const it of items) {
      if (excludeId && it.id === excludeId) continue;
      if (it.row !== rowIndex) continue;
      const t = types.find(tt => tt.id === it.typeId); if (!t) continue;
      const ox1 = it.x, ox2 = it.x + t.w;
      const overlapX = !(x2 <= ox1 || x1 >= ox2);
      if (!overlapX) continue;
      occ.push([it.z, it.z + t.d]);
    }
    // Normalize and sort by start
    occ.sort((a, b) => a[0] - b[0]);
    // Greedy scan to find first gap that fits dCm within [0, row.depth]
    let z = 0;
    for (const [s, e] of occ) {
      if (z + dCm <= s) break; // fits before this segment
      z = Math.max(z, e);
      if (z > row.depth) return null;
    }
    if (z + dCm <= row.depth) return z;
    return null;
  }, [items, shelf.rows, types]);

  const proposePlacement = useCallback((item, rowInfo, clientX, clientY) => {
    const t = types.find(tt => tt.id === item.typeId); if (!t) return { valid: false, rowIndex: rowInfo.index, x: 0, z: 0 };
    const { rect, index } = rowInfo;
    const localXpx = clamp(clientX - rect.left, 0, rect.width);
    // Center under cursor horizontally and clamp within shelf width
    let x = px2cm(localXpx) - t.w / 2; x = clamp(x, 0, shelf.width - t.w);

    // Choose a depth that respects existing items at this x-range
    let z = findAvailableZ(index, x, t.w, t.d, item.id);
    if (z == null) {
      // Fallback to pointer-derived depth within limits
      const localYpx = clamp(clientY - rect.top, 0, rect.height);
      const fromBottom = rect.height - localYpx; // px from front edge
      z = clamp(px2cm(fromBottom) - t.d / 2, 0, rowInfo.row.depth - t.d);
    }

    const valid = fitsInRow(item, index, x, z);
    return { valid, rowIndex: index, x, z };
  }, [findAvailableZ, fitsInRow, px2cm, shelf.width, types]);

  const findRowUnderPointer = useCallback((clientX, clientY) => {
    for (const [index, el] of rowsRef.current.entries()) {
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return { index, el, rect, row: shelf.rows[index] };
      }
    }
    return null;
  }, [shelf.rows]);

  const validateAllItems = useCallback(() => {
    setItems(prev => {
      let removed = 0;
      const next = prev.filter(it => {
        if (it.row === null) return true;
        const ok = fitsInRow(it, it.row, it.x, it.z);
        if (!ok) removed++;
        return ok;
      });
      if (removed) {
        setToast(`${removed} item(s) removed because they no longer fit.`);
        setTimeout(() => setToast(''), 1600);
      }
      return next;
    });
  }, [fitsInRow]);

  const onPointerDownItem = useCallback((e, it) => {
    e.preventDefault();
    const node = itemNodesRef.current.get(it.id);
    if (!node) return;
    node.setPointerCapture?.(e.pointerId);
    dragRef.current = { id: it.id, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0 };
    node.classList.add('dragging');
    hudRef.current = { visible: true, x: e.clientX, y: e.clientY, text: 'Drag an item into a row' };
    forceHud(x => x + 1);
  }, []);

  const onPointerMoveItem = useCallback((e, it) => {
    const d = dragRef.current; if (!d || d.id !== it.id) return;
    d.dx = e.clientX - d.startX; d.dy = e.clientY - d.startY;
    const node = itemNodesRef.current.get(it.id);
    if (node) node.style.transform = `translate(${d.dx}px, ${d.dy}px)`;

    const rowInfo = findRowUnderPointer(e.clientX, e.clientY);
    let text = 'Drag an item into a row';
    let invalid = false;
    if (rowInfo) {
      const prop = proposePlacement(it, rowInfo, e.clientX, e.clientY);
      const t = types.find(tt => tt.id === it.typeId);
      text = `Row ${rowInfo.index + 1} · x:${prop.x.toFixed(1)}cm z:${prop.z.toFixed(1)}cm ${prop.valid ? '✅ fits' : '❌ no fit'}\nRow depth:${rowInfo.row.depth}cm Item d:${t?.d ?? 0}cm`;
      invalid = !prop.valid;
      setHoverRow({ index: rowInfo.index, invalid });
    } else {
      setHoverRow(null);
    }
    hudRef.current = { visible: true, x: e.clientX, y: e.clientY, text };
    forceHud(x => x + 1);
  }, [findRowUnderPointer, proposePlacement, types]);

  const onPointerUpItem = useCallback((e, it) => {
    const d = dragRef.current; if (!d || d.id !== it.id) return;
    const node = itemNodesRef.current.get(it.id);
    if (node) {
      node.releasePointerCapture?.(e.pointerId);
      node.classList.remove('dragging');
      node.style.transform = '';
    }
    const rowInfo = findRowUnderPointer(e.clientX, e.clientY);
    if (rowInfo) {
      const prop = proposePlacement(it, rowInfo, e.clientX, e.clientY);
      if (prop.valid) {
        setItems(prev => prev.map(p => p.id === it.id ? { ...p, row: prop.rowIndex, x: prop.x, z: prop.z } : p));
        setStatus('Edited');
        setTimeout(saveAll, 0);
      } else {
        setToast('❌ Doesn\'t fit there');
        setTimeout(() => setToast(''), 1600);
      }
    } else {
      // Drop to pile
      setItems(prev => prev.map(p => p.id === it.id ? { ...p, row: null, x: 0, z: 0 } : p));
      setTimeout(saveAll, 0);
    }
    dragRef.current = null;
    setHoverRow(null);
    hudRef.current = { visible: false, x: 0, y: 0, text: '' };
    forceHud(x => x + 1);
  }, [findRowUnderPointer, proposePlacement, saveAll]);

  const cssEscapeUrl = (u) => u.replace(/"/g, '\\"');

  // Derived UI values
  const widthPx = cm2px(shelf.width);
  const heightPx = cm2px(totalShelfHeight);

  return (
    <div className="shelf-sim" style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'radial-gradient(1200px 600px at 70% -10%, #1b2230, #0f1115 60%)', color: '#e7ecf3' }}>
      <style>{`
        .shelf-sim * { box-sizing: border-box; }
        .shelf-sim header { display:flex; align-items:center; justify-content:space-between; padding:12px 16px; background: rgba(10,12,18,.7); backdrop-filter: blur(6px); border-bottom:1px solid #202739; position:sticky; top:0; z-index:50; }
        .shelf-sim header h1 { font-size:16px; margin:0; letter-spacing:.3px; font-weight:600; }
        .shelf-sim .actions { display:flex; gap:8px; align-items:center; }
        .shelf-sim .btn { cursor:pointer; border:1px solid #2b344a; background:#1a2030; color:#e7ecf3; padding:8px 10px; border-radius:10px; font-size:12px; line-height:1; }
        .shelf-sim .btn:hover { background:#232b40; }
        .shelf-sim .btn.good { border-color:#1a6146; background:#103226; }
        .shelf-sim .btn.bad { border-color:#5a2730; background:#2b1418; }
        .shelf-sim .app { display:grid; flex:1; min-height:0; transition: grid-template-columns .25s ease; grid-template-rows: 1fr; overflow:hidden; }
        .shelf-sim aside { background: linear-gradient(180deg, #121622, #0f121b); border-right:1px solid #1d2333; overflow:auto; }
        .shelf-sim aside.right { border-left:1px solid #1d2333; border-right:none; }
        .shelf-sim aside.collapsed { overflow:hidden; }
        .shelf-sim .section { padding:14px; border-bottom:1px dashed #232a3f; }
        .shelf-sim .section h3 { margin:0 0 8px; font-size:13px; color:#9aacbf; text-transform:uppercase; letter-spacing:.12em; }
        .shelf-sim .section-header { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; }
        .shelf-sim .section-header h3 { margin:0; }
        .shelf-sim .section-header-left { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
        .shelf-sim .section-header-left h3 { margin:0; }
        .shelf-sim label { display:block; font-size:12px; color:#a6b3c8; margin:8px 0 4px; }
        .shelf-sim input[type=number], .shelf-sim input[type=text], .shelf-sim select { width:100%; background:#0f141f; color:#e7ecf3; border:1px solid #22304a; padding:8px 10px; border-radius:10px; }
        .shelf-sim .row-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
        .shelf-sim .row-grid-3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; }
        .shelf-sim .list { display:grid; gap:8px; }
        .shelf-sim .type-card { background:#0f141f; border:1px solid #22304a; border-radius:12px; padding:10px; display:grid; grid-template-columns:46px 1fr auto; gap:10px; align-items:center; }
        .shelf-sim .swatch { width:46px; height:46px; border-radius:8px; border:1px solid #2a3a57; background:#333; background-size:cover; background-position:center; }
        .shelf-sim .type-title { font-size:13px; font-weight:600; }
        .shelf-sim .type-meta { font-size:11px; color:#9aacbf; }
        .shelf-sim main { position:relative; overflow:auto; min-width:0; }
        .shelf-sim #stage { position:relative; min-height:100%; padding:20px; }
        .shelf-sim .shelf-wrap { position:relative; margin:0 auto; display:inline-block; padding:18px 18px 26px; border-radius:18px; background: linear-gradient(180deg,#1c2436,#0d1017); box-shadow: 0 10px 40px rgba(0,0,0,.35), inset 0 0 0 1px #2a344a; }
        .shelf-sim .shelf { position:relative; background:#bbc6d9; border-radius:12px; overflow:visible; box-shadow: inset 0 -60px 120px rgba(0,0,0,.25), inset 0 30px 60px rgba(0,0,0,.18); background-image: linear-gradient(to bottom, rgba(255,255,255,.06), rgba(255,255,255,0)), radial-gradient(600px 70px at 50% 0%, rgba(0,0,0,.45), rgba(0,0,0,0) 70%), linear-gradient(to top, rgba(0,0,0,.35), rgba(0,0,0,.0) 70%); background-blend-mode: overlay, normal, normal; }
        .shelf-sim .shelf::before { content:''; position:absolute; inset:0; pointer-events:none; border-radius:12px; background: radial-gradient(120% 80% at 50% 0%, rgba(0,0,0,.55), rgba(0,0,0,0) 65%); }
        .shelf-sim .row { position:relative; width:100%; overflow:visible; }
        .shelf-sim .row .inner { position:absolute; left:0; right:0; bottom:0; top:0; padding-bottom:16px; }
        .shelf-sim .row .plane { position:absolute; left:0; right:0; bottom:0; height:28px; pointer-events:none; background:linear-gradient(to top, rgba(0,0,0,.42), rgba(0,0,0,.08)); border-bottom-left-radius:12px; border-bottom-right-radius:12px; }
        .shelf-sim .row .backshade { position:absolute; left:0; right:0; top:0; height:70%; pointer-events:none; background:linear-gradient(to bottom, rgba(0,0,0,.55), rgba(0,0,0,0)); border-top-left-radius:12px; border-top-right-radius:12px; }
        .shelf-sim .row .lip { position:absolute; left:0; right:0; bottom:0; height:10px; background: linear-gradient(to bottom, #9aa5b6, #7b8594); box-shadow: 0 6px 8px rgba(0,0,0,.35); border-bottom-left-radius:12px; border-bottom-right-radius:12px; }
        .shelf-sim .measure { position:absolute; right:8px; top:50%; transform:translateY(-50%); font-size:11px; color:#9aacbf; background:#0b0f17; border:1px solid #21304a; padding:4px 6px; border-radius:8px; }
        .shelf-sim .item { position:absolute; user-select:none; touch-action:none; cursor:grab; border-radius:6px; border:1px solid rgba(0,0,0,.35); background: linear-gradient(180deg, rgba(255,255,255,.18), rgba(255,255,255,0)), #6aa8ff; box-shadow: 0 10px 20px rgba(0,0,0,.35), 0 1px 0 rgba(255,255,255,.1) inset; overflow:hidden; }
        .shelf-sim .item.dragging { cursor:grabbing; box-shadow: 0 20px 40px rgba(0,0,0,.55), 0 0 0 2px rgba(255,255,255,.08) inset; }
        .shelf-sim .item .img { position:absolute; inset:0; background-size:cover; background-position:center; opacity:.95; mix-blend-mode:normal; }
        .shelf-sim .item .label { position:absolute; left:6px; bottom:6px; right:6px; background: rgba(10,12,18,.65); border:1px solid rgba(255,255,255,.1); font-size:10px; padding:3px 5px; border-radius:6px; text-overflow:ellipsis; white-space:nowrap; overflow:hidden; }
        .shelf-sim .pile { padding:10px; display:grid; gap:10px; grid-template-columns:repeat(2, minmax(90px, 1fr)); }
        .shelf-sim .pile .ghost { font-size:11px; color:#9aacbf; grid-column:1/-1; }
        .shelf-sim .hint { font-size:11px; color:#9aacbf; }
        .shelf-sim .divider { height:1px; background:#222a3d; margin:10px 0; border-radius:1px; }
        .shelf-sim .drag-hud { position:fixed; pointer-events:none; z-index:999999; background: rgba(12,16,24,.85); border:1px solid #2a3a57; color:#e7ecf3; padding:6px 8px; border-radius:8px; font-size:11px; transform: translate(-50%, -140%); white-space:pre; }
        .shelf-sim .row.highlight { outline:2px dashed rgba(103,212,255,.6); outline-offset:2px; }
        .shelf-sim .row.invalid { outline-color: rgba(255,93,115,.8); }
        .shelf-sim .toast { position:fixed; left:50%; transform:translateX(-50%); bottom:18px; background: rgba(13,16,24,.92); border:1px solid #2a3a57; padding:10px 12px; border-radius:10px; font-size:12px; z-index:100000; }
      `}</style>

      <header>
        <h1>🛒 Supermarket Shelf Space Simulator — <span>{status}</span></h1>
        <div className="actions">
          <button className="btn good" onClick={saveAll}>Save</button>
          <button className="btn bad" onClick={() => {
            if (!confirm('This clears ALL saved config, types, and items. Continue?')) return;
            localStorage.removeItem(LS_KEYS.CONFIG);
            localStorage.removeItem(LS_KEYS.TYPES);
            localStorage.removeItem(LS_KEYS.ITEMS);
            setScale(4); setShelf(defaultShelf); setTypes([]); setItems([]); setStatus('Ready');
          }}>Reset</button>
        </div>
      </header>

      <div
        className="app"
        style={{ gridTemplateColumns: `${leftCollapsed ? 28 : 320}px minmax(0,1fr) ${rightCollapsed ? 28 : 300}px` }}
      >
        <aside className={leftCollapsed ? 'collapsed' : ''}>
          {leftCollapsed && (
          <button
            aria-label={leftCollapsed ? 'Expand left panel' : 'Collapse left panel'}
            className="btn"
            onClick={() => setLeftCollapsed(v => !v)}
            style={{
              position: 'sticky', top: 8, zIndex: 5, margin: 0,
              width: 28, height: 28, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
            }}
            title={leftCollapsed ? 'Expand' : 'Collapse'}
          >
            {leftCollapsed ? '»' : '«'}
          </button>
          )}
          {!leftCollapsed && (
          <>
          <div className="section">
            <div className="section-header">
              <h3>Scale</h3>
              <button
                aria-label="Collapse left panel"
                className="btn"
                onClick={() => setLeftCollapsed(true)}
                title="Collapse"
                style={{ padding: '2px 8px', height: 24 }}
              >
                «
              </button>
            </div>
            <label>Pixels per centimeter</label>
            <input type="number" step={0.25} min={0.5} value={scale}
              onChange={e => { setScale(Math.max(0.5, Number(e.target.value) || 4)); setStatus('Edited'); }} />
            <div className="hint">All sizes use centimeters. Change this to zoom without breaking real‑world ratios.</div>
          </div>

          <div className="section">
            <h3>Shelf Config</h3>
            <div className="row-grid">
              <div>
                <label>Total Width (cm)</label>
                <input
                  type="number"
                  min={10}
                  value={widthInput}
                  onChange={e => setWidthInput(e.target.value)}
                  onBlur={() => {
                    const v = Math.max(10, Number(widthInput) || shelf.width);
                    if (v !== shelf.width) {
                      setShelf(s => ({ ...s, width: v }));
                      setStatus('Edited');
                      setTimeout(() => { validateAllItems(); saveAll(); }, 0);
                    } else {
                      setWidthInput(String(shelf.width));
                    }
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                />
              </div>
              <div>
                <label>Default Depth (cm)</label>
                <input
                  type="number"
                  min={5}
                  value={depthInput}
                  onChange={e => setDepthInput(e.target.value)}
                  onBlur={() => {
                    const d = Math.max(5, Number(depthInput) || majorityDepth());
                    // Apply to all rows on blur so it's actually customizable
                    setShelf(s => ({ ...s, rows: s.rows.map(r => ({ ...r, depth: d })) }));
                    setStatus('Edited');
                    setTimeout(() => { validateAllItems(); saveAll(); }, 0);
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                />
              </div>
            </div>
            <div className="row-grid">
              <div>
                <label>Row Count</label>
                <input
                  id="rowCount"
                  type="number"
                  min={1}
                  value={rowCountInput}
                  onChange={e => setRowCountInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                <button className="btn" style={{ width: '100%' }} onClick={() => {
                  const rc = Math.max(1, Number(rowCountInput) || 1);
                  const d = Math.max(5, Number(depthInput) || majorityDepth() || 50);
                  const hDefault = 40;
                  setShelf(s => ({ ...s, rows: Array.from({ length: rc }, () => ({ height: hDefault, depth: d })) }));
                  setStatus('Edited');
                  setTimeout(() => { validateAllItems(); saveAll(); }, 0);
                }}>Rebuild rows</button>
              </div>
            </div>
            <div className="divider"></div>
            <div className="list">
              {shelf.rows.map((row, idx) => (
                <div key={idx} className="type-card" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <div>
                    <div className="type-title">Row {idx + 1}</div>
                    <div className="type-meta">Height & Depth (cm)</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <input type="number" min={5} step={0.5} value={row.height}
                      onChange={e => {
                        const v = Math.max(1, Number(e.target.value) || 10);
                        setShelf(s => ({ ...s, rows: s.rows.map((r, i) => i === idx ? { ...r, height: v } : r) }));
                        setStatus('Edited');
                        setTimeout(() => { validateAllItems(); saveAll(); }, 0);
                      }} />
                    <input type="number" min={5} step={0.5} value={row.depth}
                      onChange={e => {
                        const v = Math.max(1, Number(e.target.value) || 10);
                        setShelf(s => ({ ...s, rows: s.rows.map((r, i) => i === idx ? { ...r, depth: v } : r) }));
                        setStatus('Edited');
                        setTimeout(() => { validateAllItems(); saveAll(); }, 0);
                      }} />
                  </div>
                  <div style={{ display: 'flex', gap: 6, gridColumn: '1 / -1', marginTop: 8 }}>
                    <button className="btn" onClick={() => {
                      const r = shelf.rows[idx];
                      setShelf(s => ({ ...s, rows: [...s.rows.slice(0, idx + 1), { height: r.height, depth: r.depth }, ...s.rows.slice(idx + 1)] }));
                      setStatus('Edited');
                      setTimeout(() => { validateAllItems(); saveAll(); }, 0);
                    }}>Copy</button>
                    <button className="btn bad" onClick={() => {
                      setShelf(s => {
                        const next = s.rows.slice();
                        next.splice(idx, 1);
                        return { ...s, rows: next.length ? next : [{ height: 40, depth: majorityDepth() }] };
                      });
                      setStatus('Edited');
                      setTimeout(() => { validateAllItems(); saveAll(); }, 0);
                    }}>Del</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="section">
            <h3>Create Product Type</h3>
            <div className="row-grid-3">
              <div>
                <label>Name</label>
                <input id="pName" type="text" placeholder="e.g., Cereal Box" />
              </div>
              <div>
                <label>W (cm)</label>
                <input id="pW" type="number" step={0.1} min={1} defaultValue={20} />
              </div>
              <div>
                <label>H (cm)</label>
                <input id="pH" type="number" step={0.1} min={1} defaultValue={30} />
              </div>
            </div>
            <div className="row-grid">
              <div>
                <label>D (cm)</label>
                <input id="pD" type="number" step={0.1} min={1} defaultValue={10} />
              </div>
              <div>
                <label>Color (fallback)</label>
                <input id="pColor" type="text" defaultValue="#6aa8ff" />
              </div>
            </div>
            <label>Image URL (optional)</label>
            <input id="pImg" type="text" placeholder="https://…" />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn good" style={{ flex: 1 }} onClick={() => {
                const name = String(document.getElementById('pName')?.value || 'Product').trim();
                const w = Number(document.getElementById('pW')?.value) || 10;
                const h = Number(document.getElementById('pH')?.value) || 10;
                const d = Number(document.getElementById('pD')?.value) || 5;
                if (w <= 0 || h <= 0 || d <= 0) return;
                const color = String(document.getElementById('pColor')?.value || '#6aa8ff');
                const img = String(document.getElementById('pImg')?.value || '').trim();
                setTypes(prev => [...prev, { id: uid(), name, w, h, d, color, img }]);
                setStatus('Edited');
                setTimeout(saveAll, 0);
              }}>Add Type</button>
              <button className="btn" onClick={() => {
                if (!confirm('Delete all product types?')) return;
                setItems(prev => prev.filter(it => false));
                setTypes([]);
                setTimeout(saveAll, 0); 
              }}>Clear Types</button>
            </div>
          </div>

          <div className="section">
            <h3>Product Library</h3>
            <div className="list">
              {!types.length && <div className="hint">No types yet. Create one above.</div>}
              {types.map(t => (
                <div key={t.id} className="type-card">
                  <div className="swatch" style={t.img ? { backgroundImage: `url('${cssEscapeUrl(t.img)}')` } : { background: t.color }} />
                  <div>
                    <div className="type-title">{t.name}</div>
                    <div className="type-meta">{t.w}×{t.h}×{t.d} cm</div>
                  </div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <button className="btn" onClick={() => {
                      const typeId = t.id;
                      setItems(prev => [...prev, { id: uid(), typeId, row: null, x: 0, z: 0 }]);
                      setTimeout(saveAll, 0);
                    }}>Spawn</button>
                    <button className="btn bad" onClick={() => {
                      if (!confirm('Remove this type? Existing items of this type will also be removed.')) return;
                      setItems(prev => prev.filter(it => it.typeId !== t.id));
                      setTypes(prev => prev.filter(x => x.id !== t.id));
                      setTimeout(saveAll, 0);
                    }}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="hint">Tap <b>Spawn</b> to add an instance to the unshelved pile (right). Drag it into a row. If it doesn't fit, the drop is rejected.</div>
          </div>
          </>
          )}
        </aside>

        <main>
          <div id="stage">
            <div className="shelf-wrap">
              <div className="shelf" style={{ width: `${widthPx}px`, height: `${heightPx}px`, position: 'relative' }}>
                {shelf.rows.map((row, idx) => (
                  <div
                    key={idx}
                    ref={el => rowsRef.current.set(idx, el)}
                    className={`row ${hoverRow && hoverRow.index === idx ? 'highlight' : ''} ${hoverRow && hoverRow.index === idx && hoverRow.invalid ? 'invalid' : ''}`}
                    style={{ height: `${cm2px(row.height)}px` }}
                  >
                    <div className="inner">
                      <div className="backshade"></div>
                      <div className="plane"></div>
                      <div className="lip"></div>
                      <div className="measure">{shelf.width}cm · {row.height}cm / {row.depth}cm</div>
                    </div>
                    {items.filter(it => it.row === idx).map(it => {
                      const t = types.find(tt => tt.id === it.typeId);
                      if (!t) return null;
                      const w = cm2px(t.w), h = cm2px(t.h);
                      const left = cm2px(it.x);
                      const top = cm2px(row.height) - h;
                      const brightness = 1 - 0.4 * clamp(it.z / Math.max(1, row.depth), 0, 1);
                      const zLayer = 10000 - Math.floor(it.z * 10);
                      return (
                        <div
                          key={it.id}
                          ref={el => itemNodesRef.current.set(it.id, el)}
                          className="item"
                          style={{ width: `${w}px`, height: `${h}px`, left: `${left}px`, top: `${top}px`, filter: `brightness(${brightness.toFixed(3)})`, zIndex: 100000 + idx * 10000 + zLayer }}
                          onPointerDown={e => onPointerDownItem(e, it)}
                          onPointerMove={e => onPointerMoveItem(e, it)}
                          onPointerUp={e => onPointerUpItem(e, it)}
                        >
                          <div className="img" style={t.img ? { backgroundImage: `url('${cssEscapeUrl(t.img)}')` } : { background: t.color }} />
                          <div className="label">{t.name} — {t.w}×{t.h}×{t.d}cm</div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>

        <aside className={`right ${rightCollapsed ? 'collapsed' : ''}`}>
          {rightCollapsed && (
          <button
            aria-label={rightCollapsed ? 'Expand right panel' : 'Collapse right panel'}
            className="btn"
            onClick={() => setRightCollapsed(v => !v)}
            style={{
              position: 'sticky', top: 8, zIndex: 5, margin: 0,
              width: 28, height: 28, padding: 0, float: 'right', display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
            }}
            title={rightCollapsed ? 'Expand' : 'Collapse'}
          >
            {rightCollapsed ? '«' : '»'}
          </button>
          )}
          {!rightCollapsed && (
          <div className="section">
            <div className="section-header-left">
              <button
                aria-label="Collapse right panel"
                className="btn"
                onClick={() => setRightCollapsed(true)}
                title="Collapse"
                style={{ padding: '2px 8px', height: 24 }}
              >
                »
              </button>
              <h3>Unshelved Pile</h3>
            </div>
            <div className="pile">
              {items.filter(it => it.row === null).length === 0 && (
                <div className="ghost">No items in the pile.</div>
              )}
              {items.filter(it => it.row === null).map(it => {
                const t = types.find(tt => tt.id === it.typeId);
                if (!t) return null;
                const w = Math.max(60, Math.min(130, cm2px(t.w)));
                const h = Math.max(36, Math.min(160, cm2px(t.h)));
                return (
                  <div key={it.id} style={{ position: 'relative', height: `${h}px` }}>
                    <div
                      ref={el => itemNodesRef.current.set(it.id, el)}
                      className="item"
                      style={{ position: 'absolute', left: 0, top: 0, width: `${w}px`, height: `${h}px`, zIndex: 1000000 }}
                      onPointerDown={e => onPointerDownItem(e, it)}
                      onPointerMove={e => onPointerMoveItem(e, it)}
                      onPointerUp={e => onPointerUpItem(e, it)}
                    >
                      <div className="img" style={t.img ? { backgroundImage: `url('${cssEscapeUrl(t.img)}')` } : { background: t.color }} />
                      <div className="label">{t.name}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="hint">Drop outside the shelf to return an item here.</div>
          </div>
          )}
        </aside>
      </div>

      {hudRef.current.visible && (
        <div className="drag-hud" style={{ left: `${hudRef.current.x}px`, top: `${hudRef.current.y}px` }}>{hudRef.current.text}</div>
      )}
      {!!toast && <div className="toast">{toast}</div>}
    </div>
  );
};

export default App;
