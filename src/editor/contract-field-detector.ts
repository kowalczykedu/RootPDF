import type { PDFPageProxy } from "pdfjs-dist";
import type {
  AcroFormWidgetInfo,
  ContractFieldKind,
  EditorFontFamily,
  NormalizedRect,
  PageOverlayItem,
  TextOverlayItem
} from "../types";
import {
  normalizeRotation,
  pdfRectToViewerNorm,
  type PdfBoxRect
} from "../utils/layout";
import { nextAssetId } from "./image-asset-helper";

export interface DetectContractFieldsParams {
  page: PDFPageProxy;
  totalRotation: number;
  existingOverlays: PageOverlayItem[];
  acroWidgets?: AcroFormWidgetInfo[];
  /** Optional already-rendered canvas for the page; if omitted, a temporary 1x canvas is rendered */
  renderedCanvas?: HTMLCanvasElement | null;
}

interface RawPdfTextItem {
  str: string;
  transform?: number[];
  width?: number;
  height?: number;
  fontName?: string;
  hasEOL?: boolean;
}

interface RawPdfTextStyle {
  fontFamily?: string;
}

interface ParsedTextRun {
  str: string;
  rect: NormalizedRect;
  fontPt: number;
  fontFamily: EditorFontFamily;
  hasReadableChars: boolean;
  isBlankPatternOnly: boolean;
}

interface UnderlineSegment {
  rect: NormalizedRect;
  fontPt: number;
  fontFamily: EditorFontFamily;
}

interface CanvasLineCandidate {
  xNorm: number;
  yNorm: number;
  widthNorm: number;
  sampledBgColor: string;
}

interface FieldCandidate {
  kind: ContractFieldKind;
  overlay: TextOverlayItem;
}

const UNDERLINE_REGEX = /([_]{3,}|(?:\.\s*){4,}\.|[․…]{2,})/g;
const CHECKBOX_REGEX = /(\[\s{0,4}\]|\(\s{0,4}\)|[☐□])/g;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function inferFontFamily(
  fontName: string | undefined,
  styles: Record<string, RawPdfTextStyle> | undefined
): EditorFontFamily {
  const styleFamily = fontName ? styles?.[fontName]?.fontFamily : undefined;
  const combined = `${fontName ?? ""} ${styleFamily ?? ""}`.toLowerCase();
  if (/times|serif|georgia|garamond|cambria|palatino/.test(combined)) {
    return "times";
  }
  if (/courier|mono|consolas|menlo|fixed/.test(combined)) {
    return "courier";
  }
  return "helvetica";
}

function getEffectiveCropBox(page: PDFPageProxy): PdfBoxRect {
  const view = page.view;
  const x1 = view[0] ?? 0;
  const y1 = view[1] ?? 0;
  const x2 = view[2] ?? 595.28;
  const y2 = view[3] ?? 841.89;
  return {
    x: x1,
    y: y1,
    width: Math.max(1, x2 - x1),
    height: Math.max(1, y2 - y1)
  };
}

function extractLabelHint(rawStr: string): string | undefined {
  const cleaned = rawStr
    .replace(/[_․….:\-\[\]()☐□]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || !/[A-Za-zÀ-ÿ]/.test(cleaned)) {
    return undefined;
  }

  // Keep only the trailing segment after punctuation if multiple labels share a line
  const parts = cleaned.split(/[|;]/);
  const tail = (parts[parts.length - 1] ?? cleaned).trim();
  if (!tail) return undefined;

  const words = tail.split(" ").filter(Boolean);
  const short = words.slice(-3).join(" ");
  return short.length > 28 ? short.slice(short.length - 28).trim() : short;
}

