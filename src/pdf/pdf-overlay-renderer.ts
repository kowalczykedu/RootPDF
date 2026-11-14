import {
  BlendMode,
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  StandardFonts,
  clip,
  closePath,
  degrees,
  endPath,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb
} from "pdf-lib";
import type {
  EditorFontFamily,
  ExportableOverlayItem,
  OverlayAssetInput,
  PageOverlayItem
} from "../types";
import {
  computeOverlayPdfGeometry,
  normalizeRotation,
  parseHexRgb,
  sanitizeWinAnsiText,
  wrapTextLines,
  type PdfBoxRect
} from "../utils/layout";

export class PdfFontCache {
  private readonly cache = new Map<StandardFonts, PDFFont>();

  constructor(private readonly pdfDoc: PDFDocument) {}

  get(family: EditorFontFamily, bold: boolean, italic: boolean): PDFFont {
    const key = resolveStandardFontKey(family, bold, italic);
    const existing = this.cache.get(key);
    if (existing) return existing;
    const embedded = this.pdfDoc.embedStandardFont(key);
    this.cache.set(key, embedded);
    return embedded;
  }
}

export class PdfAssetCache {
  private readonly byId = new Map<string, OverlayAssetInput>();
  private readonly embedded = new Map<string, PDFImage>();

  constructor(
    private readonly pdfDoc: PDFDocument,
    assets: OverlayAssetInput[] = []
  ) {
    for (const asset of assets) {
      this.byId.set(asset.assetId, asset);
    }
  }

  async resolve(assetId: string): Promise<PDFImage | null> {
    const cached = this.embedded.get(assetId);
    if (cached) return cached;

    const input = this.byId.get(assetId);
    if (!input) return null;

    const image =
      input.mimeType === "image/png"
        ? await this.pdfDoc.embedPng(input.bytes)
        : await this.pdfDoc.embedJpg(input.bytes);

    this.embedded.set(assetId, image);
    return image;
  }
}

