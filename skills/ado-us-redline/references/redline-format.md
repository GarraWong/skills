# 红线 HTML 规范

ADO 的 Description / Acceptance Criteria 是 HTML 字段。红线修订只在改动处插入标记，其余 HTML 保持原样。

## 标记

| 改动 | 标记 | 说明 |
| --- | --- | --- |
| 新增 | `<span style="background-color:rgb(255, 255, 0);">new text</span>` | 与 US 313467 中已有的黄底写法一致 |
| 删除 | `<span style="text-decoration:line-through;">old text</span>` | 文字保留在原位，不能真正删掉 |
| 替换 | 删除标记紧跟新增标记：`<span style="text-decoration:line-through;">old</span> <span style="background-color:rgb(255, 255, 0);">new</span>` | 先旧后新，中间留一个空格 |

不使用 `<mark>`、`<del>`、`<ins>`、class 或外部 CSS。ADO 可能过滤这些写法，也和团队现有标注不一致。

## 保留原有格式

- 改动文字原来在 `<span style="color:…">`、`<b>`、`<strong>` 等内联元素里时，把红线 `<span>` 放在这些元素**里面**，或者把原样式合并进红线 `<span>` 的 `style`，保证颜色、粗体不丢失。例如：

  ```html
  原：<span style="color:rgb(12, 100, 192);"><b>Doc Edit</b></span>
  删：<span style="color:rgb(12, 100, 192);"><b><span style="text-decoration:line-through;">Doc Edit</span></b></span>
  ```

- 红线 `<span>` 不能跨越块级元素（`<p>`、`<li>`、`<div>`、`<td>`）。改动跨多个块时，在每个块里分别加标记。
- 删除整条列表项：保留 `<li>`，只给其中的内容加删除线。新增整条列表项：插入新的 `<li>`，内容整体黄底。
- 新增文字的强调（粗体、颜色）跟随相邻原文的写法，例如权限名在原文里用 `<b>`，新增的权限名也用 `<b>`。

## 不要做的事

- 不改动改动范围以外的任何字符：不重新缩进、不合并或拆分 `<span>`、不把 `&nbsp;` 换成空格、不删除 `box-sizing`、`display:inline !important` 这类冗余样式。
- 不清理历史轮次留下的黄底或删除线。删除线内的文字已失效，不因再次匹配到它就重复修订；黄底但未删除的文字仍生效。再次修改上一轮新增的黄底文字时，只对仍生效的目标片段加删除线（保留黄底），再追加新的黄底文字。
- 不给没有改动的文字加标记，不为了「更清楚」而改写相邻句子。

## 自检

生成新 HTML 后，逐项比对：

1. 撤销本轮插入的红线标记、新增文字、分隔空格及新增结构后，结果应与原 HTML 完全相同。
2. 每一处本轮删除文字都已定位到原 HTML 的生效部分，不重复标注已有删除线中的文字。
3. 每一处黄底新增都对应预览表中的一行「改后」。
