import {
  PAGE_SIZES,
  type CreatePdfPageInput,
  type CreatorPageSize,
  type Orientation,
  type OverlayAssetInput,
  type PageOverlayItem
} from "../types";
import { escapeHtml, formatBytes, pointsToMillimeters, safeFileName } from "../utils/format";
import { ICONS } from "../utils/icons";
import { PdfMergeController } from "../pdf/pdf-merge-client";
import {
  dataUrlToAssetBytes,
  nextAssetId,
  normalizeImageFileToAsset
} from "../editor/image-asset-helper";
import { OverlayInspectorBar } from "../editor/inspector-bar";
import { PageOverlayLayer } from "../editor/page-overlay-editor";
import { SignatureLibraryDialog } from "../editor/signature-modal";

type CreatorOrientation = Exclude<Orientation, "auto">;

interface CreatorPage {
  id: string;
  pageSize: CreatorPageSize;
  orientation: CreatorOrientation;
  backgroundColor: string;
  blocks: PageOverlayItem[];
}

interface CreatorDraftPayload {
  version: 1;
  fileName: string;
  pages: CreatorPage[];
  activePageId: string;
}

const CREATOR_DRAFT_KEY = "rootpdf-creator-draft-v1";

function createDefaultPage(index = 1): CreatorPage {
  return {
    id: nextAssetId("cpage"),
    pageSize: "a4",
    orientation: "portrait",
    backgroundColor: "#ffffff",
    blocks:
      index === 1
        ? [
            {
              id: nextAssetId("ov"),
              kind: "text",
              xNorm: 0.08,
              yNorm: 0.07,
              widthNorm: 0.84,
              heightNorm: 0.08,
              rotationDeg: 0,
              text: "Título do documento",
              fontFamily: "helvetica",
              fontSizePt: 22,
              color: "#111827",
              bold: true,
              italic: false,
              align: "left",
              backgroundColor: null
            },
            {
              id: nextAssetId("ov"),
              kind: "text",
              xNorm: 0.08,
              yNorm: 0.17,
              widthNorm: 0.84,
              heightNorm: 0.24,
              rotationDeg: 0,
              text: "Clique duas vezes para editar este bloco ou adicione novos textos, imagens e assinaturas pela barra acima.",
              fontFamily: "helvetica",
              fontSizePt: 12,
              color: "#334155",
              bold: false,
              italic: false,
              align: "left",
              backgroundColor: null
            }
          ]
        : []
  };
}

function getCreatorPageSizePt(page: CreatorPage): { w: number; h: number } {
  const sizeSpec = PAGE_SIZES[page.pageSize] ?? PAGE_SIZES.a4;
  const baseW = sizeSpec.width;
  const baseH = sizeSpec.height;
  return page.orientation === "landscape"
    ? { w: Math.max(baseW, baseH), h: Math.min(baseW, baseH) }
    : { w: Math.min(baseW, baseH), h: Math.max(baseW, baseH) };
}

/**
 * Interactive multi-page PDF composer creating new documents from scratch
 * (text blocks, uploaded images, and saved signatures) 100% locally.
 */
export interface CreatorStudioOptions {
  onOpenPdfInReader?: (file: File) => void;
}

export class PdfCreatorStudio {
  private readonly host: HTMLElement;
  private readonly options: CreatorStudioOptions;
  private isActive = false;
  private isGenerating = false;
  private lastExportedFile: File | null = null;

  private pages: CreatorPage[] = [];
  private activePageId = "";
  private selectedBlockId: string | null = null;
  private placingTextMode = false;

  private assetBuffers = new Map<string, OverlayAssetInput>();
  private undoStack: Array<{ pageId: string; blocks: PageOverlayItem[] }> = [];
  private pendingUndo: { pageId: string; blocks: PageOverlayItem[] } | null = null;
  private draftSaveTimer: number | null = null;
  private progressHideTimer: number | null = null;
  private stageResizeObserver: ResizeObserver | null = null;

  private mergeController = new PdfMergeController();
  private overlayLayer!: PageOverlayLayer;
  private inspectorBar!: OverlayInspectorBar;
  private signatureModal!: SignatureLibraryDialog;

