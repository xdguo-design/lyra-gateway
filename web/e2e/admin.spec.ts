import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("freellm_gateway_language", "zh");
  });
});

test("console sidebar omits the decorative slogan", async ({ page }) => {
  await page.goto("/admin/");
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.locator(".sidebar-foot p")).toHaveCount(0);
});

test("primary navigation exposes an accessible label", async ({ page }) => {
  await page.goto("/admin/");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
});

test("primary navigation identifies the current page", async ({ page }) => {
  await page.goto("/admin/#/models");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByRole("button", { name: "Model Pool" })).toHaveAttribute("aria-current", "page");
});

test("global header leaves model operations in the model workspace", async ({ page }) => {
  await page.goto("/admin/");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  const topActions = page.locator(".top-actions");
  await expect(topActions.getByRole("button", { name: "Add Model" })).toHaveCount(0);
  await expect(topActions.getByRole("button", { name: "Multi-Connect" })).toHaveCount(0);
  await expect(page.locator(".sidebar-foot")).toContainText("Service Online");
  await expect(page.locator(".sidebar-foot")).toContainText("v1.0.0");
});

test("model management groups tasks into four workspaces", async ({ page }) => {
  await page.goto("/admin/#/models");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Models" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Providers" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Bulk connect" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Request log" })).toBeVisible();
  const providersTab = page.getByRole("tab", { name: "Providers" });
  await providersTab.click();
  await expect(providersTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Providers" })).not.toHaveAttribute("hidden");
  await expect(page).toHaveURL(/#\/models$/);
});

test("editing a model scrolls the editor into view", async ({ page }) => {
  await page.route(/\/api\/admin\/providers$/, (route) => route.fulfill({
    json: { data: [{ id: "example", name: "Example", protocol: "openai", base_url: "https://example.test/v1", official_url: "https://example.test" }] },
  }));
  await page.route(/\/api\/admin\/routes$/, (route) => route.fulfill({
    json: { data: [{ id: "example-chat", provider_id: "example", provider_name: "Example", remote_model: "example-chat", display_name: null, priority: 1, capabilities: ["chat"], enabled: true, health: "healthy", reasoning_effort: null, pricing: { currency: "USD", input_per_million: null, output_per_million: null }, public_url: null, public_docs_url: null, free_summary: null, catalog_status: "not_added" }] },
  }));
  await page.goto("/admin/#/models");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.getByRole("row").filter({ hasText: "example-chat" }).getByRole("button", { name: "Edit" }).click();
  const editor = page.getByRole("heading", { name: "Edit Model" }).locator("xpath=ancestor::form");
  await expect(editor).toBeInViewport({ ratio: 0.1 });
  await expect.poll(async () => (await editor.boundingBox())!.y).toBeLessThan(400);
});

test("model list filters routes by provider", async ({ page }) => {
  await page.route(/\/api\/admin\/providers$/, (route) => route.fulfill({
    json: { data: [{ id: "example", name: "Example", protocol: "openai", base_url: "https://example.test/v1", official_url: "https://example.test" }] },
  }));
  await page.route(/\/api\/admin\/routes$/, (route) => route.fulfill({
    json: { data: [{ id: "example-chat", provider_id: "example", provider_name: "Example", remote_model: "example-chat", display_name: null, priority: 1, capabilities: ["chat"], enabled: true, health: "healthy", reasoning_effort: null, pricing: { currency: "USD", input_per_million: null, output_per_million: null }, public_url: null, public_docs_url: null, free_summary: null, catalog_status: "not_added" }] },
  }));
  await page.goto("/admin/#/models");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  const models = page.getByRole("tabpanel", { name: "Models" });
  const table = models.getByRole("table");
  const firstProvider = await table.locator("tbody tr").first().locator("td").nth(1).innerText();
  await models.getByLabel("Provider filter").selectOption({ label: firstProvider });
  const visibleProviders = await table.locator("tbody tr td:nth-child(2)").allInnerTexts();
  expect(visibleProviders.length).toBeGreaterThan(0);
  expect(visibleProviders.every((provider) => provider === firstProvider)).toBe(true);
});

