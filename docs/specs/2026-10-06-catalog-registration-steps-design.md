# FreeLLM 注册与接入步骤展示设计

## 目标

让用户从 FreeLLM 模型目录进入外部模型页之前，先能看懂该模型需要什么账号、如何取得 API Key、用哪个模型 ID，以及需要留意的免费期限。步骤以 FreeLLM 目录数据为唯一来源，并同时出现在 FreeLLM 模型详情页和 Gateway 目录卡片。

## 当前问题

- FreeLLM offer 已有 `usageGuide.prerequisites` 和 `usageGuide.steps`，但 API 型模型详情页目前主要生成通用的“注册账号 → 获取 Key → 发送请求”步骤，模型专属步骤没有完整展示。
- Gateway 的目录 API 已传递 `usageGuide`，但目录卡片没有呈现它。
- Ling 3.1 Flash 当前步骤只有中文，需要补充英文版本，供双语页面使用。

## 设计

1. **数据来源**：继续使用每条 offer 的 `usageGuide`；为 Ling 3.1 Flash 补齐 `stepsEn`。资格条件、步骤、模型 ID、API Key 文档和促销期限都留在 offer 数据中，不在前端重复录入。
2. **FreeLLM 详情页**：API 型 offer 在步骤列表前展示 `usageGuide.prerequisites`，再按 `usageGuide.steps` 顺序生成模型专属编号步骤；可用的注册入口、文档链接和 curl 示例仍作为单独辅助操作。缺少专属步骤时保留现有通用流程作为回退。
3. **Gateway 目录卡片**：在卡片上提供可展开的“注册与接入步骤”，先列前置条件，再列编号步骤；没有步骤的 offer 不显示空区块。注册链接仍使用 offer 的模型专属 `register` URL 和标签。
4. **语言**：中文页面读取 `steps`，英文页面读取 `stepsEn`；若没有英文步骤，则回退显示 `steps`，不得丢掉关键信息。
5. **安全与内容**：步骤按纯文本渲染/转义，不执行源数据中的 HTML；外链沿用新标签页和安全 rel 属性。

## 验收与测试

- FreeLLM 生成的 Ling 3.1 Flash 详情页包含登录模型页、创建 API Key、使用正确模型 ID、检查促销期限四步，并能切换中英文。
- Gateway 卡片展开后显示相同步骤、前置条件和正确模型注册链接；折叠状态不挤占卡片主体。
- 没有 `usageGuide.steps` 的条目保持现状，不显示空步骤区。
- 运行 FreeLLM offer 页面相关 Python 测试、Gateway API/前端构建与目录页面 Playwright 测试。

## 范围

本次只补充目录步骤数据的展示和该条 Ling offer 的英文步骤，不调整账号注册本身、模型 API 路由、密钥生成或配额逻辑，也不替用户访问第三方页面注册。