function inferNeighborTypography(
  target: NormalizedRect,
  runs: ParsedTextRun[]
): { fontFamily: EditorFontFamily; fontSizePt: number; labelHint?: string } {
  const targetCy = target.yNorm + target.heightNorm / 2;
  let bestLeft: { run: ParsedTextRun; gap: number } | null = null;
  let bestRow: { run: ParsedTextRun; dist: number } | null = null;

  for (const run of runs) {
    if (!run.hasReadableChars) continue;
    const runCy = run.rect.yNorm + run.rect.heightNorm / 2;
    if (Math.abs(runCy - targetCy) > 0.02) continue;

    const runRight = run.rect.xNorm + run.rect.widthNorm;
    const dist = Math.abs(runRight - target.xNorm);

    if (!bestRow || dist < bestRow.dist) {
      bestRow = { run, dist };
    }

    if (runRight <= target.xNorm + 0.015) {
      const gap = Math.max(0, target.xNorm - runRight);
      if (gap < 0.35 && (!bestLeft || gap < bestLeft.gap)) {
        bestLeft = { run, gap };
      }
    }
  }

  const chosen = bestLeft?.run ?? bestRow?.run ?? null;
  if (!chosen) {
    return { fontFamily: "helvetica", fontSizePt: 11 };
  }

  const labelHint = bestLeft ? extractLabelHint(bestLeft.run.str) : undefined;
  return {
    fontFamily: chosen.fontFamily,
    fontSizePt: clamp(Math.round(chosen.fontPt), 9, 16),
    labelHint
  };
}

