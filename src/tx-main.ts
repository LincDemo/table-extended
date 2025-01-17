import MarkdownIt from "markdown-it";
import mTable from "markdown-it-multimd-table";	// 这是一个markdown-it的插件
import {
  MarkdownPostProcessorContext,
  MarkdownPreviewRenderer,
  MarkdownView,
  Plugin,
  TFile,
} from "obsidian";
import {
  DEFAULT_SETTINGS,
  TableExtendedSettings,
  TableExtendedSettingTab,
} from "settings";

import Export2PDFHack from "./hack-pdf";                  // 【核心】这个名字好怪，一个设置项开启
import { mditOptions, renderMarkdown } from "./render";   // 【核心】通过AST抽象语法树 markdown-it 等，渲染html

const prefixPatternInMD = /^(?:>\s*)?-tx-\n/; // -tx-标识的识别，> -tx-亦可。正则中(?:)用於标记该匹配组不应被捕获

export default class TableExtended extends Plugin {
  settings: TableExtendedSettings = DEFAULT_SETTINGS;

  print2pdfFileCache: TFile | null = null;

  renderFromMD = renderMarkdown.bind(this);               // 核心，bind方法绑定"./render"文件里的一个方法

  // 【核心】
  async onload(): Promise<void> {
    console.log("loading table-extended");
    await this.loadSettings();
    this.addSettingTab(new TableExtendedSettingTab(this.app, this));          // 加载设置
    if (this.settings.hackPDF) {                                                  // 设置2：pdf支持。一般是False
      Export2PDFHack(this);                                                       // 核心，./hack-pdf中定义的方法
    }
    if (this.settings.handleNativeTable)                                          // 设置1：扩展本机表语法。一般是True，没看出来有什么用，关了不影响
      MarkdownPreviewRenderer.registerPostProcessor(this.processNativeTable);     // 核心，此文件定义的方法 - 原生表格处理器

    this.registerMarkdownCodeBlockProcessor("tx", this.renderFromMD);         // 核心，将内容当成md内容重新走一遍渲染，是./render文件定义的renderMarkdown方法
    this.registerMarkdownPostProcessor(this.processTextSection);              // 核心，此文件定义的方法 - 文本选择处理器

    // 阅读Obsidian的配置，保持 “strictLineBreaks” 选项同步
    this.mdit.set({
      breaks: !this.app.vault.getConfig("strictLineBreaks"), // 是否严格换行，默认ture 为不空行的换行无效
    });
    this.app.workspace.onLayoutReady(this.refresh);
  }

  /** 重写构造方法，追加了三步
   * 1. markdown-it库加载插件mTable，并赋值为md_it
   * 2. 设置该插件block的启用范围
   * 3. 设置该插件inline的启用范围
   */
  mdit: MarkdownIt;
  constructor(...args: ConstructorParameters<typeof Plugin>) {
    super(...args);
    this.mdit = MarkdownIt(mditOptions).use(mTable, {
      multiline: true,
      rowspan: true,
      headerless: true,
    });

    // 只保留表所需的特征，让Obsidian处理Cell单元格内的标记
		// Ruler.enableOnly: 启用给定名称的规则，并禁用所有其他的规则。如果没有找到任何规则名称，抛出错误。可以通过第二个参数禁用错误。
    this.mdit.block.ruler.enableOnly([
      "code",       // 代码
      "fence",      // ？围栏？
      "table",      // 表格
      "paragraph",  // 段落
      "reference",  // ？参考？
      "blockquote", // 引用块
    ]);
    this.mdit.inline.ruler.enableOnly([]);
  }

  // 原生表格处理器？，一个设置项开启
  processNativeTable = (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    if (!el.querySelector("table")) return;

    const raw = getSourceMarkdown(el, ctx);
    if (!raw) {
      console.warn("failed to get Markdown text, escaping...");
      return;
    }
    el.empty();
    this.renderFromMD(raw, el, ctx);
  };

  // 文本选择处理器
  processTextSection = (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    // preview中，el只包含一个块的els
    // export2pdf中，el包含所有块的els
    for (const child of el.children) {
      let p: HTMLParagraphElement;
      if (child instanceof HTMLParagraphElement) {
        p = child;
      } else if (
        child instanceof HTMLQuoteElement &&
        child.firstElementChild instanceof HTMLParagraphElement
      ) {
        p = child.firstElementChild;
      } else continue;

      let result;
      if (p.innerHTML.startsWith("-tx-")) { // 前缀
        const src = getSourceMarkdown(el, ctx);
        if (!src) {
          console.warn("failed to get Markdown text, escaping..."); // 未能得到Markdown文本，避免
        } else if ((result = src.match(prefixPatternInMD))) {
          const footnoteSelector = "sup.footnote-ref";
          // save footnote refs
          // 保存脚注引用
          const footnoteRefs = [
            ...el.querySelectorAll(footnoteSelector),
          ] as HTMLElement[];
          // footnote refs is replaced by new ones during rendering
          // 脚注引用在渲染过程中被新的引用所取代
          this.renderFromMD(src.substring(result[0].length), el, ctx);
          // post process to revert footnote refs
          // 恢复脚注引用的后期过程
          for (const newRefs of el.querySelectorAll(footnoteSelector)) {
            newRefs.replaceWith(footnoteRefs.shift()!);
          }
          for (const fnSection of el.querySelectorAll("section.footnotes")) {
            fnSection.remove();
          }
        }
      }
    }
  };

  async loadSettings() {
    this.settings = { ...this.settings, ...(await this.loadData()) }; // this.loadData是啥
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  onunload() {
    console.log("unloading table-extended");
    MarkdownPreviewRenderer.unregisterPostProcessor(this.processNativeTable);
    this.refresh();
    this.print2pdfFileCache = null;
  }
  /** 
   * 刷新打开MarkdownView
   * refresh opened MarkdownView
   */
  refresh = () =>
    this.app.workspace.iterateAllLeaves((leaf) =>
      setTimeout(() => {
        if (leaf.view instanceof MarkdownView) {
          leaf.view.previewMode.rerender(true);
        }
      }, 200),
    );
}

// 被processTextSection调用
// 规范范围和换行
const getSourceMarkdown = (
  sectionEl: HTMLElement,
  ctx: MarkdownPostProcessorContext,
): string | null => {
  let info = ctx.getSectionInfo(sectionEl);
  if (info) {
    const { text, lineStart, lineEnd } = info;
    return text
      .split("\n")
      .slice(lineStart, lineEnd + 1)
      .join("\n");
  } else {
    return null;
  }
};
