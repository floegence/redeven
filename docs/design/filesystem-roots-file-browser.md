# 文件系统 Roots 与任意授权目录浏览最终设计

> 本文是 Redeven runtime 文件浏览能力的最终态设计方案。目标不是给现有 Home-only 行为打补丁，而是把“默认起点”“可访问边界”“UI 展示根”三者拆清楚，形成一套可审计、可复用、可扩展的文件系统访问模型。

## 1. 问题定性

当前文件浏览组件只能进入 Runtime Home，本质原因不是单个 UI 缺陷，而是全链路把 `agent_home_dir` 同时当成了：

- 用户默认工作起点；
- 文件、Git、Terminal、AI working dir 的唯一访问边界；
- 文件浏览器 UI 中显示为 `/` 的虚拟根。

这会带来三个产品问题：

- UI 里的 `/` 不是操作系统根目录 `/`，用户理解成本高；
- 用户即使拥有本机 OS 权限，也无法在 Redeven 中浏览 Home 之外的目录；
- 若简单把 `agent_home_dir` 改成 `/`，又会把 Terminal、Git、AI、文件写入等能力一次性扩大到整机，安全边界过粗。

最终态必须做到：用户可以浏览任意被 Redeven 本地策略授权、且 OS 当前用户有权限访问的目录；同时所有路径能力仍然有明确根边界、权限交集、审计语义和一致的 UI 表达。

## 2. 最终设计原则

1. `agent_home_dir` 只表示 Home 快捷路径与默认工作目录，不再表示唯一访问边界。
2. 所有本地文件系统能力统一通过 `filesystem_scope` 解析，不允许各模块各写一套路径判断。
3. 访问授权是三者交集：控制面 `session_meta`、本地 `permission_policy`、本地 `filesystem_scope`。
4. UI 显示真实路径语义：`/` 永远表示 OS root；`~` 永远表示 `agent_home_dir`；root 列表用明确名称表达访问边界。
5. 删除所有 Home-only 虚拟根转换逻辑，不保留隐藏兼容层。
6. symlink 解析必须以 root scope 为准，禁止通过符号链接逃逸到未授权目录。
7. Git、Terminal、AI working dir、File Preview、Ask Flower/Codex context handoff 使用同一套路径规范。

## 3. 核心数据结构

### 3.1 Runtime config

`config.Config` 新增 `FilesystemScope`，`AgentHomeDir` 语义改为默认 Home/工作起点。

```go
type Config struct {
    AgentHomeDir     string             `json:"agent_home_dir,omitempty"`
    PermissionPolicy *PermissionPolicy  `json:"permission_policy,omitempty"`
    FilesystemScope  *FilesystemScope   `json:"filesystem_scope,omitempty"`
}

type FilesystemScope struct {
    SchemaVersion int                    `json:"schema_version"`
    DefaultRootID string                 `json:"default_root_id,omitempty"`
    Roots         []FilesystemRootPolicy `json:"roots"`
}

type FilesystemRootPolicy struct {
    ID           string                  `json:"id"`
    Label        string                  `json:"label"`
    Path         string                  `json:"path"`
    Kind         FilesystemRootKind      `json:"kind"`
    Permissions  FilesystemPermissionSet `json:"permissions"`
    Hidden       bool                    `json:"hidden,omitempty"`
    System       bool                    `json:"system,omitempty"`
}

type FilesystemRootKind string

const (
    FilesystemRootHome     FilesystemRootKind = "home"
    FilesystemRootComputer FilesystemRootKind = "computer"
    FilesystemRootCustom   FilesystemRootKind = "custom"
)

type FilesystemPermissionSet struct {
    Read  bool `json:"read"`
    Write bool `json:"write"`
}
```

默认配置在未显式声明时生成两类 root：

```json
{
  "agent_home_dir": "/Users/alice",
  "filesystem_scope": {
    "schema_version": 1,
    "default_root_id": "home",
    "roots": [
      {
        "id": "home",
        "label": "Home",
        "path": "/Users/alice",
        "kind": "home",
        "permissions": { "read": true, "write": true },
        "system": true
      },
      {
        "id": "computer",
        "label": "Computer",
        "path": "/",
        "kind": "computer",
        "permissions": { "read": true, "write": false },
        "system": true
      }
    ]
  }
}
```

说明：

- `computer` 默认只读，避免文件浏览体验和危险写操作绑定。
- `computer` 的写权限不是隐藏在高级配置里的“系统开关”，而是作为 Files root sidebar 中 Computer 行旁的显式 RO/RW 控件暴露给用户；默认 RO，用户可在确认后切换为 RW。
- 用户可在本地配置中把特定目录加入 `custom` root，并单独授予写权限。
- 若用户明确把 `/` 配为可写，Runtime 仍只执行普通 OS 用户权限范围内的写入，不做提权。