function buildTextRunsAndPatterns(params: {
  items: unknown[];
  styles: Record<string, RawPdfTextStyle> | undefined;
  cropBox: PdfBoxRect;
  rotation: number;
}): {
  runs: ParsedTextRun[];
  underlines: UnderlineSegment[];
  checkboxes: Array<{ rect: NormalizedRect; fontPt: number; fontFamily: EditorFontFamily }>;
} {
  const { items, styles, cropBox, rotation } = params;
  const runs: ParsedTextRun[] = [];
  const rawUnderlines: UnderlineSegment[] = [];
  const checkboxes: Array<{
    rect: NormalizedRect;
    fontPt: number;
    fontFamily: EditorFontFamily;
  }> = [];

  for (const raw of items) {
    if (!raw || typeof raw !== "object" || !("str" in raw)) continue;
    const item = raw as RawPdfTextItem;
    const str = item.str;
    if (!str || str.length === 0) continue;

    const tr = Array.isArray(item.transform) && item.transform.length >= 6
      ? item.transform
      : [1, 0, 0, 11, 0, 0];

    const rawFontPt =
      Math.hypot(tr[2], tr[3]) ||
      Math.hypot(tr[0], tr[1]) ||
      item.height ||
      11;
    const safeFontPt = clamp(rawFontPt, 6, 48);
    const widthPt = Math.max(
      2,
      typeof item.width === "number" && item.width > 0
        ? item.width
        : safeFontPt * Math.max(1, str.length * 0.5)
    );

    const tx = tr[4] ?? 0;
    const ty = tr[5] ?? 0;
    const rect = pdfRectToViewerNorm(
      [tx, ty - safeFontPt * 0.22, tx + widthPt, ty + safeFontPt * 0.92],
      cropBox,
      rotation
    );
    const fontFamily = inferFontFamily(item.fontName, styles);

    const stripped = str.replace(/[_․….\[\]()☐□\s]/g, "");
    const hasReadableChars = /[A-Za-zÀ-ÿ0-9]/.test(stripped);
    const isBlankPatternOnly = stripped.length === 0;

    runs.push({
      str,
      rect,
      fontPt: safeFontPt,
      fontFamily,
      hasReadableChars,
      isBlankPatternOnly
    });

    // Pattern A: underlines and dotted blanks
    UNDERLINE_REGEX.lastIndex = 0;
    let uMatch: RegExpExecArray | null;
    while ((uMatch = UNDERLINE_REGEX.exec(str)) !== null) {
      const startFrac = uMatch.index / str.length;
      const endFrac = (uMatch.index + uMatch[0].length) / str.length;
      const subX1 = tx + widthPt * startFrac;
      const subX2 = tx + widthPt * endFrac;
      const subRect = pdfRectToViewerNorm(
        [subX1, ty - safeFontPt * 0.2, subX2, ty + safeFontPt * 0.9],
        cropBox,
        rotation
      );
      if (subRect.widthNorm >= 0.015) {
        rawUnderlines.push({
          rect: subRect,
          fontPt: safeFontPt,
          fontFamily
        });
      }
    }

    // Pattern B: checkbox tokens ([  ], (  ), ☐)
    CHECKBOX_REGEX.lastIndex = 0;
    let cMatch: RegExpExecArray | null;
    while ((cMatch = CHECKBOX_REGEX.exec(str)) !== null) {
      const startFrac = cMatch.index / str.length;
      const endFrac = (cMatch.index + cMatch[0].length) / str.length;
      const subX1 = tx + widthPt * startFrac;
      const subX2 = tx + widthPt * endFrac;
      const subRect = pdfRectToViewerNorm(
        [subX1, ty - safeFontPt * 0.2, subX2, ty + safeFontPt * 0.92],
        cropBox,
        rotation
      );

      const boxW = clamp(subRect.widthNorm * 1.15, 0.018, 0.044);
      const boxH = clamp(subRect.heightNorm * 1.12, 0.018, 0.036);
      const cx = subRect.xNorm + subRect.widthNorm / 2;
      const cy = subRect.yNorm + subRect.heightNorm / 2;

      checkboxes.push({
        rect: {
          xNorm: clamp(cx - boxW / 2, 0.005, 0.995 - boxW),
          yNorm: clamp(cy - boxH / 2, 0.005, 0.995 - boxH),
          widthNorm: boxW,
          heightNorm: boxH
        },
        fontPt: safeFontPt,
        fontFamily
      });
    }
  }

  // Merge horizontally adjacent underline segments on the same baseline
  rawUnderlines.sort((a, b) => {
    const rowDiff = Math.round(a.rect.yNorm * 70) - Math.round(b.rect.yNorm * 70);
    return rowDiff !== 0 ? rowDiff : a.rect.xNorm - b.rect.xNorm;
  });

  const underlines: UnderlineSegment[] = [];
  for (const seg of rawUnderlines) {
    const prev = underlines[underlines.length - 1];
    if (
      prev &&
      Math.abs(prev.rect.yNorm - seg.rect.yNorm) < 0.008 &&
      seg.rect.xNorm - (prev.rect.xNorm + prev.rect.widthNorm) < 0.015 &&
      seg.rect.xNorm >= prev.rect.xNorm - 0.008
    ) {
      const minX = Math.min(prev.rect.xNorm, seg.rect.xNorm);
      const maxX = Math.max(
        prev.rect.xNorm + prev.rect.widthNorm,
        seg.rect.xNorm + seg.rect.widthNorm
      );
      const minY = Math.min(prev.rect.yNorm, seg.rect.yNorm);
      const maxY = Math.max(
        prev.rect.yNorm + prev.rect.heightNorm,
        seg.rect.yNorm + seg.rect.heightNorm
      );
      prev.rect = {
        xNorm: minX,
        yNorm: minY,
        widthNorm: maxX - minX,
        heightNorm: maxY - minY
      };
    } else {
      underlines.push({
        ...seg,
        rect: { ...seg.rect }
      });
    }
  }

  return {
    runs,
    underlines: underlines.filter((u) => u.rect.widthNorm >= 0.035),
    checkboxes
  };
}