  // DOM refs
  private addTextBtn!: HTMLButtonElement;
  private addImageBtn!: HTMLButtonElement;
  private addSignatureBtn!: HTMLButtonElement;
  private imageInput!: HTMLInputElement;
  private pageSettingsToggleBtn!: HTMLButtonElement;
  private pageSettingsSummaryEl!: HTMLElement;
  private pageSettingsPanel!: HTMLElement;
  private pageSettingsOpenMobile = false;
  private resetDraftBtn!: HTMLButtonElement;
  private pageSizeSelect!: HTMLSelectElement;
  private orientationSelect!: HTMLSelectElement;
  private bgSelect!: HTMLSelectElement;
  private addPageBtn!: HTMLButtonElement;
  private pageListEl!: HTMLElement;
  private inspectorHost!: HTMLElement;
  private stageEl!: HTMLElement;
  private pageFrameEl!: HTMLElement;
  private pageMetaEl!: HTMLElement;
  private fileNameInput!: HTMLInputElement;
  private exportBtn!: HTMLButtonElement;
  private cancelBtn!: HTMLButtonElement;
  private openReaderBtn!: HTMLButtonElement;
  private progressWrap!: HTMLElement;
  private progressBar!: HTMLElement;
  private progressText!: HTMLElement;
  private progressPercent!: HTMLElement;
  private statusEl!: HTMLParagraphElement;

  constructor(host: HTMLElement, options: CreatorStudioOptions = {}) {
    this.host = host;
    this.options = options;
    this.restoreDraft();
    this.renderMarkup();
    this.bindElements();
    this.setupModules();
    this.setupResizeObserver();
    this.bindEvents();
    this.syncAll();
  }

  public setActive(active: boolean): void {
    this.isActive = active;
    if (active) {
      window.requestAnimationFrame(() => this.fitSheetToStage());
    }
  }

  public isModalOpen(): boolean {
    return this.signatureModal.isOpen();
  }

  private restoreDraft(): void {
    try {
      const raw = localStorage.getItem(CREATOR_DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<CreatorDraftPayload>;
        if (Array.isArray(parsed.pages) && parsed.pages.length > 0) {
          this.pages = parsed.pages.map((p) => ({
            id: p.id || nextAssetId("cpage"),
            pageSize: p.pageSize && p.pageSize in PAGE_SIZES ? p.pageSize : "a4",
            orientation: p.orientation === "landscape" ? "landscape" : "portrait",
            backgroundColor: typeof p.backgroundColor === "string" ? p.backgroundColor : "#ffffff",
            blocks: Array.isArray(p.blocks) ? p.blocks : []
          }));
          this.activePageId =
            this.pages.some((p) => p.id === parsed.activePageId) && parsed.activePageId
              ? parsed.activePageId
              : this.pages[0].id;
          return;
        }
      }
    } catch {
      // Fallback to crisp initial blank document
    }

    const first = createDefaultPage(1);
    this.pages = [first];
    this.activePageId = first.id;
  }

  private scheduleSaveDraft(): void {
    if (this.draftSaveTimer !== null) {
      window.clearTimeout(this.draftSaveTimer);
    }
    this.draftSaveTimer = window.setTimeout(() => {
      this.draftSaveTimer = null;
      try {
        const payload: CreatorDraftPayload = {
          version: 1,
          fileName: this.fileNameInput?.value || "novo-documento",
          pages: this.pages,
          activePageId: this.activePageId
        };
        localStorage.setItem(CREATOR_DRAFT_KEY, JSON.stringify(payload));
      } catch {
        // Ignore storage quota overflow if large images are embedded
      }
    }, 450);
  }

