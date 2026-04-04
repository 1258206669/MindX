/**
 * Example plugin — 展示如何写一个插件
 *
 * 插件可以注册 Agent、工具，监听消息总线事件
 */

export default {
  name: 'hello-plugin',
  version: '1.0.0',
  description: 'Example plugin that logs all agent results',

  register(ctx) {
    // 监听所有 Agent 执行结果
    ctx.bus.on('agent:result', (msg) => {
      console.log(`[hello-plugin] Agent completed in session ${msg.sessionId}`);
    });

    // 也可以注册自定义工具
    ctx.registerTool({
      name: 'hello',
      command: 'echo',
      description: 'A simple hello tool',
      actions: [
        {
          name: 'greet',
          description: 'Say hello',
          template: 'echo "Hello, {{name}}!"',
          params: [{ name: 'name', description: 'Who to greet', required: false, default: 'World' }],
        },
      ],
    });
  },
};
