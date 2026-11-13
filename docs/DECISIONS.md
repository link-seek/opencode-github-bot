# Architecture Decisions（拍板记录，只增不改，改要开 issue 重新拍）

## 1. 单一依赖点：只认 npm
- 消费仓对 bot 的唯一依赖是 npm 包 `opencode-github-bot`。
- 禁止跨仓 `uses:` 引用（复用 workflow 路线已废弃，见 #103）。
- `init` 生成自包含 workflow；升级走 `init upgrade`，引用和拷贝一视同仁。

## 2. 任务分流（不是“双 key”）
- 按任务形态分流：短交互（intake/judge/probe）走 fast lane，429 切 bulk；长 agent 任务只用 bulk。
- lane→key 映射放 env（`OPENCODE_API_KEY` / `OPENCODE_API_KEY_BULK` / `KEY_FAST` / `KEY_BULK`），路由策略放代码（`scripts/keys.ts`）。
- 加订阅、轮换 key、以后按模型/endpoint 分，都只改 env 不改代码。

## 3. skill 是任务书，不是操作手册
- skill 只写三样：有什么资源、什么算成、什么红线。步骤一律不写，方法不管。
- 例外：硬禁令（不许 `ls`、不许改无关文件）照写——禁令保下限。

## 4. 分工：平台 / 机器人 / 人
- 平台（deterministic）：触发、checkout、装依赖、跑 tsc+单测、推分支、开 PR、合闸门禁、钥匙透传。绝不碰判断。
- 机器人：看 issue、写代码、跑起来验证、只报“解决了/没解决 + 证据”。不管 PR 流程。
- 人：定验收（issue 写清什么算成）、拍板合（check + review 全绿才点）。

## 5. fail-closed 到处都是
- 分拣不清 → needs-human，不瞎分。
- 拆不清（超 5 块/无验收标准）→ reject，不硬拆。
- 跑不起来 → 必须声明“未运行 + 原因”，不许静默跳过；声明了的按“未验证”严审。
- tracing 缺 key/SDK → 静默 no-op，绝不卡主流程。

## 6. 一轮交卷
- self-review + run-before-submit 是交 PR 的门：写完自己审、自己跑、贴证据。
- 跨 PR 返工是例外，不是常态。连续两次首轮不干净才加独立复检。

## 7. 可观测先行
- agent 跑起来必须能被看见：intake/llm-judge 走 `withSpan` + 结尾 flush；agent 长任务由 wrapper 在进程外上报（进程内 flush 不可靠）。
- 短命进程规范：`disableBatch` + 结束时显式 flush + 超时兜底（社区标准做法）。
