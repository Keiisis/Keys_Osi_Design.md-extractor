/**
 * Reproduction fidelity scoring — structural similarity (SSIM) between
 * two screenshots (the original site and a reproduction). This is the
 * feature nobody else offers: a measured "how close is my rebuild" score.
 *
 * Pure JS, works on grayscale pixel arrays. Decoding PNG → pixels and
 * resizing to a common size happens in the offscreen document
 * (OffscreenCanvas); this module does the math so it is unit-testable.
 */

/** RGBA Uint8-ish array → Float64 grayscale (Rec. 601 luma). */
export function toGrayscale(rgba, width, height) {
  const out = new Float64Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  }
  return out;
}

/**
 * Windowed SSIM between two equal-size grayscale images.
 * Returns a score in [0, 1] (1 = identical).
 */
export function ssim(a, b, width, height, windowSize = 8) {
  if (a.length !== b.length || a.length !== width * height) {
    throw new Error("SSIM inputs must be equal-size grayscale arrays.");
  }
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  const step = windowSize;
  let total = 0;
  let count = 0;

  for (let y = 0; y + windowSize <= height; y += step) {
    for (let x = 0; x + windowSize <= width; x += step) {
      let sumA = 0;
      let sumB = 0;
      let sumAA = 0;
      let sumBB = 0;
      let sumAB = 0;
      const n = windowSize * windowSize;
      for (let wy = 0; wy < windowSize; wy++) {
        const row = (y + wy) * width + x;
        for (let wx = 0; wx < windowSize; wx++) {
          const va = a[row + wx];
          const vb = b[row + wx];
          sumA += va;
          sumB += vb;
          sumAA += va * va;
          sumBB += vb * vb;
          sumAB += va * vb;
        }
      }
      const meanA = sumA / n;
      const meanB = sumB / n;
      const varA = sumAA / n - meanA * meanA;
      const varB = sumBB / n - meanB * meanB;
      const covAB = sumAB / n - meanA * meanB;
      const s =
        ((2 * meanA * meanB + C1) * (2 * covAB + C2)) /
        ((meanA * meanA + meanB * meanB + C1) * (varA + varB + C2));
      total += s;
      count += 1;
    }
  }
  return count > 0 ? total / count : 1;
}

/** Convenience: SSIM straight from two equal-size RGBA buffers. */
export function ssimFromRgba(rgbaA, rgbaB, width, height) {
  const grayA = toGrayscale(rgbaA, width, height);
  const grayB = toGrayscale(rgbaB, width, height);
  return ssim(grayA, grayB, width, height);
}

export function scoreToGrade(score) {
  const pct = Math.round(score * 1000) / 10;
  let label = "poor";
  if (pct >= 95) label = "near-identical";
  else if (pct >= 88) label = "excellent";
  else if (pct >= 78) label = "good";
  else if (pct >= 65) label = "fair";
  return { percent: pct, label };
}
