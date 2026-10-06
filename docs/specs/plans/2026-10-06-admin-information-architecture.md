# FreeLLM Gateway 管理台信息架构改版实施计划

> **给代理执行者：** 推荐配合 `subagent-driven-development（子代理驱动开发）`，或在本会话按勾选逐项执行并在任务批次间同步。每项先写/更新测试，再验证失败，再实现并验证通过。不要覆盖工作区内已有的用户改动。

**目标：** 重新组织六个管理页面的内容层级和交互路径，让模型管理、Provider 接入、目录导入和运维状态清晰可达，并保留现有功能与 API。

**架构要点：** 保持 React/Vite、现有六个顶层路由和服务端接口。共享 Shell 负责全局导航和视觉基础；Models 页面用页内工作区分离四类管理任务；目录加入模型通过明确反馈连接到模型表单。验证使用 Vitest、TypeScript/Vite 构建和仓库已有 Playwright 浏览器测试。

**技术栈：** React 18、TypeScript、Vite、Vitest、Playwright（CI 当前固定临时安装 `@playwright/test@1.55.0`）。命令：`npm run test --prefix web`、`npm run typecheck --prefix web`、`npm run build --prefix web`、在 `web/` 中执行 `npx playwright test --config=playwright.config.ts`。

**关联设计文档：** `docs/specs/2026-10-06-admin-information-architecture-design.md`

**实施分支：** 开始实施前从当前 HEAD 新建 `codex/admin-information-architecture` 分支。保留当前工作区中所有既有未提交改动，只提交本计划涉及的文件；不在 `main` 上直接实施。

---

## 文件与职责

| 路径 | 职责 |
|---|---|
| `web/src/components/Shell.tsx` | 全局导航、页头、状态和令牌入口的层级 |
| `web/src/styles.css` | 色彩、排版、间距、表格、表单、工作区与响应式规则 |
| `web/src/i18n.tsx` | 中文/英文新增工作区、导航和操作文案 |
| `web/src/pages/ModelsPage.tsx` | 模型列表、Provider、批量接入、请求日志的页内工作区 |
| `web/src/pages/CatalogPage.tsx` | 目录筛选/卡片信息层级和加入模型的可见反馈 |
| `web/src/pages/OverviewPage.tsx` | 运维状态优先的信息顺序 |
| `web/src/pages/UsagePage.tsx` | 筛选、用量摘要、分组数据和配额编辑顺序 |
| `web/src/pages/RoutingPage.tsx` | 路由概览与能力候选状态层级 |
| `web/src/pages/SettingsPage.tsx` | 租户/应用、运行时信息和路径分组 |
| `web/e2e/admin.spec.ts` | 顶层页面、工作区切换、目录跳转和窄屏浏览回归 |
| `web/src/i18n.test.ts` | 文案键、双语一致性回归 |

## 任务 1：重做共享 Shell 与视觉基础

**涉及文件：** `web/src/components/Shell.tsx`、`web/src/styles.css`、`web/src/i18n.tsx`、`web/e2e/admin.spec.ts`、`web/src/i18n.test.ts`

- [ ] **步骤 1：为共享框架添加失败的浏览器断言**

在 `web/e2e/admin.spec.ts` 的启动测试中，于导航到 Model Pool 之后增加导航、页头主操作和移除装饰标语的断言：

```ts
await expect(page.getByRole("navigation")).toBeVisible();
await expect(page.getByRole("button", { name: "Add model" })).toBeVisible();
await expect(page.getByText("More AI")).toHaveCount(0);
```

- [ ] **步骤 2：运行 E2E 并确认断言失败**

先按仓库 `.github/workflows/release-gate.yml` 的启动步骤在 `127.0.0.1:18766` 启动服务；确认 `http://127.0.0.1:18766/health` 返回 200。然后在 `web/` 中运行：

```powershell
npm install --no-save --no-package-lock @playwright/test@1.55.0
npx playwright install chromium
$env:FREELLM_E2E_BASE_URL = "http://127.0.0.1:18766"
npx playwright test --config=playwright.config.ts
```

预期：新增的“移除装饰标语”断言失败，证明测试捕获当前 Shell。

- [ ] **步骤 3：调整共享框架和样式**

在 `Shell.tsx` 中移除 `sidebar-art` 与 slogan 区域，给导航添加 `aria-label`，并让全局页头只承载搜索、服务状态、语言和 Admin Token。各页面标题保持唯一；模型池的新增入口在任务 2 移入模型工作区。样式采用统一变量，删除旧主题重复覆盖段中与山形装饰有关的规则。保留现有 JSX 结构并直接调整，不新增无复用价值的共享组件。结构改动定位：