  private renderMarkup(): void {
    let savedFileName = "novo-documento";
    try {
      const raw = localStorage.getItem(CREATOR_DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<CreatorDraftPayload>;
        if (typeof parsed.fileName === "string" && parsed.fileName.trim()) {
          savedFileName = parsed.fileName;
        }
      }
    } catch {
      // Default filename
    }

    this.host.innerHTML = `
      <section class="creator-workbench" aria-label="Compositor de novo documento PDF">
        <div class="creator-toolbar panel" role="toolbar" aria-label="Ferramentas de criação de PDF">
          <div class="editor-tool-group">
            <button id="creatorAddTextBtn" type="button" class="button secondary compact-btn" title="Clique na folha para posicionar ou criar caixa de texto">
              ${ICONS.typeText}
              <span>Adicionar texto</span>
            </button>
            <button id="creatorAddImageBtn" type="button" class="button ghost compact-btn" title="Inserir imagem PNG, JPG, WEBP ou SVG na folha">
              ${ICONS.imagePlus}
              <span>Inserir imagem</span>
            </button>
            <button id="creatorAddSigBtn" type="button" class="button ghost compact-btn" title="Inserir assinatura desenhada, enviada ou salva">
              ${ICONS.signature}
              <span>Assinar</span>
            </button>
            <input id="creatorImageInput" type="file" accept=".png,.jpg,.jpeg,.webp,.avif,.svg,image/*" hidden />
          </div>

          <button
            id="creatorPageSettingsToggle"
            type="button"
            class="button ghost compact-btn creator-settings-toggle"
            aria-expanded="false"
            aria-controls="creatorPageSettings"
            aria-label="Opções de folha e rascunho"
          >
            <span class="creator-settings-toggle-left">
              ${ICONS.sliders}
              <span id="creatorPageSettingsSummary">Folha: A4 · Retrato</span>
            </span>
            <span class="creator-settings-chevron" aria-hidden="true">${ICONS.arrowDown}</span>
          </button>

          <div id="creatorPageSettings" class="creator-page-settings">
            <label class="insp-field" for="creatorPageSize">
              <span>Folha</span>
              <select id="creatorPageSize">
                <option value="a4">A4</option>
                <option value="a5">A5</option>
                <option value="letter">Carta (Letter)</option>
                <option value="legal">Ofício (Legal)</option>
              </select>
            </label>
            <label class="insp-field" for="creatorOrientation">
              <span>Orientação</span>
              <select id="creatorOrientation">
                <option value="portrait">Retrato</option>
                <option value="landscape">Paisagem</option>
              </select>
            </label>
            <label class="insp-field" for="creatorBgColor">
              <span>Papel</span>
              <select id="creatorBgColor">
                <option value="#ffffff">Branco</option>
                <option value="#fdfbf7">Creme</option>
                <option value="#faf5f5">Rosé Claro</option>
                <option value="#f8fafc">Gelo</option>
              </select>
            </label>
            <button id="creatorResetBtn" type="button" class="button ghost compact-btn danger-hover" title="Limpar rascunho e iniciar documento em branco">
              ${ICONS.filePlus}
              <span>Novo rascunho</span>
            </button>
          </div>
        </div>

        <div id="creatorInspectorHost" class="reader-inspector-host panel"></div>

        <div class="creator-layout">
          <aside class="panel creator-sidebar" aria-label="Páginas e exportação do documento">
            <div class="creator-sidebar-head">
              <div>
                <span class="section-kicker" aria-hidden="true">DOC</span>
                <h2>Páginas criadas</h2>
              </div>
              <button id="creatorAddPageBtn" type="button" class="button secondary compact-btn">
                ${ICONS.plus}
                <span>Nova pág.</span>
              </button>
            </div>

            <div id="creatorPageList" class="creator-page-list" role="list" aria-label="Páginas do documento"></div>

            <div class="reader-export-box">
              <label class="field" for="creatorFileName">
                <span>Arquivo de saída</span>
                <div class="input-with-icon">
                  <span class="input-prefix" aria-hidden="true">
                    ${ICONS.fileText}
                    <b>PDF</b>
                  </span>
                  <input id="creatorFileName" type="text" maxlength="80" value="${escapeHtml(savedFileName)}" placeholder="novo-documento" spellcheck="false" />
                </div>
              </label>

              <div id="creatorProgress" class="progress-wrap" hidden>
                <div class="progress-head">
                  <span id="creatorProgressText">Gerando PDF...</span>
                  <strong id="creatorProgressPercent">0%</strong>
                </div>
                <div class="progress-track">
                  <div id="creatorProgressBar" class="progress-bar"></div>
                </div>
              </div>

              <div class="action-buttons">
                <button id="creatorExportBtn" type="button" class="button primary generate-button">
                  ${ICONS.download}
                  <span>Gerar &amp; Baixar PDF</span>
                </button>
                <button id="creatorCancelBtn" type="button" class="button ghost danger-hover" hidden>
                  ${ICONS.close}
                  <span>Cancelar</span>
                </button>
              </div>
              <button id="creatorOpenReaderBtn" type="button" class="button ghost creator-open-reader-btn" hidden>
                ${ICONS.bookOpen}
                <span>Abrir no Leitor &amp; Editor</span>
              </button>

              <p id="creatorStatus" class="status" role="status" aria-live="polite"></p>
            </div>
          </aside>

          <section class="panel reader-stage-panel creator-stage-panel" aria-label="Prancheta de edição da página">
            <div id="creatorStage" class="reader-stage creator-stage" tabindex="0">
              <div id="creatorPageFrame" class="pdf-page-frame creator-page-frame"></div>
            </div>
            <div class="reader-stage-footer">
              <span id="creatorPageMeta" class="reader-page-meta">—</span>
              <span class="reader-stage-hint">Clique duplo no texto para digitar · Arraste cantos para redimensionar · Salvo localmente</span>
            </div>
          </section>
        </div>
      </section>
    `;
  }

