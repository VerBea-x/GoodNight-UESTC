# Windows 使用指南

桌面版提供学校登录、账号管理、地图选点、自动计划和运行记录。

## 1. 准备安装包

先安装 Node.js 22+ 与 Microsoft Edge。若 [Releases](https://github.com/VerBea-x/GoodNight-UESTC/releases) 已提供 GoodNight-PC.zip，可直接下载。

自行构建时，在项目目录运行：

```powershell
npm ci
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-pc.ps1
```

生成文件：`dist/GoodNight-PC.zip`。

## 2. 安装与配置

1. 解压完整 ZIP，双击 GoodNight.exe。
2. 首次启动会安装到当前用户目录，并创建开始菜单入口。
3. 在“签到计划”添加账号，完成学校登录，设置位置和每日时段。
4. 先读取当天记录并试运行，确认配置后开启自动计划。
5. 在“运行记录”和学校页面核对结果。

请保留完整安装包内容，不要只复制 exe。

## 3. 后台运行

关闭桌面窗口后，后台计划继续运行。电脑需开机、联网并保持用户登录；关机、休眠或断网会影响签到。下次登录 Windows 后会启动后台。

## 升级

解压新版完整安装包，再运行新版 GoodNight.exe。若旧后台仍占用 3210 端口，在任务计划程序中结束 `io.github.beichenO2.goodnight`，然后打开新版。

程序安装在 `%LOCALAPPDATA%\Programs\GoodNight`，账号数据保存在 `%LOCALAPPDATA%\GoodNight`。

应用配置、运行状态和日志使用本机用户密钥加密。请勿删除 `.goodnight-key` 或把加密文件复制给其他用户。浏览器资料由 Chromium 和 Windows 管理。

[网页完整指南](web.md) · [常见问题](faq.md)