```diff
- <div className="sidebar-art" aria-hidden="true"><span className="mountain mountain-one" /><span className="mountain mountain-two" /></div>
- <p>{t("shell.sloganLine1")}<br />{t("shell.sloganLine2")}</p>
- <span className="slogan-rule" />
+ <strong>FreeLLM Gateway</strong>
+ <small>v1.0.0</small>
- <nav>
+ <nav aria-label={t("shell.primaryNavigation")}>
```

颜色使用白/浅灰表面、石墨文字、蓝色主操作；状态色只表示成功、警告、错误。窄屏变单列，侧栏导航可换行，表格容器横向滚动。

- [ ] **步骤 4：验证框架任务**

运行：

```powershell
npm run test --prefix web
npm run typecheck --prefix web
npm run build --prefix web
```

预期：Vitest、TypeScript 检查和 Vite 构建全部通过；导航、语言切换、全局搜索、Admin Token 和在线状态仍可见且工作。

- [ ] **步骤 5：提交本任务文件**

只暂存本任务涉及文件：

```powershell
git add web/src/components/Shell.tsx web/src/styles.css web/src/i18n.tsx web/e2e/admin.spec.ts web/src/i18n.test.ts
git commit -m "feat(admin): simplify shared console shell"
```

## 任务 2：把模型池拆为四个页内工作区

**涉及文件：** `web/src/pages/ModelsPage.tsx`、`web/src/styles.css`、`web/src/i18n.tsx`、`web/e2e/admin.spec.ts`

- [ ] **步骤 1：先添加模型工作区 E2E 断言**

在 `admin.spec.ts` 新增标题为 `model workspaces` 的测试并断言：

```ts
await page.goto("/admin/#/models");
await page.getByRole("button", { name: "EN", exact: true }).click();
await expect(page.getByRole("tab", { name: "Models" })).toHaveAttribute("aria-selected", "true");
await page.getByRole("tab", { name: "Providers" }).click();
await expect(page.getByRole("tabpanel", { name: "Providers" })).toBeVisible();
await expect(page.getByRole("tab", { name: "Bulk connect" })).toBeVisible();
await expect(page.getByRole("tab", { name: "Request log" })).toBeVisible();
```

- [ ] **步骤 2：确认模型池测试在旧页面失败**

运行：`npx playwright test --config=playwright.config.ts -g "model workspaces"`（工作目录 `web/`，测试服务器保持健康）。

预期：`Models` 页不存在 ARIA tab，测试失败。

- [ ] **步骤 3：实现模型池工作区与表单分组**

在 `ModelsPage.tsx` 新增工作区状态，默认 `models`；用 ARIA tablist/tab/tabpanel 包裹四个既有区域。保留已有模型增删改、探测、启停、Provider 发现和批量验证/保存逻辑；通过现有状态和 handler 提供入口，不改 API。模型列表先显示模型总数、启用/健康/异常数；筛选 Provider、健康状态和能力后过滤现有 `routes` 数组。添加/编辑表单默认为关闭，按主按钮或行内编辑按钮后在模型列表工作区内展开。Provider 摘要由其关联的 `routes` 数组汇总，不依赖新增后端字段。日志筛选只作用于现有已加载的 100 条以内记录；默认显示前 10 条，每次点“加载更多”多显示 10 条，最多显示当前已加载记录。工作区切换不修改 `#/models`。

```tsx
type Workspace = "models" | "providers" | "bulk" | "logs";
const [workspace, setWorkspace] = useState<Workspace>("models");
<div role="tablist" aria-label={t("models.workspaces")}>
  {(["models", "providers", "bulk", "logs"] as const).map((id) => (
    <button key={id} role="tab" id={`workspace-tab-${id}`} aria-selected={workspace === id}
      aria-controls={`workspace-panel-${id}`} onClick={() => setWorkspace(id)}>
      {t(`models.workspace.${id}`)}
    </button>
  ))}
</div>
```

把 ModelsPage 当前模型表/编辑表单、Provider 卡片/表单、批量连接区和日志表分别包进对应的条件渲染区，并设置唯一 `id={`workspace-panel-${id}`}` 与 `aria-labelledby={`workspace-tab-${id}`}`；表单受控状态继续留在 `ModelsPage`，切换工作区不清空尚未保存的数据。

页内字段、按钮和状态只使用 i18n 字典；中文/英文新增键保持一一对应。

- [ ] **步骤 4：验证模型工作区行为**

运行：`npx playwright test --config=playwright.config.ts -g "model workspaces"`，再运行 `npm run test --prefix web` 和 `npm run typecheck --prefix web`。

预期：四个工作区可互相切换、默认模型列表、导航 URL 不变；模型表、现有表单及 Provider/日志数据仅在对应工作区展示；所有命令通过。

- [ ] **步骤 5：提交本任务文件**

```powershell
git add web/src/pages/ModelsPage.tsx web/src/styles.css web/src/i18n.tsx web/e2e/admin.spec.ts
git commit -m "feat(admin): group model management workspaces"
```