  private q<T extends HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Elemento #${id} não encontrado no Compositor.`);
    return el as T;
  }

  private bindElements(): void {
    this.addTextBtn = this.q("creatorAddTextBtn");
    this.addImageBtn = this.q("creatorAddImageBtn");
    this.addSignatureBtn = this.q("creatorAddSigBtn");
    this.imageInput = this.q("creatorImageInput");
    this.pageSettingsToggleBtn = this.q("creatorPageSettingsToggle");
    this.pageSettingsSummaryEl = this.q("creatorPageSettingsSummary");
    this.pageSettingsPanel = this.q("creatorPageSettings");
    this.resetDraftBtn = this.q("creatorResetBtn");
    this.pageSizeSelect = this.q("creatorPageSize");
    this.orientationSelect = this.q("creatorOrientation");
    this.bgSelect = this.q("creatorBgColor");
    this.addPageBtn = this.q("creatorAddPageBtn");
    this.pageListEl = this.q("creatorPageList");
    this.inspectorHost = this.q("creatorInspectorHost");
    this.stageEl = this.q("creatorStage");
    this.pageFrameEl = this.q("creatorPageFrame");
    this.pageMetaEl = this.q("creatorPageMeta");
    this.fileNameInput = this.q("creatorFileName");
    this.exportBtn = this.q("creatorExportBtn");
    this.cancelBtn = this.q("creatorCancelBtn");
    this.openReaderBtn = this.q("creatorOpenReaderBtn");
    this.progressWrap = this.q("creatorProgress");
    this.progressBar = this.q("creatorProgressBar");
    this.progressText = this.q("creatorProgressText");
    this.progressPercent = this.q("creatorProgressPercent");
    this.statusEl = this.q("creatorStatus");
  }

  private setupModules(): void {
    this.signatureModal = new SignatureLibraryDialog(this.host);

    this.overlayLayer = new PageOverlayLayer({
      hostFrame: this.pageFrameEl,
      onSelect: (id) => {
        this.selectedBlockId = id;
        this.syncInspector();
      },
      onMutate: (blocks, commit) => {
        const page = this.getActivePage();
        if (!page) return;
        if (!commit) {
          if (!this.pendingUndo || this.pendingUndo.pageId !== page.id) {
            this.pendingUndo = {
              pageId: page.id,
              blocks: page.blocks.map((b) => ({ ...b }))
            };
          }
          page.blocks = blocks;
          this.syncInspector();
          return;
        }

        if (this.pendingUndo && this.pendingUndo.pageId === page.id) {
          this.pushUndo(page.id, this.pendingUndo.blocks);
          this.pendingUndo = null;
        } else {
          this.pushUndo(page.id, page.blocks);
        }
        page.blocks = blocks;
        this.syncAll();
        this.scheduleSaveDraft();
      },
      onDelete: (id) => this.deleteBlock(id),
      onCreateAt: (rect) => {
        if (!this.placingTextMode) return null;
        this.placingTextMode = false;
        this.overlayLayer.setPlacementMode(false);
        this.addTextBtn.classList.remove("is-tool-active");
        return this.insertTextBlockAt(rect);
      }
    });

    this.inspectorBar = new OverlayInspectorBar(this.inspectorHost, {
      onPatchSelected: (patch, commit = true) => {
        const page = this.getActivePage();
        if (!page || !this.selectedBlockId) return;

        if (!commit) {
          if (!this.pendingUndo || this.pendingUndo.pageId !== page.id) {
            this.pendingUndo = {
              pageId: page.id,
              blocks: page.blocks.map((b) => ({ ...b }))
            };
          }
        } else if (this.pendingUndo && this.pendingUndo.pageId === page.id) {
          this.pushUndo(page.id, this.pendingUndo.blocks);
          this.pendingUndo = null;
        } else {
          this.pushUndo(page.id, page.blocks);
        }

        page.blocks = page.blocks.map((b) =>
          b.id === this.selectedBlockId ? ({ ...b, ...patch } as PageOverlayItem) : b
        );
        const dims = getCreatorPageSizePt(page);
        this.overlayLayer.setState({
          items: page.blocks,
          selectedId: this.selectedBlockId,
          pageWidthPt: dims.w,
          pageHeightPt: dims.h
        });
        if (commit) {
          this.syncInspector();
          this.renderPageList();
          this.scheduleSaveDraft();
        }
      },
      onStartEditSelected: () => {
        if (this.selectedBlockId) {
          this.overlayLayer.startInlineEdit(this.selectedBlockId);
        }
      },
      onDeleteSelected: () => {
        if (this.selectedBlockId) {
          this.deleteBlock(this.selectedBlockId);
        }
      },
      onUndo: () => this.undo(),
      onClearPage: () => this.clearActivePageBlocks()
    });
  }

  private setupResizeObserver(): void {
    if (typeof ResizeObserver === "undefined") return;
    this.stageResizeObserver = new ResizeObserver(() => {
      if (this.isActive) {
        window.requestAnimationFrame(() => this.fitSheetToStage());
      }
    });
    this.stageResizeObserver.observe(this.stageEl);
  }

  private bindEvents(): void {
    this.addTextBtn.addEventListener("click", () => {
      if (this.placingTextMode) {
        this.placingTextMode = false;
        this.overlayLayer.setPlacementMode(false);
        this.addTextBtn.classList.remove("is-tool-active");
        return;
      }
      const created = this.insertTextBlockAt({
        xNorm: 0.1,
        yNorm: 0.44,
        widthNorm: 0.48,
        heightNorm: 0.1
      });
      if (created) {
        this.overlayLayer.startInlineEdit(created.id);
      }
    });

    this.addImageBtn.addEventListener("click", () => this.imageInput.click());
    this.imageInput.addEventListener("change", () => {
      const file = this.imageInput.files?.[0];
      this.imageInput.value = "";
      if (file) void this.insertImageFile(file);
    });

    this.addSignatureBtn.addEventListener("click", () => {
      this.signatureModal.open((sig) => {
        this.insertSignatureBlock(sig.label, sig.dataUrl, sig.aspectRatio);
      });
    });

    this.pageSettingsToggleBtn.addEventListener("click", () => {
      this.pageSettingsOpenMobile = !this.pageSettingsOpenMobile;
      this.pageSettingsPanel.classList.toggle("is-open", this.pageSettingsOpenMobile);
      this.pageSettingsToggleBtn.setAttribute(
        "aria-expanded",
        String(this.pageSettingsOpenMobile)
      );
    });

    this.pageSizeSelect.addEventListener("change", () => {
      const page = this.getActivePage();
      if (!page) return;
      page.pageSize = this.pageSizeSelect.value as CreatorPageSize;
      this.syncAll();
      this.scheduleSaveDraft();
    });

    this.orientationSelect.addEventListener("change", () => {
      const page = this.getActivePage();
      if (!page) return;
      page.orientation = this.orientationSelect.value as CreatorOrientation;
      this.syncAll();
      this.scheduleSaveDraft();
    });

    this.bgSelect.addEventListener("change", () => {
      const page = this.getActivePage();
      if (!page) return;
      page.backgroundColor = this.bgSelect.value;
      this.syncAll();
      this.scheduleSaveDraft();
    });

    this.addPageBtn.addEventListener("click", () => {
      const active = this.getActivePage();
      const next: CreatorPage = {
        id: nextAssetId("cpage"),
        pageSize: active?.pageSize ?? "a4",
        orientation: active?.orientation ?? "portrait",
        backgroundColor: active?.backgroundColor ?? "#ffffff",
        blocks: []
      };
      this.pages.push(next);
      this.activePageId = next.id;
      this.selectedBlockId = null;
      this.syncAll();
      this.scheduleSaveDraft();
      this.setStatus(`Página ${this.pages.length} criada.`, "info");
    });

    this.resetDraftBtn.addEventListener("click", () => {
      const fresh = createDefaultPage(1);
      this.pages = [fresh];
      this.activePageId = fresh.id;
      this.selectedBlockId = null;
      this.undoStack = [];
      this.pendingUndo = null;
      this.lastExportedFile = null;
      this.openReaderBtn.hidden = true;
      this.assetBuffers.clear();
      this.syncAll();
      this.scheduleSaveDraft();
      this.setStatus("Novo documento iniciado.", "info");
    });

    this.openReaderBtn.addEventListener("click", () => {
      if (!this.lastExportedFile) return;
      this.options.onOpenPdfInReader?.(this.lastExportedFile);
    });

    this.fileNameInput.addEventListener("input", () => this.scheduleSaveDraft());

    this.pageListEl.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const card = target.closest<HTMLElement>("[data-cpage-id]");
      if (!card) return;
      const id = card.dataset.cpageId || "";
      const action = target.closest<HTMLElement>("[data-cpage-action]")?.dataset.cpageAction;

      if (!action) {
        this.activePageId = id;
        this.selectedBlockId = null;
        this.overlayLayer.stopInlineEdit();
        this.syncAll();
        return;
      }

      const idx = this.pages.findIndex((p) => p.id === id);
      if (idx === -1) return;

      if (action === "up" && idx > 0) {
        [this.pages[idx], this.pages[idx - 1]] = [this.pages[idx - 1], this.pages[idx]];
      } else if (action === "down" && idx < this.pages.length - 1) {
        [this.pages[idx], this.pages[idx + 1]] = [this.pages[idx + 1], this.pages[idx]];
      } else if (action === "duplicate") {
        const src = this.pages[idx];
        const dup: CreatorPage = {
          ...src,
          id: nextAssetId("cpage"),
          blocks: src.blocks.map((b) => ({ ...b, id: nextAssetId("ov") }))
        };
        this.pages.splice(idx + 1, 0, dup);
        this.activePageId = dup.id;
      } else if (action === "remove") {
        if (this.pages.length <= 1) {
          this.pages[0].blocks = [];
        } else {
          this.pages.splice(idx, 1);
          if (this.activePageId === id) {
            this.activePageId = this.pages[Math.min(idx, this.pages.length - 1)].id;
          }
        }
        this.selectedBlockId = null;
      }

      this.syncAll();
      this.scheduleSaveDraft();
    });

    this.exportBtn.addEventListener("click", () => void this.exportCreatedPdf());
    this.cancelBtn.addEventListener("click", () => this.mergeController.cancel());

    window.addEventListener("keydown", (event) => {
      if (!this.isActive || this.signatureModal.isOpen()) return;
      const activeEl = document.activeElement;
      const typing =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl instanceof HTMLSelectElement;

      if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        this.undo();
        return;
      }

      if (typing) return;
      this.overlayLayer.handleKeyDown(event);
    });
  }

  private getActivePage(): CreatorPage | undefined {
    return this.pages.find((p) => p.id === this.activePageId) ?? this.pages[0];
  }

  private pushUndo(pageId: string, snapshot: PageOverlayItem[]): void {
    this.undoStack.push({
      pageId,
      blocks: snapshot.map((b) => ({ ...b }))
    });
    if (this.undoStack.length > 40) {
      this.undoStack.shift();
    }
  }

  private undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    const page = this.pages.find((p) => p.id === entry.pageId);
    if (!page) return;
    this.pendingUndo = null;
    this.overlayLayer.stopInlineEdit();
    page.blocks = entry.blocks.map((b) => ({ ...b }));
    this.activePageId = page.id;
    this.selectedBlockId = null;
    this.syncAll();
    this.scheduleSaveDraft();
    this.setStatus("Última edição desfeita.", "info");
  }

  private insertTextBlockAt(rect: {
    xNorm: number;
    yNorm: number;
    widthNorm: number;
    heightNorm: number;
  }): PageOverlayItem | null {
    const page = this.getActivePage();
    if (!page) return null;
    this.pushUndo(page.id, page.blocks);

    const w = rect.widthNorm > 0 ? rect.widthNorm : 0.48;
    const h = rect.heightNorm > 0 ? rect.heightNorm : 0.1;
    const block: PageOverlayItem = {
      id: nextAssetId("ov"),
      kind: "text",
      xNorm: Math.max(0.04, Math.min(1 - w, rect.xNorm)),
      yNorm: Math.max(0.04, Math.min(1 - h, rect.yNorm)),
      widthNorm: w,
      heightNorm: h,
      rotationDeg: 0,
      text: "Novo bloco de texto",
      fontFamily: "helvetica",
      fontSizePt: 13,
      color: "#111827",
      bold: false,
      italic: false,
      align: "left",
      backgroundColor: null
    };

    page.blocks.push(block);
    this.selectedBlockId = block.id;
    this.syncAll();
    this.scheduleSaveDraft();
    return block;
  }

  private async insertImageFile(file: File): Promise<void> {
    const page = this.getActivePage();
    if (!page) return;

    try {
      const normalized = await normalizeImageFileToAsset(file);
      this.assetBuffers.set(normalized.assetId, {
        assetId: normalized.assetId,
        mimeType: normalized.mimeType,
        bytes: normalized.bytes
      });

      this.pushUndo(page.id, page.blocks);
      const dims = getCreatorPageSizePt(page);
      const pageAspect = dims.w / Math.max(1, dims.h);
      const imgAspect = normalized.width / Math.max(1, normalized.height);
      const widthNorm = 0.42;
      const heightNorm = Math.min(0.65, Math.max(0.08, (widthNorm * pageAspect) / imgAspect));

      const block: PageOverlayItem = {
        id: nextAssetId("ov"),
        kind: "image",
        assetId: normalized.assetId,
        fileName: normalized.fileName,
        dataUrl: normalized.dataUrl,
        xNorm: 0.5 - widthNorm / 2,
        yNorm: 0.5 - heightNorm / 2,
        widthNorm,
        heightNorm,
        rotationDeg: 0,
        opacity: 1
      };

      page.blocks.push(block);
      this.selectedBlockId = block.id;
      this.syncAll();
      this.scheduleSaveDraft();
      this.setStatus(`Imagem "${normalized.fileName}" adicionada à página.`, "success");
    } catch (error) {
      this.setStatus(
        error instanceof Error ? error.message : "Erro ao carregar imagem.",
        "error"
      );
    }
  }

  private insertSignatureBlock(
    label: string,
    dataUrl: string,
    aspectRatio: number
  ): void {
    const page = this.getActivePage();
    if (!page) return;
    this.pushUndo(page.id, page.blocks);

    const dims = getCreatorPageSizePt(page);
    const pageAspect = dims.w / Math.max(1, dims.h);
    const widthNorm = 0.28;
    const heightNorm = Math.min(0.45, Math.max(0.05, (widthNorm * pageAspect) / Math.max(0.3, aspectRatio)));
    const assetId = nextAssetId("sig");

    try {
      this.assetBuffers.set(assetId, {
        assetId,
        ...dataUrlToAssetBytes(dataUrl)
      });
    } catch {
      // Decoded at export
    }

    const block: PageOverlayItem = {
      id: nextAssetId("ov"),
      kind: "signature",
      assetId,
      label,
      dataUrl,
      xNorm: 0.5 - widthNorm / 2,
      yNorm: Math.max(0.05, 0.78 - heightNorm / 2),
      widthNorm,
      heightNorm,
      rotationDeg: 0,
      opacity: 1
    };

    page.blocks.push(block);
    this.selectedBlockId = block.id;
    this.syncAll();
    this.scheduleSaveDraft();
    this.setStatus(`Assinatura "${label}" inserida na folha.`, "success");
  }

  private deleteBlock(id: string): void {
    const page = this.getActivePage();
    if (!page) return;
    if (!page.blocks.some((b) => b.id === id)) return;
    this.pushUndo(page.id, page.blocks);
    page.blocks = page.blocks.filter((b) => b.id !== id);
    if (this.selectedBlockId === id) {
      this.selectedBlockId = null;
    }
    this.overlayLayer.stopInlineEdit();
    this.syncAll();
    this.scheduleSaveDraft();
  }

  private clearActivePageBlocks(): void {
    const page = this.getActivePage();
    if (!page || page.blocks.length === 0) return;
    this.pushUndo(page.id, page.blocks);
    page.blocks = [];
    this.selectedBlockId = null;
    this.overlayLayer.stopInlineEdit();
    this.syncAll();
    this.scheduleSaveDraft();
    this.setStatus("Página atual limpa.", "info");
  }

  private fitSheetToStage(): void {
    const page = this.getActivePage();
    if (!page) return;
    const dims = getCreatorPageSizePt(page);
    const availW = Math.max(240, this.stageEl.clientWidth - 48);
    const availH = Math.max(300, this.stageEl.clientHeight - 48);
    const scale = Math.min(availW / dims.w, availH / dims.h, 1.35);

    this.pageFrameEl.style.width = `${Math.round(dims.w * scale)}px`;
    this.pageFrameEl.style.height = `${Math.round(dims.h * scale)}px`;
    this.pageFrameEl.style.backgroundColor = page.backgroundColor;
    this.overlayLayer.setPageDimensions(dims.w, dims.h);
    this.overlayLayer.syncOverlayFontScales();
  }

  private syncInspector(): void {
    const page = this.getActivePage();
    const blocks = page?.blocks ?? [];
    const selectedItem = blocks.find((b) => b.id === this.selectedBlockId) ?? null;
    this.inspectorBar.update({
      selectedItem,
      canUndo: this.undoStack.length > 0,
      pageOverlayCount: blocks.length,
      hintText: "Selecione um bloco na folha ou use os botões acima para adicionar texto, imagem ou assinatura."
    });
  }

  private renderPageList(): void {
    this.pageListEl.innerHTML = this.pages
      .map((p, i) => {
        const isCurrent = p.id === this.activePageId;
        const sizeLabel = p.pageSize.toUpperCase();
        const orientLabel = p.orientation === "landscape" ? "Paisagem" : "Retrato";
        return `
          <div class="creator-page-card ${isCurrent ? "is-active" : ""}" role="listitem" data-cpage-id="${escapeHtml(p.id)}" aria-current="${isCurrent ? "page" : "false"}">
            <button type="button" class="creator-page-select" aria-label="Selecionar página ${i + 1}">
              <strong>Página ${String(i + 1).padStart(2, "0")}</strong>
              <span>${sizeLabel} · ${orientLabel} · ${p.blocks.length} ${p.blocks.length === 1 ? "bloco" : "blocos"}</span>
            </button>
            <div class="creator-page-actions">
              <button type="button" class="icon-button" data-cpage-action="up" ${i === 0 ? "disabled" : ""} aria-label="Subir página ${i + 1}" title="Subir">${ICONS.arrowUp}</button>
              <button type="button" class="icon-button" data-cpage-action="down" ${i === this.pages.length - 1 ? "disabled" : ""} aria-label="Descer página ${i + 1}" title="Descer">${ICONS.arrowDown}</button>
              <button type="button" class="icon-button" data-cpage-action="duplicate" aria-label="Duplicar página ${i + 1}" title="Duplicar">${ICONS.copy}</button>
              <button type="button" class="icon-button danger" data-cpage-action="remove" aria-label="Remover ou limpar página ${i + 1}" title="Excluir">${ICONS.trash}</button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  private syncAll(): void {
    const page = this.getActivePage();
    if (!page) return;

    this.pageSizeSelect.value = page.pageSize;
    this.orientationSelect.value = page.orientation;
    this.bgSelect.value = page.backgroundColor;

    const sizeLabel =
      page.pageSize === "letter"
        ? "Carta"
        : page.pageSize === "legal"
          ? "Ofício"
          : page.pageSize.toUpperCase();
    const orientLabel = page.orientation === "landscape" ? "Paisagem" : "Retrato";
    this.pageSettingsSummaryEl.textContent = `Folha: ${sizeLabel} · ${orientLabel}`;

    this.fitSheetToStage();
    const dims = getCreatorPageSizePt(page);
    this.overlayLayer.setState({
      items: page.blocks,
      selectedId: this.selectedBlockId,
      pageWidthPt: dims.w,
      pageHeightPt: dims.h
    });

    const pageIdx = this.pages.indexOf(page);
    this.pageMetaEl.textContent = `Página ${pageIdx + 1} de ${this.pages.length} · ${page.pageSize.toUpperCase()} (${pointsToMillimeters(dims.w)} × ${pointsToMillimeters(dims.h)} mm) · ${page.blocks.length} blocos`;

    this.renderPageList();
    this.syncInspector();

    this.exportBtn.disabled = this.isGenerating;
  }

  private setStatus(msg: string, type: "info" | "success" | "error"): void {
    this.statusEl.textContent = msg;
    this.statusEl.dataset.type = type;
  }

  private updateProgress(current: number, total: number, message: string): void {
    const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
    this.progressWrap.hidden = false;
    this.progressBar.style.width = `${pct}%`;
    this.progressText.textContent = message;
    this.progressPercent.textContent = `${pct}%`;
  }

  private async exportCreatedPdf(): Promise<void> {
    if (this.isGenerating || this.pages.length === 0) return;
    if (this.progressHideTimer !== null) {
      window.clearTimeout(this.progressHideTimer);
      this.progressHideTimer = null;
    }

    this.isGenerating = true;
    this.lastExportedFile = null;
    this.openReaderBtn.hidden = true;
    this.cancelBtn.hidden = false;
    this.exportBtn.disabled = true;
    this.overlayLayer.stopInlineEdit();

    const assetsMap = new Map<string, OverlayAssetInput>();
    const createPages: CreatePdfPageInput[] = this.pages.map((page) => {
      const blocks: CreatePdfPageInput["blocks"] = [];
      for (const b of page.blocks) {
        if (b.kind === "text") {
          blocks.push(b);
        } else if (b.kind === "image" || b.kind === "signature") {
          if (!assetsMap.has(b.assetId)) {
            const cached = this.assetBuffers.get(b.assetId);
            if (cached) {
              assetsMap.set(b.assetId, cached);
            } else {
              const converted = dataUrlToAssetBytes(b.dataUrl);
              const asset: OverlayAssetInput = { assetId: b.assetId, ...converted };
              this.assetBuffers.set(b.assetId, asset);
              assetsMap.set(b.assetId, asset);
            }
          }
          blocks.push({
            id: b.id,
            kind: "image",
            xNorm: b.xNorm,
            yNorm: b.yNorm,
            widthNorm: b.widthNorm,
            heightNorm: b.heightNorm,
            rotationDeg: b.rotationDeg,
            assetId: b.assetId,
            fileName: b.kind === "signature" ? b.label : b.fileName,
            opacity: b.opacity
          });
        }
      }
      return {
        pageSize: page.pageSize,
        orientation: page.orientation,
        backgroundColor: page.backgroundColor,
        blocks
      };
    });

    const outName = safeFileName(this.fileNameInput.value || "novo-documento");
    this.updateProgress(0, createPages.length, "Preparando geração local...");
    this.setStatus("Gerando novo PDF em segundo plano...", "info");

    try {
      const pdfBuffer = await this.mergeController.create({
        pages: createPages,
        assets: Array.from(assetsMap.values()),
        fileName: outName,
        onProgress: (c, t, m) => this.updateProgress(c, t, m)
      });

      const fileName = `${outName}.pdf`;
      const blob = new Blob([pdfBuffer], { type: "application/pdf" });
      this.lastExportedFile = new File([blob], fileName, { type: "application/pdf" });
      this.openReaderBtn.hidden = !this.options.onOpenPdfInReader;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);

      this.updateProgress(1, 1, "Documento PDF pronto!");
      this.setStatus(
        `PDF "${outName}.pdf" gerado (${this.pages.length} ${this.pages.length === 1 ? "página" : "páginas"}, ${formatBytes(pdfBuffer.byteLength)}).`,
        "success"
      );
    } catch (error) {
      if (error instanceof Error && error.message === "CANCELLED") {
        this.setStatus("Geração cancelada.", "info");
        this.progressWrap.hidden = true;
      } else {
        console.error(error);
        this.setStatus(
          error instanceof Error ? error.message : "Erro ao gerar o documento PDF.",
          "error"
        );
      }
    } finally {
      this.isGenerating = false;
      this.cancelBtn.hidden = true;
      this.exportBtn.disabled = false;
      if (!this.progressWrap.hidden) {
        this.progressHideTimer = window.setTimeout(() => {
          this.progressWrap.hidden = true;
        }, 2000);
      }
    }
  }
}
