import type {
  AcroFormFieldValue,
  AcroFormWidgetInfo,
  PageOverlayItem,
  TextOverlayItem
} from "../types";
import { escapeHtml } from "../utils/format";
import { ICONS } from "../utils/icons";
import { sanitizeWinAnsiText } from "../utils/layout";
import { nextAssetId } from "./image-asset-helper";

export interface OverlayLayerOptions {
  hostFrame: HTMLElement;
  onSelect: (id: string | null) => void;
  onMutate: (items: PageOverlayItem[], commitHistory: boolean) => void;
  onDelete: (id: string) => void;
  onCreateAt?: (normRect: {
    xNorm: number;
    yNorm: number;
    widthNorm: number;
    heightNorm: number;
  }) => PageOverlayItem | null;
  onAcroFormChange?: (fieldName: string, value: AcroFormFieldValue) => void;
}

type ResizeHandle = "nw" | "ne" | "se" | "sw";

interface DragState {
  mode: "move" | "resize" | "rotate" | "draw-new";
  itemId: string | null;
  handle?: ResizeHandle;
  pointerId: number;
  startX: number;
  startY: number;
  frameW: number;
  frameH: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
  origRot: number;
  preserveAspect: boolean;
  centerPxX: number;
  centerPxY: number;
  startAngleRad: number;
  hasMoved: boolean;
  drawBoxEl?: HTMLDivElement;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function isContractCheckbox(item: PageOverlayItem): boolean {
  return item.kind === "text" && item.contractField?.fieldKind === "checkbox";
}

function sortOverlaysInReadingOrder(items: PageOverlayItem[]): PageOverlayItem[] {
  return [...items].sort((a, b) => {
    const rowDiff = Math.round(a.yNorm * 55) - Math.round(b.yNorm * 55);
    return rowDiff !== 0 ? rowDiff : a.xNorm - b.xNorm;
  });
}

function cssFontFamily(family: "helvetica" | "times" | "courier"): string {
  if (family === "times") return 'Georgia, "Times New Roman", serif';
  if (family === "courier") return '"Space Mono", ui-monospace, monospace';
  return 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
}

/**
 * Interactive positioned overlay layer + AcroForm HTML field renderer mounted
 * over a rendered page frame. Shared by Reader Editor & From-Scratch Creator.
 */
export class PageOverlayLayer {
  private readonly hostFrame: HTMLElement;
  private readonly formLayerEl: HTMLDivElement;
  private readonly overlayLayerEl: HTMLDivElement;
  private readonly options: OverlayLayerOptions;

  private items: PageOverlayItem[] = [];
  private selectedId: string | null = null;
  private editingId: string | null = null;
  private placementToolActive = false;
  private pageWidthPt = 595.28;
  private pageHeightPt = 841.89;

  private acroWidgets: AcroFormWidgetInfo[] = [];
  private acroValues: Record<string, AcroFormFieldValue> = {};

  private dragState: DragState | null = null;
  private elementMap = new Map<string, HTMLDivElement>();
  private angleBadgeEl: HTMLDivElement | null = null;

  constructor(options: OverlayLayerOptions) {
    this.options = options;
    this.hostFrame = options.hostFrame;

    this.formLayerEl = document.createElement("div");
    this.formLayerEl.className = "pdf-acroform-layer";
    this.formLayerEl.setAttribute("aria-label", "Campos de formulário do PDF");

    this.overlayLayerEl = document.createElement("div");
    this.overlayLayerEl.className = "pdf-overlay-layer";
    this.overlayLayerEl.setAttribute("aria-label", "Camadas de edição sobre a página");

    this.hostFrame.appendChild(this.formLayerEl);
    this.hostFrame.appendChild(this.overlayLayerEl);

    this.bindEvents();
  }

  public setPlacementMode(active: boolean): void {
    this.placementToolActive = active;
    this.overlayLayerEl.classList.toggle("is-placing", active);
    this.formLayerEl.classList.toggle("is-blocked", active);
  }

  public setPageDimensions(widthPt: number, heightPt: number): void {
    this.pageWidthPt = Math.max(10, widthPt);
    this.pageHeightPt = Math.max(10, heightPt);
    this.syncOverlayFontScales();
    this.syncAcroFormScales();
  }

  public setState(params: {
    items: PageOverlayItem[];
    selectedId: string | null;
    editingId?: string | null;
    pageWidthPt?: number;
    pageHeightPt?: number;
  }): void {
    this.items = params.items;
    this.selectedId = params.selectedId;
    if (params.editingId !== undefined) {
      this.editingId = params.editingId;
    }
    if (params.pageWidthPt && params.pageHeightPt) {
      this.pageWidthPt = Math.max(10, params.pageWidthPt);
      this.pageHeightPt = Math.max(10, params.pageHeightPt);
    }
    this.renderOverlays();
  }

