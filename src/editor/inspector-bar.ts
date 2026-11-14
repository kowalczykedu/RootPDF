import type {
  EditorFontFamily,
  EditorTextAlign,
  PageOverlayItem
} from "../types";
import { ICONS } from "../utils/icons";
import { sanitizeWinAnsiText } from "../utils/layout";

export interface InspectorCallbacks {
  onPatchSelected: (patch: Partial<PageOverlayItem>, commit?: boolean) => void;
  onStartEditSelected: () => void;
  onDeleteSelected: () => void;
  onUndo: () => void;
  onClearPage?: () => void;
  onClearEmptyContractFields?: () => void;
}

const FONT_SIZE_PRESETS = [9, 10, 11, 12, 14, 16, 18, 22, 26, 32, 42, 56];

/**
 * Contextual property inspector strip shared between Reader Overlay Editor
 * and From-Scratch PDF Composer.
 */
export class OverlayInspectorBar {
  private readonly host: HTMLElement;
  private readonly callbacks: InspectorCallbacks;

  private activeItem: PageOverlayItem | null = null;
  private canUndo = false;
  private pageOverlayCount = 0;
  private emptyContractCount = 0;
  private hintText = "";

  constructor(host: HTMLElement, callbacks: InspectorCallbacks) {
    this.host = host;
    this.callbacks = callbacks;
    this.host.classList.add("overlay-inspector-bar");
    this.render();
    this.bindEvents();
  }

  public update(params: {
    selectedItem: PageOverlayItem | null;
    canUndo: boolean;
    pageOverlayCount: number;
    emptyContractCount?: number;
    hintText?: string;
  }): void {
    this.activeItem = params.selectedItem;
    this.canUndo = params.canUndo;
    this.pageOverlayCount = params.pageOverlayCount;
    this.emptyContractCount = params.emptyContractCount ?? 0;
    this.hintText = params.hintText ?? "";
    this.render();
  }

