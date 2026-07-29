# 履历助手 Agent：项目交接文档

更新时间：2026-07-28

## 1. 项目目标

这是一个基于 Page Agent 的 Chrome 侧边栏插件，用于辅助用户填写招聘/网申页面。

- 用户在插件中自行粘贴或上传自己的简历；简历本地保存于 Chrome `chrome.storage.local`。
- 用户通过侧边栏用自然语言发起任务，例如“根据我的履历填写当前页面”。
- Page Agent 读取当前页面，调用模型完成点击、输入、选择和滚动；**绝不自动提交表单**。
- 模型能力通过自建 Cloudflare Worker 网关提供；终端用户只填写产品方分发的 `mix_live_...` 产品 Key，不能自行填写 DeepSeek Key。
- 商业模式按“模型调用额度”收费，而不是按单次用户任务收费。

## 2. 本地工程与构建产物

工程根目录：

```text
/Users/jawisworkspace/Documents/value thing/page-agent
```

Chrome 本地加载目录：

```text
packages/extension/.output/chrome-mv3
```

Chrome 打包文件：

```text
packages/extension/.output/resume-fill-agent-1.12.2-chrome.zip
```

本地改动后，重新构建插件，再到 `chrome://extensions` 刷新该扩展并重新打开侧边栏。

## 3. 当前架构

```text
Chrome 扩展
  ├─ 用户履历：chrome.storage.local
  ├─ 产品 Key：mix_live_...
  └─ POST https://api.jawi.top/v1/chat/completions
             │
Cloudflare Worker：resume-api
  ├─ 校验产品 Key 哈希与额度（D1）
  ├─ 成功前预扣 1 个调用额度
  ├─ DeepSeek 失败时自动退回额度
  └─ 使用服务端 DEEPSEEK_API_KEY 调用 DeepSeek
             │
DeepSeek Chat Completions
```

注意：履历和页面上下文在用户发起任务时会短暂发送给 Worker，再由 Worker 转发给 DeepSeek；Worker 与 D1 当前**不保存**简历、网页 DOM 或提示词正文。

## 4. Cloudflare 当前资源

| 项目 | 当前值 |
| --- | --- |
| Worker 名称 | `resume-api` |
| 自定义域名 | `api.jawi.top` |
| Worker 路由 | `https://api.jawi.top/v1/chat/completions` |
| 健康检查 | `https://api.jawi.top/health` |
| D1 数据库 | `resume-product-keys` |
| D1 绑定名 | `PRODUCT_KEYS` |
| D1 数据库 ID | `ac2e28a4-0c19-42ca-9efc-864cccc58f15` |

Worker 必需 Secret（Cloudflare Dashboard → Worker → 设置 → 变量和密钥）：

- `DEEPSEEK_API_KEY`：服务方自己的 DeepSeek API Key。
- `DEEPSEEK_MODEL`：可选；未填时默认 `deepseek-chat`。

`PRODUCT_KEY_PEPPER` 是早期版本遗留的 Secret，当前代码**不再使用**。在确认线上运行稳定后可在 Dashboard 手动删除，但不要在未备份/未验证的情况下随意变更其他 Secret。

## 5. 产品 Key 与 D1

表定义在 [services/resume-api/schema.sql](services/resume-api/schema.sql)。当前表：

```sql
product_keys(
  id, key_hash, label, status,
  credit_units, expires_at, created_at, last_used_at
)
```

### 发卡

在项目根目录运行：

```bash
node services/resume-api/scripts/create-product-key.mjs
```

脚本输出：

- 一次性展示给用户的 `mix_live_...` 产品 Key；不要写入数据库、代码、Git 或聊天记录。
- 仅写进 D1 的 `key_hash`。
- 产品记录 `id`。

在 D1 控制台执行（把单引号中的三个值替换为脚本输出）：

```sql
INSERT INTO product_keys (id, key_hash, label, credit_units)
VALUES ('产品记录 ID', 'Key 哈希', '用户标识或订单号', 100);
```

### 用户观测与运营 SQL

查看全部用户：

```sql
SELECT
  label AS 用户,
  status AS 状态,
  credit_units AS 剩余额度,
  last_used_at AS 最近调用,
  expires_at AS 到期时间
FROM product_keys
ORDER BY last_used_at DESC;
```

增加额度：

```sql
UPDATE product_keys
SET credit_units = credit_units + 100
WHERE label = '目标用户标签';
```

暂停/恢复：

```sql
UPDATE product_keys SET status = 'disabled' WHERE label = '目标用户标签';
UPDATE product_keys SET status = 'active' WHERE label = '目标用户标签';
```

说明：一条用户任务可能触发多次模型调用（Page Agent 会进行规划、页面读取、工具调用和重试）。当前 `credit_units` 是**模型调用额度**。上一次首位测试用户从 100 变为 96，表示发生了 4 次成功模型请求。

## 6. Worker 源码与部署

关键文件：