  public setAcroFormState(
    widgets: AcroFormWidgetInfo[],
    values: Record<string, AcroFormFieldValue>
  ): void {
    this.acroWidgets = widgets;
    this.acroValues = values;
    this.renderAcroFormWidgets();
  }

  public startInlineEdit(itemId: string): void {
    const item = this.items.find((o) => o.id === itemId);
    if (!item || (item.kind !== "text" && item.kind !== "redact")) return;

    if (isContractCheckbox(item)) {
      this.toggleContractCheckbox(itemId);
      return;
    }

    if (this.selectedId !== itemId) {
      this.selectedId = itemId;
      this.options.onSelect(itemId);
    }
    this.editingId = itemId;
    this.renderOverlays();

    const textarea = this.elementMap
      .get(itemId)
      ?.querySelector<HTMLTextAreaElement>(".overlay-inline-textarea");
    if (textarea) {
      textarea.focus();
      textarea.select();
    }
  }

  public stopInlineEdit(): void {
    if (this.editingId !== null) {
      this.editingId = null;
      this.renderOverlays();
    }
  }

  public focusFirstContractField(): boolean {
    const contractFields = sortOverlaysInReadingOrder(
      this.items.filter((o) => o.kind === "text" && Boolean(o.contractField))
    );
    if (contractFields.length === 0) return false;

    const target =
      contractFields.find((o) => o.kind === "text" && !o.text.trim()) ??
      contractFields[0];
    this.focusOverlayTarget(target);
    return true;
  }

  private focusOverlayTarget(target: PageOverlayItem): void {
    const el = this.elementMap.get(target.id);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });

    if (isContractCheckbox(target)) {
      this.editingId = null;
      if (this.selectedId !== target.id) {
        this.selectedId = target.id;
        this.options.onSelect(target.id);
      } else {
        this.renderOverlays();
      }
      this.elementMap.get(target.id)?.focus();
      return;
    }

