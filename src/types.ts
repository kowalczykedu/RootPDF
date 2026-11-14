export type FitMode = "contain" | "cover" | "stretch";
export type PageSize = "a4" | "a5" | "letter" | "legal" | "image";
export type Orientation = "auto" | "portrait" | "landscape";
export type Quality = "high" | "balanced" | "compact";
export type Theme = "rose-pine";
export type AppMode = "converter" | "reader" | "creator";
export type ReaderZoomMode = "fit-width" | "fit-page" | "custom";
export type SortMode =
  | "manual"
  | "name-asc"
  | "name-desc"
  | "size-desc"
  | "size-asc"
  | "date-asc"
  | "date-desc";

export interface ImageItem {
  id: number;
  file: File;
  /** Lightweight thumbnail URL for fast DOM rendering */
  thumbUrl: string;
  /** Rotation in degrees (0, 90, 180, 270) */
  rotation: number;
  /** Natural width of the unrotated image */
  width: number;
  /** Natural height of the unrotated image */
  height: number;
  /** Whether dimensions/thumbnail have finished loading */
  loaded: boolean;
}

export interface Settings {
  fileName: string;
  pageSize: PageSize;
  orientation: Orientation;
  margin: number;
  fitMode: FitMode;
  quality: Quality;
  theme: Theme;
}

export interface WorkerPageInput {
  id: number;
  file: File;
  fileName: string;
  mimeType: string;
  rotation: number;
  width: number;
  height: number;
  /** Pre-rasterized buffer if the main thread had to decode (e.g. SVG) */
  preRasterizedJpeg?: ArrayBuffer;
}

export interface WorkerGenerateRequest {
  type: "generate";
  pages: WorkerPageInput[];
  settings: Settings;
}

export interface WorkerCancelRequest {
  type: "cancel";
}

export type WorkerRequest = WorkerGenerateRequest | WorkerCancelRequest;

export interface WorkerProgressMessage {
  type: "progress";
  current: number;
  total: number;
  message: string;
}

export interface WorkerSuccessMessage {
  type: "success";
  pdfBuffer: ArrayBuffer;
  pageCount: number;
}

export interface WorkerErrorMessage {
  type: "error";
  message: string;
}

export type WorkerResponse =
  | WorkerProgressMessage
  | WorkerSuccessMessage
  | WorkerErrorMessage;

export const PAGE_SIZES: Record<
  Exclude<PageSize, "image">,
  { width: number; height: number; label: string }
> = {
  a4: { width: 595.28, height: 841.89, label: "A4" },
  a5: { width: 419.53, height: 595.28, label: "A5" },
  letter: { width: 612, height: 792, label: "Carta / Letter" },
  legal: { width: 612, height: 1008, label: "Ofício / Legal" }
};

export const ACCEPTED_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".svg",
  ".avif"
];

export const ACCEPTED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/svg+xml",
  "image/avif"
];

export const DEFAULT_SETTINGS: Settings = {
  fileName: "meu-documento",
  pageSize: "a4",
  orientation: "auto",
  margin: 24,
  fitMode: "contain",
  quality: "high",
  theme: "rose-pine"
};

export interface ReaderPageItem {
  id: number;
  sourceDocId: number;
  sourceFileName: string;
  /** 1-based page number in the source PDF */
  sourcePageNumber: number;
  /** Intrinsic PDF page rotation in clockwise degrees (0, 90, 180, 270) */
  intrinsicRotation: number;
  /** Extra clockwise rotation applied in the organizer (0, 90, 180, 270) */
  userRotation: number;
  /** Width in CSS points at 1x scale and intrinsic rotation */
  widthPt: number;
  /** Height in CSS points at 1x scale and intrinsic rotation */
  heightPt: number;
}

export interface MergeSourceInput {
  docId: number;
  fileName: string;
  bytes: ArrayBuffer;
}

export type EditorToolMode =
  | "select"
  | "signature"
  | "text"
  | "image"
  | "redact"
  | "highlight";

export type EditorFontFamily = "helvetica" | "times" | "courier";
export type EditorTextAlign = "left" | "center" | "right";
export type SignatureKind = "draw" | "upload" | "type";

export interface SavedSignature {
  id: string;
  label: string;
  kind: SignatureKind;
  /** PNG data URL with preserved transparency */
  dataUrl: string;
  aspectRatio: number;
  createdAt: number;
}

export interface OverlayBase {
  id: string;
  /** Normalized viewer coordinates [0..1] in current page orientation */
  xNorm: number;
  yNorm: number;
  widthNorm: number;
  heightNorm: number;
  /** Clockwise visual tilt in degrees */
  rotationDeg: number;
}

export interface SignatureOverlayItem extends OverlayBase {
  kind: "signature";
  assetId: string;
  label: string;
  dataUrl: string;
  opacity: number;
}

export interface ImageOverlayItem extends OverlayBase {
  kind: "image";
  assetId: string;
  fileName: string;
  dataUrl: string;
  opacity: number;
}

export type ContractFieldKind = "line" | "underline" | "checkbox";

export interface NormalizedRect {
  xNorm: number;
  yNorm: number;
  widthNorm: number;
  heightNorm: number;
}