test("request logs filter loaded records and reveal more rows on demand", async ({ page }) => {
  const records = Array.from({ length: 12 }, (_, index) => ({
    request_id: `request-${index}`,
    requested_model: index === 10 ? "other-model" : "target-model",
    provider_id: index === 11 ? "provider-b" : "provider-a",
    remote_model: "upstream-model",
    tenant_id: "tenant",
    application_id: "application",
    status: index === 9 ? "error" : "success",
    elapsed_ms: 120,
    usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    timestamp: new Date().toISOString(),
  }));
  await page.route(/\/api\/admin\/connections\?limit=100$/, (route) => route.fulfill({ json: { data: records } }));
  await page.goto("/admin/#/models");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.getByRole("tab", { name: "Request log" }).click();
  const logs = page.getByRole("tabpanel", { name: "Request log" });
  await expect(logs.getByLabel("Provider filter")).toBeVisible();
  await expect(logs.getByLabel("Model filter")).toBeVisible();
  await expect(logs.getByLabel("Result filter")).toBeVisible();
  await expect(logs.getByLabel("Time range filter")).toBeVisible();
  const table = page.getByTestId("request-log-table");
  await expect(table.locator("tbody tr")).toHaveCount(10);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(table.locator("tbody tr")).toHaveCount(12);
  await logs.getByLabel("Provider filter").selectOption("provider-a");
  await expect(table.locator("tbody tr")).toHaveCount(11);
  await logs.getByLabel("Result filter").selectOption("error");
  await expect(table.locator("tbody tr")).toHaveCount(1);
});

test("catalog add opens the prefilled model form and focuses a missing endpoint", async ({ page }) => {
  await page.goto("/admin/");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.route(/\/api\/admin\/catalog\/source\?scope=models/, (route) => route.fulfill({
    json: { data: [{ id: "e2e-model", name: "E2E Model", provider: "Example", model: "example-chat",
      capabilities: ["chat"], register: "https://example.test/signup",
      docsUrl: "https://example.test/docs", freeSummary: "Free tier", pool_status: { state: "not_added" } }] },
  }));
  await page.goto("/admin/#/catalog");
  await page.getByRole("button", { name: "Configure and add to Model Pool" }).click();
  await expect(page).toHaveURL(/#\/models$/);
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue("example-chat");
  const customProvider = page.getByTestId("custom-provider");
  await expect(customProvider.getByLabel("Base URL")).toBeFocused();
  await expect(customProvider.getByLabel("Base URL")).toHaveAttribute("required", "");
});

test("catalog uses the source-provided registration label and canonical URL", async ({ page }) => {
  const modelUrl = "https://vercel.com/ai-gateway/models/ling-3.1-flash-free";
  await page.route(/\/api\/admin\/catalog\/source\?scope=models/, (route) => route.fulfill({ json: { data: [{
    id: "ant-ling-3-1-flash-free", name: "Ling 3.1 Flash", provider: "Vercel AI Gateway", model: "inclusionai/ling-3.1-flash-free",
    productType: "api", capabilities: ["model_api"], register: modelUrl,
    registerLabel: "模型注册页", registerLabelEn: "Model registration page",
  }] } }));
  await page.goto("/admin/#/catalog");
  const offer = page.locator(".catalog-card").filter({ hasText: "Ling 3.1 Flash" });
  const registration = offer.getByRole("link", { name: "模型注册页 ↗" });
  await expect(registration).toHaveAttribute("href", modelUrl);
});

test("catalog exposes model-specific registration steps on demand", async ({ page }) => {
  const modelUrl = "https://vercel.com/ai-gateway/models/ling-3.1-flash-free";
  await page.goto("/admin/");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.route(/\/api\/admin\/catalog\/source\?scope=models/, (route) => route.fulfill({ json: { data: [{
    id: "ant-ling-3-1-flash-free", name: "Ling 3.1 Flash", provider: "Vercel AI Gateway",
    model: "inclusionai/ling-3.1-flash-free", capabilities: ["model_api"], register: modelUrl,
    registerLabel: "模型注册页", registerLabelEn: "Model registration page",
    usageGuide: {
      prerequisites: ["Vercel account", "Vercel AI Gateway API key"],
      steps: ["打开 Vercel AI Gateway 的 Ling 3.1 Flash (Free) 模型页并登录。", "创建 AI Gateway API Key。"],
      stepsEn: ["Open the Ling 3.1 Flash (Free) model page and sign in.", "Create an AI Gateway API key."],
    },
  }] } }));
  await page.goto("/admin/#/catalog");
  const offer = page.locator(".catalog-card").filter({ hasText: "Ling 3.1 Flash" });
  const steps = offer.getByText("Registration and access steps", { exact: true });
  await expect(steps).toBeVisible();
  await steps.click();
  await expect(offer).toContainText("Vercel account");
  await expect(offer).toContainText("Open the Ling 3.1 Flash (Free) model page and sign in.");
  await expect(offer.getByRole("link", { name: "Model registration page ↗" })).toHaveAttribute("href", modelUrl);
});

test("catalog bundle opens as separate model routes", async ({ page }) => {
  await page.goto("/admin/");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.route(/\/api\/admin\/catalog\/source\?scope=models/, (route) => route.fulfill({
    json: { data: [{ id: "e2e-bundle", name: "Example Bundle", provider: "Example", model: "chat-a · image-b",
      capabilities: ["model_api"], apiEndpoint: "https://example.test/v1/chat/completions",
      register: "https://example.test/signup", pool_status: { state: "not_added" } }] },
  }));
  await page.goto("/admin/#/catalog");
  await page.getByRole("button", { name: "Configure and add to Model Pool" }).click();
  await expect(page).toHaveURL(/#\/models$/);
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue("chat-a");
  await expect(page.getByLabel("chat-a")).toBeChecked();
  await expect(page.getByLabel("image-b")).toBeChecked();
  await expect(page.getByRole("button", { name: "Save Selected (2)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save Model" })).toHaveCount(0);
});

test("splitting a bundled route shows per-model probe results", async ({ page }) => {
  const route = { id: "bundle", provider_id: "example", provider_name: "Example", remote_model: "chat-a · image-b", display_name: "Bundle", priority: 1, capabilities: ["model_api"], enabled: true, health: "healthy", reasoning_effort: null, pricing: { currency: "USD", input_per_million: null, output_per_million: null }, public_url: null, public_docs_url: null, free_summary: null, catalog_status: "not_added" };
  await page.route(/\/api\/admin\/providers$/, (request) => request.fulfill({ json: { data: [{ id: "example", name: "Example", protocol: "openai", base_url: "https://example.test/v1", official_url: "https://example.test" }] } }));
  await page.route(/\/api\/admin\/routes$/, (request) => request.fulfill({ json: { data: [route] } }));
  await page.route(/\/api\/admin\/routes\/bundle\/split$/, (request) => request.fulfill({ json: { data: {
    created: [route], skipped: [], validation: { passed: 1, failed: 0, not_tested: 1 }, results: [
      { remote_model: "chat-a", status: "passed" },
      { remote_model: "image-b", status: "not_tested", reason: "capability_not_supported_by_probe" },
    ],
  } } }));
  await page.goto("/admin/#/models");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.getByRole("row").filter({ hasText: "Bundle" }).getByRole("button", { name: "Split models" }).click();
  await expect(page.locator(".notice")).toContainText("Probes passed 1, failed 0, not tested 1");
  await expect(page.locator(".notice")).toContainText("chat-a：Probe passed");
  await expect(page.locator(".notice")).toContainText("image-b：This capability cannot be probed automatically by this gateway");
});

test("catalog distinguishes loading from an empty result", async ({ page }) => {
  await page.goto("/admin/");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.route(/\/api\/admin\/catalog\/source\?scope=models/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ json: { data: [] } });
  });
  await page.goto("/admin/#/catalog");
  await expect(page.getByTestId("catalog-loading")).toBeVisible();
  await expect(page.getByTestId("catalog-empty")).toBeVisible();
  await expect(page.getByTestId("catalog-loading")).toHaveCount(0);
});

