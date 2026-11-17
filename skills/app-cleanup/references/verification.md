# 验证契约与标准脚本

## 可验证到什么程度

`scripts/verify_cleanup.py` 是跨平台的**只读断言检查器**，不是卸载器、全盘残留扫描器或任意命令运行器。Python 3.9+，仅标准库；操作系统相关的原生 API 与读取授权由调用者处理。

能够直接判定：指定路径当前是否存在；实际移动落点与原始载荷是否一致；保护文件/目录的内容、名称、类型、符号链接目标是否保持；JSON 具体位置是否移除/保持；SQLite 目标行是否归零、保留结果集是否不变、数据库及外键是否正常。

**不能绝对证明**：任意未知位置无残留、磁盘安全擦除、原生回收站一定可恢复、云端账号/历史删除、原生凭据不存在、采样时刻之外永不再生。SHA-256 是内容相等的工程依据，不宣称抗任意恶意伪造或数学零碰撞；报告和 baseline 也没有身份签名。验证原始数据，不接受调用者填 `success: true` 当完成依据。

输入要在稳定窗口读取，数据库按自身只读事务获取一致视图。同一阶段同一数据库的检查共享一个连接/事务；不同数据源之间不假定原子性。文件检查会检测读取期间可观察到的替换、属性或目录变化，但不能取代真正的停写/快照机制。文件载荷检查不覆盖 ACL、扩展属性、macOS 资源分支或 Windows 备用数据流；这些属于验收条件时须另用原生检查器，不能用内容哈希宣称这些元数据全部保持。未获读取授权不运行 capture。

## 清单与覆盖

每个当前类别使用一个 manifest，沿用已有任务目录。断言在执行清理前确定，不因验证失败缩小；每项都有稳定 ID。按实际目标同时列出：

1. 清理对象（如存在性、精确 SQL 目标集合）。
2. 用户要求保护的对象或业务不变量（如书签、保留行、其他配置）。
3. 关联完整性（如外键、父子引用）。
4. 需要但脚本不支持的原生项：`native` 明确标为不可验证，或在任务验收清单中另附原生检查器的实际输入、查询、时点、输出与状态；不能悄悄删除这项求全绿。

不要只用 `SELECT COUNT(*)` 比较保留行：行数不变仍可内容损坏；用 `unchanged` 比较选定的完整业务行。查询应包含区分身份的键和值，参数来自审定范围，不依赖清理后的目标表来重新定义保留集合。会话关系需要额外查询或原生检查，数据库外键通过不能证明所有业务引用有效。

manifest 自身由操作者基于分类清单建立，脚本无法证明分类清单覆盖整机或断言符合用户意图。这一覆盖判断须在执行前审定。脚本没有可忽略的失败/可选 check；部分通过不能报告整批通过。

## Manifest 格式

根对象仅含 `version`（整数 1）、非空 `scope`、非空 `checks`。

```json
{
  "version": 1,
  "scope": "本机已确认的示例应用配置类别；保留书签和其他渠道",
  "checks": [
    {"id": "app-removed", "kind": "absent", "path": "/absolute/local/App"},
    {"id": "data-moved", "kind": "moved", "path": "/absolute/local/AppData"},
    {"id": "bookmarks", "kind": "preserved", "path": "/absolute/profile/Bookmarks"},
    {"id": "backup", "kind": "preserved", "path": "/absolute/profile/Bookmarks.bak"},
    {"id": "origin", "kind": "json", "path": "/absolute/settings.json", "selector": ["origins", "app.example"], "rule": "absent"},
    {"id": "keep-settings", "kind": "json", "path": "/absolute/settings.json", "selector": ["otherTool"], "rule": "unchanged"},
    {"id": "rows-removed", "kind": "sqlite", "path": "/absolute/mixed.db", "query": "SELECT COUNT(*) FROM providers WHERE app_type = ?", "params": ["target-app"], "rule": "equals", "expected_rows": [[0]]},
    {"id": "rows-kept", "kind": "sqlite", "path": "/absolute/mixed.db", "query": "SELECT id, app_type, config FROM providers WHERE app_type <> ?", "params": ["target-app"], "rule": "unchanged"},
    {"id": "integrity", "kind": "sqlite_integrity", "path": "/absolute/mixed.db"}
  ]
}
```

路径必须是当前操作系统的绝对路径；示例占位路径不执行。Windows JSON 中写 `C:\\Users\\Example\\...`。不固定用户名、厂商、应用版本或数据库表名。不要在 manifest、SQL 参数或报告中写入凭据值。

### 断言种类