    this.startInlineEdit(target.id);
  }

  private navigateOverlayByTab(direction: 1 | -1): boolean {
    const navigable = sortOverlaysInReadingOrder(
      this.items.filter((o) => o.kind === "text" || o.kind === "redact")
    );
    if (navigable.length === 0) return false;

    const currentIdx = this.selectedId
      ? navigable.findIndex((o) => o.id === this.selectedId)
      : -1;
    const nextIdx =
      currentIdx === -1
        ? direction === 1
          ? 0
          : navigable.length - 1
        : (currentIdx + direction + navigable.length) % navigable.length;

    const target = navigable[nextIdx];
    this.focusOverlayTarget(target);
    return true;
  }

  private toggleContractCheckbox(itemId: string): void {
    const target = this.items.find((o) => o.id === itemId);
    if (!target || target.kind !== "text" || !isContractCheckbox(target)) return;

    const nextText = target.text.trim() ? "" : "X";
    const updated = this.items.map((o) =>
      o.id === itemId && o.kind === "text" ? { ...o, text: nextText } : o
    );
    this.items = updated;
    this.editingId = null;
    this.selectedId = itemId;
    this.options.onMutate(updated, true);
    this.elementMap.get(itemId)?.focus();
  }

  public handleKeyDown(event: KeyboardEvent): boolean {
    if (this.editingId) return false;

    if (event.key === "Tab" && this.selectedId) {
      const hasSelectedEditable = this.items.some(
        (o) =>
          o.id === this.selectedId && (o.kind === "text" || o.kind === "redact")
      );
      if (hasSelectedEditable) {
        event.preventDefault();
        return this.navigateOverlayByTab(event.shiftKey ? -1 : 1);
      }
    }

    if (!this.selectedId) return false;

    const item = this.items.find((o) => o.id === this.selectedId);
    if (!item) return false;

    if (isContractCheckbox(item)) {
      if (event.key === "Enter") {
        event.preventDefault();
        this.toggleContractCheckbox(item.id);
        return true;
      }
      if (event.key === " ") {
        // Prevent page scroll; actual toggle fires on keyup matching native checkbox/button behavior
        event.preventDefault();
        return true;
      }
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.options.onDelete(item.id);
      return true;
    }

    const step = event.shiftKey ? 0.02 : 0.005;
    let dx = 0;
    let dy = 0;
    if (event.key === "ArrowLeft") dx = -step;
    else if (event.key === "ArrowRight") dx = step;
    else if (event.key === "ArrowUp") dy = -step;
    else if (event.key === "ArrowDown") dy = step;
    else return false;

    event.preventDefault();
    const updated = this.items.map((o) =>
      o.id === item.id
        ? {
            ...o,
            xNorm: clamp(o.xNorm + dx, -0.1, 1 - o.widthNorm * 0.25),
            yNorm: clamp(o.yNorm + dy, -0.1, 1 - o.heightNorm * 0.25)
          }
        : o
    );
    this.items = updated;
    this.renderOverlays();
    this.options.onMutate(updated, true);
    return true;
  }

  private getScalePxPerPt(): number {
    const rect = this.hostFrame.getBoundingClientRect();
    const w = rect.width || this.hostFrame.clientWidth || this.pageWidthPt;
    return w / Math.max(10, this.pageWidthPt);
  }

  private bindEvents(): void {
    this.overlayLayerEl.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const target = e.target as HTMLElement;

      if (target.closest(".overlay-inline-textarea")) {
        return;
      }

      const miniDeleteBtn = target.closest<HTMLElement>("[data-ov-action='delete']");
      if (miniDeleteBtn) {
        e.stopPropagation();
        if (this.selectedId) this.options.onDelete(this.selectedId);
        return;
      }

      const miniDuplicateBtn = target.closest<HTMLElement>("[data-ov-action='duplicate']");
      if (miniDuplicateBtn && this.selectedId) {
        e.stopPropagation();
        this.duplicateOverlayById(this.selectedId);
        return;
      }

      const miniEditBtn = target.closest<HTMLElement>("[data-ov-action='edit']");
      if (miniEditBtn && this.selectedId) {
        e.stopPropagation();
        this.startInlineEdit(this.selectedId);
        return;
      }

      const itemEl = target.closest<HTMLDivElement>(".pdf-overlay-item");
      const frameRect = this.overlayLayerEl.getBoundingClientRect();
      const frameW = Math.max(20, frameRect.width);
      const frameH = Math.max(20, frameRect.height);

      if (!itemEl) {
        if (this.editingId) {
          this.stopInlineEdit();
        }

        if (this.placementToolActive && this.options.onCreateAt) {
          e.preventDefault();
          this.overlayLayerEl.setPointerCapture(e.pointerId);
          const u = clamp((e.clientX - frameRect.left) / frameW, 0, 1);
          const v = clamp((e.clientY - frameRect.top) / frameH, 0, 1);
          const drawBoxEl = document.createElement("div");
          drawBoxEl.className = "overlay-draw-marquee";
          drawBoxEl.style.left = `${u * 100}%`;
          drawBoxEl.style.top = `${v * 100}%`;
          drawBoxEl.style.width = "0%";
          drawBoxEl.style.height = "0%";
          this.overlayLayerEl.appendChild(drawBoxEl);

          this.dragState = {
            mode: "draw-new",
            itemId: null,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            frameW,
            frameH,
            origX: u,
            origY: v,
            origW: 0,
            origH: 0,
            origRot: 0,
            preserveAspect: false,
            centerPxX: 0,
            centerPxY: 0,
            startAngleRad: 0,
            hasMoved: false,
            drawBoxEl
          };
          return;
        }

        if (this.selectedId !== null) {
          this.options.onSelect(null);
        }
        return;
      }

      const id = itemEl.dataset.overlayId || "";
      const item = this.items.find((o) => o.id === id);
      if (!item) return;

      if (this.editingId && this.editingId !== id) {
        this.stopInlineEdit();
      }
      if (this.editingId === id) {
        return;
      }

      if (this.selectedId !== id) {
        this.selectedId = id;
        this.options.onSelect(id);
      }

      e.stopPropagation();
      e.preventDefault();

      const rotateHandle = target.closest<HTMLElement>("[data-ov-rotate]");
      const resizeHandleEl = target.closest<HTMLElement>("[data-ov-resize]");
      const itemRect = itemEl.getBoundingClientRect();
      const centerPxX = itemRect.left + itemRect.width / 2;
      const centerPxY = itemRect.top + itemRect.height / 2;

      this.overlayLayerEl.setPointerCapture(e.pointerId);

      if (rotateHandle) {
        this.dragState = {
          mode: "rotate",
          itemId: id,
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          frameW,
          frameH,
          origX: item.xNorm,
          origY: item.yNorm,
          origW: item.widthNorm,
          origH: item.heightNorm,
          origRot: item.rotationDeg,
          preserveAspect: false,
          centerPxX,
          centerPxY,
          startAngleRad: Math.atan2(e.clientY - centerPxY, e.clientX - centerPxX),
          hasMoved: false
        };
        return;
      }

      if (resizeHandleEl) {
        const handle = (resizeHandleEl.dataset.ovResize || "se") as ResizeHandle;
        this.dragState = {
          mode: "resize",
          itemId: id,
          handle,
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          frameW,
          frameH,
          origX: item.xNorm,
          origY: item.yNorm,
          origW: item.widthNorm,
          origH: item.heightNorm,
          origRot: item.rotationDeg,
          preserveAspect: item.kind === "signature" || item.kind === "image",
          centerPxX,
          centerPxY,
          startAngleRad: 0,
          hasMoved: false
        };
        return;
      }

      this.dragState = {
        mode: "move",
        itemId: id,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        frameW,
        frameH,
        origX: item.xNorm,
        origY: item.yNorm,
        origW: item.widthNorm,
        origH: item.heightNorm,
        origRot: item.rotationDeg,
        preserveAspect: false,
        centerPxX,
        centerPxY,
        startAngleRad: 0,
        hasMoved: false
      };
    });

    this.overlayLayerEl.addEventListener("pointermove", (e) => {
      if (!this.dragState || e.pointerId !== this.dragState.pointerId) return;
      const st = this.dragState;
      const dxPx = e.clientX - st.startX;
      const dyPx = e.clientY - st.startY;
      if (Math.hypot(dxPx, dyPx) > 2.5) {
        st.hasMoved = true;
      }

      if (st.mode === "draw-new" && st.drawBoxEl) {
        const curU = clamp(st.origX + dxPx / st.frameW, 0, 1);
        const curV = clamp(st.origY + dyPx / st.frameH, 0, 1);
        const left = Math.min(st.origX, curU);
        const top = Math.min(st.origY, curV);
        const w = Math.abs(curU - st.origX);
        const h = Math.abs(curV - st.origY);
        st.drawBoxEl.style.left = `${left * 100}%`;
        st.drawBoxEl.style.top = `${top * 100}%`;
        st.drawBoxEl.style.width = `${w * 100}%`;
        st.drawBoxEl.style.height = `${h * 100}%`;
        return;
      }

      if (!st.itemId) return;

      if (st.mode === "move") {
        const nextX = clamp(st.origX + dxPx / st.frameW, -0.1, 1 - st.origW * 0.25);
        const nextY = clamp(st.origY + dyPx / st.frameH, -0.1, 1 - st.origH * 0.25);
        this.applyGeometryPatch(st.itemId, { xNorm: nextX, yNorm: nextY }, false);
        return;
      }

      if (st.mode === "rotate") {
        const currentRad = Math.atan2(e.clientY - st.centerPxY, e.clientX - st.centerPxX);
        let deg = st.origRot + ((currentRad - st.startAngleRad) * 180) / Math.PI;
        while (deg >= 180) deg -= 360;
        while (deg < -180) deg += 360;

        if (!e.altKey) {
          for (const snap of [0, 90, -90, 180, -180]) {
            if (Math.abs(deg - snap) < 3.5) {
              deg = snap === -180 ? 180 : snap;
              break;
            }
          }
        }
        const rounded = Math.round(deg * 10) / 10;
        const displayDeg = Object.is(Math.round(deg), -0) ? 0 : Math.round(deg);
        this.applyGeometryPatch(st.itemId, { rotationDeg: rounded }, false);
        const updated = this.items.find((o) => o.id === st.itemId);
        if (updated) {
          this.showAngleBadge(updated, `${displayDeg}°`);
        }
        return;
      }

      if (st.mode === "resize" && st.handle) {
        const rad = (-st.origRot * Math.PI) / 180;
        const cosA = Math.cos(rad);
        const sinA = Math.sin(rad);
        const localDx = (dxPx * cosA - dyPx * sinA) / st.frameW;
        const localDy = (dxPx * sinA + dyPx * cosA) / st.frameH;

        let nextX = st.origX;
        let nextY = st.origY;
        let nextW = st.origW;
        let nextH = st.origH;
        const minW = 0.03;
        const minH = 0.02;

        if (st.handle.includes("e")) {
          nextW = Math.max(minW, st.origW + localDx);
        }
        if (st.handle.includes("w")) {
          const clampedW = Math.max(minW, st.origW - localDx);
          nextX = st.origX + (st.origW - clampedW);
          nextW = clampedW;
        }
        if (st.handle.includes("s")) {
          nextH = Math.max(minH, st.origH + localDy);
        }
        if (st.handle.includes("n")) {
          const clampedH = Math.max(minH, st.origH - localDy);
          nextY = st.origY + (st.origH - clampedH);
          nextH = clampedH;
        }

        if (st.preserveAspect && !e.shiftKey) {
          const aspectPx = (st.origW * st.frameW) / Math.max(1, st.origH * st.frameH);
          const nextHPx = (nextW * st.frameW) / Math.max(0.1, aspectPx);
          const lockedH = Math.max(minH, nextHPx / st.frameH);
          if (st.handle.includes("n")) {
            nextY = st.origY + (st.origH - lockedH);
          }
          nextH = lockedH;
        }

        this.applyGeometryPatch(
          st.itemId,
          { xNorm: nextX, yNorm: nextY, widthNorm: nextW, heightNorm: nextH },
          false
        );
      }
    });

    const finishPointer = (e: PointerEvent) => {
      if (!this.dragState || e.pointerId !== this.dragState.pointerId) return;
      const st = this.dragState;
      this.dragState = null;
      this.clearAngleBadge();

      if (this.overlayLayerEl.hasPointerCapture(e.pointerId)) {
        this.overlayLayerEl.releasePointerCapture(e.pointerId);
      }

      if (st.mode === "draw-new") {
        st.drawBoxEl?.remove();
        if (this.options.onCreateAt) {
          const dxNorm = (e.clientX - st.startX) / st.frameW;
          const dyNorm = (e.clientY - st.startY) / st.frameH;
          const curU = clamp(st.origX + dxNorm, 0, 1);
          const curV = clamp(st.origY + dyNorm, 0, 1);
          const created = this.options.onCreateAt({
            xNorm: st.hasMoved ? Math.min(st.origX, curU) : st.origX,
            yNorm: st.hasMoved ? Math.min(st.origY, curV) : st.origY,
            widthNorm: st.hasMoved ? Math.max(0.04, Math.abs(curU - st.origX)) : 0,
            heightNorm: st.hasMoved ? Math.max(0.025, Math.abs(curV - st.origY)) : 0
          });
          if (created && (created.kind === "text" || created.kind === "redact")) {
            this.startInlineEdit(created.id);
          }
        }
        return;
      }

      if (!st.hasMoved && st.itemId) {
        const clickedItem = this.items.find((o) => o.id === st.itemId);
        if (clickedItem && isContractCheckbox(clickedItem)) {
          this.toggleContractCheckbox(clickedItem.id);
        }
        return;
      }

      if (st.hasMoved && st.itemId) {
        this.options.onMutate(this.items, true);
      }
    };

    this.overlayLayerEl.addEventListener("pointerup", finishPointer);
    this.overlayLayerEl.addEventListener("pointercancel", finishPointer);

    this.overlayLayerEl.addEventListener("keyup", (e) => {
      if (e.key !== " " || this.editingId || !this.selectedId) return;
      const item = this.items.find((o) => o.id === this.selectedId);
      if (item && isContractCheckbox(item)) {
        e.preventDefault();
        e.stopPropagation();
        this.toggleContractCheckbox(item.id);
      }
    });

    this.overlayLayerEl.addEventListener("dblclick", (e) => {
      const target = e.target as HTMLElement;
      const itemEl = target.closest<HTMLDivElement>(".pdf-overlay-item");
      if (!itemEl) return;
      const id = itemEl.dataset.overlayId;
      if (id) {
        this.startInlineEdit(id);
      }
    });

    this.overlayLayerEl.addEventListener("focusin", (e) => {
      const target = e.target as HTMLElement;
      const itemEl = target.closest<HTMLDivElement>(".pdf-overlay-item");
      if (!itemEl) return;
      const id = itemEl.dataset.overlayId;
      if (id && id !== this.selectedId) {
        this.selectedId = id;
        this.options.onSelect(id);
      }
    });

    // Delegated AcroForm changes
    this.formLayerEl.addEventListener("input", (e) => {
      const target = e.target as HTMLInputElement | HTMLTextAreaElement;
      const name = target.dataset.acroField;
      if (!name || !this.options.onAcroFormChange) return;
      if (target.type === "checkbox" || target.type === "radio") return;
      this.options.onAcroFormChange(name, target.value);
    });

    this.formLayerEl.addEventListener("change", (e) => {
      const target = e.target as HTMLInputElement | HTMLSelectElement;
      const name = target.dataset.acroField;
      if (!name || !this.options.onAcroFormChange) return;
      if (target instanceof HTMLInputElement && target.type === "checkbox") {
        this.options.onAcroFormChange(name, target.checked);
      } else if (target instanceof HTMLInputElement && target.type === "radio") {
        if (target.checked) {
          this.options.onAcroFormChange(name, target.value);
        }
      } else {
        this.options.onAcroFormChange(name, target.value);
      }
    });
  }

  private applyGeometryPatch(
    itemId: string,
    patch: Partial<Pick<PageOverlayItem, "xNorm" | "yNorm" | "widthNorm" | "heightNorm" | "rotationDeg">>,
    commit: boolean
  ): void {
    this.items = this.items.map((o) => (o.id === itemId ? { ...o, ...patch } : o));
    const el = this.elementMap.get(itemId);
    const updated = this.items.find((o) => o.id === itemId);
    if (el && updated) {
      el.style.left = `${updated.xNorm * 100}%`;
      el.style.top = `${updated.yNorm * 100}%`;
      el.style.width = `${updated.widthNorm * 100}%`;
      el.style.height = `${updated.heightNorm * 100}%`;
      el.style.transform = updated.rotationDeg ? `rotate(${updated.rotationDeg}deg)` : "";
    }
    this.options.onMutate(this.items, commit);
  }

  private renderOverlays(): void {
    this.elementMap.clear();
    this.overlayLayerEl.innerHTML = "";
    this.angleBadgeEl = null;
    const scale = this.getScalePxPerPt();

    for (const item of this.items) {
      const isSelected = item.id === this.selectedId;
      const isEditing = item.id === this.editingId;
      const isContractField = item.kind === "text" && Boolean(item.contractField);
      const isCheckbox = isContractCheckbox(item);
      const isEmptyContract =
        isContractField && item.kind === "text" && item.text.trim().length === 0;

      const el = document.createElement("div");
      el.className = [
        `pdf-overlay-item kind-${item.kind}`,
        isSelected ? "is-selected" : "",
        isEditing ? "is-editing" : "",
        isContractField ? "is-contract-field" : "",
        isEmptyContract ? "is-contract-empty" : "",
        isCheckbox ? "is-contract-checkbox" : ""
      ]
        .filter(Boolean)
        .join(" ");
      el.dataset.overlayId = item.id;
      el.tabIndex = 0;
      el.setAttribute("role", isCheckbox ? "checkbox" : "group");
      if (isCheckbox && item.kind === "text") {
        el.setAttribute(
          "aria-checked",
          String(item.text.trim().toUpperCase() === "X")
        );
      }
      el.setAttribute("aria-label", this.describeOverlay(item));

      el.style.left = `${item.xNorm * 100}%`;
      el.style.top = `${item.yNorm * 100}%`;
      el.style.width = `${item.widthNorm * 100}%`;
      el.style.height = `${item.heightNorm * 100}%`;
      el.style.transform = item.rotationDeg ? `rotate(${item.rotationDeg}deg)` : "";

      if (item.kind === "highlight") {
        el.style.backgroundColor = item.color;
        el.style.opacity = String(item.opacity);
      } else if (item.kind === "signature" || item.kind === "image") {
        const img = document.createElement("img");
        img.className = "overlay-media-img";
        img.src = item.dataUrl;
        img.alt = item.kind === "signature" ? item.label : item.fileName;
        img.draggable = false;
        img.style.opacity = String(item.opacity);
        el.appendChild(img);
      } else if (item.kind === "text" || item.kind === "redact") {
        const bgColor = item.kind === "redact" ? item.coverColor : item.backgroundColor;
        if (bgColor) {
          el.style.backgroundColor = bgColor;
        }
        const textVal = item.kind === "redact" ? item.replacementText : item.text;
        const textColor = item.kind === "redact" ? item.textColor : item.color;
        const padPx = Math.min(6, Math.max(2, item.fontSizePt * 0.25)) * scale;

        if (isEditing) {
          const ta = document.createElement("textarea");
          ta.className = "overlay-inline-textarea";
          ta.value = textVal;
          ta.placeholder =
            item.kind === "redact"
              ? "Texto substituto (opcional)..."
              : "Digite o texto...";
          ta.setAttribute("aria-label", "Editar conteúdo de texto na página");
          ta.style.fontFamily = cssFontFamily(item.fontFamily);
          ta.style.fontSize = `${item.fontSizePt * scale}px`;
          ta.style.color = textColor;
          ta.style.fontWeight = item.bold ? "700" : "400";
          ta.style.fontStyle = item.italic ? "italic" : "normal";
          ta.style.textAlign = item.align;
          ta.style.padding = `${padPx}px`;

          const warnEl = document.createElement("div");
          warnEl.className = "overlay-inline-winansi-warn";
          warnEl.setAttribute("role", "status");
          warnEl.textContent =
            "Atenção: emojis ou símbolos fora do padrão WinAnsi serão convertidos para '?' ao exportar.";
          warnEl.hidden = !sanitizeWinAnsiText(textVal).hadUnsupported;

          let blurHandled = false;

          ta.addEventListener("input", () => {
            warnEl.hidden = !sanitizeWinAnsiText(ta.value).hadUnsupported;
            this.items = this.items.map((o) => {
              if (o.id !== item.id) return o;
              if (o.kind === "redact") return { ...o, replacementText: ta.value };
              if (o.kind === "text") return { ...o, text: ta.value };
              return o;
            });
            this.options.onMutate(this.items, false);
          });
          ta.addEventListener("keydown", (ev) => {
            if (ev.isComposing || ev.keyCode === 229) return;
            if (ev.key === "Tab") {
              ev.stopPropagation();
              ev.preventDefault();
              blurHandled = true;
              this.options.onMutate(this.items, true);
              this.navigateOverlayByTab(ev.shiftKey ? -1 : 1);
              return;
            }
            if (ev.key === "Escape") {
              ev.stopPropagation();
              ev.preventDefault();
              blurHandled = true;
              this.options.onMutate(this.items, true);
              this.stopInlineEdit();
            }
          });
          ta.addEventListener("blur", () => {
            if (blurHandled) return;
            this.options.onMutate(this.items, true);
            window.setTimeout(() => {
              if (this.editingId === item.id) {
                this.stopInlineEdit();
              }
            }, 60);
          });

          el.appendChild(ta);
          el.appendChild(warnEl);
        } else {
          const textDiv = document.createElement("div");
          textDiv.className = "overlay-text-preview";
          if (isCheckbox) {
            textDiv.textContent = textVal.trim() ? "X" : "";
          } else if (isContractField && item.kind === "text" && item.contractField) {
            textDiv.textContent =
              textVal || item.contractField.labelHint || "Preencher...";
            if (!textVal) {
              textDiv.classList.add("is-placeholder", "is-contract-placeholder");
            }
          } else {
            textDiv.textContent =
              textVal ||
              (item.kind === "text" ? "Clique duplo para editar" : "");
            if (!textVal && item.kind === "text") {
              textDiv.classList.add("is-placeholder");
            }
          }
          textDiv.style.fontFamily = cssFontFamily(item.fontFamily);
          textDiv.style.fontSize = `${item.fontSizePt * scale}px`;
          textDiv.style.color = textColor;
          textDiv.style.fontWeight = item.bold ? "700" : "400";
          textDiv.style.fontStyle = item.italic ? "italic" : "normal";
          textDiv.style.textAlign = item.align;
          textDiv.style.padding = isCheckbox ? "0px" : `${padPx}px`;
          el.appendChild(textDiv);
        }
      }

      if (isSelected && !isEditing) {
        const controls = document.createElement("div");
        controls.className = "overlay-selection-chrome";
        const canEditText = item.kind === "text" || item.kind === "redact";
        const editIcon = isCheckbox ? ICONS.checkSquare : ICONS.typeText;
        const editTitle = isCheckbox ? "Marcar ou desmarcar (Espaço)" : "Editar texto";
        controls.innerHTML = `
          <span class="overlay-handle nw" data-ov-resize="nw" aria-hidden="true"></span>
          <span class="overlay-handle ne" data-ov-resize="ne" aria-hidden="true"></span>
          <span class="overlay-handle se" data-ov-resize="se" aria-hidden="true"></span>
          <span class="overlay-handle sw" data-ov-resize="sw" aria-hidden="true"></span>
          <span class="overlay-rotate-knob" data-ov-rotate="true" title="Arraste para girar" aria-hidden="true"></span>
          <div class="overlay-mini-bar">
            ${
              canEditText
                ? `<button type="button" class="overlay-mini-btn" data-ov-action="edit" title="${editTitle}" aria-label="${editTitle}">${editIcon}</button>`
                : ""
            }
            <button type="button" class="overlay-mini-btn" data-ov-action="duplicate" title="Duplicar camada" aria-label="Duplicar camada">${ICONS.copy}</button>
            <button type="button" class="overlay-mini-btn danger" data-ov-action="delete" title="Excluir camada (Del)" aria-label="Excluir camada">${ICONS.trash}</button>
          </div>
        `;
        el.appendChild(controls);
      }

      this.overlayLayerEl.appendChild(el);
      this.elementMap.set(item.id, el);
    }
  }

  private renderAcroFormWidgets(): void {
    this.formLayerEl.innerHTML = "";
    if (this.acroWidgets.length === 0) return;

    const scale = this.getScalePxPerPt();

    for (const w of this.acroWidgets) {
      const currentVal =
        w.fieldName in this.acroValues
          ? this.acroValues[w.fieldName]
          : w.defaultValue;

      const wrap = document.createElement("div");
      wrap.className = `acroform-widget type-${w.fieldType}`;
      wrap.style.left = `${w.xNorm * 100}%`;
      wrap.style.top = `${w.yNorm * 100}%`;
      wrap.style.width = `${w.widthNorm * 100}%`;
      wrap.style.height = `${w.heightNorm * 100}%`;

      if (w.fieldType === "text") {
        const control = w.multiline
          ? document.createElement("textarea")
          : document.createElement("input");
        if (control instanceof HTMLInputElement) {
          control.type = "text";
        }
        control.className = "acro-input";
        control.dataset.acroField = w.fieldName;
        control.value = String(currentVal ?? "");
        control.disabled = w.readOnly;
        if (w.maxLen) control.maxLength = w.maxLen;
        control.setAttribute("aria-label", `Campo ${w.fieldName}`);
        control.title = w.fieldName;
        control.style.fontSize = `${Math.max(8, w.fontSizePt) * scale}px`;
        control.style.color = w.textColor;
        control.style.textAlign = w.align;
        wrap.appendChild(control);
      } else if (w.fieldType === "checkbox") {
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "acro-check";
        cb.dataset.acroField = w.fieldName;
        cb.checked = Boolean(currentVal === true || currentVal === "Yes" || currentVal === "On");
        cb.disabled = w.readOnly;
        cb.setAttribute("aria-label", `Caixa de seleção ${w.fieldName}`);
        wrap.appendChild(cb);
      } else if (w.fieldType === "radio") {
        const rb = document.createElement("input");
        rb.type = "radio";
        rb.name = `acro-radio-${w.fieldName}`;
        rb.className = "acro-radio";
        rb.dataset.acroField = w.fieldName;
        rb.value = w.exportValue;
        rb.checked = String(currentVal) === w.exportValue;
        rb.disabled = w.readOnly;
        rb.setAttribute("aria-label", `${w.fieldName}: ${w.exportValue}`);
        wrap.appendChild(rb);
      } else if (w.fieldType === "select") {
        const sel = document.createElement("select");
        sel.className = "acro-select";
        sel.dataset.acroField = w.fieldName;
        sel.disabled = w.readOnly;
        sel.setAttribute("aria-label", `Lista ${w.fieldName}`);
        sel.style.fontSize = `${Math.max(8, w.fontSizePt) * scale}px`;
        sel.innerHTML = w.options
          .map(
            (opt) =>
              `<option value="${escapeHtml(opt.exportValue)}">${escapeHtml(opt.displayValue)}</option>`
          )
          .join("");
        sel.value = String(currentVal ?? "");
        wrap.appendChild(sel);
      }

      this.formLayerEl.appendChild(wrap);
    }
  }

  public syncOverlayFontScales(): void {
    const scale = this.getScalePxPerPt();
    for (const item of this.items) {
      if (item.kind !== "text" && item.kind !== "redact") continue;
      const el = this.elementMap.get(item.id);
      if (!el) continue;
      const padPx = Math.min(6, Math.max(2, item.fontSizePt * 0.25)) * scale;
      const target =
        el.querySelector<HTMLElement>(".overlay-text-preview") ||
        el.querySelector<HTMLElement>(".overlay-inline-textarea");
      if (target) {
        target.style.fontSize = `${item.fontSizePt * scale}px`;
        target.style.padding = `${padPx}px`;
      }
    }
  }

  private syncAcroFormScales(): void {
    const scale = this.getScalePxPerPt();
    for (const w of this.acroWidgets) {
      if (w.fieldType !== "text" && w.fieldType !== "select") continue;
      const input = this.formLayerEl.querySelector<HTMLElement>(
        `[data-acro-field="${CSS.escape(w.fieldName)}"]`
      );
      if (input) {
        input.style.fontSize = `${Math.max(8, w.fontSizePt) * scale}px`;
      }
    }
  }

  private duplicateOverlayById(itemId: string): void {
    const src = this.items.find((o) => o.id === itemId);
    if (!src) return;
    const xNorm =
      src.xNorm + 0.03 + src.widthNorm <= 1
        ? src.xNorm + 0.03
        : Math.max(0, src.xNorm - 0.03);
    const yNorm =
      src.yNorm + 0.03 + src.heightNorm <= 1
        ? src.yNorm + 0.03
        : Math.max(0, src.yNorm - 0.03);
    const dup: PageOverlayItem = {
      ...src,
      id: nextAssetId("ov"),
      xNorm,
      yNorm
    };
    const nextItems = [...this.items, dup];
    this.items = nextItems;
    this.selectedId = dup.id;
    this.editingId = null;
    this.options.onSelect(dup.id);
    this.options.onMutate(nextItems, true);
  }

  private showAngleBadge(item: PageOverlayItem, label: string): void {
    if (!this.angleBadgeEl) {
      this.angleBadgeEl = document.createElement("div");
      this.angleBadgeEl.className = "overlay-angle-badge";
      this.angleBadgeEl.setAttribute("aria-hidden", "true");
      this.overlayLayerEl.appendChild(this.angleBadgeEl);
    }
    this.angleBadgeEl.textContent = label;
    this.angleBadgeEl.style.left = `${(item.xNorm + item.widthNorm / 2) * 100}%`;
    this.angleBadgeEl.style.top = `${(item.yNorm + item.heightNorm / 2) * 100}%`;
  }

  private clearAngleBadge(): void {
    this.angleBadgeEl?.remove();
    this.angleBadgeEl = null;
  }

  private describeOverlay(item: PageOverlayItem): string {
    switch (item.kind) {
      case "signature":
        return `Assinatura ${item.label}. Use as setas para mover ou Delete para remover.`;
      case "image":
        return `Imagem ${item.fileName}. Use as setas para mover ou Delete para remover.`;
      case "text":
        if (item.contractField) {
          const hint = item.contractField.labelHint
            ? ` ${item.contractField.labelHint}`
            : "";
          if (item.contractField.fieldKind === "checkbox") {
            return `Caixa de seleção${hint}. Pressione Espaço para marcar, Tab para avançar ou Delete para remover.`;
          }
          return `Campo de contrato${hint}. Digite para preencher, Tab para avançar ou Delete para remover.`;
        }
        return `Texto "${item.text.slice(0, 24)}". Clique duplo para editar ou Delete para remover.`;
      case "redact":
        return `Cobertura e substituição de trecho. Clique duplo para editar texto substituto.`;
      case "highlight":
        return `Marca-texto sobre a página. Use as setas para mover ou Delete para remover.`;
    }
  }
}
