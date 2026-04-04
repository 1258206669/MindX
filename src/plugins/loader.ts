/**
 * Plugin Loader — 从文件系统动态加载插件
 *
 * 插件目录结构：
 *   ~/.macli/plugins/
 *     my-plugin/
 *       index.js   ← export default { name, version, register }
 *
 * 也支持 JSON 格式的纯工具定义：
 *   ~/.macli/tools/
 *     kiro.json    ← CliToolDef JSON
 */

import { resolve } from 'path';
import { homedir } from 'os';
import { readdirSync, existsSync, readFileSync, mkdirSync } from 'fs';
import type { Plugin, CliToolDef } from '../types.js';
import type { Orchestrator } from '../core/orchestrator.js';

const PLUGINS_DIR = resolve(homedir(), '.macli', 'plugins');
const TOOLS_DIR = resolve(homedir(), '.macli', 'tools');

/** 加载所有 JSON 工具定义 */
export function loadToolDefs(dir: string = TOOLS_DIR): CliToolDef[] {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    return [];
  }

  const tools: CliToolDef[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = readFileSync(resolve(dir, file), 'utf-8');
      const def = JSON.parse(raw) as CliToolDef;
      tools.push(def);
    } catch (e: any) {
      console.error(`Failed to load tool ${file}: ${e.message}`);
    }
  }
  return tools;
}

/** 加载所有 JS 插件 */
export async function loadPlugins(orchestrator: Orchestrator, dir: string = PLUGINS_DIR): Promise<void> {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    return;
  }

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const indexPath = resolve(dir, entry.name, 'index.js');
    if (!existsSync(indexPath)) continue;

    try {
      const mod = await import(`file://${indexPath}`);
      const plugin: Plugin = mod.default ?? mod;
      await orchestrator.loadPlugin(plugin);
    } catch (e: any) {
      console.error(`Failed to load plugin ${entry.name}: ${e.message}`);
    }
  }
}
