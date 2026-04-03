# multi-agent-cli

多 Agent CLI 框架 — 支持 LLM 和本地 CLI 工具双后端，插件化扩展，带记忆系统。

## 架构

```
用户输入
  │
  ▼
┌──────────────────────────────────────┐
│         Orchestrator (调度器)          │
│  路由 · 记忆注入 · Agent 选择 · 日志   │
└──┬──────────┬──────────┬─────────────┘
   │          │          │
   ▼          ▼          ▼
┌──────┐  ┌──────┐  ┌──────┐
│ CLI  │  │ CLI  │  │ LLM  │   ← Agent（统一接口）
│Agent │  │Agent │  │Agent │
│(git) │  │(kiro)│  │(可选) │
└──┬───┘  └──┬───┘  └──┬───┘
   ▼         ▼         ▼
  git      kiro    OpenAI/Ollama
  npm      cursor   Anthropic
  docker    ...      ...
```

## 核心概念

- **Agent**: 统一接口，背后可以是 CLI 工具或 LLM
- **Orchestrator**: 调度器，自动路由任务到合适的 Agent
- **Memory**: SQLite 持久化，短期会话 + 长期记忆
- **Plugin**: 动态加载，可注册 Agent/工具/事件监听
- **MessageBus**: 事件总线，解耦各模块通信

## 快速开始

```bash
npm install
npm run build

# 交互模式
macli

# 单次执行
macli -e "git status"
macli -e "@git log"
```

## 自定义工具

在 `~/.macli/tools/` 放 JSON 文件：

```json
{
  "name": "kiro",
  "command": "kiro",
  "description": "Kiro AI IDE CLI",
  "actions": [
    {
      "name": "chat",
      "template": "kiro chat \"{{message}}\"",
      "description": "Send message to Kiro",
      "params": [{ "name": "message", "required": true }]
    }
  ]
}
```

## 插件

在 `~/.macli/plugins/my-plugin/index.js`：

```js
export default {
  name: 'my-plugin',
  version: '1.0.0',
  register(ctx) {
    ctx.registerTool({ ... });
    ctx.bus.on('agent:result', (msg) => { ... });
  }
};
```

## 交互命令

| 命令 | 说明 |
|------|------|
| `/agents` | 列出所有已注册 Agent |
| `/memory <query>` | 搜索记忆 |
| `/new` | 新建会话 |
| `/help` | 帮助 |
| `@agent:name <input>` | 指定 Agent 执行 |