  private render(): void {
    const item = this.activeItem;

    const historyControls = `
      <div class="insp-group insp-history">
        <button type="button" class="button ghost compact-btn" data-insp-cmd="undo" ${this.canUndo ? "" : "disabled"} title="Desfazer última edição (Ctrl+Z)">
          ${ICONS.undo}
          <span>Desfazer</span>
        </button>
        ${
          this.callbacks.onClearEmptyContractFields && this.emptyContractCount > 0
            ? `<button type="button" class="button ghost compact-btn" data-insp-cmd="clear-empty-contract" title="Remover guias de contrato ainda vazias nesta página">
                ${ICONS.eraser}
                <span>Descartar vazios (${this.emptyContractCount})</span>
              </button>`
            : ""
        }
        ${
          this.callbacks.onClearPage
            ? `<button type="button" class="button ghost compact-btn danger-hover" data-insp-cmd="clear-page" ${this.pageOverlayCount > 0 ? "" : "disabled"} title="Remover todas as anotações desta página">
                ${ICONS.trash}
                <span>Limpar página (${this.pageOverlayCount})</span>
              </button>`
            : ""
        }
      </div>
    `;

    if (!item) {
      this.host.innerHTML = `
        <div class="insp-empty-msg">
          <span>${this.hintText || "Selecione uma ferramenta acima para assinar, adicionar texto, imagem ou cobrir trechos."}</span>
        </div>
        ${historyControls}
      `;
      return;
    }

    let propsHtml = "";

    if (item.kind === "text" || item.kind === "redact") {
      const textVal = item.kind === "redact" ? item.replacementText : item.text;
      const textColor = item.kind === "redact" ? item.textColor : item.color;
      const hasUnicodeWarn = sanitizeWinAnsiText(textVal).hadUnsupported;
      const contractMeta = item.kind === "text" ? item.contractField : undefined;
      const isContractCheckbox = contractMeta?.fieldKind === "checkbox";
      const roundedPt = Math.max(6, Math.round(item.fontSizePt));
      const sizeOptions = FONT_SIZE_PRESETS.includes(roundedPt)
        ? FONT_SIZE_PRESETS
        : [...FONT_SIZE_PRESETS, roundedPt].sort((a, b) => a - b);

      let bgOrContractHtml = "";
      if (item.kind === "redact") {
        bgOrContractHtml = `<label class="insp-field" title="Cor de cobertura sobre o texto antigo">
          <span>Cobertura</span>
          <input type="color" value="${item.coverColor}" data-insp-prop="coverColor" aria-label="Cor da tarja de cobertura" />
        </label>`;
      } else if (isContractCheckbox) {
        const isChecked = item.text.trim() !== "";
        bgOrContractHtml = `<button type="button" class="button secondary compact-btn ${isChecked ? "is-selected" : ""}" data-insp-cmd="toggle-check" aria-pressed="${isChecked}" title="Alternar marcação da caixa (Enter ou Espaço)">
          ${ICONS.checkSquare}
          <span>Marcar (X)</span>
        </button>`;
      } else if (contractMeta) {
        const coverHex =
          /^#[0-9a-f]{6}$/i.test(item.backgroundColor ?? "")
            ? (item.backgroundColor as string)
            : /^#[0-9a-f]{6}$/i.test(contractMeta.sampledBgColor)
              ? contractMeta.sampledBgColor
              : "#ffffff";
        bgOrContractHtml = `<label class="insp-field" title="Posicionamento em relação à linha detectada">
            <span>Lacuna</span>
            <select data-insp-prop="contractCoverMode" aria-label="Modo de preenchimento na lacuna">
              <option value="above" ${!contractMeta.coverSource ? "selected" : ""}>Acima da linha</option>
              <option value="cover" ${contractMeta.coverSource ? "selected" : ""}>Cobrir lacuna</option>
            </select>
          </label>
          ${
            contractMeta.coverSource
              ? `<label class="insp-field" title="Cor de cobertura sobre a lacuna">
                  <span>Cobrir</span>
                  <input type="color" value="${coverHex}" data-insp-prop="contractCoverColor" aria-label="Cor de cobertura da lacuna" />
                </label>`
              : ""
          }`;
      } else {
        bgOrContractHtml = `<label class="insp-field" title="Fundo da caixa de texto">
          <span>Fundo</span>
          <select data-insp-prop="textBgMode" aria-label="Fundo da caixa de texto">
            <option value="none" ${!item.backgroundColor ? "selected" : ""}>Transparente</option>
            <option value="#ffffff" ${item.backgroundColor === "#ffffff" ? "selected" : ""}>Branco</option>
            <option value="#fef3c7" ${item.backgroundColor === "#fef3c7" ? "selected" : ""}>Creme</option>
          </select>
        </label>`;
      }

      propsHtml = `
        ${bgOrContractHtml}
        <label class="insp-field">
          <span>Fonte</span>
          <select data-insp-prop="fontFamily" aria-label="Família tipográfica">
            <option value="helvetica" ${item.fontFamily === "helvetica" ? "selected" : ""}>Sans (Helvetica)</option>
            <option value="times" ${item.fontFamily === "times" ? "selected" : ""}>Serif (Times)</option>
            <option value="courier" ${item.fontFamily === "courier" ? "selected" : ""}>Mono (Courier)</option>
          </select>
        </label>
        <label class="insp-field">
          <span>Tam.</span>
          <select data-insp-prop="fontSizePt" aria-label="Tamanho da fonte em pontos">
            ${sizeOptions.map(
              (sz) =>
                `<option value="${sz}" ${roundedPt === sz ? "selected" : ""}>${sz} pt</option>`
            ).join("")}
          </select>
        </label>
        <label class="insp-field">
          <span>Texto</span>
          <input type="color" value="${textColor}" data-insp-prop="${item.kind === "redact" ? "textColor" : "color"}" aria-label="Cor do texto" />
        </label>
        <div class="insp-btn-strip" role="group" aria-label="Estilo e alinhamento">
          <button type="button" class="button ghost icon-only ${item.bold ? "is-selected" : ""}" data-insp-toggle="bold" aria-pressed="${item.bold}" title="Negrito"><b>B</b></button>
          <button type="button" class="button ghost icon-only ${item.italic ? "is-selected" : ""}" data-insp-toggle="italic" aria-pressed="${item.italic}" title="Itálico"><i>I</i></button>
          <button type="button" class="button ghost icon-only ${item.align === "left" ? "is-selected" : ""}" data-insp-align="left" aria-label="Alinhar à esquerda" title="Esquerda">${ICONS.alignLeft}</button>
          <button type="button" class="button ghost icon-only ${item.align === "center" ? "is-selected" : ""}" data-insp-align="center" aria-label="Centralizar" title="Centralizar">${ICONS.alignCenter}</button>
          <button type="button" class="button ghost icon-only ${item.align === "right" ? "is-selected" : ""}" data-insp-align="right" aria-label="Alinhar à direita" title="Direita">${ICONS.alignRight}</button>
        </div>
        <button type="button" class="button secondary compact-btn" data-insp-cmd="edit-text" title="Editar texto na caixa">
          ${ICONS.typeText}
          <span>Editar</span>
        </button>
        ${
          hasUnicodeWarn
            ? `<span class="insp-warn" title="Símbolos ou emojis não suportados por fontes padrão PDF serão adaptados na exportação">Caracteres especiais adaptados ao exportar</span>`
            : ""
        }
      `;
    } else if (item.kind === "highlight") {
      propsHtml = `
        <label class="insp-field">
          <span>Cor</span>
          <select data-insp-prop="color" aria-label="Cor do marca-texto">
            <option value="#fde047" ${item.color === "#fde047" ? "selected" : ""}>Amarelo</option>
            <option value="#86efac" ${item.color === "#86efac" ? "selected" : ""}>Verde</option>
            <option value="#93c5fd" ${item.color === "#93c5fd" ? "selected" : ""}>Azul</option>
            <option value="#f9a8d4" ${item.color === "#f9a8d4" ? "selected" : ""}>Rosa</option>
          </select>
        </label>
        <label class="insp-field">
          <span>Opacidade</span>
          <input type="range" min="20" max="75" step="5" value="${Math.round(item.opacity * 100)}" data-insp-prop="opacityPct" aria-label="Opacidade do destaque" />
        </label>
      `;
    } else {
      const labelTxt = item.kind === "signature" ? `Assinatura: ${item.label}` : `Imagem: ${item.fileName}`;
      propsHtml = `
        <span class="insp-tag">${labelTxt}</span>
        <label class="insp-field">
          <span>Opacidade</span>
          <input type="range" min="20" max="100" step="5" value="${Math.round(item.opacity * 100)}" data-insp-prop="opacityPct" aria-label="Opacidade da imagem ou assinatura" />
        </label>
        <label class="insp-field">
          <span>Ângulo</span>
          <select data-insp-prop="rotationDeg" aria-label="Rotação rápida">
            <option value="0" ${Math.round(item.rotationDeg) === 0 ? "selected" : ""}>0°</option>
            <option value="-15" ${Math.round(item.rotationDeg) === -15 ? "selected" : ""}>-15°</option>
            <option value="15" ${Math.round(item.rotationDeg) === 15 ? "selected" : ""}>+15°</option>
            <option value="90" ${Math.round(item.rotationDeg) === 90 ? "selected" : ""}>90°</option>
            <option value="-90" ${Math.round(item.rotationDeg) === -90 ? "selected" : ""}>-90°</option>
          </select>
        </label>
      `;
    }

    this.host.innerHTML = `
      <div class="insp-props">
        ${propsHtml}
        <button type="button" class="button ghost compact-btn danger-hover" data-insp-cmd="delete" title="Remover item selecionado (Del)">
          ${ICONS.trash}
          <span>Remover</span>
        </button>
      </div>
      ${historyControls}
    `;
  }