| kind | 行为与字段 |
|---|---|
| `absent` | `path`；用 `lstat` 区分不存在和无读取权限。目标本来已不存在也可确认当前不存在，但会明确没有证明新发生的删除。悬空符号链接算存在。 |
| `moved` | `path` 是原始位置；capture 记录原载荷。verify 要求原位置消失、实际 `destination` 存在且载荷相同，不能仅凭原位置消失通过。此结果不单独证明 native Trash 的恢复功能。 |
| `preserved` | `path` 为文件、目录或符号链接；比较相对名称、类型、内容、空目录和链接目标，默认不跟随符号链接。可选 `permissions: true` 额外比较平台报告的权限位；这不是 Windows ACL 检查。保护对象原本缺失标不可验证。 |
| `json` | `path`、`selector`（精确键/非负数组索引，不解析点号）、`rule` 为 `absent` / `unchanged` / `equals`；仅 equals 加 `expected`。`null` 与不存在不同；容器类型错误不是不存在。拒绝重复 JSON 键、NaN/Infinity。 |
| `sqlite` | `path`、只读 `query`、可选标量数组 `params`；`rule` 为 `equals` 或 `unchanged`。equals 要有 `expected_rows`。默认比较保留重复行及 SQL 值类型的无序多重集；要验证顺序就设 `ordered: true` 并写确定性 `ORDER BY`。unchanged 的空基线默认不可验证，只有确有意义才加 `allow_empty: true`。计数归零应写 `SELECT COUNT(*)` 和 `[[0]]`，不是把零命中当执行覆盖。 |
| `sqlite_integrity` | `path`；固定运行只读 `PRAGMA quick_check` 和 `PRAGMA foreign_key_check`，两者均通过才 pass。不是任意 PRAGMA 执行接口。 |
| `native` | 仅 `id`、`kind`、`reason`。例如 `{"id":"keychain","kind":"native","reason":"需原生凭据存在性查询"}`。脚本始终标不可验证，不能导入一个布尔值冒充实际查询。 |

SQLite 使用 URI `mode=ro`、query-only 及 authorizer，拒绝写入、ATTACH、扩展加载、非查询语句；缺失数据库不会自动创建。参数绑定不用于标识符。读取失败、数据库锁定、无权限、数据类型或模式异常不报成功。SQL 期望整数 `0` 与实数 `0.0` 不等，保留 BLOB、NULL 和重复行。

## 运行与移动落点

```bash
python3 /absolute/skill/scripts/verify_cleanup.py capture \
  --manifest /absolute/run/manifest.json --output /absolute/run/before.json

# 执行已确认类别，记录原生 API 返回的真实落点。
# destinations.json 只包含 moved check 的 id → 实际绝对路径，例如：
# {"data-moved": "/actual/native/trash/renamed-AppData"}

python3 /absolute/skill/scripts/verify_cleanup.py verify \
  --baseline /absolute/run/before.json --destinations /absolute/run/destinations.json \
  --output /absolute/run/after.json
```

verify 直接使用 baseline 中的原清单，不接受另一份缩小后的清单。`--destinations` 不能增加 check 或覆盖源路径；实际落点已提前确定时也可在 moved check 写 `destination`。不靠修改 baseline 记录落点。

输出必须在观测源/目标目录之外，且路径未占用；不覆盖旧报告、不创建父目录、不修改目标数据。报告保存摘要、计数、错误和时点，不保存文件正文或 SQL 行的原始值。捕获的摘要用于比较，不是备份，不提供数据恢复。

### 退出码和终态

- capture：`0` 为基线全部取得；`2` 为有缺口/输入错误，不是清理已验证。需要的 baseline 未取得时，先补齐或明确受阻，不执行依赖它的破坏操作。
- verify：`0` 所有声明断言 pass；`1` 有确定 fail；`2` 有 unverifiable 或格式/工具错误。不可验证优先于失败退出码，但逐项保留全部失败，不隐藏。
- 没有检查、未知字段、重复 ID、路径不绝对、覆盖不一致、输出已存在都拒绝。不设自动跳过、静默截断或可忽略错误。

每次接续先查已有原生操作与报告，不为重跑 verifier 重放删除。有效同输入结果复用；新的输入/目标重新出现时，只检查变化部分并说明原因，不自动获得下一轮删除授权。

## 本地测试

```bash
python3 /absolute/skill/scripts/test_verify_cleanup.py
```

测试仅在系统临时目录构造文件、JSON、SQLite 数据，不接触真实应用、浏览器或凭据。脚本兼容 Windows/macOS/Linux 的标准库接口；在某一系统运行通过不能声称另外两类系统已实机验证。
