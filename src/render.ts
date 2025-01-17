import type Token from "markdown-it/lib/token";
import {
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownRenderer,
} from "obsidian";

import TableExtended from "./tx-main";

export const mditOptions = { html: true };

const elToPreserveText = ["td", "th", "caption"];

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
export function renderMarkdown(
  this: TableExtended,                        // 使用bind方法被绑进来的
  src: string,                                // 代码块内容
  blockEl: HTMLElement,                       // 代码块渲染的元素
  ctx: MarkdownPostProcessorContext,
) {
  let child = new MarkdownRenderChild(blockEl);
  ctx.addChild(child);

  // 导入渲染结果
  const ast = this.mdit.parse(src, {});         // 解析代码块里的内容为ast（实则为token数组）
  const MarkdownTextInTable = processAST(ast);  // 处理表格内的md语法树，是一个数组，有几个表格单元格就有多长
  console.log("ast: Token[]", ast)
  console.log("MarkdownTextInTable: []", MarkdownTextInTable)

  const result = this.mdit.renderer.render(ast, mditOptions, {}); // 根据mdit规则渲染为元素（这里是仅根据表格规则渲染，表格内md语法的渲染见下）
  blockEl.innerHTML = result;
  
  // 处理表格内的markdown语法
  // 删掉后，```ad-note 这种就失效了
  console.log("querySelectorAll", blockEl.querySelectorAll("[id^=TX_]"))  // 有几个单元格这个数组就有多长
  for (let el of blockEl.querySelectorAll("[id^=TX_]")) { // 选择器，id是processAST方法临时给的，后面会去除掉
    const parent = el as HTMLElement,
      indexText = el.id.substring(3);
    el.removeAttribute("id");                             // 这里把id属性给删除了，所以你在调试器里看不到有id了
    if (!Number.isInteger(+indexText)) continue;

    // 将表格内的markdown文本，渲染出来，替换掉表格的原内容
    const text = MarkdownTextInTable[+indexText];
    if (!text) continue;
    parent.empty();
    MarkdownRenderer.renderMarkdown(text, parent, ctx.sourcePath, child);

    let renderedFirstBlock = parent.firstElementChild;
    if (renderedFirstBlock) {
      const from = renderedFirstBlock;
      // 复制markdown-attribute中的attr设置
      ["style", "class", "id"].forEach((attr) => copyAttr(attr, from, parent)); // 复制属性
      if (renderedFirstBlock instanceof HTMLElement) {
        Object.assign(parent.dataset, renderedFirstBlock.dataset);
      }
      // 把所有的子元素都unwarp（纠正）到父表单元格/标题
      if (renderedFirstBlock instanceof HTMLParagraphElement)
        renderedFirstBlock.replaceWith(...renderedFirstBlock.childNodes);
    }
  }
}

/**
 * 作用：处理表格内的markdown语法，应该是辅助renderMarkdown的for使用的
 * 处理抽象语法树，用于从表格单元格中提取源markdown
 * 被renderMarkdown()调用
 * @param ast 为每个表单元格添加id
 * @returns markdown文本的数组，索引是带对应单元格元素id的一部分
 */
const processAST = (ast: Token[]): string[] => {
  let srcMarkdown: string[] = [];

  for (let i = 0; i < ast.length; i++) {
    const token = ast[i];
    if (elToPreserveText.includes(token.tag) && token.nesting === 1) {
      let iInline = i,
        nextToken = ast[++iInline];
      while (
        // not closing tag
        !elToPreserveText.includes(nextToken.tag) ||
        nextToken.nesting !== -1
      ) {
        let content = "";
        if (nextToken.type === "inline") {              // 内联Token
          content = nextToken.content;
        } else if (nextToken.type === "fence") {        // Fence Token
          content =
            "```" + nextToken.info + "\n" + nextToken.content + "\n" + "```";
        } else if (nextToken.type === "code_block") {   // 代码块Token
          content = nextToken.content.replace(/^/gm, "    ");
        }

        if (content) {
          const index = srcMarkdown.push(content) - 1;
          token.attrSet("id", `TX_${index}`);           // 设置id属性
          break;
        }
        nextToken = ast[++iInline];
      }
      // 跳过 inline token 和 close token
      i = iInline;
    }
  }
  return srcMarkdown;
};

// 被renderMarkdown()的for调用
const copyAttr = (attr: string, from: Element, to: Element) => {
  if (from.hasAttribute(attr)) {
    to.setAttribute(attr, from.getAttribute(attr)!);
  }
};