  private bindEvents(): void {
    this.host.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const cmdBtn = target.closest<HTMLElement>("[data-insp-cmd]");
      if (cmdBtn) {
        const cmd = cmdBtn.dataset.inspCmd;
        if (cmd === "undo") this.callbacks.onUndo();
        else if (cmd === "clear-empty-contract") {
          this.callbacks.onClearEmptyContractFields?.();
        }
        else if (cmd === "clear-page") this.callbacks.onClearPage?.();
        else if (cmd === "delete") this.callbacks.onDeleteSelected();
        else if (cmd === "edit-text") this.callbacks.onStartEditSelected();
        else if (cmd === "toggle-check" && this.activeItem?.kind === "text") {
          const isChecked = this.activeItem.text.trim() !== "";
          this.callbacks.onPatchSelected({ text: isChecked ? "" : "X" }, true);
        }
        return;
      }

      const toggleBtn = target.closest<HTMLElement>("[data-insp-toggle]");
      if (toggleBtn && this.activeItem && (this.activeItem.kind === "text" || this.activeItem.kind === "redact")) {
        const prop = toggleBtn.dataset.inspToggle as "bold" | "italic";
        this.callbacks.onPatchSelected({ [prop]: !this.activeItem[prop] });
        return;
      }

      const alignBtn = target.closest<HTMLElement>("[data-insp-align]");
      if (alignBtn) {
        const align = alignBtn.dataset.inspAlign as EditorTextAlign;
        this.callbacks.onPatchSelected({ align });
      }
    });

    this.host.addEventListener("input", (e) => {
      const target = e.target as HTMLInputElement | HTMLSelectElement;
      if (target instanceof HTMLInputElement && (target.type === "range" || target.type === "color")) {
        this.handleFieldChange(target, false);
      }
    });
    this.host.addEventListener("change", (e) => {
      this.handleFieldChange(e.target as HTMLInputElement | HTMLSelectElement, true);
    });
  }

  private handleFieldChange(
    el: HTMLInputElement | HTMLSelectElement,
    commit: boolean
  ): void {
    const prop = el.dataset.inspProp;
    if (!prop) return;

    if (prop === "fontFamily") {
      this.callbacks.onPatchSelected({ fontFamily: el.value as EditorFontFamily }, commit);
    } else if (prop === "fontSizePt") {
      this.callbacks.onPatchSelected({ fontSizePt: Number(el.value) || 14 }, commit);
    } else if (prop === "textBgMode") {
      this.callbacks.onPatchSelected(
        { backgroundColor: el.value === "none" ? null : el.value },
        commit
      );
    } else if (
      prop === "contractCoverMode" &&
      this.activeItem?.kind === "text" &&
      this.activeItem.contractField
    ) {
      const cover = el.value === "cover";
      const meta = this.activeItem.contractField;
      const targetRect = cover ? meta.coverRect : meta.aboveLineRect;
      const bg = cover
        ? (this.activeItem.backgroundColor ?? meta.sampledBgColor)
        : null;
      this.callbacks.onPatchSelected(
        {
          xNorm: targetRect.xNorm,
          yNorm: targetRect.yNorm,
          widthNorm: targetRect.widthNorm,
          heightNorm: targetRect.heightNorm,
          backgroundColor: bg,
          contractField: {
            ...meta,
            coverSource: cover
          }
        },
        commit
      );
    } else if (
      prop === "contractCoverColor" &&
      this.activeItem?.kind === "text" &&
      this.activeItem.contractField
    ) {
      this.callbacks.onPatchSelected(
        {
          backgroundColor: el.value,
          contractField: {
            ...this.activeItem.contractField,
            sampledBgColor: el.value,
            coverSource: true
          }
        },
        commit
      );
    } else if (prop === "opacityPct") {
      this.callbacks.onPatchSelected(
        { opacity: clampOpacity(Number(el.value) / 100) },
        commit
      );
    } else if (prop === "rotationDeg") {
      this.callbacks.onPatchSelected({ rotationDeg: Number(el.value) || 0 }, commit);
    } else if (prop === "coverColor") {
      this.callbacks.onPatchSelected({ coverColor: el.value }, commit);
    } else if (prop === "textColor") {
      this.callbacks.onPatchSelected({ textColor: el.value }, commit);
    } else if (prop === "color") {
      this.callbacks.onPatchSelected({ color: el.value }, commit);
    }
  }
}

function clampOpacity(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.max(0.15, Math.min(1, v));
}
