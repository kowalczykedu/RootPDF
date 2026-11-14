import {
  PAGE_SIZES,
  type ContractFieldMeta,
  type FitMode,
  type NormalizedRect,
  type Quality,
  type Settings
} from "../types";

export function normalizeRotation(rotation: number): number {
  return ((rotation % 360) + 360) % 360;
}

export function getRotatedDimensions(
  width: number,
  height: number,
  rotation: number
): [number, number] {
  const norm = normalizeRotation(rotation);
  return norm === 90 || norm === 270 ? [height, width] : [width, height];
}

export function getPageDimensions(
  naturalWidth: number,
  naturalHeight: number,
  rotation: number,
  settings: Pick<Settings, "pageSize" | "orientation">
): [number, number] {
  const safeW = naturalWidth > 0 ? naturalWidth : 1000;
  const safeH = naturalHeight > 0 ? naturalHeight : 1400;
  const [rotatedW, rotatedH] = getRotatedDimensions(safeW, safeH, rotation);

  if (settings.pageSize === "image") {
    const scale = 0.75;
    return [Math.max(1, rotatedW * scale), Math.max(1, rotatedH * scale)];
  }

  const base = PAGE_SIZES[settings.pageSize];
  const minSide = Math.min(base.width, base.height);
  const maxSide = Math.max(base.width, base.height);

  if (settings.orientation === "portrait") {
    return [minSide, maxSide];
  }
  if (settings.orientation === "landscape") {
    return [maxSide, minSide];
  }

  // "auto": match the rotated image's orientation
  const isImageLandscape = rotatedW > rotatedH;
  return isImageLandscape ? [maxSide, minSide] : [minSide, maxSide];
}

export function getEffectiveMargin(
  settings: Pick<Settings, "pageSize" | "margin">,
  pageWidth: number,
  pageHeight: number
): number {
  if (settings.pageSize === "image") return 0;
  const maxAllowed = Math.max(0, Math.min(pageWidth, pageHeight) / 2 - 4);
  return Math.min(Math.max(0, settings.margin), maxAllowed);
}

export function qualityConfig(quality: Quality): {
  jpeg: number;
  maxDimension: number;
} {
  if (quality === "compact") return { jpeg: 0.6, maxDimension: 2200 };
  if (quality === "balanced") return { jpeg: 0.78, maxDimension: 3200 };
  return { jpeg: 0.9, maxDimension: 5000 };
}

export interface PdfDrawPlacement {
  drawX: number;
  drawY: number;
  drawWidth: number;
  drawHeight: number;
  /** Counter-clockwise angle in degrees expected by pdf-lib (Y-up coordinate system) */
  pdfRotationDegrees: number;
  clipX: number;
  clipY: number;
  clipW: number;
  clipH: number;
  needsClip: boolean;
}

/**
 * Computes exact PDF coordinates and rotation angle.
 * Note: UI rotation is clockwise (90 = right, 270 = left), whereas PDF coordinate space
 * has Y pointing UP, meaning positive angles in pdf-lib rotate counter-clockwise.
 */
