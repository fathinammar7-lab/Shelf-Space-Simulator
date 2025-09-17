export function sanitizeConfig(c) {
  return {
    facing: Math.max(1, Math.floor(Number(c.facing) || 1)),
    gapPx: Math.max(0, Math.floor(Number(c.gapPx) || 0)),
    capacity: Math.max(1, Math.floor(Number(c.capacity) || 1)),
    stack: Math.max(1, Math.floor(Number(c.stack) || 1)),
  };
}

export function computeMetrics(cfg, product, shelf, pxPerCm) {
  const gapCm = cfg.gapPx / Math.max(0.0001, pxPerCm);
  const usedWcm = cfg.facing * product.w + (cfg.facing - 1) * gapCm;
  const usedHcm = cfg.stack * product.h;
  const usedDcm = cfg.capacity * product.d;

  return {
    usedWcm,
    usedHcm,
    usedDcm,
    totalUnits: cfg.facing * cfg.capacity * cfg.stack,
    validW: usedWcm <= shelf.width + 1e-6,
    validH: usedHcm <= shelf.height + 1e-6,
    validD: usedDcm <= shelf.depth + 1e-6,
  };
}

