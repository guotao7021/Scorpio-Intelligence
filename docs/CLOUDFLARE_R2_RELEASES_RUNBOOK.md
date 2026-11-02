# Cloudflare R2 安装包发布手册

本文用于维护 Scorpio Intelligence 商业版安装包的上传、登记和下载链路。

## 账户中心与反馈升级的部署前检查

2026-11-02 的只读核对结果：Cloudflare Pages 生产版本仍为 `9670428`；
Worker 最新版本为 `0ff9bb86-be88-4ba1-818d-f12f5153f370`。新账户接口
`GET /v1/account/overview` 在线返回 404，生产库尚无账户操作、授权历史和
续期申请三张表。`wrangler d1 migrations list --remote` 确认仅待执行
`0031_account_center.sql`。此次检查没有执行远程迁移或发布。

本地新版已经包含用户授权工作台、用户中心、续期审批和中英文反馈表单，
但仅提交静态页面无法完成升级。正式发布需经确认后按顺序执行：

1. 再次核对两个工作区及远程版本，避免覆盖部署期间出现的新云端模块。
2. 确认远程待迁移列表仍只有审核过的 `0031_account_center.sql`，再执行迁移。
3. 发布通过测试和 `wrangler deploy --dry-run` 的合并版 Worker，保留现有
   D1/R2 绑定、签名密钥和生产 secret。不要使用旧版网站 Worker 覆盖新模块。
4. 核对 API 的 CORS 包含官网、Pages 域名及 `https://guotao7021.github.io`。
   旧线上配置返回了不匹配的 GitHub Pages Origin；本地配置已补齐。
5. 从 `docs/public` 发布完整静态目录，包括新增的 CSS/JS。GitHub Actions
   的 `pages.yml` 会原样复制此目录，不需要前端构建命令。
6. 在官网和 GitHub Pages 分别检查样式资源、登录、授权、续期回执及反馈。
   国际用户须验证真实 Turnstile 控件，大陆用户须验证真实邮件验证码；
   实际收信和真实客户端安装包下载不能由本地假数据验收替代。

反馈接口已移除重复的 Turnstile 校验：大陆路径只消费反馈邮箱验证码，
国际路径只调用一次 Siteverify，均保留原来的服务端验证和限流。
Turnstile 令牌只能校验一次，参见
[Cloudflare 服务端校验文档](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)。

本地预览 `node scripts/preview-account-center.mjs --port 4173` 使用内存数据库、
假账号和假验证码，不会发送真实邮件。预览服务关闭访问统计并限制浏览器
API 请求到本机；反馈预览固定模拟大陆邮箱验证，不绕过生产验证逻辑。

## 交付链路

- 安装包文件存放在 Cloudflare R2：`scorpio-releases`。
- 发布元数据存放在 D1：`release_versions`。
- 用户中心登录后调用 `/v1/releases/latest` 读取可下载版本。
- 下载入口统一走 Worker：`/v1/releases/download/:id`。
- 官网访问、真实注册用户、绑定 License 用户、安装包下载次数统一写入 D1 统计表。
- Worker 会校验用户登录状态和版本权益，然后从 R2 读取对象并流式返回文件。

这条链路不向用户暴露 R2 原始地址，也不要求官网仓库存放 200MB 级安装包。

## 首次配置

1. 在 Cloudflare R2 创建 bucket：

   ```text
   scorpio-releases
   ```

2. 确认 `cloudflare/license-api/wrangler.toml` 已包含：

   ```toml
   [[r2_buckets]]
   binding = "RELEASE_BUCKET"
   bucket_name = "scorpio-releases"
   ```

3. 先迁移 D1，再部署 Worker：

   ```powershell
   cd D:\dev\stock\cloudflare\license-api
   npm.cmd run d1:migrate:remote
   npm.cmd run deploy
   ```

## 运营统计

公开页面会加载 `docs/public/site-analytics.js`，匿名上报访问事件到：

```text
POST /v1/site/visit
```

Worker 会按天聚合：

- `site_page_daily`：页面访问次数、估算独立访客数。
- `release_download_daily`：每个安装包每天下载次数。
- `release_versions.download_count`：发行包累计下载次数。

管理员后台 `/scorpio_v1_admin.html` 的概览区展示：

- 官网今日访问次数与独立访客。
- 真实注册用户数，默认排除 `@example.com`、`cf-test`、`+cf...@` 测试账号。
- 已绑定 License 的真实用户数。
- 发行包数量和累计下载次数。

后台也可以直接调用：

```text
GET /v1/scorpio_v1_admin/overview
GET /v1/scorpio_v1_admin/site-analytics?days=30
```

## 上传并登记安装包

推荐使用脚本一次完成 R2 上传和后台登记：

```powershell
cd D:\dev\stock\cloudflare\license-api
$env:SCORPIO_ADMIN_API_TOKEN = "<ADMIN_API_TOKEN>"

npm.cmd run release:upload -- `
  --file "D:\release\Scorpio-Setup.exe" `
  --edition personal_pro `
  --version 1.0.0 `
  --channel stable `
  --api https://api.scorpio-intelligence.tech `
  --notes "正式版安装包"
```

常用参数：

- `--edition`: `personal_standard` / `personal_pro` / `all`
- `--channel`: `stable` / `beta`
- `--key`: 自定义 R2 对象 Key，默认会生成 `releases/{edition}/{channel}/{version}/{fileName}`
- `--required`: 标记为强制更新

## 后台手工登记

如果文件已经手动上传到 R2，可以在管理员后台的“发行包”里填写：

- `R2 对象 Key`: R2 中的对象路径
- `文件名`: 用户下载时看到的文件名
- `Content-Type`: 默认 `application/octet-stream`
- `备用 HTTPS 下载地址`: 仅在 R2 未配置时使用
- `SHA256`: 安装包校验值
- `文件大小 bytes`: 安装包字节数

## 用户下载

用户必须先登录用户中心。前端会：

1. 调用 `/v1/releases/latest` 查询当前账号可下载版本。
2. 点击下载时调用 `/v1/releases/download/:id`。
3. Worker 校验账号权益后返回文件。

未登录、无对应版本权益或文件不存在时，不开放下载。

## 常见问题

- `release_bucket_not_configured`: Worker 没绑定 `RELEASE_BUCKET`，检查 `wrangler.toml` 后重新部署。
- `release_object_not_found`: D1 里的 `r2_key` 与 R2 对象路径不一致。
- `release_entitlement_required`: 当前用户没有该版本下载权益，需要先签发或绑定授权。
- `release_download_source_required`: 发布记录既没有 `r2_key`，也没有备用 HTTPS 下载地址。
- D1 查询字段报错：先执行 `npm.cmd run d1:migrate:remote`，再重新部署 Worker。
