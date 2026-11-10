---
name: review-spec-impl
description: >-
  Read-only end-of-feature review of implementation code against a functional-spec
  change document (BR-xxx / INV-xxx) and its OpenSpec changes, producing a classified
  findings report (Missing / Conflict / Partial / Extra / Drift / Test gap / Unverifiable).
  Use when the user asks for 实现一致性审查, Spec 与实现 review, spec-vs-implementation
  review, or a final Spec↔代码 check of a feature before release or baselining.
  Not for maintaining FS↔OpenSpec coverage ledgers (use func-spec-coverage) or checking
  OpenSpec task completion (use openspec-verify-change).
argument-hint: "<slug> [increment] [<repo>=<base>..<head> ...]"
disable-model-invocation: true
allowed-tools:
  - Read
  - Grep
  - Glob
  - "Bash(git status:*)"
  - "Bash(git log:*)"
  - "Bash(git diff:*)"
  - "Bash(git merge-base:*)"
  - "Bash(git show:*)"
  - "Bash(git grep:*)"
  - "Bash(git ls-tree:*)"
  - "Bash(git branch:*)"
  - "Bash(git rev-parse:*)"
  - "Bash(git symbolic-ref:*)"
  - "Bash(ls:*)"
  - "Bash(grep:*)"
  - "Bash(head:*)"
  - "Bash(cat:*)"
---

# Spec ↔ 实现一致性审查（只读）

参数：`$ARGUMENTS`

- `<slug>`（必填）：`functional-spec/changes/<slug>.md` 的文件名，不带 `.md`。
- `[increment]`（可选）：Delivery manifest 中某一行，可以写行首关键字（如 `Phase 2`）或 ADO Feature 号（如 `320258`）。
- `[<repo>=<base>..<head>]`（可选，可重复）：显式指定某仓库的 Git 范围，`<head>` 也可写 commit 或 PR 源分支。

**全程只读。** 不修改、新建、暂存、提交任何文件，不切换分支，不执行 `git fetch` / `checkout` / `switch` / `pull`。报告直接在对话中输出。用户要求落盘时，再另行确认路径。

## 第 0 步：解析范围（先确认，再审查）

按顺序解析。任何一项有歧义就停下来问用户，**不要猜**。

1. **Functional Spec 与审查口径**：读 `functional-spec/changes/<slug>.md`；不存在时查 `functional-spec/changes/archive/*-<slug>.md`，两处都没有就停止。
   - 默认审查当前实现。change 已归档时，用归档文档恢复原增量和规则 ID，再按 `functional-spec/appendix/business-rules-index.md` 定位这些 ID 当前所在的主题章节、版本及撤回状态；不要把归档旧文当作现行规则。
   - 用户明确要求回顾历史交付时，使用对应时点的规范与代码版本。口径、规则去向或版本无法确定时，只确认受影响部分；不要混用历史与当前口径。
2. **增量与规则清单**：从原 change 文档读 `### Delivery manifest`。
   - manifest 只有一行，就用这一行。
   - 有多行且用户未指定时，列出每行的增量名和规则区间，询问用户审查哪一行（或全部）。
   - 把区间展开为逐条 ID，例如 `BR-ID-026–038` 展开为 13 条。`withdrawn` 的规则放进单独的「已撤回」清单，**不计入覆盖范围**，只用于第 5 步找 X。
3. **OpenSpec change 与生效规范**：在 `openspec/changes/*/proposal.md` 中搜索 slug，并按增量、Feature 号或规则 ID 匹配；也检查 `openspec/changes/archive/`。
   - 按规则引用定位 `openspec/specs/` 中的现行 capability 及适用 change 的 delta。核对 MODIFIED / REMOVED 等变更，不能把已被替换的历史 Scenario 当作当前要求。历史交付回顾则使用所选时点的规范。
4. **对账台账**：按当前规则所在的源文档定位 `openspec/coverage/` 中的台账，并核实 `§1 Baseline` 的来源与版本；不固定假设仍是 `<slug>.md`。
   - 基线化后的规则查主题台账；历史交付回顾可查 `openspec/coverage/archive/*-<slug>.md`，但来源和版本必须匹配。找不到适用台账时记入盲区，第 2 步改为全量人工对账。