### 3.2 运行时 Scope Registry

新增包 `internal/filesystemscope`，成为所有路径能力的唯一入口。

```go
type Registry struct {
    homeAbs       string
    defaultRootID string
    roots         []Root
    byID          map[string]Root
}

type Root struct {
    ID          string
    Label       string
    PathAbs     string
    PathReal    string
    Kind        RootKind
    Permissions PermissionSet
    System      bool
}

type ResolvedPath struct {
    RootID      string
    RootLabel   string
    InputPath   string
    LogicalAbs  string
    RealAbs     string
    Relative    string
    Permissions PermissionSet
}

type ResolveOptions struct {
    RequireExisting bool
    RequireDir      bool
    ForWrite        bool
    AllowFileTarget bool
}
```

关键 API：

```go
func NewRegistry(cfg *config.Config) (*Registry, error)
func (r *Registry) PathContext() PathContext
func (r *Registry) Resolve(path string, opts ResolveOptions) (ResolvedPath, error)
func (r *Registry) ResolveTarget(path string, opts ResolveOptions) (ResolvedPath, error)
func (r *Registry) Contains(path string) (ResolvedPath, bool)
```

规则：

- `~` 与 `~/...` 只展开到 `homeAbs`。
- 普通绝对路径按所有 root 的 `PathReal` 做最长前缀匹配。
- root 之间嵌套时选择最长匹配 root，避免 `/` 的只读 `computer` 覆盖 `/Users/alice/projects` 的可写 custom root。
- 对现有路径使用 `EvalSymlinks` 后校验 real path 仍在 root 内。
- 对目标路径使用“最近存在祖先”解析，防止通过不存在尾段绕过 symlink 检查。
- 匹配不到 root 返回稳定错误 `PATH_OUTSIDE_FILESYSTEM_SCOPE`。

### 3.3 RPC contract

`fs.get_path_context` 改为返回完整上下文：

```ts
export interface FsPathContextResponse {
  homePathAbs: string;
  defaultRootId: string;
  roots: FsRoot[];
}

export interface FsRoot {
  id: string;
  label: string;
  path: string;
  kind: 'home' | 'computer' | 'custom';
  permissions: {
    read: boolean;
    write: boolean;
  };
  system?: boolean;
}
```

文件 RPC 请求继续接受真实绝对路径，不引入 root-relative path 作为长期接口，原因是：

- 真实绝对路径与 Terminal/Git/AI working dir 语义一致；
- 右键、预览、Ask Flower、Open in Terminal 之间无需做路径格式转换；
- UI 可用 root metadata 做展示与校验，但 runtime 仍是最终裁决者。

错误码统一：

| code | message | 场景 |
| --- | --- | --- |
| 400 | `invalid path` | 语法非法、路径为空、目标类型不符 |
| 403 | `read permission denied` | session/local cap 不允许读 |
| 403 | `write permission denied` | session/local cap/root 不允许写 |
| 403 | `path outside filesystem scope` | 路径不属于任何 root |
| 404 | `not found` | 路径不存在 |
| 409 | `destination already exists` | 创建/复制/重命名冲突 |

### 3.4 UI state model

文件浏览 UI 使用真实绝对路径作为主状态。

```ts
type FileBrowserRoot = {
  id: string;
  label: string;
  path: string;
  kind: 'home' | 'computer' | 'custom';
  canRead: boolean;
  canWrite: boolean;
  system: boolean;
};

type FileBrowserLocation = {
  pathAbs: string;
  rootId: string;
};

type FileBrowserViewState = {
  roots: FileBrowserRoot[];
  current: FileBrowserLocation;
  showHidden: boolean;
  viewMode: 'list' | 'grid';
  gitMode: 'files' | 'git';
};
```

删除旧的 `toFileBrowserDisplayPath` / `toFileBrowserAbsolutePath` Home-virtual-root 语义，替换为：

```ts
formatPathLabel(pathAbs, context) // 仅用于显示：/Users/alice -> ~
parsePathInput(raw, context)      // 输入解析：~、~/x、/x 都转真实绝对路径
findRootForPath(pathAbs, roots)   // UI 提示用，runtime 仍最终校验
```

## 4. 业务流程时序

### 4.1 打开文件浏览器

