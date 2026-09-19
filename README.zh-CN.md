<div align="center">

# Agenda

### 把日子铺开，把今天留下。

[English](README.md) | **简体中文**

[下载 v3.1.1](https://github.com/zz-zane/Agenda/releases/tag/v3.1.1) · [MIT 开源许可证](LICENSE)

</div>

Agenda 是一款 Windows 本地日历应用，将毛玻璃界面、日程安排、照片打卡和 AI 学习规划放在一起。记录保存在你的电脑上；AI 是可选功能，由你配置使用的模型服务商。

## 你可以用它做什么

| 功能 | 说明 |
| --- | --- |
| 日历与日程 | 月、周、日三种视图；点击周或日视图的空白时段即可新增安排，历史日程只读。 |
| 总览与任务完成 | 独立「总览」页按周／月显示紧凑完成色块、连续打卡和打卡率，并按全部课次展示课程／目标进度（含未来安排），适配深浅主题。在今日待办、日期详情及周／日程表勾选当天任务即完成，无需照片；已完成任务保留勾选并只读。 |
| 日记 | 玻璃底板上的纸质书本，自动收录当天已完成任务与照片；冲印相片斜放叠加，点击循环切换。今日文字自动保存到本机，可翻看历史日记。 |
| 自动更新 | 从3.1.1起，设置支持自动检查公开仓库 `zz-zane/Agenda`、下载校验并在退出时安装；旧客户端需先手动升级一次。详见[自动更新发布说明](docs/自动更新发布.md)。 |
| 课表导入 | 导入 `.xlsx` 课表，处理重复安排，也可通过 AI 附件流程导入。 |
| 照片打卡 | 当天勾选完成至少一项任务并上传照片，即自动打卡，无需额外按钮。只有今天显示表情：已打卡 😊，未打卡 😢；过去和未来不显示，不支持补卡。 |
| AI 学习规划 | 聊天调整日程、修改课程、预览学习计划，确认后执行。重排保留剩余大纲和截止日；延期需要你明确提出并确认。 |
| 学习画像 | 根据已记录的事实和活动主动生成画像。估计明确标注未经校准，观察样本不足时不输出数值概率。 |
| 多模型管理 | 添加、修改和切换已保存的模型，每个模型的 API Key 在 Windows 上分别加密保存。 |
| 小猫提醒 | 在月表选择日期添加提醒，日表空白时段可添加具体时间的提醒，也可通过小猫语音请求当前 AI 模型添加。日期提醒当天打开提示，定时提醒到点提示或当天晚些打开补提示；已成功提示的事项不重复通知。程序退出后不在后台计时。 |
| 画面选项 | 浅色与深色毛玻璃、深色缓慢飘落的微弱星点、可收起导航，以及页面切换动画。 |
| 语言与开场 | 简体中文 / English 界面切换。可选简短开场直接显示 **KEEP GOING**，不显示进度条，再展开进入日历；设置重启后保留。 |

## v3.1 新增

- **小猫桌宠**：在设置中开启。单击打开独立的今日待办窗，查看时间与事项、统一上传当天照片和打卡；双击打开 AI。深浅主题跟随 Agenda。
- **语音助手**：可选本地唤醒、语音识别和朗读，AI 回复显示在小猫旁的气泡里。识别出的文字交给当前配置的模型。
- **受限桌面权限**：默认关闭。逐个授权软件启动，明确选择代码文件供 AI 审阅；原文件保持不变，修改结果另存新文件，不支持任意命令或代码执行。
- **长对话管理**：启动时及聊天过程中在后台增量压缩上下文，使用当前模型并产生 API 用量。保留原始聊天，失败时保留上次有效摘要。
- **规则排期**：复用规则安排每日时长、每周次数、连续运动时段和按当天课程决定的复习块，先预览、确认后写入。

## Windows 安装

1. 打开 [v3.1.1 发布页面](https://github.com/zz-zane/Agenda/releases/tag/v3.1.1)。
2. 下载 **Agenda-Setup-3.1.1-x64.exe**，安装后从桌面或开始菜单启动。
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
| 软件授权清单 | `%LOCALAPPDATA%\Agenda\desktop-access.json` |
| 修改后的代码副本 | `%LOCALAPPDATA%\Agenda\Code reviews` |
| 窗口缓存、画面与语言偏好 | `%LOCALAPPDATA%\Agenda\window` |

首次新安装不携带用户或开发测试数据。升级、重装和卸载保留数据目录；备份时先退出 Agenda，再复制整个数据目录。

API Key 使用当前 Windows 账户的 DPAPI 加密。新模型密钥分别保存在 `data/model-keys/`，旧的 `data/ai-key.dpapi` 继续兼容读取。密钥不写入 SQLite，加密备份也不能当作可跨机器直接使用的凭据。

**使用 AI 时，相关聊天、日程、学习画像上下文及明确选择供审阅的代码会发送给你选择的服务商，照片文件不会发送。** 切换界面语言不会翻译已保存记录或模型回复；后端错误提示暂保留原语言。

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

先按 [agenda_pet/README.md](agenda_pet/README.md) 准备本地语音模型；源码快照不含模型权重。在 Windows 的干净 Python 虚拟环境中运行，并确保 Node/npm 可用：

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

v3.1 已通过本机 Windows 的后端、多模型设置、数据持久化、主题、语言、简短开场和打卡检查。这些检查使用隔离数据和模拟服务商，不等同于真实服务商规划质量或全新 Windows 设备的安装验收。

普通窗口呈现毛玻璃视觉效果，不模糊背后的桌面；支持的 Windows 11 系统最大化时使用 Acrylic。目前不提供手机、macOS 或 Linux 桌面安装包。

## 许可证与致谢

Agenda 使用 [MIT 许可证](LICENSE)。历史复用的 Swarm 许可保留在 [LICENSE-Swarm-MIT.txt](LICENSE-Swarm-MIT.txt)。第三方依赖遵循各自许可证，官方 DSH 依赖及锁文件见 [`dsh/`](dsh/)。
