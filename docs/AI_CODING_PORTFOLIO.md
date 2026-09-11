# 履历助手 Agent：AI Coding 项目说明

> 作品定位：面向招聘 / 网申网页的 AI 辅助填写 Chrome 扩展。用户主动发起任务后，扩展结合本人履历和当前网页表单，辅助完成输入、选择、点击与滚动；**不会自动提交申请**。

## 1. 我解决的真实问题

网申表单字段多、网站差异大，手工复制个人信息耗时且容易遗漏。本项目把“阅读网页字段—匹配履历—填写表单”的重复操作变成用户可审阅的 AI 辅助流程，同时保留最终提交权给用户。

核心原则：

- 用户只需要保存自己的履历并输入自然语言任务，例如“根据我的履历填写当前页面”。
- 履历保留在浏览器本地；只有用户发起任务时，必要的履历与当前页面上下文才会发送给模型。
- 任何表单提交、投递、付款、验证码处理均不自动执行。
- 不要求普通用户配置模型供应商 API Key，而是通过产品 Key 控制体验额度。

## 2. AI Coding 协作过程

这个项目不是一次性生成代码，而是按照“观察问题 → 明确约束 → 修改实现 → 本地/线上验证 → 继续迭代”的方式完成。

| 阶段 | 人的决策与反馈 | AI 辅助实现与验证 |
| --- | --- | --- |
| 需求澄清 | 明确目标是辅助填写而非自动投递；希望用户无需自行购买模型 Key。 | 拆分为扩展侧交互、模型网关、额度管理、商店合规四个模块。 |
| 体验迭代 | 根据真实招聘页截图反馈字段漏填、下拉/日期选择、侧边栏文案和视觉效果问题。 | 调整字段映射与模型提示、改造设置页、优化侧边栏状态和品牌资产。 |
| 商业化 | 决定由产品方发放 `mix_live_...` Key，并按模型调用额度收费。 | 设计 Key 哈希、D1 额度表、预扣费和失败退款逻辑，编写发卡与查询脚本。 |
| 线上排障 | 测试中遇到鉴权失败与首次调用异常。 | 比对 Worker、发卡脚本和 D1 哈希规则，统一为 `SHA-256(productKey)`；用健康检查、D1 查询和真实测试验证余额变化。 |
| 发布准备 | 准备 Chrome Web Store 的截图、数据披露和隐私政策。 | 增加公开隐私政策端点，整理审核填写材料，确保商店声明与真实数据流一致。 |

AI 在其中承担代码阅读、跨文件修改建议、测试命令编排、错误定位、文档整理等工作；涉及产品边界、数据处理范围、收费方式和是否自动提交等决定，均由产品需求与真实测试反馈约束。

## 3. 系统架构与关键实现

```text
Chrome Extension
  ├─ chrome.storage.local：履历、产品 Key、用户侧设置
  ├─ Page Agent：读取可访问 DOM、执行用户发起的页面操作
  └─ HTTPS 请求 → https://api.jawi.top/v1/chat/completions
                         │
Cloudflare Worker (resume-api)
  ├─ 验证 Bearer 产品 Key 的 SHA-256 哈希
  ├─ D1：状态、剩余额度、最近调用时间
  ├─ 每次模型调用预扣 1 个额度，失败自动退款
  └─ 使用服务端 Secret 调用 DeepSeek
                         │
DeepSeek Chat Completions
```

关键代码与配置：

- `packages/extension/`：Chrome MV3 扩展、侧边栏交互与页面自动化能力。
- `services/resume-api/worker.js`：鉴权、额度扣减、错误处理、模型转发、隐私政策页。
- `services/resume-api/schema.sql`：D1 产品 Key 表结构。
- `services/resume-api/scripts/create-product-key.mjs`：一次性发卡工具；原始 Key 不写入数据库。
- `services/resume-api/worker.test.mjs`：Worker 的基础行为测试。

## 4. 重点能力证明

### 端到端产品实现

完成从浏览器扩展、模型调用、云端网关、数据库额度控制到 Chrome Web Store 上架材料的完整链路，而不是只完成一个前端原型。

### AI Agent 与网页自动化

基于 DOM 的页面理解与工具调用，覆盖表单填写、下拉选择、日期、滚动和多标签页等实际网页操作；同时通过提示和交互边界限制高风险动作。

### 云端后端与商业化基础设施

在 Cloudflare Worker + D1 上实现轻量网关。服务端保存产品 Key 哈希、状态与额度，不保存原始 Key；支持按用户标签管理、充值、禁用、查看最近调用。

### 安全与隐私设计

- 模型供应商 Key 只作为 Cloudflare Secret 保存，不进入扩展或 Git 仓库。
- 产品 Key 仅向用户展示一次，数据库只保存哈希。
- 不持久化履历正文、DOM、提示词正文或密码/验证码/支付信息。
- 隐私政策公开地址：<https://api.jawi.top/privacy>。

### 验证与可维护性

- Worker 具备自动化测试，部署前执行 `node --test worker.test.mjs`。
- 用 `npx wrangler deploy --keep-vars` 部署，避免覆盖控制台 Secret。
- D1 查询可验证每个产品 Key 的余额和最近调用；Git 历史保留每次功能与文档更新。

## 5. 当前状态与演进方向

当前版本已经具备可体验的“发 Key → 用户填写 → 网关鉴权扣费 → 用户可观测余额变化”闭环。下一阶段将优先实现：

1. `usage_events` 调用流水：记录 token、模型、估算成本，不记录履历或 DOM 正文。
2. 管理后台：一键发卡、充值、停用和按用户查看使用情况。
3. 更稳健的招聘网站字段适配：多级省市、复杂下拉、日期和无法确定字段的候选选项。
4. Chrome Web Store 审核后的正式分发与版本更新流程。

## 6. 本地运行与验证

```bash
# 扩展构建
npm run build:ext

# Worker 测试与部署
cd services/resume-api
node --test worker.test.mjs
npx wrangler deploy --keep-vars
curl -sS https://api.jawi.top/health
```

扩展构建完成后，在 Chrome 的 `chrome://extensions` 刷新已加载的本地扩展即可验证最新改动。