```text
Browser Env App
  |
  | rpc.fs.getPathContext()
  v
Runtime fs service
  |
  | Registry.PathContext()
  v
filesystemscope.Registry
  |
  | home + roots + default_root_id
  v
Browser Env App
  |
  | current = persisted path if still inside roots else default root path
  | rpc.fs.list({ path: current.pathAbs })
  v
Runtime fs service
  |
  | session_meta read ∩ permission_policy read ∩ root read
  | Registry.Resolve(path, RequireExisting+RequireDir)
  | os.ReadDir(resolved.RealAbs)
  v
Browser renders root sidebar + breadcrumb + entries
```

### 4.2 输入路径跳转

```text
User types: /var/log
  |
  v
UI parsePathInput("/var/log")
  |
  | absolute path = /var/log
  v
rpc.fs.list({ path: "/var/log" })
  |
  v
Runtime Registry.Resolve("/var/log")
  |
  +-- no matching root ------------------> 403 path outside filesystem scope
  |
  +-- root matched but OS denies --------> 400 invalid path / 404 not found
  |
  +-- root matched and readable ---------> entries
```

UI 不再把 `/var/log` 转成 `Home + /var/log`，也不再使用“路径在 Home 外则回退 Home”的兜底。

### 4.3 写入、删除、重命名

```text
User invokes mutation
  |
  | UI checks current root canWrite for affordance only
  v
rpc.fs.rename / write / delete / mkdir / copy
  |
  v
Runtime checks:
  session_meta.can_write
    ∩ permission_policy effective write
    ∩ filesystem root write
    ∩ symlink-safe path scope
  |
  +-- allowed ----> perform OS operation
  |
  +-- denied -----> stable 403
```

UI 只负责禁用和解释，不承担安全判断。

### 4.4 Git 与 Terminal 联动

```text
File Browser current path: /Volumes/work/repo
  |
  +--> Git resolveRepo({ path })
  |      Runtime Registry.Resolve(path, read)
  |      Git top-level must stay inside same matched root
  |
  +--> Open in Terminal
         Runtime terminal.resolveWorkingDir(path)
         Registry.Resolve(path, execute working dir)
```

Terminal 的可启动目录与文件浏览根保持一致，但执行能力仍由 `execute` 控制。若一个 root 可读不可写，Terminal 能否进入该目录取决于 `execute` 是否允许；Terminal 执行后的文件系统写入由 OS 权限决定，因此 UI 必须用“Terminal can modify files when execute is enabled”解释 execute 的风险。

### 4.5 AI working dir 与文件引用

```text
Ask Flower / Codex context from Files
  |
  | selected absolute paths + root metadata
  v
AI service validates working_dir through Registry.Resolve()
  |
  | builtin tool path resolver uses same Registry
  v
Model/tool execution sees consistent absolute paths
```

所有 AI tool path normalization 删除“project root 必须在 Home 下”的旧假设，改为“working dir 必须在某个授权 root 下，工具目标必须在 working dir/root 允许范围内”。

## 5. UI 与交互设计

### 5.1 现有组件保留原则

最终实现必须基于当前文件浏览器组件体系演进，不允许为了支持 roots 浏览而重做一个简化版文件浏览器。现有用户已经依赖的操作密度、状态反馈和桌面级效率必须保留。

必须保留并继续复用的现有结构：

- `RemoteFileBrowser` 作为业务编排容器，继续负责 runtime RPC、Git mode、context menu、preview、Ask Flower/Codex、Open in Terminal 等跨表面联动。
- `FileBrowserWorkspace` 作为文件浏览主工作区，继续承载 sidebar、toolbar、列表/网格、拖拽、筛选和状态栏。
- Path 行继续包含路径控件、filter 输入、Refresh、List/Grid 视图模式切换、More 下拉，不允许因为新增 roots sidebar 而删除或降级。
- `FileBrowserPathControl` 继续作为路径查看/编辑入口，只改变路径语义：`/` 代表 OS root，`~` 代表 Home。
- `FileBrowserSidebarTree` 继续承载目录树能力；新增 roots 只是 sidebar 顶层分组，不替换目录树。
- 现有 `show hidden`、Go to path、Refresh current directory、file count、selected count、filter active、loading 文案等状态反馈全部保留。
- 现有 context menu 项目继续保留；仅根据 root 权限增加禁用原因或危险确认，不做功能删减。
- Workbench wheel/text selection 规则保持不变；新增 roots/sidebar 不能引入未标记滚动视口或破坏文本选择所有权。

也就是说，本次 UI 变化的本质是：在当前文件浏览器上增加“真实 filesystem roots 的导航维度”，而不是替换当前成熟工具栏和文件列表体验。

### 5.2 最终结构

文件浏览器最终结构：