test("overview puts health and recent activity before client setup", async ({ page }) => {
  await page.goto("/admin/");
  await expect(page.locator(".hero-art")).toHaveCount(0);
  const status = page.getByTestId("overview-status");
  const attention = page.getByTestId("model-attention");
  const recent = page.getByTestId("recent-calls");
  const access = page.getByTestId("client-access");
  await expect(status).toBeVisible();
  await expect(attention).toBeVisible();
  await expect(recent).toBeVisible();
  await expect(access).toBeVisible();
  expect((await status.boundingBox())!.y).toBeLessThan((await attention.boundingBox())!.y);
  expect((await attention.boundingBox())!.y).toBeLessThan((await recent.boundingBox())!.y);
  expect((await recent.boundingBox())!.y).toBeLessThan((await access.boundingBox())!.y);
});

test("usage follows the approved filter, summary, quota, breakdown order", async ({ page }) => {
  await page.goto("/admin/#/usage");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  const filters = page.getByRole("combobox", { name: "Tenant", exact: true });
  const summary = page.getByText("Total Tokens", { exact: true });
  const quota = page.getByRole("heading", { name: "Monthly Quotas", exact: true });
  const breakdown = page.getByRole("heading", { name: "By Tenant", exact: true });
  const y = async (locator: typeof filters) => (await locator.boundingBox())!.y;
  expect(await y(filters)).toBeLessThan(await y(summary));
  expect(await y(summary)).toBeLessThan(await y(quota));
  expect(await y(quota)).toBeLessThan(await y(breakdown));
});

