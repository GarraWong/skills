---
name: review-spec-impl
description: Read-only end-of-feature review of implementation code against a functional-spec change document (BR-xxx / INV-xxx) and its OpenSpec changes, producing a classified findings report (Missing / Conflict / Partial / Extra / Drift / Test gap / Unverifiable). Use when the user asks for 实现一致性审查, Spec 与实现 review, spec-vs-implementation review, or a final Spec↔代码 check of a feature before release or baselining. Not for maintaining FS↔OpenSpec coverage ledgers (use func-spec-coverage) or checking OpenSpec task completion (use openspec-verify-change).
argument-hint: <slug> [increment] [<repo>=<base>..<head> ...]
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash(git log:*), Bash(git diff:*), Bash(git merge-base:*), Bash(git show:*), Bash(git branch:*), Bash(git rev-parse:*), Bash(git symbolic-ref:*), Bash(ls:*), Bash(grep:*), Bash(head:*), Bash(cat:*)
---

# Spec ↔ 实现一致性审查（只读）

参数：`$ARGUMENTS`

- `<slug>`（必填）：`functional-spec/changes/<slug>.md` 的文件名，不带 `.md`。
- `[increment]`（可选）：Delivery manifest 中某一行，可以写行首关键字（如 `Phase 2`）或 ADO Feature 号（如 `320258`）。
- `[<repo>=<base>..<head>]`（可选，可重复）：显式指定某仓库的 Git 范围，`<head>` 也可写 commit 或 PR 源分支。

**全程只读。** 不修改、新建、暂存、提交任何文件，不切换分支，不执行 `git fetch` / `checkout` / `switch` / `pull`。报告直接在对话中输出。用户要求落盘时，再另行确认路径。

## 第 0 步：解析范围（先确认，再审查）

按顺序解析。任何一项有歧义就停下来问用户，**不要猜**。

1. **Functional Spec**：读 `functional-spec/changes/<slug>.md`。
   - 文件不存在时，再查 `functional-spec/changes/archive/*-<slug>.md`。找到后说明该 change 已归档：审查对象改为已基线化的主题章节规则，并请用户确认。两处都没有就停止。
2. **增量与规则清单**：读 `### Delivery manifest`。
   - manifest 只有一行，就用这一行。
   - 有多行且用户未指定时，列出每行的增量名和规则区间，询问用户审查哪一行（或全部）。
   - 把区间展开为逐条 ID，例如 `BR-ID-026–038` 展开为 13 条。`withdrawn` 的规则放进单独的「已撤回」清单，**不计入覆盖范围**，只用于第 5 步找 X。
3. **OpenSpec change**：在 `openspec/changes/*/proposal.md`（不含 `archive/`）中 grep slug，按增量匹配 change（名称后缀、proposal 中的 Feature 号或规则 ID）。也检查 `openspec/changes/archive/` 中同 slug 的已归档 change，以及已同步到 `openspec/specs/` 的 capability。
4. **对账台账**：`openspec/coverage/<slug>.md`。不存在时，记入盲区，第 2 步改为全量人工对账。
5. **仓库**：从每个 change 的 `proposal.md` 影响仓库表中取仓库名，映射到 `projects/<repo>/`。先读 `projects/AGENTS.md` 和各仓库自己的 `AGENTS.md`。clone 不存在时记入盲区，**不要臆测其内容**。`Freya-Docs-TA` 用于第 6 步的测试覆盖。
6. **Git 范围**：用户已给出就照用。否则对每个仓库：
   - `head` = 当前分支（`git branch --show-current`）；
   - `base` = `git merge-base origin/main HEAD`（`origin/HEAD` 不是 `origin/main` 时用 `origin/HEAD`）；
   - 当前分支名看起来与本 Feature 无关（不含 slug 关键词，或停在 `main`）时，标为「待确认」。
   - **范围为空**（`base == head`）通常说明该增量已经合入 `main`。这时在 `git log origin/main` 中按 slug、change 名或 Feature 号找合并 PR，用它的提交范围；找不到就问用户要 PR 号。