```text
+----------------------------------------------------------------------------------+
| Files                                                                            |
+----------------------+-----------------------------------------------------------+
| ROOTS                |  [Up] Path [ /Volumes/work/repo/src             ]         |
|                      |       Filter files...        [List|Grid] [Refresh] [More] |
|                      |-----------------------------------------------------------|
| > Home          RW   |  Home / Volumes / work / repo / src                      |
|   /Users/alice       |-----------------------------------------------------------|
|                      |  Name                         Kind      Modified         |
| > Computer      RO   |  -------------------------------------------------------- |
|   /                  |  components                   Folder    10:42            |
|                      |  main.tsx                     TSX       10:35            |
| > Projects      RW   |  package.json                 JSON      Yesterday        |
|   /Volumes/work      |                                                           |
|                      |                                                           |
| FAVORITES            |                                                           |
| + Add current folder |                                                           |
+----------------------+-----------------------------------------------------------+
| 3 visible · Filter active · Root: Projects · Read/write enabled                  |
+----------------------------------------------------------------------------------+
```

对应到现有组件：

```text
RemoteFileBrowser
  |
  +-- FileBrowserWorkspace
        |
        +-- BrowserWorkspaceShell
        |     |
        |     +-- FileBrowserSidebarTree
        |     |     +-- Roots section: Home / Computer / Custom roots
        |     |     +-- Directory tree section: current root subtree
        |     |
        |     +-- FileWorkspaceHeader
        |     |     +-- Sidebar toggle (mobile/embedded)
        |     |     +-- Up button
        |     |     +-- FileBrowserPathControl
        |     |     +-- Filter files input
        |     |     +-- List/Grid SegmentedControl
        |     |     +-- Refresh button
        |     |     +-- More dropdown
        |     |
        |     +-- FileListView / FileGridView
        |     +-- FileWorkspaceStatusBar
        |
        +-- FileBrowserDragPreview
        +-- FileContextMenu
```

路径栏规则：

```text
显示：
  /Users/alice                  -> ~
  /Users/alice/Desktop          -> ~/Desktop
  /Volumes/work/repo            -> /Volumes/work/repo
  /                             -> /

输入：
  ~                             -> agent_home_dir
  ~/Desktop                     -> agent_home_dir/Desktop
  /                             -> OS root
  /tmp                          -> OS /tmp
  relative/path                 -> invalid，要求输入绝对路径或 ~
```

root sidebar 行为：

```text
Home
  - 永远指向 agent_home_dir
  - 默认选中
  - 默认 RW；仍受 session cap、permission_policy 与 OS 用户权限约束

Computer
  - 指向 OS /
  - 默认 read-only
  - root 行右侧展示 RO/RW segmented toggle
  - RO -> RW 必须弹出确认；RW -> RO 立即生效
  - 若用户没有 OS 权限读取某些目录，目录行保留但进入时报清晰错误

Custom roots
  - 用户配置或 Runtime Settings 添加
  - 可独立 read/write
  - root 行右侧同样展示 RO/RW 状态；custom root 可在 sidebar 快速切换，也可在 Runtime Settings 完整管理
  - label 可编辑，path 不做虚拟化
```

root row 交互结构：

```text
+------------------------------------------------+
| ROOTS                                          |
|                                                |
| > Home                                [ RW ]   |
|   /Users/alice                                 |
|                                                |
| > Computer                            [ RO ]   |
|   /                                             |
|                                                |
| > Projects                            [ RW ]   |
|   /Volumes/work                                |
+------------------------------------------------+

点击行主体：进入该 root
点击 RO/RW：只切换该 root 写权限，不触发导航
键盘焦点：root 行与 RO/RW 控件分别可聚焦，切换控件有清晰 aria-label / title
当前 root 目录树 header：只显示当前 RO/RW 状态 chip，不重复提供第二个可变更入口
```

RO/RW 控件的产品语义：

- RO 表示该 root 允许读，不允许通过 Redeven 文件 API 执行 create、delete、rename、copy target、overwrite、mkdir 等 mutation。
- RW 表示 Redeven 文件 API 可以在该 root 下执行写操作，但最终仍与 `permission_policy`、session capability、runtime registry 与 OS 用户权限取交集。
- Computer 从 RO 切到 RW 等价于允许 Redeven 对 `/` 下“当前 OS 用户本来就有权限写入”的路径发起写操作；它不是提权，也不是绕过系统保护。
- 切换权限必须走 runtime 一等更新路径：校验 root id/kind、持久化 `filesystem_scope`、原子重建 registry、发布新的 path context，UI 再刷新 mutation affordance。禁止只在前端本地改按钮状态，也禁止用失败后再兜底回退的补丁逻辑。

Computer RO -> RW 确认：