5. **仓库**：从每个 change 的 `proposal.md` 影响仓库表中取仓库名，映射到 `projects/<repo>/`。先读 `projects/AGENTS.md` 和各仓库自己的 `AGENTS.md`。clone 不存在时记入盲区，**不要臆测其内容**。`Freya-Docs-TA` 用于第 6 步的测试覆盖。
6. **固定被审查版本与历史搜索范围**：用户给出的 Git 范围优先；否则每个仓库的 `head` 默认取当前 HEAD，并解析成完整提交 SHA。记录分支和 `git status --short`；除非用户要求审查工作区，否则不把未提交改动混入提交审查，并在范围表注明。
   - 根据项目约定、upstream 和本地已有引用识别目标集成分支，可以是 `dev`，不固定为 `main`。其 merge-base 仅作历史搜索起点，不是功能边界；`base == head` 不能说明本功能没有改动，也不能据此断定已合入 `main`。
   - 默认范围遗漏了已合入集成分支的本功能提交时，沿第 7 项的入口和路径向前追溯。显式范围不自行扩大；只有对象缺失或范围仍无法判定时，才请用户提供分支、PR 或时间线索，**不要求用户记 commit，也不要求分支只含本功能**。
   - 代码、直接依赖与测试证据统一绑定各自固定的 `head`。工作区内容未确认与该版本一致时，用 `git show <head>:<path>`、`git grep ... <head> -- <paths>`、`git ls-tree` 等只读方式读取和搜索，不切换分支；证据行号也必须属于该版本。用户要求审工作区时，单独说明其改动范围，不冒充某个 commit 的内容。
7. **自动圈定本 Feature 的改动**：由模型按「规则 → 实现入口与路径 → 相关提交 → head 中的完整行为」识别，不把作者、分支名、提交 scope 或 Feature 号作为唯一筛选条件。
   - 从 `proposal.md`、`design.md`、`plan.md` 及固定版本中的代码取入口，沿直接调用与数据流找到实现路径，再用 Git 历史辅助定位相关改动。
   - 包括其他开发者合入的同 Feature 代码，以及 merge 后的冲突解决修改。保留 merge commit，必要时与各 parent 比较，检查最终合并结果；不能用 `--no-merges` 筛掉这类修改。
   - 一个 commit 混有多个功能时，按行为和差异块划分；无关功能排除，共享路径中影响本规则的部分保留。不能仅凭提交信息或文件名决定纳入、排除。
   - 在范围确认表中写明入口/路径、提交线索及纳排依据、相关提交数和文件数。审查起点是相关改动，最终判断仍须涵盖 head 中满足规则所需的既有实现。
8. **已知的已接受偏差**：查找 Functional Spec 修订历史、台账 `§4` 或用户提供的决策记录。只有明确决策覆盖的**具体义务/检查点、适用层级、增量及有效期限**才免于重复报告，不能把一个 atom 或测试事项的延期当作整条 BR 的实现豁免。
   - 核对延期条件是否已到期、后续决策是否已替代；同一事项按最新适用记录判断。仅写 deferred、没有清楚适用范围的，列为待确认，不自行扩展豁免。
   - 其余检查点照常审查。有效偏差在报告「已接受偏差」列出，并注明本次核对结果；偏差已超出批准范围或到期未满足时照常报告。

把解析结果整理成一张**范围确认表**交给用户：审查口径、规范与台账版本、规则数、change、仓库 × 分支 × 固定 head/历史范围 × 自动圈定依据及文件数。用户确认后再进入第 1 步。用户已完整指定全部范围时，可以直接继续，但报告开头仍要列出这张表；无需用户逐个选择 commit。

## 审查方法（按顺序执行）

### 1. 抽取规则清单，并拆出检查点

**审查粒度是 BR / INV 规则**，不是台账中的 atom（如 `BR-MI-064.33`）。只有台账在 `§2` 中把某个 atom 标为非 covered，或 `§4` 中有未关闭的记录时，才单独展开该 atom。

