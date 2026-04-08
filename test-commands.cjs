const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:4120');

ws.on('open', () => {
  // 先获取最新的执行记录
  ws.send(JSON.stringify({
    id: 'history',
    type: 'command',
    payload: { command: 'kiroAgent.executions.getExecutionHistory' }
  }));
});

let step = 0;
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  if (step === 0) {
    // 拿到执行历史，找最新的 succeed 的 executionId
    const executions = JSON.parse(msg.data);
    const latest = executions.find(e => e.status === 'succeed');
    if (latest) {
      console.log('Latest execution:', latest.executionId, latest.status);
      // 用 getExecutionById 获取详细内容
      ws.send(JSON.stringify({
        id: 'detail',
        type: 'command',
        payload: { command: 'kiroAgent.executions.getExecutionById', args: [latest.executionId] }
      }));
      step = 1;
    } else {
      console.log('No successful execution found');
      ws.close();
    }
  } else if (step === 1) {
    // 打印执行详情
    console.log('\nExecution detail:');
    console.log(msg.data ? msg.data.slice(0, 2000) : JSON.stringify(msg));
    ws.close();
  }
});

ws.on('error', (err) => console.error('Error:', err.message));
setTimeout(() => { ws.close(); process.exit(0); }, 15000);