test("routing shows each candidate model health and enabled state", async ({ page }) => {
  await page.route(/\/api\/admin\/routes(?:\?.*)?$/, (route) => route.fulfill({
    json: { data: [
      { id: "healthy", provider_id: "p1", provider_name: "Example", remote_model: "healthy-model", display_name: null, priority: 1, capabilities: ["chat"], enabled: true, health: "healthy", reasoning_effort: null, pricing: { currency: "USD", input_per_million: null, output_per_million: null }, public_url: null, public_docs_url: null, free_summary: null, catalog_status: "not_added" },
      { id: "limited", provider_id: "p2", provider_name: "Example", remote_model: "limited-model", display_name: null, priority: 2, capabilities: ["chat"], enabled: true, health: "rate_limited", reasoning_effort: null, pricing: { currency: "USD", input_per_million: null, output_per_million: null }, public_url: null, public_docs_url: null, free_summary: null, catalog_status: "not_added" },
      { id: "disabled", provider_id: "p3", provider_name: "Example", remote_model: "disabled-model", display_name: null, priority: 3, capabilities: ["chat"], enabled: false, health: "healthy", reasoning_effort: null, pricing: { currency: "USD", input_per_million: null, output_per_million: null }, public_url: null, public_docs_url: null, free_summary: null, catalog_status: "not_added" },
    ] },
  }));
  await page.goto("/admin/#/routing");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  const capability = page.getByRole("heading", { name: "chat", exact: true }).locator("..");
  await expect(capability).toContainText("Healthy");
  await expect(capability).toContainText("Rate Limited");
  await expect(capability).toContainText("Disabled");
});

test("settings groups client setup, runtime access, and diagnostics", async ({ page }) => {
  await page.goto("/admin/#/settings");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  const client = page.getByTestId("settings-client-setup");
  const runtime = page.getByTestId("settings-runtime-access");
  const diagnostics = page.getByTestId("settings-diagnostics");
  await expect(client).toBeVisible();
  await expect(runtime).toBeVisible();
  await expect(diagnostics).toBeVisible();
  expect((await client.boundingBox())!.y).toBeLessThan((await runtime.boundingBox())!.y);
  expect((await runtime.boundingBox())!.y).toBeLessThan((await diagnostics.boundingBox())!.y);
});

test("all primary pages fit a narrow viewport without document overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const view of ["overview", "models", "usage", "routing", "catalog", "settings"]) {
    await page.goto(`/admin/#/${view}`);
    await expect(page.locator("main h1")).toBeVisible();
    const widths = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
      offenders: [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 2)
        .slice(0, 8)
        .map((element) => `${element.tagName.toLowerCase()}.${element.className}=${Math.round(element.getBoundingClientRect().right)}`),
    }));
    expect(widths.page, `${view} page scroll width; overflow: ${widths.offenders.join(", ")}`).toBeLessThanOrEqual(widths.viewport + 1);
  }
});

test("React admin boots, navigates, switches language, and has no runtime errors", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
  });

  await page.goto("/admin/");
  await expect(page.getByRole("heading", { level: 1, name: "概览" })).toBeVisible();
  await expect(page).toHaveTitle("概览 · FreeLLM Gateway");

  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(page).toHaveTitle("Overview · FreeLLM Gateway");

  await page.getByRole("button", { name: "Model Pool" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Model Pool" })).toBeVisible();
  await expect(page).toHaveTitle("Model Pool · FreeLLM Gateway");

  await page.getByRole("button", { name: "Token Usage" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Token Usage" })).toBeVisible();
  await expect(page.getByText("Monthly Quotas")).toBeVisible();

  await page.getByRole("button", { name: "Routing" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Routing" })).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

  expect(runtimeErrors).toEqual([]);
});

test("quota form performs a real UI-to-API round trip", async ({ page, request }) => {
  const suffix = Date.now().toString(36);
  const tenantId = `e2e-tenant-${suffix}`;
  const applicationId = `e2e-app-${suffix}`;
  const tenant = await request.post("/api/admin/tenants", {
    data: { id: tenantId, name: "E2E Tenant" },
  });
  expect(tenant.status()).toBe(201);

  const application = await request.post("/api/admin/applications", {
    data: { id: applicationId, tenant_id: tenantId, name: "E2E App" },
  });
  expect(application.status()).toBe(201);

  await page.goto("/admin/#/usage");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByText("Monthly Quotas")).toBeVisible();

  await page.getByLabel("Scope").selectOption("application");
  await page.getByLabel("Target").selectOption(applicationId);
  await page.getByLabel("Monthly Token Quota").fill("1000");
  await page.getByLabel("Monthly Cost Budget").fill("10");
  await page.getByLabel("Currency").fill("USD");
  await page.getByLabel("Warning Threshold %").fill("75");
  await page.getByRole("button", { name: "Save Quota" }).click();

  await expect.poll(async () => {
    const response = await request.get("/api/admin/quotas");
    const payload = await response.json();
    const policy = payload.data.find(
      (item: { scope_type: string; scope_id: string }) =>
        item.scope_type === "application" && item.scope_id === applicationId,
    );
    return policy
      ? {
          token_limit: policy.token_limit,
          cost_limit: policy.cost_limit,
          warning_threshold_percent: policy.warning_threshold_percent,
        }
      : null;
  }).toEqual({
    token_limit: 1000,
    cost_limit: 10,
    warning_threshold_percent: 75,
  });
});
