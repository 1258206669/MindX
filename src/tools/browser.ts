/**
 * Browser Tool — 操作本地浏览器
 *
 * 支持：打开 URL、打开豆包/ChatGPT 等 AI 网站
 */

import type { CliToolDef } from '../types.js';

export const browserTool: CliToolDef = {
  name: 'browser',
  command: 'start',  // Windows 用 start，Mac 用 open，Linux 用 xdg-open
  description: 'Open URLs in local browser',
  actions: [
    {
      name: 'open',
      description: 'Open a URL in browser',
      template: 'start {{url}}',
      params: [{ name: 'url', description: 'URL to open', required: true }],
    },
    {
      name: 'doubao',
      description: 'Open Doubao (豆包) AI',
      template: 'start https://www.doubao.com/chat/',
    },
    {
      name: 'chatgpt',
      description: 'Open ChatGPT',
      template: 'start https://chat.openai.com',
    },
    {
      name: 'kimi',
      description: 'Open Kimi AI',
      template: 'start https://kimi.moonshot.cn',
    },
    {
      name: 'search',
      description: 'Search on Google',
      template: 'start https://www.google.com/search?q={{query}}',
      params: [{ name: 'query', description: 'Search query', required: true }],
    },
  ],
};
