import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, useDraggable, useDroppable } from '@dnd-kit/core';
import RowConfigPanel from './planogram/RowConfigPanel.jsx';

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
  // dnd-kit state
  const [activeId, setActiveId] = useState(null);
  const [clientPos, setClientPos] = useState({ x: 0, y: 0 });
  const [selectedId, setSelectedId] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);

  // Keep side panels exclusive
  useEffect(() => { if (panelOpen) setRightCollapsed(true); }, [panelOpen]);
  useEffect(() => { if (!rightCollapsed && panelOpen) setPanelOpen(false); }, [rightCollapsed, panelOpen]);

  const cm2px = useCallback((cm) => cm * scale, [scale]);
  const px2cm = useCallback((px) => px / scale, [scale]);

  // Effective dimensions of an item considering rotation
  const getDims = useCallback((item) => {
    const t = types.find(tt => tt.id === item.typeId);
    if (!t) return { w: 0, h: 0, d: 0 };
    return item?.rot ? { w: t.h, h: t.w, d: t.d } : { w: t.w, h: t.h, d: t.d };
  }, [types]);

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
    const dms = getDims(item);
    if (dms.h > row.height) return false;
    if (dms.w > shelf.width) return false;
    if (dms.d > row.depth) return false;
    if (x < 0 || z < 0) return false;
    if (x + dms.w > shelf.width) return false;
    if (z + dms.d > row.depth) return false;
    const target = { x1: x, x2: x + dms.w, z1: z, z2: z + dms.d };
    const groupId = item.group || null;
    for (const other of items) {
      if (other.id === item.id) continue; if (other.row !== rowIndex) continue;
      const od = getDims(other);
      const r = { x1: other.x, x2: other.x + od.w, z1: other.z, z2: other.z + od.d };
      if (rectOverlap(target, r)) {
        // Allow vertical stacking if same group and exact same cell (x,z),
        // as long as total stacked height fits within the row height.
        if (groupId && other.group === groupId) {
          const eps = 1e-6;
          const sameCell = Math.abs(other.x - x) < eps && Math.abs(other.z - z) < eps && Math.abs(od.w - dms.w) < eps && Math.abs(od.d - dms.d) < eps;
          if (sameCell) {
            const maxLayers = Math.floor((row.height + 1e-6) / dms.h);
            // count existing layers at this cell (exclude the candidate item itself)
            let layers = 0;
            for (const it of items) {
              if (it.id === item.id) continue;
              if (it.row !== rowIndex) continue;
              if (it.group !== groupId) continue;
              const dt = getDims(it);
              if (Math.abs(it.x - x) < eps && Math.abs(it.z - z) < eps && Math.abs(dt.w - dms.w) < eps && Math.abs(dt.d - dms.d) < eps) {
                layers++;
              }
            }
            if (layers + 1 <= maxLayers) continue; // stacking allowed here
          }
        }
        return false;
      }
    }
    return true;
  }, [getDims, items, shelf.rows, shelf.width, types]);

  // Compute the nearest available depth (z) position for an item at x-range without overlapping others
  const findAvailableZ = useCallback((rowIndex, x, wCm, dCm, excludeId) => {
    const row = shelf.rows[rowIndex]; if (!row) return null;
    const x1 = x, x2 = x + wCm;
    // Collect occupied depth segments for items that overlap in x-range
    const occ = [];
    for (const it of items) {
      if (excludeId && it.id === excludeId) continue;
      if (it.row !== rowIndex) continue;
      const d = getDims(it);
      const ox1 = it.x, ox2 = it.x + d.w;
      const overlapX = !(x2 <= ox1 || x1 >= ox2);
      if (!overlapX) continue;
      occ.push([it.z, it.z + d.d]);
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
  }, [getDims, items, shelf.rows]);

  const proposePlacement = useCallback((item, rowInfo, clientX, clientY) => {
    const t = types.find(tt => tt.id === item.typeId); if (!t) return { valid: false, rowIndex: rowInfo.index, x: 0, z: 0 };
    const { rect, index } = rowInfo;
    const localXpx = clamp(clientX - rect.left, 0, rect.width);
    const dms = getDims(item);
    // Center under cursor horizontally and clamp within shelf width
    let x = px2cm(localXpx) - dms.w / 2; x = clamp(x, 0, shelf.width - dms.w);

    // If item has a group, try to snap onto an existing group's cell to allow stacking
    let z = null;
    const eps = 1e-6;
    const groupId = item.group || null;
    if (groupId) {
      // Find any existing cell for this group with matching dims, closest in x
      let best = null;
      for (const it of items) {
        if (it.row !== index) continue;
        if (it.group !== groupId) continue;
        const dt = getDims(it);
        if (Math.abs(dt.w - dms.w) > eps || Math.abs(dt.d - dms.d) > eps) continue;
        // Consider this cell at (it.x, it.z)
        const dx = Math.abs(it.x - x);
        if (!best || dx < best.dx) best = { x: it.x, z: it.z, dx };
      }
      if (best) {
        // Count existing layers at this cell
        let layers = 0;
        for (const it of items) {
          if (it.row !== index) continue;
          if (it.group !== groupId) continue;
          const dt = getDims(it);
          if (Math.abs(it.x - best.x) < eps && Math.abs(it.z - best.z) < eps && Math.abs(dt.w - dms.w) < eps && Math.abs(dt.d - dms.d) < eps) {
            layers++;
          }
        }
        const maxLayers = Math.floor((rowInfo.row.height + 1e-6) / dms.h);
        if (layers < maxLayers) {
          // Snap x to the group's cell x, keep z the same to stack
          x = best.x;
          z = best.z;
        }
      }
    }

    // Choose a depth that respects existing items at this x-range if not stacking onto same cell
    if (z == null) {
      z = findAvailableZ(index, x, dms.w, dms.d, item.id);
    }
    if (z == null) {
      // Fallback to pointer-derived depth within limits
      const localYpx = clamp(clientY - rect.top, 0, rect.height);
      const fromBottom = rect.height - localYpx; // px from front edge
      z = clamp(px2cm(fromBottom) - dms.d / 2, 0, rowInfo.row.depth - dms.d);
    }

    const valid = fitsInRow(item, index, x, z);
    return { valid, rowIndex: index, x, z };
  }, [findAvailableZ, fitsInRow, getDims, px2cm, shelf.width, types]);

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
      const dms = getDims(it);
      text = `Row ${rowInfo.index + 1} · x:${prop.x.toFixed(1)}cm z:${prop.z.toFixed(1)}cm ${prop.valid ? '✅ fits' : '❌ no fit'}\nRow depth:${rowInfo.row.depth}cm Item d:${dms.d}cm`;
      invalid = !prop.valid;
      setHoverRow({ index: rowInfo.index, invalid });
    } else {
      setHoverRow(null);
    }
    hudRef.current = { visible: true, x: e.clientX, y: e.clientY, text };
    forceHud(x => x + 1);
  }, [findRowUnderPointer, proposePlacement, getDims]);

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

  // Toggle item rotation (double‑click). Ensures rotated item still fits where placed.
  const toggleRotate = useCallback((it) => {
    const cur = items.find(x => x.id === it.id);
    if (!cur) return;
    const nextRot = !cur.rot;
    if (cur.row == null) {
      setItems(prev => prev.map(p => p.id === it.id ? { ...p, rot: nextRot } : p));
      setStatus('Edited');
      setTimeout(saveAll, 0);
      return;
    }
    const rotated = { ...cur, rot: nextRot };
    const dms = getDims(rotated);
    let x = clamp(rotated.x, 0, shelf.width - dms.w);
    let z = rotated.z;
    if (!fitsInRow(rotated, rotated.row, x, z)) {
      const bestZ = findAvailableZ(rotated.row, x, dms.w, dms.d, rotated.id);
      if (bestZ == null || !fitsInRow(rotated, rotated.row, x, bestZ)) {
        setToast("❌ Doesn't fit after rotation");
        setTimeout(() => setToast(''), 1600);
        return;
      }
      z = bestZ;
    }
    setItems(prev => prev.map(p => p.id === it.id ? { ...p, rot: nextRot, x, z } : p));
    setStatus('Edited');
    setTimeout(saveAll, 0);
  }, [findAvailableZ, fitsInRow, getDims, items, saveAll, shelf.width]);

  // dnd-kit drag handlers
  const onDragStart = useCallback((event) => {
    const { active } = event;
    setActiveId(active?.id || null);
    if (active?.id) { setSelectedId(active.id); setPanelOpen(true); }
    hudRef.current = { visible: true, x: clientPos.x, y: clientPos.y, text: 'Drag an item into a row' };
    forceHud(x => x + 1);
  }, [clientPos.x, clientPos.y]);

  const onDragMove = useCallback((event) => {
    const { active, over } = event;
    if (!active) return;
    const it = items.find(i => i.id === active.id);
    if (!it) return;

    let text = 'Drag an item into a row';
    let invalid = false;
    if (over && typeof over.id === 'string' && over.id.startsWith('row-')) {
      const index = Number(over.id.slice(4));
      const el = rowsRef.current.get(index);
      if (el) {
        const rect = el.getBoundingClientRect();
        const rowInfo = { index, el, rect, row: shelf.rows[index] };
        const prop = proposePlacement(it, rowInfo, clientPos.x, clientPos.y);
        const dms = getDims(it);
        text = `Row ${index + 1} · x:${prop.x.toFixed(1)}cm z:${prop.z.toFixed(1)}cm ${prop.valid ? '✅ fits' : '❌ no fit'}\nRow depth:${rowInfo.row.depth}cm Item d:${dms.d}cm`;
        invalid = !prop.valid;
        setHoverRow({ index, invalid });
      }
    } else {
      setHoverRow(null);
    }
    hudRef.current = { visible: true, x: clientPos.x, y: clientPos.y, text };
    forceHud(x => x + 1);
  }, [clientPos.x, clientPos.y, getDims, items, proposePlacement, shelf.rows]);

  const onDragEnd = useCallback((event) => {
    const { active, over } = event;
    const it = items.find(i => i.id === active?.id);
    if (it && over && typeof over.id === 'string' && over.id.startsWith('row-')) {
      const index = Number(over.id.slice(4));
      const el = rowsRef.current.get(index);
      if (el) {
        const rect = el.getBoundingClientRect();
        const rowInfo = { index, el, rect, row: shelf.rows[index] };
        const prop = proposePlacement(it, rowInfo, clientPos.x, clientPos.y);
        if (prop.valid) {
          setItems(prev => prev.map(p => p.id === it.id ? { ...p, row: prop.rowIndex, x: prop.x, z: prop.z } : p));
          setStatus('Edited');
          setTimeout(saveAll, 0);
        } else {
          setToast("❌ Doesn't fit there");
          setTimeout(() => setToast(''), 1600);
        }
      }
    } else if (it) {
      // Drop to pile
      setItems(prev => prev.map(p => p.id === it.id ? { ...p, row: null, x: 0, z: 0 } : p));
      setTimeout(saveAll, 0);
    }
    setActiveId(null);
    setHoverRow(null);
    hudRef.current = { visible: false, x: 0, y: 0, text: '' };
    forceHud(x => x + 1);
  }, [clientPos.x, clientPos.y, items, proposePlacement, saveAll, shelf.rows]);

  const cssEscapeUrl = (u) => u.replace(/"/g, '\\"');

  // Derived UI values
  const widthPx = cm2px(shelf.width);
  const heightPx = cm2px(totalShelfHeight);

  const selectedItem = useMemo(() => items.find(i => i.id === selectedId) || null, [items, selectedId]);
  const selectedDims = useMemo(() => selectedItem ? getDims(selectedItem) : null, [selectedItem, getDims]);
  const selectedShelfDims = useMemo(() => {
    if (!selectedItem) return null;
    const row = selectedItem.row != null ? shelf.rows[selectedItem.row] : shelf.rows[0];
    if (!row) return null;
    return { width: shelf.width, height: row.height, depth: row.depth };
  }, [selectedItem, shelf.rows, shelf.width]);

  // Arrange-and-place helper: duplicates items per config and places as a block
  const arrangeAndPlace = useCallback((baseItem, cfg) => {
    const d = getDims(baseItem);
    const gapCm = (cfg.gapPx || 0) / Math.max(0.0001, scale);
    const usedW = cfg.facing * d.w + (cfg.facing - 1) * gapCm;
    const usedD = cfg.capacity * d.d;
    const usedH = cfg.stack * d.h;

    // Candidate rows that can fit the whole arrangement
    const candidates = shelf.rows
      .map((r, idx) => ({ r, idx }))
      .filter(({ r }) => usedH <= r.height + 1e-6 && usedD <= r.depth + 1e-6 && usedW <= shelf.width + 1e-6)
      .map(x => x.idx);
    if (!candidates.length) {
      setToast('No shelf row fits this configuration');
      setTimeout(() => setToast(''), 1600);
      return false;
    }

    // Prefer current row if set
    const ordered = baseItem.row != null && candidates.includes(baseItem.row)
      ? [baseItem.row, ...candidates.filter(i => i !== baseItem.row)] : candidates;

    let placed = null;
    for (const rowIndex of ordered) {
      // Scan x positions
      const maxX = Math.max(0, shelf.width - usedW);
      for (let x0 = 0; x0 <= maxX + 1e-6; x0 += 1) {
        // Use arrangement block to find a free depth slot
        const z0 = findAvailableZ(rowIndex, x0, usedW, usedD, null);
        if (z0 == null) continue;
        // Found anchor top-left (x0, z0)
        placed = { rowIndex, x0, z0 };
        break;
      }
      if (placed) break;
    }

    if (!placed) {
      setToast('No free space found for this configuration');
      setTimeout(() => setToast(''), 1600);
      return false;
    }

    const { rowIndex, x0, z0 } = placed;
    const clones = [];
    for (let c = 0; c < cfg.capacity; c++) {
      for (let f = 0; f < cfg.facing; f++) {
        for (let s = 0; s < cfg.stack; s++) {
          const xi = x0 + f * (d.w + (f > 0 ? gapCm : 0));
          const zi = z0 + c * d.d;
          clones.push({ xi, zi, s });
        }
      }
    }

    setItems(prev => {
      const groupId = baseItem.group || baseItem.id;
      // Remove previous clones from the same group (keep none)
      const withoutGroup = prev.filter(p => (p.group || p.id) !== groupId || p.id === baseItem.id);
      const base = withoutGroup.find(p => p.id === baseItem.id);
      const rest = withoutGroup.filter(p => p.id !== baseItem.id);

      const newItems = [];
      clones.forEach((cl, idx) => {
        if (idx === 0 && base) {
          newItems.push({ ...base, group: groupId, arr: cfg, row: rowIndex, x: cl.xi, z: cl.zi, s: cl.s });
        } else {
          newItems.push({ id: uid(), group: groupId, typeId: baseItem.typeId, rot: baseItem.rot, arr: cfg, row: rowIndex, x: cl.xi, z: cl.zi, s: cl.s });
        }
      });
      const next = [...rest, ...newItems];
      return next;
    });

    setStatus('Edited');
    setTimeout(saveAll, 0);
    setToast(`Placed ${cfg.facing * cfg.capacity * cfg.stack} unit(s)`);
    setTimeout(() => setToast(''), 1200);
    return true;
  }, [findAvailableZ, getDims, saveAll, scale, shelf.rows, shelf.width]);

  // Arrange items of chosen type on a specific row based on configuration
  const arrangeOnRow = useCallback((rowIndex, typeId, cfg) => {
    const t = types.find(tt => tt.id === typeId);
    const row = shelf.rows[rowIndex];
    if (!t || !row) return false;
    const d = { w: t.w, h: t.h, d: t.d };
    const gapCm = (cfg.gapPx || 0) / Math.max(0.0001, scale);

    const existing = items.filter(it => it.row === rowIndex && it.typeId === typeId);

    // Helper to test if a candidate unit fits considering collisions
    const canPlaceAt = (x, z, group) => {
      const dummy = { id: 'tmp', typeId, rot: false, group };
      return fitsInRow(dummy, rowIndex, x, z);
    };

    // If there are existing items of this type on the row, extend them
    if (existing.length > 0) {
      const minX = Math.min(...existing.map(e => e.x));
      const minZ = Math.min(...existing.map(e => e.z));
      const stepX = d.w + gapCm;
      const stepZ = d.d;
      // Choose most common group to extend; if none, create one
      const freq = new Map();
      for (const e of existing) { if (e.group) freq.set(e.group, (freq.get(e.group) || 0) + 1); }
      let groupId = null;
      if (freq.size) {
        groupId = Array.from(freq.entries()).sort((a,b)=>b[1]-a[1])[0][0];
      } else {
        groupId = uid();
      }
      // Build a set of occupied x|z|s for this type on row
      const occ = new Set(existing.map(e => `${e.x.toFixed(3)}|${e.z.toFixed(3)}|${Number(e.s||0)}`));

      const additions = [];
      for (let f = 0; f < cfg.facing; f++) {
        const x = minX + f * stepX;
        if (x + d.w > shelf.width + 1e-6) break;
        for (let c = 0; c < cfg.capacity; c++) {
          const z = minZ + c * stepZ;
          if (z + d.d > row.depth + 1e-6) break;
          for (let s = 0; s < cfg.stack; s++) {
            const key = `${x.toFixed(3)}|${z.toFixed(3)}|${s}`;
            if (occ.has(key)) continue; // already present
            if (!canPlaceAt(x, z, groupId)) continue; // collision with others
            additions.push({ id: uid(), group: groupId, typeId, rot: false, arr: cfg, row: rowIndex, x, z, s });
            occ.add(key);
          }
        }
      }

      if (additions.length === 0) {
        setToast('No space to extend on this row');
        setTimeout(() => setToast(''), 1200);
        return false;
      }

      setItems(prev => prev.map(it => {
        if (it.row === rowIndex && it.typeId === typeId) {
          // unify under chosen group to allow stacking overlap rules
          return { ...it, group: it.group || groupId, arr: it.arr || cfg };
        }
        return it;
      }).concat(additions));
      setStatus('Edited');
      setTimeout(saveAll, 0);
      setToast(`Added ${additions.length} unit(s)`);
      setTimeout(() => setToast(''), 1200);
      return true;
    }

    // Otherwise, place a new block at first free spot (original behavior)
    const usedW = cfg.facing * d.w + (cfg.facing - 1) * gapCm;
    const usedD = cfg.capacity * d.d;
    const usedH = cfg.stack * d.h;
    if (usedW > shelf.width + 1e-6 || usedD > row.depth + 1e-6 || usedH > row.height + 1e-6) {
      setToast('Configuration exceeds shelf bounds');
      setTimeout(() => setToast(''), 1600);
      return false;
    }
    let placed = null;
    const maxX = Math.max(0, shelf.width - usedW);
    for (let x0 = 0; x0 <= maxX + 1e-6; x0 += 1) {
      const z0 = findAvailableZ(rowIndex, x0, usedW, usedD, null);
      if (z0 == null) continue;
      placed = { x0, z0 };
      break;
    }
    if (!placed) {
      setToast('No free space found on this row');
      setTimeout(() => setToast(''), 1600);
      return false;
    }
    const { x0, z0 } = placed;
    const groupId = uid();
    const newItems = [];
    for (let c = 0; c < cfg.capacity; c++) {
      for (let f = 0; f < cfg.facing; f++) {
        for (let s = 0; s < cfg.stack; s++) {
          const xi = x0 + f * (d.w + (f > 0 ? gapCm : 0));
          const zi = z0 + c * d.d;
          newItems.push({ id: uid(), group: groupId, typeId, rot: false, arr: cfg, row: rowIndex, x: xi, z: zi, s });
        }
      }
    }
    setItems(prev => [...prev, ...newItems]);
    setStatus('Edited');
    setTimeout(saveAll, 0);
    setToast(`Placed ${cfg.facing * cfg.capacity * cfg.stack} unit(s)`);
    setTimeout(() => setToast(''), 1200);
    return true;
  }, [findAvailableZ, fitsInRow, items, saveAll, scale, shelf.rows, shelf.width, types]);

  return (
    <div className={`shelf-sim ${panelOpen ? 'panel-open' : ''}`} style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'radial-gradient(1200px 600px at 70% -10%, #1b2230, #0f1115 60%)', color: '#e7ecf3' }} onMouseMoveCapture={(e) => setClientPos({ x: e.clientX, y: e.clientY })}>
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
        /* When auto-configure panel is open, ensure pile items don't overlay */
        .shelf-sim.panel-open .pile .item { z-index: 1 !important; pointer-events: none; opacity: .7; }
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

      <DndContext onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd}>
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
                  <RowDroppable
                    key={idx}
                    idx={idx}
                    className={`row ${hoverRow && hoverRow.index === idx ? 'highlight' : ''} ${hoverRow && hoverRow.index === idx && hoverRow.invalid ? 'invalid' : ''}`}
                    style={{ height: `${cm2px(row.height)}px` }}
                    setRowEl={(el) => rowsRef.current.set(idx, el)}
                    onBackgroundClick={(rowIndex) => { setSelectedRow(rowIndex); setPanelOpen(true); }}
                  >
                    <div className="backshade"></div>
                    <div className="plane"></div>
                    <div className="lip"></div>
                    <div className="measure">{shelf.width}cm · {row.height}cm / {row.depth}cm</div>
                    {items.filter(it => it.row === idx).map(it => {
                      const t = types.find(tt => tt.id === it.typeId);
                      if (!t) return null;
                      const dms = getDims(it);
                      const w = cm2px(dms.w), h = cm2px(dms.h);
                      const left = cm2px(it.x);
                      const stackIndex = Number(it.s || 0);
                      const top = cm2px(row.height - (stackIndex + 1) * dms.h);
                      const brightness = 1 - 0.4 * clamp(it.z / Math.max(1, row.depth), 0, 1);
                      const zLayer = 10000 - Math.floor(it.z * 10);
                      return (
                        <DraggableItem
                          key={it.id}
                          it={it}
                          dims={{ w, h, left, top }}
                          styleExtra={{ filter: `brightness(${brightness.toFixed(3)})`, zIndex: 100000 + idx * 10000 + zLayer + stackIndex }}
                          onDoubleClick={() => toggleRotate(it)}
                        >
                          <div className="img" style={t.img ? { backgroundImage: `url('${cssEscapeUrl(t.img)}')` } : { background: t.color }} />
                          <div className="label">{t.name} — {dms.w}×{dms.h}×{dms.d}cm {it.rot ? '(rot)' : ''}</div>
                        </DraggableItem>
                      );
                    })}
                  </RowDroppable>
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
                const dms = getDims(it);
                const w = Math.max(60, Math.min(130, cm2px(dms.w)));
                const h = Math.max(36, Math.min(160, cm2px(dms.h)));
                return (
                  <div key={it.id} style={{ position: 'relative', height: `${h}px` }}>
                    <DraggableItem
                      it={it}
                      dims={{ w, h, left: 0, top: 0 }}
                      styleExtra={{ position: 'absolute', left: 0, top: 0, zIndex: 1000000 }}
                      onDoubleClick={() => toggleRotate(it)}
                    >
                      <div className="img" style={t.img ? { backgroundImage: `url('${cssEscapeUrl(t.img)}')` } : { background: t.color }} />
                      <div className="label">{t.name} {it.rot ? '(rot)' : ''}</div>
                    </DraggableItem>
                  </div>
                );
              })}
            </div>
            <div className="hint">Drop outside the shelf to return an item here.</div>
          </div>
          )}
        </aside>
      </div>
      </DndContext>

      {hudRef.current.visible && (
        <div className="drag-hud" style={{ left: `${hudRef.current.x}px`, top: `${hudRef.current.y}px` }}>{hudRef.current.text}</div>
      )}
      {!!toast && <div className="toast">{toast}</div>}
      {panelOpen && selectedRow != null && (
        <RowConfigPanel
          open={panelOpen}
          types={types}
          initialTypeId={types[0]?.id}
          initial={{ facing: 1, gapPx: 0, capacity: 1, stack: 1 }}
          shelfDims={{ width: shelf.width, height: shelf.rows[selectedRow]?.height || 0, depth: shelf.rows[selectedRow]?.depth || 0 }}
          pxPerCm={scale}
          onApply={({ cfg, typeId }) => { arrangeOnRow(selectedRow, typeId, cfg); setPanelOpen(false); setSelectedRow(null); }}
          onCancel={() => { setPanelOpen(false); setSelectedRow(null); }}
        />
      )}
    </div>
  );
};

