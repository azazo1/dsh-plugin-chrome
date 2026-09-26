# 列出可用的 recipe.
[private]
default:
    @just --list

# 安装依赖 (本仓库统一使用 pnpm).
install:
    pnpm install

# 类型检查 host 与 client 两个 program.
typecheck:
    pnpm typecheck

# 构建 lib/ 全部产物: host 入口与声明, client bundle 与声明.
build:
    pnpm build

# 持续构建; client 变更经 HMR 热更, host 变更需重启 DSH.
watch:
    pnpm watch

# 运行 vitest 单元测试 (不含真实浏览器).
test:
    pnpm test

# 运行真实 Chrome 端到端冒烟 (会弹出可见窗口).
test-e2e:
    pnpm test:e2e

# 依次做类型检查, 构建, 单测与 npm 包内容预览.
verify:
    just typecheck
    just build
    just test
    pnpm pack --dry-run
