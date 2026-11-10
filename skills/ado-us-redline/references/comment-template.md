# Comment 模板（英文，Markdown）

格式与团队已有的 US comment 保持一致（参考 US 313467）：开头一句说明原因，接着逐条列出改动，最后写标注说明和职责边界。读者是 BA、PM、QA，只写业务行为。

```markdown
Updated this User Story to align with the delivered behavior.

Changes:
- <Field / AC n>: "<before>" → "<after>". <one-sentence business reason, e.g. Rename is offered only when the user can also edit the containing folder>.
- <Field / AC n>: removed "<before>" — <business reason>.
- <Field / AC n>: added "<after>" — <business reason>.

Formatting: struck-through text is removed; text highlighted in yellow is new or changed.

<Optional, only when already cited by the US: Related rules: BR-ID-021, BR-ID-022.>
<Optional: This User Story remains responsible for <scope>; <other behavior> stays owned by User Story <ID>.>

Redline revision: <organization>/<project>/<US-ID>@rev-<original-rev>.
```

## 写法要求

- 全部英文。改前 / 改后各用一对引号原样引用，长文本可以截取关键部分并用 `…` 标出省略。
- 原因写成用户可观察的行为，不写实现依据：不写仓库、commit、PR、文件路径、类名、方法名、接口、数据库、权限代码常量（用显示名，如 **Doc Edit Metadata**）。
- 原 US 已引用时可保留 `BR-xxx` 规则编号；可以引用相关的其他 US / Bug ID。
- 一条改动一行，只写事实，不写「代码有误」「US 有误」之类的评价。
- 只有改动涉及职责划分时才写最后一段边界说明。
- 同一轮修订只添加一条 comment。使用 skill 正文约定的可见修订标识（组织、project、US ID、预览原始 rev），在预览及实际 comment 末尾原样保留：`Redline revision: <organization>/<project>/<US-ID>@rev-<original-rev>.`。标识不是新的业务说明；续接沿用原值，不换成更新后的 rev。
