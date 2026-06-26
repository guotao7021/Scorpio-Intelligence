# Cloudflare R2 安装包发布手册

本文用于维护 Scorpio Intelligence 商业版安装包的上传、登记和下载链路。

## 交付链路

- 安装包文件存放在 Cloudflare R2：`scorpio-releases`。
- 发布元数据存放在 D1：`release_versions`。
- 用户中心登录后调用 `/v1/releases/latest` 读取可下载版本。
- 下载入口统一走 Worker：`/v1/releases/download/:id`。
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

