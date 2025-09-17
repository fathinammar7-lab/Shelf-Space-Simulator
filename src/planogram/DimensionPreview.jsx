import React, { useMemo } from 'react';

export default function DimensionPreview({ cfg, product, shelf, pxPerCm, ariaLabel }) {
  const gapCm = cfg.gapPx / Math.max(0.0001, pxPerCm);
  const box = useMemo(() => ({
    wPx: shelf.width * pxPerCm,
    dPx: shelf.depth * pxPerCm,
  }), [shelf.width, shelf.depth, pxPerCm]);

  const unit = useMemo(() => ({
    wPx: product.w * pxPerCm,
    dPx: product.d * pxPerCm,
  }), [product.w, product.d, pxPerCm]);

  const gapPx = gapCm * pxPerCm; // equals cfg.gapPx

  const rects = useMemo(() => {
    const r = [];
    for (let c = 0; c < cfg.capacity; c++) {
      for (let f = 0; f < cfg.facing; f++) {
        const x = f * (unit.wPx + (f > 0 ? gapPx : 0));
        const y = c * unit.dPx;
        r.push({ x, y, w: unit.wPx, h: unit.dPx, key: `${c}-${f}` });
      }
    }
    return r;
  }, [cfg.capacity, cfg.facing, gapPx, unit.wPx, unit.dPx]);

  return (
    <div aria-label={ariaLabel} role="img" style={{
      border: '1px solid #22304a',
      background: '#0f141f',
      borderRadius: 10,
      padding: 8,
    }}>
      <div style={{ position: 'relative', width: Math.max(220, box.wPx), height: Math.max(120, box.dPx), background: '#131a28', border: '1px solid #22304a', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.03), rgba(255,255,255,0.03) 1px, transparent 1px, transparent 16px)' }} />
        {rects.map(r => (
          <div key={r.key} style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, background: 'linear-gradient(180deg, rgba(255,255,255,.18), rgba(255,255,255,0)), #6aa8ff', border: '1px solid rgba(0,0,0,.35)', borderRadius: 4 }} />
        ))}
        <div style={{ position: 'absolute', right: 8, top: 8, background: '#0b0f17', border: '1px solid #22304a', color: '#9aacbf', fontSize: 11, borderRadius: 8, padding: '3px 6px' }} aria-label={`Stack count ${cfg.stack}`}>
          Stack × {cfg.stack}
        </div>
      </div>
    </div>
  );
}

