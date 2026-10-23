# 晚安成电 · GoodNight

面向电子科技大学「晚安成电」的本机签到工具。设置位置和时间后，应用会在指定时段尝试签到，并提醒你核对学校记录。

[下载安装](https://github.com/VerBea-x/GoodNight-UESTC/releases/tag/v0.6.6) · [使用文档](docs/index.md) · [常见问题](docs/faq.md) · [反馈问题](https://github.com/VerBea-x/GoodNight-UESTC/issues)

## 手机端

支持 Android 8.0 及以上，可独立运行，无需电脑在线。当前版本为 **0.6.6 预发布版**。

1. 下载 Release 附件中的 APK 并安装。
2. 点击“学校登录”，完成认证并进入“晚安成电”。
3. 粘贴电脑端复制的配置，或填写 GCJ-02 经纬度与签到时段。
4. 允许通知，打开“自动签到”，等待顶部显示计划已开启。
5. 收到提醒后，在学校页面核对当天结果。

升级请覆盖安装。若提示签名不兼容，保留旧应用并反馈，避免卸载后丢失设置与登录状态。手机端没有地图，可先在电脑端选点再复制配置。

详见 [Android 使用指南](docs/android.md)。

## 电脑端

Windows 桌面版支持多账号、地图选点、自动计划和运行记录。签到时电脑需要开机、联网并保持用户登录。

已发布的安装包见 [Releases](https://github.com/VerBea-x/GoodNight-UESTC/releases)。自行构建与安装见 [Windows 使用指南](docs/pc.md)。

也可使用本机网页：安装 Node.js 22+，下载源码后运行：

```sh
npm ci
npm run web
```

服务启动后，在同一台电脑的浏览器中打开 [本机控制台](http://127.0.0.1:3210/)，按页面指引配置。

后台部署和地图设置见 [网页指南](docs/web.md)。

## 使用前了解

- 学校保存的记录是最终结果。网络、登录过期及系统省电可能导致任务延迟或失败。
- 配置坐标只用于本应用的签到请求，不改变手机系统定位；坐标是否有效由学校判断。
- 应用设置与记录使用本机密钥加密；浏览器登录资料由浏览器和系统管理。不要分享密码、Cookie、个人配置或密钥。
- Android 卸载会丢失本机数据；Windows 请勿删除数据目录内的 `.goodnight-key`。

使用前请阅读[本项目免责声明](DISCLAIMER.md)。本项目与学校无官方关联，请遵守学校规定，仅使用自己有权操作的账号。

## 开发与发布

[项目结构](docs/architecture.md) · [贡献指南](CONTRIBUTING.md) · [安装包发布](docs/releases.md) · [隐私反馈](SECURITY.md)

```sh
git clone https://github.com/VerBea-x/GoodNight-UESTC.git
cd GoodNight-UESTC
npm ci
```

Android 构建环境见安卓指南。源码提交到 Git，生成的安装包通过 Release 附件分发。

项目基于 [GoodNight](https://github.com/beichenO2/GoodNight) 开发；地图交互参考 [GoGoGo](https://github.com/ZCShou/GoGoGo)，未并入其 Android 虚拟定位代码。源码使用 [MIT 许可证](LICENSE)。