从 Functional Spec 抽取范围内的全部 BR / INV，每条列「ID + 一句话」。同时记录：
- 带 `OQ-xxx` 或明确待定的规则（候选 U）；
- 文档中已记录的决策：`REQ-*` 决策表、修订历史中「user-confirmed / BA-confirmed」的条目。这些是**已接受的口径**，按决策后的语义审查。

然后**在搜索代码之前**，按实际独立义务拆出足够的可检查点，按适用的五要素归类，不设固定数量。检查点必须与原规范语义等价，以可观察结果和不变量为准；实现机制只是核查线索，除非规范明确规定，否则不能要求唯一做法。例如：

| 规则原文 | 检查点 |
| --- | --- |
| 主结果按文档最后修改时间倒序，相同时间保持稳定顺序 | 首要排序依据是文档级最后修改时间且为倒序；相同时间的顺序稳定。唯一键次序只是可行机制之一，不强制要求 |
| 空条件 Apply 不返回无界列表 | 无条件请求不会返回无界列表；具体采用拒绝、空结果还是有界返回，以适用规范为准，不自行指定 |
| Status 可选值包括 Draft、Reviewed、QC Reviewed | 选项包含这三个值；是否还有其他值按规范核对，不自行改成封闭枚举 |

拆解时要求：
- 重点拆出容易漏的点：取值来源（哪个版本、文档级还是版本级）、组合逻辑（AND / OR）、排序与分页、适用的服务端校验、Denial behavior 的副作用；
- 同时写出这些检查点分别该在哪一层验证（后端、前端或两者），作为第 3 步的搜索清单；
- 检查点清单写进报告的覆盖矩阵依据中，不单独输出；规范未明确的行为不补成要求，影响结论时记 U 或请用户确认。

### 2. FS → OpenSpec
- 读台账 `§2 Atom Coverage` 表；`§1` 的历史 deferred 段落不代表当前状态。`§4` 同一事项以最新适用记录为准，不覆盖其他义务或增量的判断。
- `✅ covered` 只作定位线索：核对 `Covered by` 是否仍有效，并逐个确认承载本次义务的 Requirement / Scenario 与所选 FS 口径一致。不能仅凭台账状态或抽样结果给未核对项标 ✅。
- 已有逐项语义核对记录且源文档与所引用的 OpenSpec 内容均未变化时直接复用；只比较 FS 版本不够，OpenSpec 单独变化也须定向复核。没有可复用依据、非 covered、缺行或版本不符时，按第 0 步定位适用的生效规范或历史版本人工核对，不只找原 change 的 `specs/`。
- 确认语义不一致或在完整适用范围内确实缺少对应义务 → **D**；尚未读取、无法访问或证据不充分的部分记 U 或盲区，不当作已覆盖或确定缺失。
- 已接受或延期事项只按第 0 步确定的具体范围处理，报告中列明适用义务与本次核对结果，不免除同规则其余检查点。

### 3. 规则 → 代码
对每条 BR，按第 1 步拆出的检查点逐项在代码中定位实现点（Controller / Service / Repository / SQL / Flyway 迁移 / 前端组件或 hook），给出 `file:line`。记录每个检查点是否核对到；没有核对到的检查点要写进报告的盲区，不能默认为满足。五要素的核对要点如下：

| 要素 | 核对点 |
| --- | --- |
| Trigger | 实现是否挂在规则所述的触发点上；是否遗漏同一触发点的其他入口 |
| Preconditions | 前置条件是否被校验；校验位置是否先于副作用 |
| Rule | 结果是否与规则一致（取值来源、范围、排序、版本选择等） |
| Exceptions | 例外分支是否存在且条件一致 |
| Denial behavior | 拒绝时的结果（无副作用、错误码、提示、是否部分提交）是否一致 |

优先从第 0 步自动圈定的相关差异入手，再检查固定 head 中的完整实现及直接依赖；不要把混入同一 Git 范围的其他功能纳入审查。规则行为也可能落在 diff 之外，未找到时要在该固定版本的整个仓库中搜索后再下结论，不误读其他版本的工作区文件。