```text
+--------------------------------------------------+
| Enable write access for Computer                 |
|                                                  |
| Redeven will be allowed to create, rename,       |
| delete, and overwrite files anywhere under /     |
| that your macOS user can write. System           |
| permission prompts and OS restrictions still     |
| apply.                                           |
|                                                  |
| Root: Computer                                   |
| Path: /                                          |
|                                                  |
| [Keep read-only]              [Enable RW]        |
+--------------------------------------------------+
```

权限切换时序：

```text
User clicks Computer [RO]
  -> FileBrowserSidebarTree opens confirmation dialog
  -> user confirms Enable RW
  -> UI calls runtime settings/filesystem-scope update API
  -> runtime validates root id, system root kind, and requested permission transition
  -> runtime persists filesystem_scope
  -> runtime atomically rebuilds filesystemscope.Registry
  -> runtime publishes refreshed FsPathContextResponse
  -> RemoteFileBrowser reloads path context and current directory metadata
  -> context menu, toolbar, drag/drop, and status bar update mutation affordances
```

危险写入提示：

```text
root = Computer(/), write enabled
operation = delete / rename / overwrite / recursive copy

+------------------------------------------+
| Confirm filesystem change                |
| You are modifying a system-level root.    |
| Path: /etc/example.conf                   |
|                                          |
| [Cancel] [Confirm change]                 |
+------------------------------------------+
```

这个确认是交互层保护，不是权限兜底；权限仍由 runtime 执行。

## 6. 模块级最终实施清单

### 6.1 `internal/config`

- [x] 新增 `FilesystemScope`、`FilesystemRootPolicy`、`FilesystemPermissionSet` 配置结构。
- [x] 更新 `Config.AgentHomeDir` 注释：从 “filesystem scope” 改为 “default home / working directory”。
- [x] `ValidateLocalMinimal` 校验 `filesystem_scope.schema_version`、root id 唯一性、label/path 非空、权限合法。
- [x] 默认配置生成 Home + Computer roots。
- [x] Bootstrap/config save/load 保持 unknown fields forward-compatible。
- [x] 移除所有把 `agent_home_dir` 当唯一 filesystem boundary 的新旧注释。

### 6.2 `internal/filesystemscope`

- [x] 新建包并实现 `Registry`、`Root`、`ResolvedPath`、`ResolveOptions`。
- [x] 实现 root canonicalization、最长 root 匹配、`~` 展开、绝对路径解析。
- [x] 实现 existing path 与 target path 的 symlink-safe 校验。
- [x] 实现稳定错误类型：invalid、not found、outside scope、read denied、write denied。
- [x] 为 Windows 路径语义预留平台适配文件；Unix/macOS 下 `/` 是 Computer root。
- [x] 删除 `pathutil.ResolveExistingScopedPath` 在业务模块中的直接使用入口；保留底层工具函数时只供 registry 内部使用。

### 6.3 `internal/fs`

- [x] `Service` 持有 `*filesystemscope.Registry`，不再只持有 `agentHomeAbs`。
- [x] 生产入口使用 `NewServiceWithScope(registry)`；保留旧 `NewService(agentHomeAbs)` 作为测试/默认 scope 包装器，不再承载业务边界。
- [x] `fs.get_path_context` 返回 `home_path_abs`、`default_root_id`、`roots[]`。
- [x] `listDirectoryEntries` 使用 `Registry.Resolve(...RequireDir)`。
- [x] `readFile` 与 `fs/read_file` stream 使用同一 registry read path。
- [x] `write/mkdir/delete/rename/copy` 使用 `Registry.ResolveTarget(...ForWrite)`。
- [x] 删除 Home-only 错误文案，统一为 scope-aware 错误。
- [x] 保留符号链接分类，但进入 symlink directory 前重新校验 real path root。

### 6.4 `internal/gitrepo`

- [x] `Service` 使用 registry 解析 repo path。
- [x] `resolveRepoForPath` 允许任意授权 root 内的 Git repo。
- [x] Git top-level real path 必须仍在匹配 root 内；删除 “repoRoot 必须在 agentHomeAbs 下” 旧逻辑。
- [x] workspace、diff、stash、branch worktree 路径统一走 registry。
- [x] Git UI 不再因路径 Home 外而显示 “not inside repository” 的误导性 fallback。

### 6.5 `internal/terminal`

- [x] `Manager` 使用 registry 解析 working dir。
- [x] `resolveWorkingDir` 默认取 `agent_home_dir`，但允许进入任意授权 root 内目录。
- [x] Terminal 创建失败区分 outside scope、not directory、not found、execute denied。
- [x] 终端相关文档明确 execute 风险：即使 root write=false，shell 仍可按 OS 权限修改文件。