function resolveStandardFontKey(
  family: EditorFontFamily,
  bold: boolean,
  italic: boolean
): StandardFonts {
  if (family === "times") {
    if (bold && italic) return StandardFonts.TimesRomanBoldItalic;
    if (bold) return StandardFonts.TimesRomanBold;
    if (italic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }

  if (family === "courier") {
    if (bold && italic) return StandardFonts.CourierBoldOblique;
    if (bold) return StandardFonts.CourierBold;
    if (italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }

  if (bold && italic) return StandardFonts.HelveticaBoldOblique;
  if (bold) return StandardFonts.HelveticaBold;
  if (italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

export function getPageEffectiveBox(page: PDFPage): PdfBoxRect {
  try {
    const crop = page.getCropBox();
    if (crop && crop.width > 0 && crop.height > 0) {
      return crop;
    }
  } catch {
    // Fallback to MediaBox if CropBox cannot be parsed
  }

  try {
    const media = page.getMediaBox();
    if (media && media.width > 0 && media.height > 0) {
      return media;
    }
  } catch {
    // Fallback to getSize()
  }

  const size = page.getSize();
  return { x: 0, y: 0, width: size.width, height: size.height };
}

function drawTextInsideBox(params: {
  page: PDFPage;
  text: string;
  fontFamily: EditorFontFamily;
  fontSizePt: number;
  textColor: string;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
  geom: ReturnType<typeof computeOverlayPdfGeometry>;
  fontCache: PdfFontCache;
}): boolean {
  const {
    page,
    text,
    fontFamily,
    fontSizePt,
    textColor,
    bold,
    italic,
    align,
    geom,
    fontCache
  } = params;

  const { text: cleanText, hadUnsupported } = sanitizeWinAnsiText(text);
  if (!cleanText.trim() && !cleanText.includes("\n")) {
    return hadUnsupported;
  }

  const font = fontCache.get(fontFamily, bold, italic);
  const colorParsed = parseHexRgb(textColor);
  const color = rgb(colorParsed.r, colorParsed.g, colorParsed.b);

  const safeSize = Math.max(6, Math.min(96, fontSizePt || 14));
  const padPt = Math.min(6, Math.max(2, safeSize * 0.25));
  const maxLineWidth = Math.max(4, geom.wPt - padPt * 2);
  const lines = wrapTextLines(cleanText, maxLineWidth, (candidate) =>
    font.widthOfTextAtSize(candidate, safeSize)
  );

  const lineHeight = safeSize * 1.3;
  const ascent = safeSize * 0.85;
  const [c0, c1, c2, c3] = geom.corners;

  page.pushOperators(
    pushGraphicsState(),
    moveTo(c0.x, c0.y),
    lineTo(c1.x, c1.y),
    lineTo(c2.x, c2.y),
    lineTo(c3.x, c3.y),
    closePath(),
    clip(),
    endPath()
  );

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const baselineFromTop = padPt + ascent + i * lineHeight;
    if (baselineFromTop - safeSize * 0.25 > geom.hPt) {
      break;
    }

    if (line.length === 0) continue;

    const lineW = font.widthOfTextAtSize(line, safeSize);
    let localX = padPt;
    if (align === "center") {
      localX = padPt + Math.max(0, (maxLineWidth - lineW) / 2);
    } else if (align === "right") {
      localX = Math.max(padPt, geom.wPt - padPt - lineW);
    }

    const localY = geom.hPt - baselineFromTop;
    const drawX = geom.anchorX + localX * geom.ex.x + localY * geom.ey.x;
    const drawY = geom.anchorY + localX * geom.ex.y + localY * geom.ey.y;

    page.drawText(line, {
      x: drawX,
      y: drawY,
      size: safeSize,
      font,
      color,
      rotate: degrees(geom.pdfAngleDeg)
    });
  }

  page.pushOperators(popGraphicsState());
  return hadUnsupported;
}

/**
 * Returns whether an overlay item should be baked into the exported PDF.
 * Empty/unchecked contract fields (and completely empty non-tinted text boxes)
 * are kept only as UI guides and skipped on export.
 */
export function isOverlayExportable(
  overlay: PageOverlayItem | ExportableOverlayItem
): boolean {
  if (overlay.kind === "text") {
    if (overlay.contractField) {
      return overlay.text.trim().length > 0;
    }
    return overlay.text.trim().length > 0 || Boolean(overlay.backgroundColor);
  }
  return true;
}

export async function drawPageOverlays(params: {
  page: PDFPage;
  cropBox: PdfBoxRect;
  totalRotation: number;
  overlays: ExportableOverlayItem[];
  fontCache: PdfFontCache;
  assetCache: PdfAssetCache;
}): Promise<{ hadUnsupportedChars: boolean }> {
  const { page, cropBox, totalRotation, overlays, fontCache, assetCache } =
    params;

  let hadUnsupportedChars = false;
  const rot = normalizeRotation(totalRotation);

  for (const overlay of overlays) {
    if (!isOverlayExportable(overlay)) continue;
    const geom = computeOverlayPdfGeometry(overlay, cropBox, rot);

    if (overlay.kind === "highlight") {
      const c = parseHexRgb(overlay.color);
      page.drawRectangle({
        x: geom.anchorX,
        y: geom.anchorY,
        width: geom.wPt,
        height: geom.hPt,
        color: rgb(c.r, c.g, c.b),
        opacity: Math.min(1, Math.max(0.1, overlay.opacity)),
        rotate: degrees(geom.pdfAngleDeg),
        blendMode: BlendMode.Multiply
      });
      continue;
    }

    if (overlay.kind === "signature" || overlay.kind === "image") {
      const embeddedImg = await assetCache.resolve(overlay.assetId);
      if (!embeddedImg) continue;
      page.drawImage(embeddedImg, {
        x: geom.anchorX,
        y: geom.anchorY,
        width: geom.wPt,
        height: geom.hPt,
        opacity: Math.min(1, Math.max(0.1, overlay.opacity)),
        rotate: degrees(geom.pdfAngleDeg)
      });
      continue;
    }

    if (overlay.kind === "redact") {
      const cover = parseHexRgb(overlay.coverColor);
      page.drawRectangle({
        x: geom.anchorX,
        y: geom.anchorY,
        width: geom.wPt,
        height: geom.hPt,
        color: rgb(cover.r, cover.g, cover.b),
        opacity: 1,
        rotate: degrees(geom.pdfAngleDeg)
      });

      if (overlay.replacementText.trim().length > 0) {
        const unsupported = drawTextInsideBox({
          page,
          text: overlay.replacementText,
          fontFamily: overlay.fontFamily,
          fontSizePt: overlay.fontSizePt,
          textColor: overlay.textColor,
          bold: overlay.bold,
          italic: overlay.italic,
          align: overlay.align,
          geom,
          fontCache
        });
        if (unsupported) hadUnsupportedChars = true;
      }
      continue;
    }

    if (overlay.kind === "text") {
      if (overlay.backgroundColor) {
        const bg = parseHexRgb(overlay.backgroundColor);
        page.drawRectangle({
          x: geom.anchorX,
          y: geom.anchorY,
          width: geom.wPt,
          height: geom.hPt,
          color: rgb(bg.r, bg.g, bg.b),
          opacity: 1,
          rotate: degrees(geom.pdfAngleDeg)
        });
      }

      const unsupported = drawTextInsideBox({
        page,
        text: overlay.text,
        fontFamily: overlay.fontFamily,
        fontSizePt: overlay.fontSizePt,
        textColor: overlay.color,
        bold: overlay.bold,
        italic: overlay.italic,
        align: overlay.align,
        geom,
        fontCache
      });
      if (unsupported) hadUnsupportedChars = true;
    }
  }

  return { hadUnsupportedChars };
}