### 4. 不变量与旁路入口
对每条 INV，确认代码层面有保证，不只是 UI 层。至少检查以下旁路：
- REST / 内部 API 直调（绕过前端校验）；
- 批量操作、导入、迁移脚本 / Flyway 数据迁移；
- 异步任务、监听器、ECS worker、跨服务调用（如 Manager、Rendition）；
- 并发：同一对象的并发写，是否有锁、版本号或唯一约束。

只在 UI 层被保证 → **P**。

### 5. 反向扫描（找 X）
遍历第 0 步圈定差异中新增或修改的相关业务分支（新的条件判断、新端点、新字段写入、新错误码），追溯其适用 BR / INV / OpenSpec Requirement。行为不在本增量清单里时，先核对关联的现行规则及已确认决策，不能直接当作无依据。以下情况记为 **X**：
- 核对适用规范与决策后仍找不到依据的业务行为（纯重构、日志、技术性防御代码不算）；
- 「已撤回」清单中的规则在代码中仍然生效。

### 6. 测试覆盖
- 对每条 BR，查找 `openspec/changes/<change>/test_spec/`（或已提升的 `test_spec/<change>/`）中的 TC，以及仓库单测、`Freya-Docs-TA` 中的自动化用例。
- 没有任何测试覆盖 → **T**。断言与规则不一致（断言了错误的值，或只断言了 happy path、漏掉 Denial behavior）→ **T**。
- 只核对测试是否存在、断言是否正确。**不运行测试**，也不声称测试已通过。

## 判定纪律

- 每条发现给出规范依据、差异与影响，以及 taxonomy 对应类型所要求的证据。M / C / P 需要规则 ID、原文要点和固定版本代码路径；D 用规范双方证据，X 可注明无对应规则并列搜索范围，T 用测试证据，U 说明缺口。不为满足统一格式编造规则 ID 或无关代码位置。
- 没找到实现时，写明搜索过的关键词和目录，置信度记为 **Suspect**，不要直接判定为确定的 Missing。
- 规范含糊或带 `OQ-xxx` 的，归为 **U**，不要自行推断答案。
- 只报告明确冲突或明确缺失。「可以更好」的建议只能放在 S4，并标注为建议。
- Functional Spec 中不该出现的实现细节，不当作要求。代码内部结构（分层、命名、抽取方式）不当作违反 BR。
- 不审查范围外的规则和模块。不做代码风格、性能、重构类评价。
- 权威顺序：Functional Spec > OpenSpec > 代码。OpenSpec 与代码一致但与 FS 不一致时，代码发现照常报告；如果 FS 修订历史显示该处是更晚的决策，归属写 `needs-decision`。

分类、级别、置信度和归属的定义见 [references/taxonomy.md](references/taxonomy.md)，必须严格按其中定义标注。

## 输出

按 [references/report-template.md](references/report-template.md) 的结构输出，各节顺序不变，某节为空时写「无」。总评须区分审查完成且无实质问题、审查完成且有发现、审查未完成且存在影响结论的缺口；不能因没有确认 S1 / S2 就判整体通过。

涉及多个仓库（如前后端）或规则较多（超过约 30 条）时，可以按仓库或规则组派发只读子 agent 并行执行第 3–6 步：

- brief 要包含：实际规范和台账路径/版本、审查口径、**第 1 步拆出的每条规则检查点**、各仓库固定 head 和自动圈定的相关路径/提交依据、工作区是否纳入、五要素核对表、判定纪律、分类定义、具体有效的已接受偏差，并要求子 agent 只读、不运行测试、不继续委派，逐个检查点返回「已核对 / 未核对」及所属版本证据。
- 子 agent 启动失败（例如模型不可用）时，改用 fork 或在当前会话中执行，不要反复重试同一配置。
- 汇总时：
  - 去重；
  - 把一个子 agent 留给其他层确认的问题（「需要前端确认……」「需要后端交叉核对……」），用另一层的证据逐条闭合。闭合后不再列为 Suspect，在报告中注明已交叉核对；
  - 对每条 S1–S3 发现核对其类型要求的原始证据及版本；涉及实现时核对 `file:line` 和可达路径。只有满足 taxonomy 的完整证据条件才能标为 Confirmed，不能仅凭子 agent 自报或局部抽查升级置信度。