## 任务 3：让目录加入模型的结果和下一步清楚可见

**涉及文件：** `web/src/pages/CatalogPage.tsx`、`web/src/pages/ModelsPage.tsx`、`web/src/i18n.tsx`、`web/src/styles.css`、`web/e2e/admin.spec.ts`

- [ ] **步骤 1：增加目录导入的失败 E2E 覆盖**

在 `admin.spec.ts` 新增标题为 `catalog model handoff` 的测试，将 UI 切到英文并用 Playwright route stub 固定目录数据，避免依赖实时目录：

```ts
await page.goto("/admin/");
await page.getByRole("button", { name: "EN", exact: true }).click();
await page.route(/\/api\/admin\/catalog\/source\?scope=models/, (route) => route.fulfill({
  json: { data: [{ id: "e2e-model", name: "E2E Model", provider: "Example",
    model: "example-chat", capabilities: ["chat"], apiEndpoint: "https://example.test/v1",
    register: "https://example.test/signup", docsUrl: "https://example.test/docs",
    freeSummary: "Free tier", pool_status: { state: "not_added" } }] },
}));
await page.goto("/admin/#/catalog");
await page.getByRole("button", { name: "Add to model pool" }).click();
await expect(page.getByRole("button", { name: "Continue configuration" })).toBeVisible();
await page.getByRole("button", { name: "Continue configuration" }).click();
await expect(page).toHaveURL(/#\/models$/);
await expect(page.getByLabel("Model")).toHaveValue("example-chat");
```

`EN` 切换前先访问 `/admin/`，切换后注册目录 route stub，再打开 Catalog 路由。另加无 Endpoint 的 stub 个案，验证点“继续配置”后显示需补全 Endpoint 的提示。

- [ ] **步骤 2：确认新增反馈断言失败**

运行：`npx playwright test --config=playwright.config.ts -g "catalog model handoff"`（工作目录 `web/`）。

预期：当前按钮直接跳转，不显示“继续配置”，断言失败。

- [ ] **步骤 3：实现卡片层级与预填交接反馈**

整理目录卡片顺序为名称/Provider/池状态 → 能力与免费限制 → 模型标识/Endpoint → 次级注册/文档链接。点击加入时保存 `catalogRouteDraft(offer)` 到既有 `CATALOG_DRAFT_KEY` 并留在目录页显示确认与“继续配置”按钮；点击继续配置再跳转到 `#/models`。Models 检测到草稿后选中模型工作区、打开编辑表单并显示预填状态。Endpoint 缺失时明确提示需补齐，绝不显示已接入或健康。

```tsx
function addToPool(offer: CatalogOffer) {
  sessionStorage.setItem(CATALOG_DRAFT_KEY, JSON.stringify(catalogRouteDraft(offer)));
  setPendingOfferName(String(offer.name ?? offer.model ?? offer.id));
}
{pendingOfferName && <div role="status">
  {t("catalog.prefilled", { name: pendingOfferName })}
  <button onClick={() => { window.location.hash = "/models"; }}>
    {t("catalog.continueConfiguration")}
  </button>
</div>}
```

- [ ] **步骤 4：运行目录接入验证**

运行：`npx playwright test --config=playwright.config.ts -g "catalog model handoff"`，再运行 `npm run test --prefix web` 和 `npm run typecheck --prefix web`。

预期：加入后停留目录并显示成功预填提示；继续配置后模型表单包含 stub 模型与注册/文档信息；无 Endpoint 时显示补齐提示；任何情况下都不提前标记已接入/健康。

- [ ] **步骤 5：提交本任务文件**

```powershell
git add web/src/pages/CatalogPage.tsx web/src/pages/ModelsPage.tsx web/src/i18n.tsx web/src/styles.css web/e2e/admin.spec.ts
git commit -m "feat(admin): clarify catalog model handoff"
```

## 任务 4：重排概览、用量、路由和设置页面

**涉及文件：** `web/src/pages/OverviewPage.tsx`、`web/src/pages/UsagePage.tsx`、`web/src/pages/RoutingPage.tsx`、`web/src/pages/SettingsPage.tsx`、`web/src/styles.css`、`web/src/i18n.tsx`、`web/e2e/admin.spec.ts`

- [ ] **步骤 1：添加四页的顺序/存在性断言**

在 `admin.spec.ts` 新增标题为 `page information hierarchy` 的测试。给相关 `<section>` 添加以下 `data-testid`：概览 `overview-status`、`client-access`；用量 `usage-filters`、`usage-table`、`quota-editor`；路由 `routing-flow`、`routing-candidates`；设置 `tenant-apps`、`runtime-info`。逐一断言可见，并断言概览指标早于客户端接入、筛选早于用量表且用量表早于配额、路由流程早于能力候选、租户/应用早于运行时信息。概览顺序断言示例：