### 6.6 `internal/ai`

- [x] `validateThreadWorkingDir` 改用 registry。
- [x] builtin tool path resolver 改用 registry，不再要求 project root 位于 Home。
- [x] prompt workspace context 增加 `filesystem_roots` 摘要，避免模型误认为 Home 是唯一可访问范围。
- [x] Ask Flower 从 Files 传递绝对路径与 root label；Codex cwd 使用 registry 校验后的绝对路径，不注入 Home 虚拟路径。
- [x] 删除旧的 Home-only working dir fallback，不能把无效路径静默改回 Home。

### 6.7 `internal/agent`

- [x] Agent 初始化时创建一个共享 `filesystemscope.Registry`。
- [x] fs、gitrepo、terminal、ai、codeapp/codex 统一注入同一个 registry。
- [x] startup log 输出 home、roots 摘要与权限，不输出敏感 credential。
- [x] session serve path 不再重复构造 Home-scoped service。

### 6.8 `internal/codeapp` / `internal/codexbridge`

- [x] Code App workspace path 解析改用 registry。
- [x] Codex default cwd 仍为 `agent_home_dir`，但用户选择的 cwd 可位于任意授权 root。
- [x] gateway settings API 展示 filesystem roots 状态。
- [x] 禁止通过 Code App gateway 私自绕过 registry 访问本地路径。

### 6.9 `internal/envapp/ui_src` 协议层

- [x] 更新 `FsPathContextResponse` 类型。
- [x] 更新 fs codec/wire 测试，覆盖 roots contract。
- [x] 删除 `agentHomePathAbs` 作为唯一 root 的使用。
- [x] 新增 `filesystemRoots.ts`：context normalization、root matching、path label formatting、input parsing。

### 6.10 `internal/envapp/ui_src` 文件浏览 UI

- [x] `RemoteFileBrowser` state 使用真实绝对路径。
- [x] 保留 `RemoteFileBrowser` / `FileBrowserWorkspace` / `BrowserWorkspaceShell` / `FileWorkspaceHeader` / `FileBrowserPathControl` / `FileBrowserSidebarTree` 的现有职责边界，只做 roots-aware 扩展。
- [x] 保留 Path 行现有控件：Up、Path、Filter files、List/Grid、Refresh、More dropdown；新增 roots 不得删除、隐藏或降级这些功能。
- [x] 保留 More dropdown 中 Go to path、Show hidden files 等现有操作，并扩展为真实绝对路径语义。
- [x] 将 `visibleBrowserPath`、`buildFallbackDirectoryCandidates` 改为 roots-aware，不再使用 Home-only fallback。
- [x] 删除 `toFileBrowserDisplayPath` / `toFileBrowserAbsolutePath` Home 虚拟根映射。
- [x] Path 输入允许 `/` 表示 OS root，`~` 表示 Home。
- [x] Root sidebar 展示 Home、Computer、Custom roots。
- [x] Root sidebar 的 Computer 行新增内联 RO/RW segmented toggle：默认 RO，RO -> RW 需要强确认，RW -> RO 立即生效。
- [x] Root sidebar 的 custom root 行展示 RO/RW 状态并支持快速切换写权限；Home 行展示 RW 状态但仍受全局 capability 与 OS 权限约束。
- [x] 当前 root 目录树 header 只展示被动 RO/RW status chip，不提供重复写权限开关，避免两个入口状态竞争。
- [x] RO/RW 控件点击与键盘操作不得触发行导航；root 行主体导航与权限切换必须有清晰的 hit area 与 focus ring。
- [x] 权限切换后刷新 path context、status bar、context menu mutation、drag/drop mutation affordance，不允许只改本地视觉状态。
- [x] `FileBrowserSidebarTree` 顶部新增 roots section，当前 root 下的目录树能力继续保留。
- [x] 持久化 last path 时保存真实绝对路径，并在恢复时验证仍属于 roots；无效则明确回默认 root。
- [x] context menu mutation 根据 root write permission 禁用并显示原因。
- [x] Git mode、Open in Terminal、Ask Flower/Codex 使用真实绝对路径。
- [x] Workbench Files widget semantic state 保存真实路径和 root id。

### 6.11 Runtime Settings UI

- [x] Runtime Settings 页面新增 Filesystem Roots 表格。
- [x] 支持查看 Home/Computer/custom roots 的 path、read/write、system/custom。
- [x] 支持添加/编辑/移除 custom root。
- [x] system root 不可删除；Computer write 默认关闭。
- [x] Runtime Settings 继续作为完整管理面；Files root sidebar 中的 Computer/custom RO/RW 控件作为高频快捷入口，二者使用同一条 runtime 更新路径。
- [x] 写权限变更统一使用清晰确认策略：Computer RO -> RW 强确认，custom root RO -> RW 普通确认，RW -> RO 立即生效。

