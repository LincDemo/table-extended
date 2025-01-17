import { around } from "monkey-around";
import { MarkdownView, TFile, Vault } from "obsidian";

import TableExtended from "./tx-main";

const Export2PDFHack = (plugin: TableExtended) => {
  const unloaders = [
    around(MarkdownView.prototype, {
      // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
      // Eslint禁用下一行，偏向箭头/偏向箭头函数
      printToPdf: (original) =>
        function (this: MarkdownView) {
          plugin.print2pdfFileCache = this.file;
          // shalow copy the file to provide basic info
          // 复制文件以提供基本信息
          this.file = { ...this.file, export2pdf: true } as any;
          original.call(this);
          this.file = plugin.print2pdfFileCache;
        },
    }),
    around(Vault.prototype, {
      cachedRead: (original) =>
        async function (this: Vault, input: TFile | string) {
          if (!(input instanceof TFile) && (input as any)?.export2pdf) {
            const file = plugin.print2pdfFileCache;
            if (!file) {
              throw new Error(
                "Failed to get file from table extended plugin instance",
              );
            }
            return preprocessMarkdown(await original.call(this, file), plugin);
          } else {
            return original.call(this, input as any);
          }
        },
    }),
  ];
  unloaders.forEach((u) => plugin.register(u));
};

/**
 * warp all tables in markdown text with tx codeblock
 * 扭曲所有表markdown文本与tx码块
 */
const preprocessMarkdown = (text: string, plugin: TableExtended) => {
  if (!text) return text;
  const ast = plugin.mdit.parse(text, {});
  let tableStarts: number[] = [],
    tableEnds: number[] = [];
  let linesToRemove: number[] = [];

  ast.forEach((token, index, allTokens) => {
    if (token.type === "table_open") {
      let txTable = false;
      if (index - 3 >= 0) {
        const paraStart = index - 3,
          paraContent = index - 2;
        if (
          allTokens[paraStart].type === "paragraph_open" &&
          allTokens[paraContent].type === "inline" &&
          allTokens[paraContent].content === "-tx-"
        ) {
          // remove -tx- prefix
          // 移除 -tx- 前缀
          linesToRemove.push(token.map![0] - 1);
          txTable = true;
        }
      }
      // process all tables or only tables with -tx- prefix
      // 处理所有表或仅处理带有-tx- prefix的表
      if (plugin.settings.handleNativeTable || txTable) {
        tableStarts.push(token.map![0]);
        tableEnds.push(token.map![1]);
      }
    }
  });

  if (tableStarts.length === 0) return text;

  let lines = text.split(/\r?\n/).flatMap((line, index) => {
    // remove -tx- prefix
    if (linesToRemove.includes(index)) return [];
    // warp all tables with tx codeblock
    if (tableStarts.includes(index)) return ["```tx", line];
    if (tableEnds.includes(index)) return ["```", line];
    return [line];
  });
  return lines.join("\n");
};

export default Export2PDFHack;