```ts
await page.goto("/admin/#/overview");
await expect(page.getByTestId("overview-status")).toBeVisible();
await expect(page.getByTestId("client-access")).toBeVisible();
expect(await page.getByTestId("overview-status").evaluate((el) => el.getBoundingClientRect().top))
  .toBeLessThan(await page.getByTestId("client-access").evaluate((el) => el.getBoundingClientRect().top));
```

- [ ] **步骤 2：运行断言确认顺序不符**

运行：`npx playwright test --config=playwright.config.ts -g "page information hierarchy"`（工作目录 `web/`）。

预期：具名区域或期望顺序尚未存在时失败。

- [ ] **步骤 3：重排页面 JSX 和样式**

概览顺序调整为网关状态/刷新 → 启用与健康模型/异常连接摘要 → 最近请求 → 独立客户端接入区；不新增成功率计算。用量页把时间/租户/应用/Provider/模型筛选放前，摘要和分组表置中，配额编辑收在独立区。路由页缩短流程说明并突出按能力分组的候选、优先级和健康状态。设置页将租户与应用、运行时接入信息、服务路径分区显示。各页继续调用现有 API 和回调，不创建 `PageSection` 抽象；测试定位使用 `data-testid`。

概览把现有统计区和客户端接入区标记为稳定的 E2E 定位点：

```diff
- <section className="stat-grid overview-stats">
+ <section className="stat-grid overview-stats" data-testid="overview-status">
- <article className="card api-card">
+ <article className="card api-card" data-testid="client-access">
```

- [ ] **步骤 4：验证四页顺序与功能**

运行：`npx playwright test --config=playwright.config.ts -g "page information hierarchy"`，再运行 `npm run test --prefix web` 和 `npm run typecheck --prefix web`。

预期：区域顺序断言通过；用量筛选/配额表单、路由候选状态、设置创建租户/应用与密钥复制仍能操作；没有新增接口或指标。

- [ ] **步骤 5：提交本任务文件**

```powershell
git add web/src/pages/OverviewPage.tsx web/src/pages/UsagePage.tsx web/src/pages/RoutingPage.tsx web/src/pages/SettingsPage.tsx web/src/styles.css web/src/i18n.tsx web/e2e/admin.spec.ts
git commit -m "feat(admin): prioritize operational page content"
```

## 任务 5：全页与窄屏回归

**涉及文件：** `web/e2e/admin.spec.ts`、`web/src/i18n.test.ts`、`web/src/styles.css`、本计划前述页面组件

- [ ] **步骤 1：补齐六页/双语/窄屏的浏览器覆盖**

扩展现有启动测试，逐页导航到 `overview`、`models`、`usage`、`routing`、`catalog`、`settings`，验证主标题、当前导航态、无未捕获浏览器异常；分别检查中文和英文。窄屏用 `page.setViewportSize({ width: 390, height: 844 })` 并验证页面主体无横向溢出（表格自身允许滚动）：

```ts
await page.setViewportSize({ width: 390, height: 844 });
await expect.poll(() => page.locator("body").evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(390);
```

- [ ] **步骤 2：运行全量回归**

在服务于 `127.0.0.1:18766` 的 E2E 环境运行：

```powershell
npx playwright test --config=playwright.config.ts
npm run test --prefix web
npm run typecheck --prefix web
npm run build --prefix web
```

预期：Playwright 所有页面和流程通过、浏览器运行时错误数组为空；Vitest、类型检查和生产构建全部通过。

- [ ] **步骤 3：按失败证据修正并重跑**

只修复浏览器截图/trace 或失败断言指向的布局、文案、交互问题；每次修正后重跑对应 Playwright 用例，再重跑上一步全量命令。

- [ ] **步骤 4：提交回归修正**

只提交本任务实际修正的文件：

```powershell
git add web/e2e/admin.spec.ts web/src/i18n.test.ts web/src/styles.css web/src/pages/OverviewPage.tsx web/src/pages/ModelsPage.tsx web/src/pages/CatalogPage.tsx web/src/pages/UsagePage.tsx web/src/pages/RoutingPage.tsx web/src/pages/SettingsPage.tsx
git commit -m "test(admin): verify redesigned console workflows"
```

## 完成门槛

- 六个顶层页面与四个模型池工作区的入口清晰，中文/英文均可用。
- 模型管理、Provider 接入、批量接入、目录预填、用量/配额、路由、设置的既有核心功能仍可达。
- 目录加入反馈不把“已预填”误报成“已接入”；不存在新建成功率定义。
- `npm run test --prefix web`、`npm run typecheck --prefix web`、`npm run build --prefix web`、Playwright 全量 E2E 均通过。
- 所有提交只包含本计划的文件；既有用户未提交更改保持原样。