export function computePdfDrawPlacement(
  sourceW: number,
  sourceH: number,
  pageWidth: number,
  pageHeight: number,
  margin: number,
  fitMode: FitMode,
  clockwiseRotation: number
): PdfDrawPlacement {
  const normalizedClockwise = normalizeRotation(clockwiseRotation);
  const [rotatedW, rotatedH] = getRotatedDimensions(
    sourceW,
    sourceH,
    normalizedClockwise
  );

  const areaW = Math.max(1, pageWidth - margin * 2);
  const areaH = Math.max(1, pageHeight - margin * 2);

  let renderedW: number;
  let renderedH: number;

  if (fitMode === "stretch") {
    renderedW = areaW;
    renderedH = areaH;
  } else {
    const scale =
      fitMode === "cover"
        ? Math.max(areaW / rotatedW, areaH / rotatedH)
        : Math.min(areaW / rotatedW, areaH / rotatedH);

    renderedW = rotatedW * scale;
    renderedH = rotatedH * scale;
  }

  const targetX = margin + (areaW - renderedW) / 2;
  const targetY = margin + (areaH - renderedH) / 2;

  const scaleX = renderedW / rotatedW;
  const scaleY = renderedH / rotatedH;

  const drawWidth = sourceW * scaleX;
  const drawHeight = sourceH * scaleY;

  let drawX = targetX;
  let drawY = targetY;
  let pdfRotationDegrees = 0;

  switch (normalizedClockwise) {
    case 90:
      // 90° clockwise (right) = -90° (or 270°) counter-clockwise in PDF Y-up space
      drawX = targetX;
      drawY = targetY + renderedH;
      pdfRotationDegrees = -90;
      break;
    case 180:
      drawX = targetX + renderedW;
      drawY = targetY + renderedH;
      pdfRotationDegrees = 180;
      break;
    case 270:
      // 270° clockwise (90° left) = +90° counter-clockwise in PDF Y-up space
      drawX = targetX + renderedW;
      drawY = targetY;
      pdfRotationDegrees = 90;
      break;
    case 0:
    default:
      drawX = targetX;
      drawY = targetY;
      pdfRotationDegrees = 0;
      break;
  }

  return {
    drawX,
    drawY,
    drawWidth,
    drawHeight,
    pdfRotationDegrees,
    clipX: margin,
    clipY: margin,
    clipW: areaW,
    clipH: areaH,
    needsClip: fitMode === "cover"
  };
}

export interface PdfBoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayGeomInput {
  xNorm: number;
  yNorm: number;
  widthNorm: number;
  heightNorm: number;
  rotationDeg: number;
}

export interface OverlayPdfGeometry {
  wPt: number;
  hPt: number;
  anchorX: number;
  anchorY: number;
  centerX: number;
  centerY: number;
  pdfAngleDeg: number;
  ex: { x: number; y: number };
  ey: { x: number; y: number };
  corners: [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number }
  ];
}

/**
 * Windows-1252 code points in 0x80..0x9F mapped outside Latin-1.
 */
const WIN1252_EXTRA_ALLOWED = new Set<number>([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178
]);

const UNICODE_WINANSI_REPLACEMENTS: Record<string, string> = {
  "\u00A0": " ",
  "\t": "  ",
  "\u2212": "-",
  "\u2010": "-",
  "\u2011": "-",
  "\u2192": "->",
  "\u2190": "<-",
  "\u2194": "<->",
  "\u2713": "v",
  "\u2714": "v",
  "\u2717": "x",
  "\u2718": "x",
  "\u2611": "[v]",
  "\u2610": "[ ]",
  "\u25CF": "*"
};

/**
 * Normalizes text into Windows-1252 (WinAnsi) safe characters accepted by pdf-lib StandardFonts.
 */
