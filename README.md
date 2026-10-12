# GoodNight

GoodNight 是面向电子科技大学「晚安成电」的本地自动填报工具。它用 Node.js 和 Playwright 执行确定性流程：读取当天记录和服务时段，优先使用真实 GCJ-02 定位与有效宿舍圈办理签到；签到不可行时，在记录仍为 `PENDING` 且实际位置适合报告的条件下提交报告，并回读学校保存的记录核对结果。日常流程不调用 LLM。

## 状态与边界

原 macOS 自动化曾于 2026-10-10 22:30 使用已认证的 Chrome 完成填报，并在之后读取到同日 `STUDENT_REPORTED`、`INSTRUCTOR_REPORTED` 状态及对应内容。这是原 macOS 流程的验证记录，不代表本仓库新移植版本已通过学校端到端测试。新仓库目前尚未完成学校 E2E 验证；Windows、Linux 的定位和认证也未验证。CI 只运行离线合成样例。

该工具会向学校服务提交真实签到或报告。请阅读配置和 `run --dry-run` 输出，并确认操作符合学校要求及你的实际情况。它只适配当前实现的 UESTC 流程，不会自动适配其他学校。

## 环境

- Node.js 22 或更新版本
- npm
- macOS、Windows 或 Linux
- 推荐已安装的 Chrome。用户首次运行需要在自己可见的浏览器窗口中完成登录、OAuth 或验证码；工具不绕过这些步骤。
- 定位需要真实操作系统/浏览器定位提供方；实际位置需符合所选操作的要求。

```sh
git clone https://github.com/beichenO2/GoodNight.git
cd GoodNight
npm ci
node bin/goodnight.mjs init
node bin/goodnight.mjs login
node bin/goodnight.mjs doctor
node bin/goodnight.mjs check
node bin/goodnight.mjs run --dry-run
```

`init` 会交互式询问说明（10–200 个 UTF-16 代码单元）、关键词（默认“旅游”，与“校外”位置类型组合）、每日时间（默认 22:30）及浏览器。说明默认值为“在校外旅游会注意自己安全，导员放心”；交互时直接按 Enter 使用该值。非交互模式省略 `--remark` 也使用默认说明。自定义说明必须符合 10–200 个 UTF-16 代码单元的长度限制。也可传入 `--remark`、`--keyword`、`--time`、`--browser`。

`login` 打开工具自己的独立浏览器配置文件。请在该窗口进入统一认证、完成认证后点击“晚安成电”，再回到终端按 Enter 让工具在线验证业务登录。你平时使用的普通浏览器登录不会自动转移到这个独立配置文件。`doctor` 默认仅作本地离线检查；加 `--online` 才检查在线认证。`check` 只读学校当天记录。`run --dry-run` 检查时段、真实定位和表单，不提交签到或报告。

`run` 先尝试在学校签到窗口内使用真实 GCJ-02 定位及有效宿舍圈签到。若没有可用的有效宿舍圈，或签到得到明确拒绝，程序会使用当前登录会话重新读取当天记录；只有记录仍为 `PENDING` 且位置判定适合报告时，才转为报告流程。默认“校外”报告只用于实际判定在校外的位置，绝不会把校园内位置标成校外。签到 POST 超时或结果不明属于不确定状态，程序不会因此盲目改发报告。签到和报告各有独立的按日持久日志，在发送相应 POST 之前落盘；结果不明时先运行 `check`。

浏览器可选 `chrome`（默认）、`msedge`、`chromium`。优先使用已安装的 Chrome 或 Edge；Playwright Chromium 可用 `npx playwright install chromium` 安装，并在初始化时指定 `--browser chromium`。Chromium 安装本身不会提供真实校园定位。定位实现优先调用 `uni.getLocation`；不可用时通过 Acorn AST 解析当前同源入口和学生页面模块，发现实际发起 `{type: "gcj02", success, fail}` 调用的命名导入及其入口导出。若两条路径都不可用或前端契约变化，失败停止，不会猜测别名。

## 持续运行

```sh
node bin/goodnight.mjs daemon
node bin/goodnight.mjs status
node bin/goodnight.mjs service install
node bin/goodnight.mjs service remove
```

`daemon` 每 30 秒检查调度：默认在 22:10–22:30 每日执行一次只读认证与真实定位预检，22:30 启动原快速填报流程；快速补跑窗之后，仍可按每 10 分钟一次恢复检查，最晚不超过 23:55（不含），且仍受学校服务时段限制。原 macOS 600 秒 keeper 会在预检窗口内第一次醒来时预检，并非精确 22:10 触发。尚未提交且符合重试条件的临时失败会在原 30 分钟快速窗口内每两分钟重试；提交结果不明时只回读核对，不盲目重复 POST。服务以当前用户运行，机器需保持开机、联网且用户会话可用。`service install --write-only` 只写入服务定义。服务绑定安装时的绝对仓库目录和 Node 路径，移动仓库后请重新安装。daemon 不热加载配置；修改配置后需重启/重新安装服务。失败状态与提醒策略见 [`docs/resilience.md`](docs/resilience.md)。

## 私有数据

配置、浏览器配置文件、认证状态、日志和运行状态放在仓库之外的用户数据目录。默认位置：macOS `~/Library/Application Support/GoodNight`；Windows `%LOCALAPPDATA%\GoodNight`；Linux `$XDG_STATE_HOME/goodnight`，未设置时为 `~/.local/state/goodnight`。可用 `GOODNIGHT_HOME` 或任一命令的 `--data-dir PATH` 指定目录。不要提交这些私有数据，也不要把浏览器配置文件复制到另一台机器或操作系统；请在新设备重新登录。

授权会过期。客户端周期性访问只能延长客户端一侧的会话维护；学校服务端的会话时限未知。遇到 `need_login` 等状态时，视为失败并重新登录，不能当作操作成功。

## 安全与恢复

程序使用独占运行锁和分别对应签到、报告操作的按日期持久 POST 日志。进程崩溃或请求超时后，若结果不确定，不会盲目重试或从签到切换到报告；请先运行 `check` 查看学校当天记录，再根据结果处理。程序不导出 Cookie，也不应分享个人说明文本、日志或浏览器数据。

`frontendLocationExport` 默认 `auto`，运行时以当前前端源码契约解析定位导出。旧配置中的 `bk`、`bl` 等显式值仍可读取但已弃用；它们不会覆盖源码解析结果。找不到唯一、有效的前端导出时失败关闭，不得猜测坐标或用 LLM 修复。`maxAccuracyMeters` 默认 200 米；定位未知或精度差于该阈值时停止。只有真实定位提供方确实能给出较大误差时，才按实际情况调整阈值；不要使用固定位置。

## 开发

```sh
npm ci
npm test
```

CI 在 Node.js 22/24 和 Ubuntu、macOS、Windows 上运行离线测试，包括系统服务定义生成器的合成测试。这些是候选移植路径的代码测试，不表示服务已在对应真实操作系统安装测试，也不证明学校 E2E、GPS 或认证成功。2026-10-12 定位导出事故及后续 macOS 共享定位器验证记录见 [`docs/incidents/2026-10-12-location-export.md`](docs/incidents/2026-10-12-location-export.md)；这些记录不代表新 CLI 已完成学校 E2E。架构、恢复机制和待核验主张见 [`docs/architecture.md`](docs/architecture.md)、[`docs/portability.md`](docs/portability.md)、[`docs/resilience.md`](docs/resilience.md)、[`docs/source-audit.md`](docs/source-audit.md)。
