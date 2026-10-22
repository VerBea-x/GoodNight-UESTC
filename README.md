# 晚安成电 · GoodNight

面向电子科技大学「晚安成电」的本机签到工具。Windows 版提供桌面窗口和本机网页配置；Android 版可在手机上独立运行。用户自行登录学校系统、设置签到时间与 GCJ-02 坐标，程序在设定时段内尝试签到，并读取学校保存的记录供核对。学校记录是最终结果，自动任务可能受网络、登录状态和系统省电影响。

## 开始使用

### Windows 桌面版

安装 Node.js 22+ 与 Microsoft Edge。下载源码，在项目目录运行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\build-pc.ps1`，解压生成的 `dist/GoodNight-PC.zip`，双击其中的 `GoodNight.exe`。首次启动会安装到当前用户目录并创建开始菜单入口；以后无需保持终端窗口打开。详见 [Windows 使用指南](docs/pc.md)。

### 本机网页版

安装 Node.js 22+，运行 `npm ci` 和 `npm run web`，打开 `http://127.0.0.1:3210`。Windows 也可双击 `install-web.cmd` 设置登录后后台启动。网页版仅监听本机，不是公网多人服务。详见 [网页使用指南](docs/web.md)。

### Android 独立版

下载或自行构建 APK，打开应用，粘贴电脑端复制的账号配置，完成手机上的学校登录，核对坐标与时间，然后开启自动签到。手机不依赖电脑持续运行。构建命令为 `build-android.cmd`，生成文件为 `dist/GoodNight-Android-debug.apk`。手机端不提供地图选点；可在电脑端选点后复制配置，或手动填写 GCJ-02 坐标。详见 [Android 使用指南](docs/android.md)。

`dist/` 是本机生成目录，不提交到 Git。发布安装包时应作为 GitHub Release 附件上传；源码以仓库文件为准。

## 功能与限制

- Windows 端支持多账号配置、地图选点、学校登录、签到计划与运行记录。地图可使用自行申请 AK 的百度地图，或 OpenStreetMap 备用图层。
- Android 端支持粘贴配置、学校登录、签到时间与位置、后台计划、结果通知和记录查看。应用仅把配置坐标用于本应用的签到请求，不修改手机系统定位。
- 虚拟坐标模式只尝试签到，不自动提交校外报告。位置必须符合学校当前有效范围；配置坐标不保证学校接受。
- 自动签到与结果读取依赖当前学校页面和接口。登录过期、学校服务变化、手机省电策略、关机或断网都可能使计划延迟或失败。请在学校系统核对当天结果。
- Android v0.6.2 修复后台任务注册所需的网络状态权限；真实手机上的后台唤醒和签到仍应以安装后的运行记录核验。
- Android v0.6.4 可在应用内阅读免责声明、手动清除全部本机签到历史；设置与运行记录由 Android Keystore 密钥加密。自动任务完成尝试后会通过系统通知提醒，需允许通知权限。Windows 的配置、账号索引、运行状态和日志使用当前用户的 Windows DPAPI 密钥配合 AES-256-GCM 加密。

## 本机数据保护

Windows 版首次读取旧 JSON 数据时会在原用户目录内完成加密迁移；请勿删除 `.goodnight-key`，也不要把加密文件单独复制到另一个 Windows 用户。Android 版首次读取旧设置时迁移到加密偏好；请直接覆盖安装，勿先卸载。电脑浏览器资料由 Chromium 和 Windows 管理，手机 WebView 会话由 Android 管理；这些浏览器资料不在上述应用文件加密范围内。若需要覆盖整台设备及浏览器缓存的静态数据，请开启系统磁盘加密与锁屏保护。

## 项目说明

本项目是对 [GoodNight 原始仓库](https://github.com/beichenO2/GoodNight) 的持续开发。电脑地图选点的交互参考了 [GoGoGo](https://github.com/ZCShou/GoGoGo)；没有并入其 Android 虚拟定位代码。源码按仓库中的 [MIT 许可证](LICENSE)提供。项目与电子科技大学、学校系统和地图服务提供商没有官方关联。

使用前请阅读[本项目免责声明](DISCLAIMER.md)。请遵守学校规定，仅处理自己有权操作的账号，妥善保管登录数据，并以学校保存的记录为准。

## 从源码开发

Node.js 22+：`npm ci`。命令行入口为 `node bin/goodnight.mjs`；常用命令有 `login`、`check`、`run --dry-run`、`daemon`。Android 构建需要 JDK 17、Android SDK Platform 35、Build Tools 35.0.0 和 Gradle 8.13。详细设计见 [架构说明](docs/architecture.md)。配置、浏览器会话和运行日志保存在用户数据目录，切勿提交到 Git 或与他人分享。