## 7. `.md` 文档修正与补充清单

- [x] 更新 `docs/PERMISSION_POLICY.md`：说明 `permission_policy` 是 RWX cap，`filesystem_scope` 是目录级文件系统 cap，两者取交集。
- [x] 更新 `docs/CAPABILITY_PERMISSIONS.md`：`FS Get home` 改为 `FS Get path context`，补充 roots contract 与 root write 权限。
- [x] 更新 `docs/ENV_APP.md`：补充文件浏览器 root sidebar、真实路径栏、Home/Computer/custom roots 交互。
- [x] 更新 `internal/envapp/ui_src/README.md`：说明 Files widget shared state 保存真实绝对路径。
- [x] 更新 `docs/CODEX_UI.md`：Codex cwd 可来自任意授权 root。
- [x] 更新 `docs/AI_AGENT.md`：AI working dir 与 tool path scope 使用 `filesystem_scope`。
- [x] 更新 `docs/CODE_APP.md`：Code App workspace path 不再隐含 Home-only。
- [x] 公开仓正式英文文档已补齐；本文作为本次中文评审/验收方案草案保留，不作为最终公开用户文档口径。
- [x] 更新 `docs/ENV_APP.md`：补充 Files root sidebar 内联 RO/RW 切换、Computer 默认 RO、切换 RW 的确认语义。
- [x] 更新 `docs/PERMISSION_POLICY.md`：补充 Computer RW 仍与 `permission_policy`、session capability、OS 用户权限取交集。

## 8. 测试覆盖清单

### 8.1 Go 单测

- [x] `internal/config`：filesystem scope schema 校验、默认 roots、非法重复 root id、非法 path。
- [x] `internal/filesystemscope`：`~` 展开、绝对路径、最长 root 匹配、nested custom root 覆盖 `/`、symlink escape、target path existing ancestor。
- [x] `internal/fs`：Home list、Computer `/` list、custom root list、outside scope 403、root read=false、root write=false。
- [x] `internal/fs`：write target、mkdir、delete、rename source/destination、copy destination 均覆盖 root write 权限；copy source 只要求 read。
- [x] `internal/fs`：`fs/read_file` stream 与 JSON read 行为一致。
- [x] `internal/gitrepo`：Home 外 custom root repo 可 resolve；repo top-level 逃逸 root 被拒绝。
- [x] `internal/terminal`：custom root working dir 可启动；outside scope 失败；默认空 working dir 仍为 Home。
- [x] `internal/ai`：thread working dir、tool path、relative path normalization 均支持授权 root。
- [x] `internal/agent`：共享 registry 被注入 fs/gitrepo/terminal/ai/codeapp。

### 8.2 前端单测

- [x] `filesystemRoots.test.ts`：path context normalize、root matching、`~` label、`/` root label、input parse。
- [x] `fileBrowserPathInput`：删除 Home-only outside error；由 `filesystemRoots.test.ts` 覆盖 `/var`、`~`、`~/x`、relative invalid 语义。
- [x] `RemoteFileBrowser.e2e.test.tsx`：初始化默认 root、恢复 persisted path、root 失效/缓存场景恢复到 scope 默认 root。
- [x] `FileBrowserWorkspace.e2e.test.tsx`：root sidebar、path bar 显示真实路径，并断言 Filter、Refresh、List/Grid、More dropdown 仍存在且可交互。
- [x] `FileBrowserWorkspace.e2e.test.tsx` + `FileBrowserShared.test.ts`：roots section 与当前 root 目录树同时存在，切换 root 不破坏目录树展开/选择能力。
- [x] context menu tests：read-only root 禁用 mutation；custom writable root 保持 mutation 可用并由 runtime 二次校验。
- [x] Workbench Files widget tests：shared state 保存真实绝对路径与 root id。
- [x] `FileBrowserWorkspace.e2e.test.tsx`：Computer root row 默认显示 RO，切换 RW 前弹确认，取消后仍为 RO。
- [x] `RemoteFileBrowser.e2e.test.tsx`：确认 Computer/custom root 写权限变更后重新拉取 path context，context menu mutation 与 drag/drop mutation affordance 同步刷新。
- [x] `FileBrowserWorkspace.e2e.test.tsx`：点击 RO/RW 控件不触发 root navigation；点击 root 行主体仍正常进入 root。
- [x] `FileBrowserWorkspace.e2e.test.tsx`：Path 行 Filter、Refresh、List/Grid、More dropdown 在新增 RO/RW 控件后仍存在且可交互。
- [x] `filesystemScopeSettings.test.ts`：Runtime Settings 与 sidebar toggle 使用同一份 root permission model，不产生双状态。

