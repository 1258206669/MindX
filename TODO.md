# 待办任务

## 🔴 下一步：安装 WSL2 + kiro-cli（等下班后执行）

### 步骤 1：安装 WSL2
```powershell
# PowerShell 管理员模式
wsl --install
# 重启电脑
```

### 步骤 2：在 WSL 里装 kiro-cli + acpx
```bash
# 装 kiro-cli
curl -fsSL https://cli.kiro.dev/install | bash
kiro-cli auth login

# 装 Node.js 22+
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 装 acpx
npm install -g acpx@latest

# 验证
kiro-cli --version
acpx kiro status
```

### 步骤 3：测试 acpx 驱动 Kiro
```bash
acpx kiro exec "列出当前目录的文件"
```

### 步骤 4：改项目代码
- 把 `spawn('acpx', ...)` 改成 `spawn('wsl', ['acpx', ...])` 支持 Windows 通过 WSL 调用
- 测试完整链路：飞书 → Server → acpx → kiro-cli → 执行任务 → 回传结果

## ✅ 已完成
- 项目骨架搭建（TypeScript + Express + Ink）
- 多 Agent 框架（Orchestrator + Agent Loop + Brain 接口）
- 记忆系统（sql.js 三层记忆）
- 安全层（PermissionEngine 命令审批）
- 可观测性（Tracer 链路追踪）
- 并行执行（ParallelRunner）
- 渠道层（飞书 + Webhook 适配器）
- HTTP Server（Express API）
- acpx 封装（AcpxCli + AcpxBrain）
- IDE Extension 桥（VS Code 扩展骨架）
- 浏览器操作（打开豆包/ChatGPT/Kimi）
- 内置工具（git/npm/docker/shell/browser）
