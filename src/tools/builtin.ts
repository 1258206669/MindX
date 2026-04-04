/**
 * Built-in CLI tool definitions
 *
 * 每个工具定义了名称、命令、动作模板
 * Orchestrator 会自动为每个工具创建 CliAgent
 */

import type { CliToolDef } from '../types.js';

export const gitTool: CliToolDef = {
  name: 'git',
  command: 'git',
  description: 'Git version control',
  actions: [
    { name: 'status', description: 'Show working tree status', template: 'git status' },
    { name: 'log', description: 'Show commit log', template: 'git log --oneline -{{count}}', params: [{ name: 'count', description: 'Number of commits', required: false, default: '10' }] },
    { name: 'diff', description: 'Show changes', template: 'git diff' },
    { name: 'branch', description: 'List branches', template: 'git branch -a' },
    { name: 'add', description: 'Stage files', template: 'git add {{path}}', params: [{ name: 'path', description: 'File path', required: false, default: '.' }] },
    { name: 'commit', description: 'Commit changes', template: 'git commit -m "{{message}}"', params: [{ name: 'message', description: 'Commit message', required: true }] },
    { name: 'pull', description: 'Pull from remote', template: 'git pull' },
    { name: 'push', description: 'Push to remote', template: 'git push' },
  ],
};

export const npmTool: CliToolDef = {
  name: 'npm',
  command: 'npm',
  description: 'Node.js package manager',
  actions: [
    { name: 'install', description: 'Install dependencies', template: 'npm install' },
    { name: 'run', description: 'Run script', template: 'npm run {{script}}', params: [{ name: 'script', description: 'Script name', required: true }] },
    { name: 'list', description: 'List installed packages', template: 'npm list --depth=0' },
    { name: 'outdated', description: 'Check outdated packages', template: 'npm outdated' },
  ],
};

export const dockerTool: CliToolDef = {
  name: 'docker',
  command: 'docker',
  description: 'Docker container management',
  actions: [
    { name: 'ps', description: 'List containers', template: 'docker ps' },
    { name: 'images', description: 'List images', template: 'docker images' },
    { name: 'build', description: 'Build image', template: 'docker build -t {{tag}} {{path}}', params: [{ name: 'tag', description: 'Image tag', required: true }, { name: 'path', description: 'Build context', required: false, default: '.' }] },
    { name: 'run', description: 'Run container', template: 'docker run {{image}}', params: [{ name: 'image', description: 'Image name', required: true }] },
    { name: 'stop', description: 'Stop container', template: 'docker stop {{container}}', params: [{ name: 'container', description: 'Container ID/name', required: true }] },
  ],
};

export const shellTool: CliToolDef = {
  name: 'shell',
  command: '',
  description: 'Execute arbitrary shell commands',
  actions: [
    { name: 'exec', description: 'Run a shell command', template: '{{command}}', params: [{ name: 'command', description: 'Shell command to execute', required: true }] },
    { name: 'ls', description: 'List directory', template: 'ls -la {{path}}', params: [{ name: 'path', description: 'Directory path', required: false, default: '.' }] },
    { name: 'cat', description: 'Read file', template: 'cat {{file}}', params: [{ name: 'file', description: 'File path', required: true }] },
  ],
};

/** 所有内置工具 */
export { browserTool } from './browser.js';
import { browserTool } from './browser.js';
export const builtinTools: CliToolDef[] = [gitTool, npmTool, dockerTool, shellTool, browserTool];
