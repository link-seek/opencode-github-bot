# Setup（5 分钟接好）

目标：新仓跑起来 bot 的 review（PR 自动看代码）。intake（issue 自动分拣）是可选的第二步。

## 1. 生成 workflow

```bash
npx opencode-github-bot init
```

默认写到 `.github/workflows/opencode.yml`，自包含（版本号 bake 在文件里）。已有文件不会被覆盖（要覆盖加 `--force`），只想看不写加 `--dry-run`。`init` 还会顺带提醒 intake 才需要的东西（缺也不挡 review）。

## 2. 配 2 个 secret + 1 个 var

仓 Settings → Secrets and variables → Actions：

| 类型 | 名字 | 填什么 |
| --- | --- | --- |
| secret | `AGENT_GITHUB_TOKEN` | 有 `contents:write, pull-requests:write, issues:write` 的 PAT |
| secret | `OPENCODE_API_KEY` | 模型 key（fast lane） |
| var | `OPENCODE_MODEL` | 模型变量，JSON 如 `{"cli":"opencode-go/beam-free","apiBase":"..."}`；可选加 `fallback_cli` / `fallback_apiBase` 做同 key 备用模型（无备字段=单模型，老形状照用） |

可选：`OPENCODE_API_KEY_BULK`（长任务专用 key，有就配）。

**私仓注意**：org 级 secret 可能下发不到新建私仓（表现为 workflow 里全空）。这时直接在**仓级**建上面 3 个，立刻好。

## 3. 验证（2 分钟）

1. 随便开个 PR → Actions 里 `opencode` 跑绿 + bot 留下 review 评论。
2. 红了先看缺配置报错那步，它会直接报缺了哪个（fail-closed，不会静默跳过）。

## 4. 可选：开 intake（issue 自动分拣）

review 跑通之后再开，别一起调。`init` 的 notes 会提醒这两样：

1. 加 `.github/repo-role.yml`（告诉 bot 你这个仓管什么、不管什么，参考本仓同名文件）。
2. 预建 label（缺了 intake 会 403 跳过 labeling，但分拣结论不受影响）：
   `needs-triage, needs-human, needs-role, needs-info, needs-review, rejected-out-of-scope, ready, needs-split, split-proposed, split-applied`

issue 上 `assigned` 触发 intake，结论看 bot 评论（含隐藏的 machine-readable verdict）。

## 升级

`npx opencode-github-bot init upgrade vX.Y.Z`（重写仓内所有版本引用，不用重跑 init）。
