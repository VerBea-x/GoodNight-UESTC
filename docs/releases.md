# 安装包发布指南

推荐通过本仓库的 GitHub Releases 分发 APK：源码进入 main，APK 作为对应版本的附件上传。用户下载 Assets 中的 APK；GitHub 自动生成的 Source code 压缩包是源码，不能在手机上直接安装。

## 版本与签名

1. 在 android/app/build.gradle 增加 versionCode，更新 versionName，并同步 CHANGELOG.md 和使用指南。
2. 从已提交的源码构建，记录该提交号。创建同版本标签，例如 v0.6.6，标签指向这次构建使用的提交。
3. APK 名称建议为 GoodNight-Android-v0.6.6.apk，同时提供 SHA256SUMS.txt、更新说明和验证范围。
4. 每个版本使用同一个签名密钥，Android 才能覆盖升级。当前构建脚本生成调试签名包，适合现阶段自行安装；不要在另一台机器上随意重建后当作可覆盖升级的包发布。

正式长期发布建议配置专用 release 签名并离线备份密钥与密码。密钥、密码、用户数据不得进入 Git。由调试签名切换为不同的正式签名时，旧用户通常无法直接覆盖安装；卸载可能丢失本机加密设置与登录状态。切换前应单独发布迁移说明，不要建议用户直接卸载重装。

## 网页发布步骤

1. 推送已核对的源码，到仓库 Releases → Draft a new release。
2. 创建新的版本标签，选择准确的构建提交，填写标题和更新说明。
3. 上传对应 APK 和校验文件，确认 APK 内版本号、Release 标签和说明一致。
4. 尚未完成真机验证的版本先选择 Pre-release；预发布不会自动替代稳定版的 Latest。
5. 用户确认覆盖安装、学校登录、快速切换、后台唤醒和通知后，再发布稳定版或取消预发布标记。

旧版本保留下载和版本记录。不要把 0.6.6 的 APK 覆盖到 v0.6.4 下，也不要移动已发布标签。修正文案可以编辑原 Release，修改功能应新建版本。

## 校验与安装

在 Windows 下载 APK 后运行：

```powershell
Get-FileHash .\GoodNight-Android-v0.6.6.apk -Algorithm SHA256
```

结果应与同一 Release 的 SHA256SUMS.txt 一致。校验值可检查下载是否完整；签名及可信发布来源同样需要核对。

## 后续自动发布

GitHub Actions 可按版本标签自动构建和上传附件，但必须先解决稳定签名和密钥备份。发布工作流仅使用仓库 Secrets 读取签名凭证，并限制发布权限；不要每次生成随机调试签名。现阶段建议本机使用现有密钥构建、核对后手动上传 Release。

官方参考：[管理 Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)、[Android 应用签名](https://developer.android.com/studio/publish/app-signing)。