export interface ContractFieldMeta {
  fieldKind: ContractFieldKind;
  labelHint?: string;
  /** Normalized rect positioned right above the black line (keeps original line visible) */
  aboveLineRect: NormalizedRect;
  /** Normalized rect covering the original gap/underscores */
  coverRect: NormalizedRect;
  /** Sampled paper background color around the gap */
  sampledBgColor: string;
  /** Whether the field covers the underlying gap or sits above the line */
  coverSource: boolean;
}

export interface TextOverlayItem extends OverlayBase {
  kind: "text";
  text: string;
  fontFamily: EditorFontFamily;
  fontSizePt: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: EditorTextAlign;
  backgroundColor: string | null;
  contractField?: ContractFieldMeta;
}

export interface RedactOverlayItem extends OverlayBase {
  kind: "redact";
  coverColor: string;
  replacementText: string;
  textColor: string;
  fontFamily: EditorFontFamily;
  fontSizePt: number;
  bold: boolean;
  italic: boolean;
  align: EditorTextAlign;
}

export interface HighlightOverlayItem extends OverlayBase {
  kind: "highlight";
  color: string;
  opacity: number;
}

export type PageOverlayItem =
  | SignatureOverlayItem
  | ImageOverlayItem
  | TextOverlayItem
  | RedactOverlayItem
  | HighlightOverlayItem;

export type ExportableOverlayItem =
  | Omit<SignatureOverlayItem, "dataUrl">
  | Omit<ImageOverlayItem, "dataUrl">
  | TextOverlayItem
  | RedactOverlayItem
  | HighlightOverlayItem;

export interface OverlayAssetInput {
  assetId: string;
  mimeType: "image/png" | "image/jpeg";
  bytes: ArrayBuffer;
}

export type AcroFormFieldValue = string | boolean;
export type AcroFormFieldType = "text" | "checkbox" | "radio" | "select";

export interface AcroFormWidgetInfo {
  widgetId: string;
  fieldName: string;
  fieldType: AcroFormFieldType;
  xNorm: number;
  yNorm: number;
  widthNorm: number;
  heightNorm: number;
  multiline: boolean;
  maxLen: number | null;
  align: EditorTextAlign;
  fontSizePt: number;
  textColor: string;
  options: Array<{ exportValue: string; displayValue: string }>;
  exportValue: string;
  defaultValue: AcroFormFieldValue;
  readOnly: boolean;
}

export type CreatorBlock =
  | {
      id: string;
      kind: "text";
      xNorm: number;
      yNorm: number;
      widthNorm: number;
      heightNorm: number;
      rotationDeg: number;
      text: string;
      fontFamily: EditorFontFamily;
      fontSizePt: number;
      color: string;
      bold: boolean;
      italic: boolean;
      align: EditorTextAlign;
      backgroundColor: string | null;
    }
  | {
      id: string;
      kind: "image";
      xNorm: number;
      yNorm: number;
      widthNorm: number;
      heightNorm: number;
      rotationDeg: number;
      assetId: string;
      fileName: string;
      dataUrl: string;
      opacity: number;
    };

export type CreatorPageSize = keyof typeof PAGE_SIZES;

export interface CreatorPageDoc {
  id: string;
  pageSize: CreatorPageSize;
  orientation: Exclude<Orientation, "auto">;
  backgroundColor: string;
  blocks: CreatorBlock[];
}

export interface CreatePdfPageInput {
  pageSize: CreatorPageSize;
  orientation: Exclude<Orientation, "auto">;
  backgroundColor: string;
  blocks: Array<
    | Extract<CreatorBlock, { kind: "text" }>
    | Omit<Extract<CreatorBlock, { kind: "image" }>, "dataUrl">
  >;
}

export interface CreatePdfWorkerRequest {
  type: "create";
  pages: CreatePdfPageInput[];
  assets: OverlayAssetInput[];
  fileName: string;
}

export interface MergePageInput {
  sourceDocId: number;
  /** 0-based page index in the source PDF */
  sourcePageIndex: number;
  /** Additional clockwise rotation applied by user in degrees */
  deltaRotation: number;
  /** Layered edits/signatures placed on this page instance */
  overlays?: ExportableOverlayItem[];
}

export interface MergeWorkerRequest {
  type: "merge";
  sources: MergeSourceInput[];
  pages: MergePageInput[];
  assets?: OverlayAssetInput[];
  formValuesByDoc?: Record<number, Record<string, AcroFormFieldValue>>;
  flattenOutput?: boolean;
  fileName: string;
}

export type ReaderWorkerRequest =
  | MergeWorkerRequest
  | CreatePdfWorkerRequest
  | WorkerCancelRequest;

export interface MergeWorkerProgressMessage {
  type: "progress";
  current: number;
  total: number;
  message: string;
}

export interface MergeWorkerSuccessMessage {
  type: "success";
  pdfBuffer: ArrayBuffer;
  pageCount: number;
}

export interface MergeWorkerErrorMessage {
  type: "error";
  message: string;
}

export type ReaderWorkerResponse =
  | MergeWorkerProgressMessage
  | MergeWorkerSuccessMessage
  | MergeWorkerErrorMessage;