7. **圈定本 Feature 的代码**：feature 分支里常混有其他工作，merge-base diff 可能有几百个文件，不能直接拿来审查。按以下顺序圈定：
   - 从 `proposal.md` 影响表、`design.md`、`plan.md` 中取实现入口（类名、组件名、端点）；
   - 用 `git log --no-merges --format='%h %s' <base>..<head>` 按提交 scope 归类（如 `link`、`module-link`），选出与入口相符的 scope。提交信息里通常不写 Feature 号或 phase，不要只按这些关键词筛选；
   - 以这些提交触及的文件和入口所在文件为审查起点，在范围确认表中写明选了哪些 scope、提交数和文件数。
8. **已知的已接受偏差**：询问用户或查找 BA 已确认暂缓、豁免的规则（Functional Spec 修订历史中的 deferred、台账 `§4`、用户提供的决策记录）。这些规则不报为发现，在报告「已接受偏差」一节列出。

把解析结果整理成一张**范围确认表**交给用户：规则数、change、台账、仓库 × 分支 × base..head × diff 文件数。用户确认后再进入第 1 步。用户在参数里已完整指定全部范围时，可以直接继续，但报告开头仍要列出这张表。

## 审查方法（按顺序执行）

### 1. 抽取规则清单，并拆出检查点

**审查粒度是 BR / INV 规则**，不是台账中的 atom（如 `BR-MI-064.33`）。只有台账在 `§2` 中把某个 atom 标为非 covered，或 `§4` 中有未关闭的记录时，才单独展开该 atom。

从 Functional Spec 抽取范围内的全部 BR / INV，每条列「ID + 一句话」。同时记录：
- 带 `OQ-xxx` 或明确待定的规则（候选 U）；
- 文档中已记录的决策：`REQ-*` 决策表、修订历史中「user-confirmed / BA-confirmed」的条目。这些是**已接受的口径**，按决策后的语义审查。

然后**在搜索代码之前**，把每条规则拆成 3–10 个可检查点，按五要素归类。每个检查点要写成「在代码里能看到什么，就算满足」的形式，例如：

| 规则原文 | 检查点 |
| --- | --- |
| 主结果按文档最后修改时间倒序，相同时间保持稳定顺序 | 查询的 ORDER BY 以文档级修改时间降序为首键；有唯一键作为第二排序键 |
| 空条件 Apply 不返回无界列表 | 服务端（不只是 UI）在没有任何条件时返回空结果 |
| Status 可选值包括 Draft、Reviewed、QC Reviewed | 状态选项来源包含这三个值，没有被硬编码为 Approved / Effective |

拆解时要求：
- 重点拆出容易漏的点：取值来源（哪个版本、文档级还是版本级）、组合逻辑（AND / OR）、排序与分页、服务端兜底、Denial behavior 的副作用；
- 同时写出这些检查点分别该在哪一层验证（后端、前端或两者），作为第 3 步的搜索清单；
- 检查点清单写进报告的覆盖矩阵依据中，不单独输出。

### 2. FS → OpenSpec
- 只读台账 `§2 Atom Coverage` 表。`§1` 中的历史段落可能保留同一 atom 在早期增量的 `deferred` 行，不代表当前状态。`§4` 按日期倒序累积，同一 atom 以最新一条记录为准。
- 先读 `§2`：`✅ covered` 的 atom 采信其 `Covered by` 指向的 Requirement / Scenario，只抽查语义是否一致。
- 状态不是 covered、缺行，或台账 Baseline 版本落后于 FS 当前版本时，到 change 的 `specs/` 中人工查找对应 Requirement / Scenario。
- 找不到，或语义不一致 → **D**。
- 台账 `§4 Findings & Actions` 中已登记且标注为已接受或已延期的事项，不再作为新发现，在报告「已接受偏差」一节列出。

### 3. 规则 → 代码
对每条 BR，按第 1 步拆出的检查点逐项在代码中定位实现点（Controller / Service / Repository / SQL / Flyway 迁移 / 前端组件或 hook），给出 `file:line`。记录每个检查点是否核对到；没有核对到的检查点要写进报告的盲区，不能默认为满足。五要素的核对要点如下：

