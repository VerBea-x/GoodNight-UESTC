# 晚安成电 · GoodNight

[项目仓库](https://github.com/VerBea-x/GoodNight-UESTC) · [版本记录](CHANGELOG.md) · [安卓指南](docs/android.md) · [Windows 指南](docs/pc.md) · [问题反馈](https://github.com/VerBea-x/GoodNight-UESTC/issues)

[完整文档导航](docs/index.md) · [常见问题](docs/faq.md) · [APK 发布指南](docs/releases.md)

Android 当前预发布版本为 **0.6.6**。从 [Releases](https://github.com/VerBea-x/GoodNight-UESTC/releases) 下载对应版本的 APK；安装前阅读该版本的说明。升级请覆盖安装，保留本机设置和登录状态。

面向电子科技大学「晚安成电」的本机签到工具。Windows 版提供桌面窗口和本机网页配置；Android 版可在手机上独立运行。用户自行登录学校系统、设置签到时间与 GCJ-02 坐标，程序在设定时段内尝试签到，并读取学校保存的记录供核对。学校记录是最终结果，自动任务可能受网络、登录状态和系统省电影响。

## 开始使用

### Windows 桌面版

安装 Node.js 22+ 与 Microsoft Edge。下载源码，运行 `npm ci`，再运行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\build-pc.ps1`。解压生成的 `dist/GoodNight-PC.zip`，双击其中的 `GoodNight.exe`。首次启动会安装并创建开始菜单入口。详见 [Windows 使用指南](docs/pc.md)。

### 本机网页版

安装 Node.js 22+，运行 `npm ci` 和 `npm run web`，打开 `http://127.0.0.1:3210`。Windows 也可双击 `install-web.cmd` 设置登录后后台启动。网页版仅监听本机，不是公网多人服务。详见 [网页使用指南](docs/web.md)。

### Android 独立版

最低支持 Android 8.0。

1. 从 Release 的 Assets 下载 APK 并安装。Source code 压缩包是源码，不能直接安装。
2. 打开“学校登录”，完成认证并进入“晚安成电”。
3. 点击“粘贴配置”导入电脑端复制的设置，或手动填写 GCJ-02 经纬度及签到时段。
4. 允许通知，开启“自动签到”，等待顶部显示计划已开启。
5. 收到结果提醒后，在学校页面核对当天记录。

手机可独立运行，无需电脑保持在线。手机端没有地图；选点可在电脑端完成。详见 [Android 使用指南](docs/android.md)。

`dist/` 是本机生成目录，不提交到 Git。发布安装包时应作为 GitHub Release 附件上传；源码以仓库文件为准。

Release 标签和 APK 版本应一致。当前源码为 0.6.6，已发布下载请以对应 Release 为准；预发布包尚需真机验证。覆盖安装需要签名一致，详见 [发布与升级说明](docs/releases.md)。

## 功能与限制

- Windows 端支持多账号配置、地图选点、学校登录、签到计划与运行记录。地图可使用自行申请 AK 的百度地图，或 OpenStreetMap 备用图层。
- Android 端支持粘贴配置、学校登录、签到时间与位置、后台计划、结果通知和记录查看。应用仅把配置坐标用于本应用的签到请求，不修改手机系统定位。
- 虚拟坐标模式只尝试签到，不自动提交校外报告。位置必须符合学校当前有效范围；配置坐标不保证学校接受。
- 自动签到与结果读取依赖当前学校页面和接口。登录过期、学校服务变化、手机省电策略、关机或断网都可能使计划延迟或失败。请在学校系统核对当天结果。
- 可在应用内阅读免责声明、清除本机签到历史。具体版本变更见 [CHANGELOG.md](CHANGELOG.md)。

## 本机数据保护

Windows 版首次读取旧 JSON 数据时会在原用户目录内完成加密迁移；请勿删除 `.goodnight-key`，也不要把加密文件单独复制到另一个 Windows 用户。Android 版首次读取旧设置时迁移到加密偏好；请直接覆盖安装，勿先卸载。电脑浏览器资料由 Chromium 和 Windows 管理，手机 WebView 会话由 Android 管理；这些浏览器资料不在上述应用文件加密范围内。若需要覆盖整台设备及浏览器缓存的静态数据，请开启系统磁盘加密与锁屏保护。

## 项目说明

本项目是对 [GoodNight 原始仓库](https://github.com/beichenO2/GoodNight) 的持续开发。电脑地图选点的交互参考了 [GoGoGo](https://github.com/ZCShou/GoGoGo)；没有并入其 Android 虚拟定位代码。源码按仓库中的 [MIT 许可证](LICENSE)提供。项目与电子科技大学、学校系统和地图服务提供商没有官方关联。

使用前请阅读[本项目免责声明](DISCLAIMER.md)。请遵守学校规定，仅处理自己有权操作的账号，妥善保管登录数据，并以学校保存的记录为准。

## 从源码开发

下载当前项目：

```sh
git clone https://github.com/VerBea-x/GoodNight-UESTC.git
cd GoodNight-UESTC
npm ci
npm run web
```

开发贡献见 [CONTRIBUTING.md](CONTRIBUTING.md)，隐私与漏洞反馈见 [SECURITY.md](SECURITY.md)。

Node.js 22+：`npm ci`。命令行入口为 `node bin/goodnight.mjs`；常用命令有 `login`、`check`、`run --dry-run`、`daemon`。Android 构建需要 JDK 17、Android SDK Platform 35、Build Tools 35.0.0 和 Gradle 8.13。详细设计见 [架构说明](docs/architecture.md)。配置、浏览器会话和运行日志保存在用户数据目录，切勿提交到 Git 或与他人分享。