- [services/resume-api/worker.js](services/resume-api/worker.js)：鉴权、扣费、转发、失败退款。
- [services/resume-api/schema.sql](services/resume-api/schema.sql)：D1 表结构。
- [services/resume-api/wrangler.toml](services/resume-api/wrangler.toml)：Worker、D1、域名路由配置。
- [services/resume-api/worker.test.mjs](services/resume-api/worker.test.mjs)：基础测试。

验证与部署：

```bash
cd "/Users/jawisworkspace/Documents/value thing/page-agent/services/resume-api"
node --test worker.test.mjs
npx wrangler deploy --keep-vars
curl -sS https://api.jawi.top/health
```

**必须带 `--keep-vars`**，否则有覆盖 Dashboard 上 Secret/变量配置的风险。

## 7. 已修复的问题

此前出现 `Authentication failed` 的根因是：旧 Worker 使用 `SHA256(pepper + ':' + productKey)`，而 D1 内产品 Key 哈希与当前 `PRODUCT_KEY_PEPPER` 不一致。

现在的 Worker 与发卡脚本统一为：

```text
key_hash = SHA256(productKey)
```

产品 Key 本身有高随机性；数据库仅保存 SHA-256 哈希。线上部署已完成，用户已验证第二次对话成功，且 D1 的余额和 `last_used_at` 已更新。

## 8. 插件当前产品配置

扩展侧默认配置已改为：

- 产品网关：`https://api.jawi.top/v1`
- 模型：`deepseek-chat`（Worker 会强制覆盖模型名）
- 用户只填写 `mix_live_...` 产品 API Key。

扩展中不应再暴露：

- DeepSeek API Key 输入框。
- 产品网关地址输入框。
- 模型名称输入框。
- 网页调用令牌 / Agent Hub 等普通用户不需要的设置。

这些是平台运维配置，不是用户设置。

## 9. 下一优先级：调用流水与成本统计

当前系统只保存剩余额度和最近使用时间，不能准确统计每个用户的 token 或人民币成本。

建议下一位 Agent 按以下顺序实现：

1. 新增 `usage_events` 表，不存简历、DOM、prompt 正文。
2. Worker 在 DeepSeek 成功返回后解析 `usage`：`prompt_tokens`、`completion_tokens`、`total_tokens`。
3. 每一次成功请求写一条流水，字段建议：
   - `id`
   - `key_hash`
   - `created_at`
   - `model`
   - `prompt_tokens`
   - `completion_tokens`
   - `total_tokens`
   - `estimated_cost_cny`
   - `request_kind`（以后可区分规划/执行）
4. 成本单价不要硬编码在扩展；放在 Worker 环境变量或单独配置表，并根据 DeepSeek 当期官方价目表维护。
5. 在 D1 控制台先使用 SQL 观测；后续再做管理员页面，避免把管理接口暴露给普通插件用户。

目标查询示例：

```sql
SELECT
  p.label AS 用户,
  COUNT(e.id) AS 成功调用数,
  SUM(e.total_tokens) AS 总_token,
  ROUND(SUM(e.estimated_cost_cny), 4) AS 预估成本
FROM usage_events e
JOIN product_keys p ON p.key_hash = e.key_hash
WHERE e.created_at >= '2026-07-01'
GROUP BY p.label
ORDER BY 预估成本 DESC;
```

## 10. 其他后续工作

### P1：产品与安全

- 给产品 Key 增加有效期、试用额度和订单号。
- 增加调用频率限制，防止单个 Key 被滥用。
- 规范错误提示：余额不足、Key 禁用、服务端模型故障要可区分。
- 定期轮换泄露过的 DeepSeek Key 与产品 Key；绝不把 Secret 提交 Git。
- 为 Cloudflare Worker 配置告警/日志留存策略。

### P1：插件体验

- 继续提高表单字段匹配，尤其是下拉、日期和多层级省市选项。
- 对模型无法判断的字段显示候选项/让用户补充，而不是静默跳过。
- 明确展示“已填写、待确认、无法判断”的结果。
- 所有表单提交保持人为操作。

### P2：交付

- 整理 `README`、隐私政策、使用说明、商店素材。
- Chrome Web Store 发布前核查隐私披露：用户履历会被转发给模型供应商完成任务，不能宣称“完全不上云”。
- 项目尚未推送到用户自己的 GitHub：当前本地 `origin` 仍是 Page Agent 上游仓库，推送前必须创建个人私有仓库并改远端。

## 11. 绝对安全规则

1. 不要在聊天、Issue、Git、截图、日志中发送 `DEEPSEEK_API_KEY`、`mix_live_...`、Pepper 或任何 Cloudflare Token。
2. 不要把产品 Key 原文写入 D1；只保存哈希。
3. 不要记录简历正文、网页 DOM、账号密码、验证码、支付信息。
4. 插件不得自动提交招聘表单。
5. 修改 Worker 后先跑测试，再用 `npx wrangler deploy --keep-vars` 发布。