| 要素 | 核对点 |
| --- | --- |
| Trigger | 实现是否挂在规则所述的触发点上；是否遗漏同一触发点的其他入口 |
| Preconditions | 前置条件是否被校验；校验位置是否先于副作用 |
| Rule | 结果是否与规则一致（取值来源、范围、排序、版本选择等） |
| Exceptions | 例外分支是否存在且条件一致 |
| Denial behavior | 拒绝时的结果（无副作用、错误码、提示、是否部分提交）是否一致 |

优先从 diff 中的改动入手：`git diff --stat <base>..<head>`，再看具体文件。规则行为也可能落在 diff 之外的既有代码里，所以 diff 中没找到时，要在整个仓库中搜索后再下结论。

### 4. 不变量与旁路入口
对每条 INV，确认代码层面有保证，不只是 UI 层。至少检查以下旁路：
- REST / 内部 API 直调（绕过前端校验）；
- 批量操作、导入、迁移脚本 / Flyway 数据迁移；
- 异步任务、监听器、ECS worker、跨服务调用（如 Manager、Rendition）；
- 并发：同一对象的并发写，是否有锁、版本号或唯一约束。

只在 UI 层被保证 → **P**。

### 5. 反向扫描（找 X）
遍历 diff 中新增或修改的行为分支（新的条件判断、新端点、新字段写入、新错误码），确认每一处都能追溯到范围内的 BR / INV / OpenSpec Requirement。以下情况记为 **X**：
- 找不到依据的业务行为（纯重构、日志、技术性防御代码不算）；
- 「已撤回」清单中的规则在代码中仍然生效。

### 6. 测试覆盖
- 对每条 BR，查找 `openspec/changes/<change>/test_spec/`（或已提升的 `test_spec/<change>/`）中的 TC，以及仓库单测、`Freya-Docs-TA` 中的自动化用例。
- 没有任何测试覆盖 → **T**。断言与规则不一致（断言了错误的值，或只断言了 happy path、漏掉 Denial behavior）→ **T**。
- 只核对测试是否存在、断言是否正确。**不运行测试**，也不声称测试已通过。

## 判定纪律

- 每条发现必须同时给出：规则 ID、规范原文要点、代码证据（`file:line`）、差异说明。缺任何一项都不能作为 Confirmed / Likely 发现。T 类发现没有代码证据，按 taxonomy 中 T 的证据标准判定置信度。
- 没找到实现时，写明搜索过的关键词和目录，置信度记为 **Suspect**，不要直接判定为确定的 Missing。
- 规范含糊或带 `OQ-xxx` 的，归为 **U**，不要自行推断答案。
- 只报告明确冲突或明确缺失。「可以更好」的建议只能放在 S4，并标注为建议。
- Functional Spec 中不该出现的实现细节，不当作要求。代码内部结构（分层、命名、抽取方式）不当作违反 BR。
- 不审查范围外的规则和模块。不做代码风格、性能、重构类评价。
- 权威顺序：Functional Spec > OpenSpec > 代码。OpenSpec 与代码一致但与 FS 不一致时，代码发现照常报告；如果 FS 修订历史显示该处是更晚的决策，归属写 `needs-decision`。

分类、级别、置信度和归属的定义见 [references/taxonomy.md](references/taxonomy.md)，必须严格按其中定义标注。

## 输出

按 [references/report-template.md](references/report-template.md) 的结构输出，各节顺序不变，某节为空时写「无」。

涉及多个仓库（如前后端）或规则较多（超过约 30 条）时，可以按仓库或规则组派发只读子 agent 并行执行第 3–6 步：

- brief 要包含：规则原文的位置、**第 1 步拆出的每条规则检查点**、Git 范围和第 0 步选定的提交 scope、五要素核对表、判定纪律、分类定义、已接受偏差清单，并要求子 agent 只读、不运行测试，逐个检查点返回「已核对 / 未核对」及证据。
- 子 agent 启动失败（例如模型不可用）时，改用 fork 或在当前会话中执行，不要反复重试同一配置。
- 汇总时：
  - 去重；
  - 把一个子 agent 留给其他层确认的问题（「需要前端确认……」「需要后端交叉核对……」），用另一层的证据逐条闭合。闭合后不再列为 Suspect，在报告中注明已交叉核对；
  - 至少抽查每条 S1–S3 发现的 `file:line`，抽查通过才能标为 Confirmed。