### 8.3 浏览器/E2E

- [x] `RemoteFileBrowser.e2e.test.tsx` + `FileBrowserWorkspace.e2e.test.tsx`：可进入 `/`，可从 `/` 展示 `/Users` 或可读目录。
- [x] `FileBrowserWorkspace.e2e.test.tsx`：输入 `/` 不再跳回 Home。
- [x] `FileBrowserWorkspace.e2e.test.tsx`：roots 导航后，Path 行的 Filter、Refresh、List/Grid、More dropdown 行为与原有 Home 内浏览一致。
- [x] 文件预览路径链路：Home 外 custom root 文件以真实绝对路径进入 preview 请求，runtime read/stream 仍由 registry 校验。
- [x] Git browse E2E：Home 外 custom root repo 可进入 Git mode，后端 `internal/gitrepo` 覆盖 custom root repo resolve。
- [x] Terminal handoff E2E：Home 外 custom root directory 可 Open in Terminal，后端 `internal/terminal` 覆盖 custom root working dir。
- [x] Mobile viewport E2E：root sidebar 作为 drawer 仍能切换 roots，路径栏不溢出。

## 9. 最终一致性 Review 清单

- [x] 全仓搜索 `agentHomeAbs` / `agent_home_dir` / `runtime home directory`，确认只保留默认 Home/working dir 语义。
- [x] 全仓搜索 `ResolveExistingScopedPath` / `ResolveExistingScopedDir` / `ResolveTargetScopedPath`，确认业务模块不再直接依赖 Home scope。
- [x] 全仓搜索 `Path is outside the runtime home directory`，确认旧文案完全移除。
- [x] 全仓搜索 `toFileBrowserDisplayPath` / `toFileBrowserAbsolutePath` / `visibleBrowserPath`，确认 Home 虚拟根逻辑移除或改名为纯显示 helper。
- [x] Review fs、gitrepo、terminal、ai、codeapp 是否全部通过同一 registry。
- [x] Review UI 中所有 mutation affordance 是否由 root write permission 呈现，但 runtime 仍最终校验。
- [x] Review Files root sidebar 的 RO/RW 控件是否只复用统一 permission 更新路径，不存在前端本地临时覆盖或失败兜底状态。
- [x] Review Computer RW 是否没有引入提权暗示：所有文案均说明只在 OS 用户本来可写范围内生效。
- [x] Review 文件浏览现有组件与交互是否完整保留：Path、Filter、Refresh、List/Grid、More、sidebar tree、drag preview、context menu、status bar。
- [x] Review README/docs 是否不存在“Home 是唯一文件系统范围”的过时描述。
- [x] Review tests 是否覆盖 Home、Computer、custom root、read-only root、outside scope、symlink escape。
- [x] Review 错误文案是否区分 permission denied、outside scope、not found、invalid path。
- [x] Review Workbench wheel/text selection contract 未因 Files root sidebar 改动被破坏。
- [x] Review no compatibility layer：不存在将 Home 外路径静默改回 Home 的兜底逻辑。

## 10. 本地质量门禁

完成最终实现后必须跑通：

```bash
sh -n scripts/install.sh
sh -n scripts/generate_release_notes.sh
bash -n scripts/lint_ui.sh
bash -n scripts/build_desktop_bundled_agent.sh
bash -n scripts/check_desktop.sh
bash -n scripts/check_runtime_compatibility_contract.sh
bash -n scripts/ui_package_common.sh
bash -n scripts/open_source_hygiene_check.sh
bash -n scripts/install_git_hooks.sh
./scripts/lint_ui.sh
./scripts/check_runtime_compatibility_contract.sh --source-only
./scripts/check_desktop.sh
./scripts/open_source_hygiene_check.sh --staged
./scripts/open_source_hygiene_check.sh --all
./scripts/knowledge/check_source_integrity.sh
./scripts/build_knowledge_bundle.sh --verify-only
./scripts/build_assets.sh
go test ./...
golangci-lint run ./...
```

## 11. 最终验收标准

- 文件浏览器能打开 `/`，并明确显示这是 OS root。
- 文件浏览器能打开任意 custom root 内目录。
- Home 仍可通过 `~` 快速访问。
- Home 外路径不会被静默转换为 Home 内路径。
- 所有文件、Git、Terminal、AI 路径能力共享同一套 scope 判断。
- read/write/execute、root read/write、OS 权限三者边界清晰可解释。
- 旧 Home-only 逻辑、文案、测试假设和文档描述全部被移除。