// Row droppable wrapper
function RowDroppable({ idx, children, className, style, setRowEl, onBackgroundClick }) {
  const { setNodeRef } = useDroppable({ id: `row-${idx}` });
  const refCb = useCallback((el) => {
    setNodeRef(el);
    setRowEl?.(el);
  }, [setNodeRef, setRowEl]);
  const handleClick = useCallback((e) => {
    if (e.target.closest && e.target.closest('.item')) return;
    onBackgroundClick?.(idx);
  }, [idx, onBackgroundClick]);
  return (
    <div className={className} style={style}>
      <div className="inner" ref={refCb} onClickCapture={handleClick}>
        {children}
      </div>
    </div>
  );
}

// Draggable item wrapper
function DraggableItem({ it, dims, styleExtra, onDoubleClick, onClick, children }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: it.id });
  const style = {
    width: `${dims.w}px`,
    height: `${dims.h}px`,
    left: `${dims.left}px`,
    top: `${dims.top}px`,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    ...(styleExtra || {})
  };
  const cls = `item${isDragging ? ' dragging' : ''}`;
  return (
    <div ref={setNodeRef} className={cls} style={style} {...listeners} {...attributes} onDoubleClick={onDoubleClick} onClick={onClick}>
      {children}
    </div>
  );
}

export default App;
