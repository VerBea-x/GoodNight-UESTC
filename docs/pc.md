# Windows 桌面应用

本项目基于 [GoodNight 源项目](https://github.com/beichenO2/GoodNight)。桌面应用提供独立窗口；签到、学校登录、地图、每日计划和运行记录与本机网页版本相同。

## 安装与打开

如果 Release 已提供 GoodNight-PC.zip，可直接下载。自行构建时先安装 Node.js 22+，在项目目录依次运行 `npm ci` 和 `powershell -NoProfile -ExecutionPolicy Bypass -File .\build-pc.ps1`，生成安装包位于 dist/。

1. Windows 电脑需已安装 Microsoft Edge，以及 Node.js 22 或更新版本。首次安装需要 Node.js；应用随后将它复制到自己的固定目录。
2. 解压完整的 `GoodNight-PC.zip`，双击 `GoodNight.exe`。不要只复制 exe 文件。
3. 第一次启动会复制应用到当前用户的 `%LOCALAPPDATA%\Programs\GoodNight`，注册登录后启动的后台任务，并在开始菜单建立“晚安成电”入口。此后可删除解压目录，通过开始菜单打开。
4. 在“签到计划”完成学校登录、选择签到位置和每日时段，先读取当天记录及试运行，再开启自动计划。运行结果在“运行记录”查看。

关闭桌面窗口后，后台计划继续运行。退出 Windows、关机、休眠或断网会影响签到；下次登录 Windows 会自动启动后台。签到时电脑需开机、联网并保持用户会话。程序在设定时间段内尝试，学校保存的记录才是最终结果；请按提醒核对，失败时手动处理。

应用数据位于 `%LOCALAPPDATA%\GoodNight`，独立于安装文件。升级时解压新版并再次双击新版 `GoodNight.exe`，它会更新固定目录内的程序。不要把应用程序文件直接移到别处。若旧版后台仍占用 3210 端口，可在任务计划程序结束 `io.github.beichenO2.goodnight` 后再打开新版。完整功能说明见仓库中的 `docs/web.md`。

Windows 版的配置、账号索引、运行状态和日志由当前用户的 Windows DPAPI 密钥配合 AES-256-GCM 加密。旧 JSON 文件在新版首次打开相应数据目录时迁移。不要删除数据目录里的 `.goodnight-key`；加密数据不能直接复制到另一个 Windows 账号使用。浏览器资料由 Chromium 和 Windows 自身管理，不属于上述应用文件加密范围；若需要覆盖浏览器缓存及整机离线数据，请开启 Windows 设备加密或 BitLocker。
