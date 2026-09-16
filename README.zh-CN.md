<div align="center">

# Agenda

### 把日子铺开，把今天留下。

[English](README.md) | **简体中文**

[下载 v2.1](https://github.com/zz-zane/Agenda/releases/tag/v2.1) · [MIT 开源许可证](LICENSE)

</div>

Agenda 是一款 Windows 本地日历应用，将毛玻璃界面、日程安排、照片打卡和 AI 学习规划放在一起。记录保存在你的电脑上；AI 是可选功能，由你配置使用的模型服务商。

## 你可以用它做什么

| 功能 | 说明 |
| --- | --- |
| 日历与日程 | 月、周、日三种视图；点击周或日视图的空白时段即可新增安排，历史日程只读。 |
| 课表导入 | 导入 `.xlsx` 课表，处理重复安排，也可通过 AI 附件流程导入。 |
| 照片打卡 | 上传当天照片后完成打卡。只有今天显示表情：已打卡 😊，未打卡 😢；过去和未来不显示，不支持补卡。 |
| AI 学习规划 | 聊天调整日程、修改课程、预览学习计划，确认后执行。重排保留剩余大纲和截止日；延期需要你明确提出并确认。 |
| 学习画像 | 根据已记录的事实和活动主动生成画像。估计明确标注未经校准，观察样本不足时不输出数值概率。 |
| 多模型管理 | 添加、修改和切换已保存的模型，每个模型的 API Key 在 Windows 上分别加密保存。 |
| 画面选项 | 浅色与深色毛玻璃、深色缓慢飘落的微弱星点、可收起导航，以及页面切换动画。 |
| 语言与开场 | 简体中文 / English 界面切换。可选简短开场直接显示 **KEEP GOING**，不显示进度条，再展开进入日历；设置重启后保留。 |

## Windows 安装

1. 打开 [v2.1 发布页面](https://github.com/zz-zane/Agenda/releases/tag/v2.1)。
2. 下载 **Agenda-Setup-2.1.0-x64.exe**，安装后从桌面或开始菜单启动。
3. 日历可直接使用。需要 AI 时，在 **设置 → 模型设置** 填入服务商地址、模型 ID 和 API Key。

安装包已包含后端及 AI 运行环境，使用者无需另装 Python 或 Node.js。当前安装包**未签名**，发布页面提供 SHA-256 校验文件。

应用采用单实例和私有本机端口，关闭窗口会停止后端。拖动顶部空白区移动窗口，通过最大化／还原按钮改变尺寸；目前不支持拖动窗口边缘缩放。

## 选择模型

- **DeepSeek**：内置服务商预设。
- **OpenAI / GPT**：支持 Chat Completions 和工具调用的模型。
- **Claude**：通过 Anthropic 官方 OpenAI 兼容入口使用，功能受该兼容入口限制。
- **其他兼容服务商**：填写兼容接口地址与模型 ID。

请填写所选服务商签发的 API Key。保存配置不代表已验证连通性或账户权限。AI 调用需要联网；日历和本地记录无需联网。

## 数据与隐私

| 内容 | Windows 桌面版保存位置 |
| --- | --- |
| 日历、照片、聊天、原始导入文件和画像 | `%LOCALAPPDATA%\Agenda\data` |
| 窗口缓存、画面与语言偏好 | `%LOCALAPPDATA%\Agenda\window` |

首次新安装不携带用户或开发测试数据。升级、重装和卸载保留数据目录；备份时先退出 Agenda，再复制整个数据目录。

API Key 使用当前 Windows 账户的 DPAPI 加密。新模型密钥分别保存在 `data/model-keys/`，旧的 `data/ai-key.dpapi` 继续兼容读取。密钥不写入 SQLite，加密备份也不能当作可跨机器直接使用的凭据。

**使用 AI 时，相关聊天、日程和学习画像上下文会发送给你选择的服务商，照片文件不会发送。** 切换界面语言不会翻译已保存记录或模型回复；后端错误提示暂保留原语言。

请勿将数据目录、API Key 或环境配置提交到 Git。发布源码和安装包排除个人数据及内部开发记录。

## 从源码运行

需要 Windows、Python 3.10+ 和 Node.js 22+。下载发布源码或克隆仓库，在根目录运行：

```powershell
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
scripts\install-ai.bat
scripts\run-local.bat
```

保持终端开启，在浏览器访问 **http://127.0.0.1:8765**。源码模式将记录保存在项目的 `data/` 目录。服务只监听本机，本仓库不提供公网网站托管。

直接导入课表时，可使用名为 `日程明细` 的 `.xlsx` 工作表，列为 `日期`、`课程`、`时间`，时间范围示例为 `09:00-10:00`。

## 构建 Windows 安装包

在 Windows 的干净 Python 虚拟环境中运行，并确保 Node/npm 可用：

```powershell
.venv\Scripts\python.exe -m pip install -r desktop/requirements-build.txt
.venv\Scripts\python.exe scripts/build-windows.py
```

产物位于 `dist/windows/`。构建需要联网安装锁定依赖。项目复用 HTML/CSS/JavaScript 前端与 Python 业务逻辑，使用 **Electron**、**PyInstaller** 和官方 **DeepSeek Harness** 运行时；安装包只收录实际使用的 DSH 模块并保留第三方许可证。

## 检查与当前限制

```powershell
.venv\Scripts\python.exe -m unittest discover -s tests
node frontend/calendar.test.mjs
```

桌面检查见 `scripts/check-desktop-window.mjs`，其中 `--preferences` 覆盖语言、简短开场和打卡表情；`scripts/check-windows.py` 使用本地 HTTPS 模拟服务商检查随包运行环境。

v2.1 已通过本机 Windows 的后端、多模型设置、数据持久化、主题、语言、简短开场和打卡检查。这些检查使用隔离数据和模拟服务商，不等同于真实服务商规划质量或全新 Windows 设备的安装验收。

普通窗口呈现毛玻璃视觉效果，不模糊背后的桌面；支持的 Windows 11 系统最大化时使用 Acrylic。目前不提供手机、macOS 或 Linux 桌面安装包。

## 许可证与致谢

Agenda 使用 [MIT 许可证](LICENSE)。历史复用的 Swarm 许可保留在 [LICENSE-Swarm-MIT.txt](LICENSE-Swarm-MIT.txt)。第三方依赖遵循各自许可证，官方 DSH 依赖及锁文件见 [`dsh/`](dsh/)。