async function acquirePageImageData(
  page: PDFPageProxy,
  rotation: number,
  pageWidthPt: number,
  renderedCanvas?: HTMLCanvasElement | null
): Promise<ImageData | null> {
  if (
    renderedCanvas &&
    renderedCanvas.width > 0 &&
    renderedCanvas.height > 0 &&
    renderedCanvas.width <= 2800
  ) {
    const ctx = renderedCanvas.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      try {
        return ctx.getImageData(0, 0, renderedCanvas.width, renderedCanvas.height);
      } catch {
        // Fallback to temporary canvas below
      }
    }
  }

  const analysisScale = clamp(900 / Math.max(100, pageWidthPt), 1, 1.5);
  const viewport = page.getViewport({ scale: analysisScale, rotation });
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = Math.max(1, Math.floor(viewport.width));
  tempCanvas.height = Math.max(1, Math.floor(viewport.height));

  const ctx = tempCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  try {
    await page.render({ canvas: tempCanvas, viewport }).promise;
    return ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
  } catch {
    return null;
  } finally {
    tempCanvas.width = 0;
    tempCanvas.height = 0;
  }
}

function sampleRegionBgColor(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  x0: number,
  x1: number,
  yTop: number,
  yBottom: number
): { hex: string; lightRatio: number } {
  const sx = clamp(Math.floor(x0), 0, w - 1);
  const ex = clamp(Math.ceil(x1), sx + 1, w);
  const sy = clamp(Math.floor(yTop), 0, h - 1);
  const ey = clamp(Math.ceil(yBottom), sy + 1, h);

  const rowStep = Math.max(1, Math.floor((ey - sy) / 4));
  const colStep = Math.max(1, Math.floor((ex - sx) / 18));

  let totalSamples = 0;
  let lightSamples = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;

  for (let y = sy; y < ey; y += rowStep) {
    for (let x = sx; x < ex; x += colStep) {
      const idx = (y * w + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      totalSamples++;
      if (lum > 210) {
        lightSamples++;
        sumR += r;
        sumG += g;
        sumB += b;
      }
    }
  }

  const lightRatio = totalSamples > 0 ? lightSamples / totalSamples : 0;
  const hex =
    lightSamples > 0
      ? rgbToHex(sumR / lightSamples, sumG / lightSamples, sumB / lightSamples)
      : "#ffffff";
  return { hex, lightRatio };
}

function hasTextAboveLine(
  xNorm: number,
  yNorm: number,
  widthNorm: number,
  runs: ParsedTextRun[]
): boolean {
  const xEnd = xNorm + widthNorm;
  let coveredWidth = 0;

  for (const run of runs) {
    if (!run.hasReadableChars || run.isBlankPatternOnly) continue;
    const runBottom = run.rect.yNorm + run.rect.heightNorm;
    if (runBottom < yNorm - 0.028 || run.rect.yNorm > yNorm + 0.004) {
      continue;
    }

    const overlap =
      Math.min(xEnd, run.rect.xNorm + run.rect.widthNorm) -
      Math.max(xNorm, run.rect.xNorm);
    if (overlap > 0) {
      coveredWidth += overlap;
      if (coveredWidth / Math.max(0.01, widthNorm) > 0.25) {
        return true;
      }
    }
  }

  return false;
}

function detectHorizontalLinesFromImage(
  img: ImageData,
  pageHeightPt: number,
  runs: ParsedTextRun[]
): CanvasLineCandidate[] {
  const { width: w, height: h, data } = img;
  if (w < 40 || h < 40) return [];

  const minRunPx = Math.max(18, Math.round(w * 0.055));
  const maxRunPx = Math.round(w * 0.85);
  const minY = Math.floor(h * 0.04);
  const maxY = Math.ceil(h * 0.95);
  const minX = Math.floor(w * 0.03);
  const maxX = Math.ceil(w * 0.97);

  interface RawRun {
    y: number;
    x0: number;
    x1: number;
  }

  const rawRuns: RawRun[] = [];

  for (let y = minY; y < maxY; y++) {
    let runStart = -1;
    let gapCount = 0;

    for (let x = minX; x < maxX; x++) {
      const idx = (y * w + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const saturationSpread = Math.max(r, g, b) - Math.min(r, g, b);
      const isDarkStroke = lum < 155 && saturationSpread < 60;

      if (isDarkStroke) {
        if (runStart === -1) runStart = x;
        gapCount = 0;
      } else if (runStart !== -1) {
        if (gapCount === 0 && x + 1 < maxX) {
          gapCount = 1;
        } else {
          const endX = x - gapCount;
          const len = endX - runStart;
          if (len >= minRunPx && len <= maxRunPx) {
            rawRuns.push({ y, x0: runStart, x1: endX });
          }
          runStart = -1;
          gapCount = 0;
        }
      }
    }

    if (runStart !== -1) {
      const endX = maxX - gapCount;
      const len = endX - runStart;
      if (len >= minRunPx && len <= maxRunPx) {
        rawRuns.push({ y, x0: runStart, x1: endX });
      }
    }
  }

  // Group vertically adjacent runs forming a single horizontal rule
  interface GroupedLine {
    x0: number;
    x1: number;
    yMin: number;
    yMax: number;
  }

  const groups: GroupedLine[] = [];
  for (const run of rawRuns) {
    let matched: GroupedLine | null = null;
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      if (run.y - g.yMax > 2) break;
      if (Math.abs(g.x0 - run.x0) <= 5 && Math.abs(g.x1 - run.x1) <= 5) {
        matched = g;
        break;
      }
    }

    if (matched) {
      matched.x0 = Math.min(matched.x0, run.x0);
      matched.x1 = Math.max(matched.x1, run.x1);
      matched.yMax = run.y;
    } else {
      groups.push({ x0: run.x0, x1: run.x1, yMin: run.y, yMax: run.y });
    }
  }

  const maxThickness = Math.max(5, Math.round(h * 0.006));
  const bandHeightPx = Math.max(8, Math.round((12 * h) / Math.max(100, pageHeightPt)));
  const candidates: CanvasLineCandidate[] = [];

  for (const g of groups) {
    const thickness = g.yMax - g.yMin + 1;
    if (thickness > maxThickness) continue;

    const xNorm = g.x0 / w;
    const widthNorm = (g.x1 - g.x0) / w;
    const yNorm = g.yMin / h;

    if (hasTextAboveLine(xNorm, yNorm, widthNorm, runs)) {
      continue;
    }

    const inset = Math.min(8, Math.floor((g.x1 - g.x0) * 0.1));
    const bandTop = Math.max(0, g.yMin - bandHeightPx);
    const bandBottom = Math.max(bandTop + 2, g.yMin - 2);
    const { hex, lightRatio } = sampleRegionBgColor(
      data,
      w,
      h,
      g.x0 + inset,
      g.x1 - inset,
      bandTop,
      bandBottom
    );

    if (lightRatio < 0.85) {
      continue;
    }

    candidates.push({
      xNorm,
      yNorm,
      widthNorm,
      sampledBgColor: hex
    });
  }

  return candidates;
}

function rectsCollide(a: NormalizedRect, b: NormalizedRect): boolean {
  const overlapX =
    Math.min(a.xNorm + a.widthNorm, b.xNorm + b.widthNorm) -
    Math.max(a.xNorm, b.xNorm);
  if (overlapX <= 0) return false;

  const minW = Math.max(0.005, Math.min(a.widthNorm, b.widthNorm));
  if (overlapX / minW < 0.35) return false;

  const aCy = a.yNorm + a.heightNorm / 2;
  const bCy = b.yNorm + b.heightNorm / 2;
  if (Math.abs(aCy - bCy) < 0.018) return true;

  const overlapY =
    Math.min(a.yNorm + a.heightNorm, b.yNorm + b.heightNorm) -
    Math.max(a.yNorm, b.yNorm);
  const minH = Math.max(0.005, Math.min(a.heightNorm, b.heightNorm));
  return overlapY > 0 && overlapY / minH > 0.3;
}

/**
 * Locally scans a PDF page (text runs + drawn horizontal rules) and produces
 * interactive contract fill fields aligned to the active viewer rotation.
 */
export async function detectContractFieldsOnPage(
  params: DetectContractFieldsParams
): Promise<TextOverlayItem[]> {
  const {
    page,
    totalRotation,
    existingOverlays,
    acroWidgets = [],
    renderedCanvas
  } = params;

  const rot = normalizeRotation(totalRotation);
  const baseViewport = page.getViewport({ scale: 1, rotation: rot });
  const pageWidthPt = Math.max(10, baseViewport.width);
  const pageHeightPt = Math.max(10, baseViewport.height);
  const cropBox = getEffectiveCropBox(page);

  const textContent = await page.getTextContent();
  const styles = (textContent.styles ?? undefined) as
    | Record<string, RawPdfTextStyle>
    | undefined;

  const { runs, underlines, checkboxes } = buildTextRunsAndPatterns({
    items: textContent.items,
    styles,
    cropBox,
    rotation: rot
  });

  const imgData = await acquirePageImageData(
    page,
    rot,
    pageWidthPt,
    renderedCanvas
  );

  const sampleBgForNormRect = (rect: NormalizedRect): string => {
    if (!imgData) return "#ffffff";
    const x0 = rect.xNorm * imgData.width + 2;
    const x1 = (rect.xNorm + rect.widthNorm) * imgData.width - 2;
    const yBottom = rect.yNorm * imgData.height - 2;
    const yTop = Math.max(0, yBottom - Math.max(6, imgData.height * 0.012));
    return sampleRegionBgColor(
      imgData.data,
      imgData.width,
      imgData.height,
      x0,
      x1,
      yTop,
      yBottom
    ).hex;
  };

  const candidates: FieldCandidate[] = [];

  // 1. Checkboxes ([  ], (  ), ☐)
  for (const cb of checkboxes) {
    const typo = inferNeighborTypography(cb.rect, runs);
    const fontSizePt = clamp(Math.round(cb.fontPt || typo.fontSizePt), 9, 14);
    const boxRect: NormalizedRect = { ...cb.rect };
    candidates.push({
      kind: "checkbox",
      overlay: {
        id: nextAssetId("ov"),
        kind: "text",
        ...boxRect,
        rotationDeg: 0,
        text: "",
        fontFamily: typo.fontFamily,
        fontSizePt,
        color: "#111827",
        bold: true,
        italic: false,
        align: "center",
        backgroundColor: null,
        contractField: {
          fieldKind: "checkbox",
          labelHint: typo.labelHint,
          aboveLineRect: boxRect,
          coverRect: boxRect,
          sampledBgColor: "#ffffff",
          coverSource: false
        }
      }
    });
  }

  // 2. Text underlines / dotted sequences (_____, .....)
  for (const ul of underlines) {
    const typo = inferNeighborTypography(ul.rect, runs);
    const fontSizePt = typo.fontSizePt;
    const lineHeightNorm = clamp((fontSizePt * 1.35) / pageHeightPt, 0.022, 0.044);
    const baselineY = ul.rect.yNorm + ul.rect.heightNorm * 0.78;
    const aboveLineRect: NormalizedRect = {
      xNorm: ul.rect.xNorm,
      yNorm: clamp(baselineY - lineHeightNorm, 0.004, 0.992 - lineHeightNorm),
      widthNorm: ul.rect.widthNorm,
      heightNorm: lineHeightNorm
    };
    const coverH = Math.max(0.022, ul.rect.heightNorm * 1.15, lineHeightNorm * 0.92);
    const coverRect: NormalizedRect = {
      xNorm: ul.rect.xNorm,
      yNorm: clamp(
        ul.rect.yNorm - Math.max(0, (coverH - ul.rect.heightNorm) * 0.35),
        0.004,
        0.992 - coverH
      ),
      widthNorm: ul.rect.widthNorm,
      heightNorm: coverH
    };

    const sampledBgColor = sampleBgForNormRect(ul.rect);
    candidates.push({
      kind: "underline",
      overlay: {
        id: nextAssetId("ov"),
        kind: "text",
        ...aboveLineRect,
        rotationDeg: 0,
        text: "",
        fontFamily: typo.fontFamily,
        fontSizePt,
        color: "#111827",
        bold: false,
        italic: false,
        align: "left",
        backgroundColor: null,
        contractField: {
          fieldKind: "underline",
          labelHint: typo.labelHint,
          aboveLineRect,
          coverRect,
          sampledBgColor,
          coverSource: false
        }
      }
    });
  }

  // 3. Visual black horizontal lines from rendered canvas
  if (imgData) {
    const lineCandidates = detectHorizontalLinesFromImage(
      imgData,
      pageHeightPt,
      runs
    );
    for (const line of lineCandidates) {
      const probeRect: NormalizedRect = {
        xNorm: line.xNorm,
        yNorm: Math.max(0.005, line.yNorm - 0.024),
        widthNorm: line.widthNorm,
        heightNorm: 0.024
      };
      const typo = inferNeighborTypography(probeRect, runs);
      const fontSizePt = typo.fontSizePt;
      const lineHeightNorm = clamp((fontSizePt * 1.35) / pageHeightPt, 0.022, 0.042);

      const aboveLineRect: NormalizedRect = {
        xNorm: line.xNorm,
        yNorm: clamp(line.yNorm - lineHeightNorm + 0.002, 0.004, 0.992 - lineHeightNorm),
        widthNorm: line.widthNorm,
        heightNorm: lineHeightNorm
      };
      const coverRect: NormalizedRect = {
        xNorm: line.xNorm,
        yNorm: clamp(line.yNorm - lineHeightNorm * 0.78, 0.004, 0.992 - lineHeightNorm),
        widthNorm: line.widthNorm,
        heightNorm: lineHeightNorm
      };

      candidates.push({
        kind: "line",
        overlay: {
          id: nextAssetId("ov"),
          kind: "text",
          ...aboveLineRect,
          rotationDeg: 0,
          text: "",
          fontFamily: typo.fontFamily,
          fontSizePt,
          color: "#111827",
          bold: false,
          italic: false,
          align: "left",
          backgroundColor: null,
          contractField: {
            fieldKind: "line",
            labelHint: typo.labelHint,
            aboveLineRect,
            coverRect,
            sampledBgColor: line.sampledBgColor,
            coverSource: false
          }
        }
      });
    }
  }

  // Deduplicate against existing overlays, native AcroForm widgets, and higher-priority candidates
  const occupiedRects: NormalizedRect[] = [
    ...existingOverlays.map((o) => ({
      xNorm: o.xNorm,
      yNorm: o.yNorm,
      widthNorm: o.widthNorm,
      heightNorm: o.heightNorm
    })),
    ...acroWidgets.map((w) => ({
      xNorm: w.xNorm,
      yNorm: w.yNorm,
      widthNorm: w.widthNorm,
      heightNorm: w.heightNorm
    }))
  ];

  const accepted: TextOverlayItem[] = [];
  for (const cand of candidates) {
    const rect: NormalizedRect = {
      xNorm: cand.overlay.xNorm,
      yNorm: cand.overlay.yNorm,
      widthNorm: cand.overlay.widthNorm,
      heightNorm: cand.overlay.heightNorm
    };

    if (occupiedRects.some((occ) => rectsCollide(rect, occ))) {
      continue;
    }

    occupiedRects.push(rect);
    accepted.push(cand.overlay);
  }

  // Reading order: top -> bottom rows, then left -> right
  accepted.sort((a, b) => {
    const rowDiff = Math.round(a.yNorm * 55) - Math.round(b.yNorm * 55);
    return rowDiff !== 0 ? rowDiff : a.xNorm - b.xNorm;
  });

  return accepted;
}