export function sanitizeWinAnsiText(input: string): {
  text: string;
  hadUnsupported: boolean;
} {
  const normalized = input.replace(/\r\n?/g, "\n");
  let out = "";
  let hadUnsupported = false;

  for (const ch of normalized) {
    if (ch === "\n") {
      out += ch;
      continue;
    }
    const mapped = UNICODE_WINANSI_REPLACEMENTS[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    const isAscii = code >= 0x20 && code <= 0x7e;
    const isLatin1 = code >= 0xa0 && code <= 0xff;
    if (isAscii || isLatin1 || WIN1252_EXTRA_ALLOWED.has(code)) {
      out += ch;
    } else {
      out += "?";
      hadUnsupported = true;
    }
  }

  return { text: out, hadUnsupported };
}

export function parseHexRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.trim().replace(/^#/, "");
  const full =
    clean.length === 3
      ? `${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return { r: 0.1, g: 0.09, b: 0.14 };
  }
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255
  };
}

/**
 * Maps a normalized point (u right, v down) inside the rotated viewer page
 * into unrotated PDF user space relative to CropBox (or MediaBox).
 */
export function mapViewerPointToPdf(
  u: number,
  v: number,
  cropBox: PdfBoxRect,
  totalRotation: number
): { x: number; y: number } {
  const rot = normalizeRotation(totalRotation);
  const { x: cx, y: cy, width: cw, height: ch } = cropBox;

  if (rot === 90) {
    return { x: cx + v * cw, y: cy + u * ch };
  }
  if (rot === 180) {
    return { x: cx + (1 - u) * cw, y: cy + v * ch };
  }
  if (rot === 270) {
    return { x: cx + (1 - v) * cw, y: cy + (1 - u) * ch };
  }
  return { x: cx + u * cw, y: cy + (1 - v) * ch };
}

/**
 * Inverse of mapViewerPointToPdf: maps a point in unrotated PDF user space
 * into normalized viewer space [0..1] (u right, v down).
 */
export function mapPdfPointToViewer(
  px: number,
  py: number,
  cropBox: PdfBoxRect,
  totalRotation: number
): { u: number; v: number } {
  const rot = normalizeRotation(totalRotation);
  const cw = Math.max(1, cropBox.width);
  const ch = Math.max(1, cropBox.height);
  const uCrop = (px - cropBox.x) / cw;
  const vCrop = (py - cropBox.y) / ch;

  if (rot === 90) {
    return { u: vCrop, v: uCrop };
  }
  if (rot === 180) {
    return { u: 1 - uCrop, v: vCrop };
  }
  if (rot === 270) {
    return { u: 1 - vCrop, v: 1 - uCrop };
  }
  return { u: uCrop, v: 1 - vCrop };
}

/**
 * Maps a PDF annotation [x1, y1, x2, y2] rect to normalized [0..1] viewer coordinates.
 */
export function pdfRectToViewerNorm(
  rect: [number, number, number, number],
  cropBox: PdfBoxRect,
  totalRotation: number
): { xNorm: number; yNorm: number; widthNorm: number; heightNorm: number } {
  const p1 = mapPdfPointToViewer(rect[0], rect[1], cropBox, totalRotation);
  const p2 = mapPdfPointToViewer(rect[2], rect[3], cropBox, totalRotation);
  const minU = Math.max(0, Math.min(1, Math.min(p1.u, p2.u)));
  const maxU = Math.max(0, Math.min(1, Math.max(p1.u, p2.u)));
  const minV = Math.max(0, Math.min(1, Math.min(p1.v, p2.v)));
  const maxV = Math.max(0, Math.min(1, Math.max(p1.v, p2.v)));

  return {
    xNorm: minU,
    yNorm: minV,
    widthNorm: Math.max(0.008, maxU - minU),
    heightNorm: Math.max(0.008, maxV - minV)
  };
}

function rotateNormRect(
  rect: NormalizedRect,
  deltaDeg: 90 | -90,
  oldPageWidthPt: number,
  oldPageHeightPt: number
): NormalizedRect {
  const safeW = Math.max(1, oldPageWidthPt);
  const safeH = Math.max(1, oldPageHeightPt);
  const cx = rect.xNorm + rect.widthNorm / 2;
  const cy = rect.yNorm + rect.heightNorm / 2;

  const wPt = rect.widthNorm * safeW;
  const hPt = rect.heightNorm * safeH;
  // After +/-90 deg rotation, new page dimensions are (safeH, safeW)
  const nextWidthNorm = Math.min(1.5, Math.max(0.015, wPt / safeH));
  const nextHeightNorm = Math.min(1.5, Math.max(0.015, hPt / safeW));

  const nextCx = deltaDeg === 90 ? 1 - cy : cy;
  const nextCy = deltaDeg === 90 ? cx : 1 - cx;

  return {
    xNorm: nextCx - nextWidthNorm / 2,
    yNorm: nextCy - nextHeightNorm / 2,
    widthNorm: nextWidthNorm,
    heightNorm: nextHeightNorm
  };
}

/**
 * Updates normalized viewer box coordinates when the host page rotates by +/- 90 deg,
 * preserving the overlay's point size and anchoring it to the same visual spot on the page.
 */
export function transformOverlayOnPageRotate<T extends OverlayGeomInput>(
  overlay: T,
  deltaDeg: 90 | -90,
  oldPageWidthPt: number,
  oldPageHeightPt: number
): T {
  const rotatedBox = rotateNormRect(overlay, deltaDeg, oldPageWidthPt, oldPageHeightPt);

  let nextRot = (overlay.rotationDeg + deltaDeg) % 360;
  if (nextRot >= 180) nextRot -= 360;
  if (nextRot < -180) nextRot += 360;

  const result: T = {
    ...overlay,
    ...rotatedBox,
    rotationDeg: nextRot
  };

  if ("contractField" in overlay && overlay.contractField) {
    const cf = overlay.contractField as ContractFieldMeta;
    (result as T & { contractField?: ContractFieldMeta }).contractField = {
      ...cf,
      aboveLineRect: rotateNormRect(cf.aboveLineRect, deltaDeg, oldPageWidthPt, oldPageHeightPt),
      coverRect: rotateNormRect(cf.coverRect, deltaDeg, oldPageWidthPt, oldPageHeightPt)
    };
  }

  return result;
}

/**
 * Computes exact unrotated pdf-lib CropBox anchor, basis vectors, and corner coordinates
 * matching the viewer's CSS box + clockwise rotation under page rotation 0/90/180/270.
 */
export function computeOverlayPdfGeometry(
  overlay: OverlayGeomInput,
  cropBox: PdfBoxRect,
  totalRotation: number
): OverlayPdfGeometry {
  const rot = normalizeRotation(totalRotation);
  const viewerW = rot === 90 || rot === 270 ? cropBox.height : cropBox.width;
  const viewerH = rot === 90 || rot === 270 ? cropBox.width : cropBox.height;

  const wPt = Math.max(2, overlay.widthNorm * viewerW);
  const hPt = Math.max(2, overlay.heightNorm * viewerH);

  const centerU = overlay.xNorm + overlay.widthNorm / 2;
  const centerV = overlay.yNorm + overlay.heightNorm / 2;
  const centerPdf = mapViewerPointToPdf(centerU, centerV, cropBox, rot);

  const pdfAngleDeg = rot - (overlay.rotationDeg || 0);
  const rad = (pdfAngleDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  const ex = { x: cosA, y: sinA };
  const ey = { x: -sinA, y: cosA };

  const anchorX = centerPdf.x - (wPt / 2) * cosA + (hPt / 2) * sinA;
  const anchorY = centerPdf.y - (wPt / 2) * sinA - (hPt / 2) * cosA;

  const c0 = { x: anchorX, y: anchorY };
  const c1 = { x: anchorX + wPt * ex.x, y: anchorY + wPt * ex.y };
  const c2 = {
    x: anchorX + wPt * ex.x + hPt * ey.x,
    y: anchorY + wPt * ex.y + hPt * ey.y
  };
  const c3 = { x: anchorX + hPt * ey.x, y: anchorY + hPt * ey.y };

  return {
    wPt,
    hPt,
    anchorX,
    anchorY,
    centerX: centerPdf.x,
    centerY: centerPdf.y,
    pdfAngleDeg,
    ex,
    ey,
    corners: [c0, c1, c2, c3]
  };
}

/**
 * Wraps explicit paragraphs and words inside maxWidthPt without overflowing horizontally.
 */
export function wrapTextLines(
  text: string,
  maxWidthPt: number,
  measureWidth: (candidate: string) => number
): string[] {
  const safeMax = Math.max(8, maxWidthPt);
  const paragraphs = text.split("\n");
  const lines: string[] = [];

  for (const para of paragraphs) {
    if (para.length === 0) {
      lines.push("");
      continue;
    }

    const tokens = para.split(/(\s+)/).filter((t) => t.length > 0);
    let currentLine = "";

    for (const token of tokens) {
      const candidate = currentLine + token;
      if (measureWidth(candidate) <= safeMax) {
        currentLine = candidate;
        continue;
      }

      if (currentLine.trimEnd().length > 0) {
        lines.push(currentLine.trimEnd());
        currentLine = "";
      }

      const trimmed = token.trimStart();
      if (!trimmed) continue;

      if (measureWidth(trimmed) <= safeMax) {
        currentLine = trimmed;
      } else {
        // Hard-wrap tokens longer than a single box width
        let chunk = "";
        for (const ch of trimmed) {
          if (measureWidth(chunk + ch) > safeMax && chunk.length > 0) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        currentLine = chunk;
      }
    }

    if (currentLine.length > 0) {
      lines.push(currentLine.trimEnd());
    }
  }

  return lines.length > 0 ? lines : [""];
}
