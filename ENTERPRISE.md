# 企业内部密钥发放

此分支基于官方 v0.2.19，新增管理员为指定用户生成模型 API Key 的能力。

## 使用

1. 管理员在用户管理中创建员工账户，并设置余额、并发、RPM 与可用分组。
2. 打开该用户的 API 密钥弹窗，点击“为该用户创建密钥”。
3. 填写名称、分组、总额度、24 小时额度及有效期，创建后复制密钥交给员工。
4. 员工在客户端填写网关地址与密钥即可调用，无需登录本站。

分组授权或有效订阅须提前配置。密钥额度为额外上限，不会自动增加用户余额，也不会绕过用户并发、RPM、分组权限或订阅校验。

## 接口与边界

新增 `POST /api/v1/admin/users/:id/api-keys`，使用管理员身份认证；请求字段与用户创建密钥接口一致。前端提交 `Idempotency-Key`，重复请求返回原结果；相同幂等键不得跨用户重放。受限管理密钥默认无权调用新增接口。

创建后显示完整密钥，关闭弹窗或切换用户时清除。已有密钥列表保持遮罩展示。无数据库结构变更。

## 构建与发布

前端使用 Node 和 pnpm 9：在 `frontend` 执行 `pnpm install --frozen-lockfile`、`pnpm run build`。构建产物输出至 `backend/internal/web/dist`。

后端使用 Go 1.27.3，在 `backend` 执行：

```sh
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -tags embed -trimpath \
  -ldflags="-s -w -X main.Version=0.2.19-milejoy.1 -X main.Commit=<commit> -X main.BuildType=release" \
  -o ../build/sub2api ./cmd/server
```

使用 `deploy/Dockerfile.enterprise` 从固定官方镜像替换自编译的应用程序；运行依赖与官方 v0.2.19 保持一致。也可直接使用仓库根目录完整多阶段 Dockerfile 编译。

部署前备份 PostgreSQL、Compose 和应用数据。仅更新 Sub2API 应用镜像；沿用现有数据库、Redis 和 1Panel 网站反代。回滚时恢复备份的 Compose 并重建应用容器。不要通过站内官方自动更新覆盖定制版。
