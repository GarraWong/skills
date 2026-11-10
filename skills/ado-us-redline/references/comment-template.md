# Comment 模板（英文，Markdown）

格式与团队已有的 US comment 保持一致（参考 US 313467）：开头一句说明原因，接着逐条列出改动，最后写标注说明和职责边界。读者是 BA、PM、QA，只写业务行为。

```markdown
Updated this User Story to align with the delivered behavior.

Changes:
- <Field / AC n>: "<before>" → "<after>". <one-sentence business reason, e.g. Rename is offered only when the user can also edit the containing folder>.
- <Field / AC n>: removed "<before>" — <business reason>.
- <Field / AC n>: added "<after>" — <business reason>.

Formatting: struck-through text is removed; text highlighted in yellow is new or changed.

<Optional: Related rules: BR-ID-021, BR-ID-022.>
<Optional: This User Story remains responsible for <scope>; <other behavior> stays owned by User Story <ID>.>
```

## 写法要求

- 全部英文。改前 / 改后各用一对引号原样引用，长文本可以截取关键部分并用 `…` 标出省略。
- 原因写成用户可观察的行为，不写实现依据：不写仓库、commit、PR、文件路径、类名、方法名、接口、数据库、权限代码常量（用显示名，如 **Doc Edit Metadata**）。
- 可以引用 `BR-xxx` 规则编号、其他 US / Bug 的 ID。
- 一条改动一行，只写事实，不写「代码有误」「US 有误」之类的评价。
- 只有改动涉及职责划分时才写最后一段边界说明。
