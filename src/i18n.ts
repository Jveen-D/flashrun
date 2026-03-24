import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// 翻译资源
const resources = {
  en: {
    translation: {
      "FlashRun": "FlashRun",
      "Welcome to FlashRun": "Welcome to FlashRun",
      "点击左侧 \u002B 号添加你的第一个项目接入空间吧！": "Click the \u002B icon on the left to add your first project space!",
      "全局设置": "Global Settings",
      "全局终端设置": "Global Settings",
      "默认代码编辑器": "Default Code Editor",
      "当在 TopBar 点击“打开”时，系统将通过此关联唤起对应应用解析该项目目录。": "When clicking 'Open' in the TopBar, the system will use this associated app to open the project directory.",
      "完成": "Done",
      "展开侧边栏": "Expand Sidebar",
      "收起侧边栏": "Collapse Sidebar",
      "接入新项目": "Add new project",
      "Console Commands": "Console Commands",
      "添加自定义命令": "Add custom command",
      "在系统资源管理器中打开此目录": "Open this directory in the system file explorer",
      "一键起飞打开该项目": "Open this project in editor",
      "在 {{editor}} 中打开": "Open in {{editor}}",
      "打开终端失败": "Failed to open terminal",
      "终端": "Terminal",
      "在当前目录打开系统终端": "Open system terminal in current directory",
      "语言": "Language",
      "主题": "Theme",
      "浅色模式": "Light",
      "深色模式": "Dark",
      "跟随系统": "System",
      "编辑器": "Editor",
      "打开文件夹失败:": "Failed to open folder:",
      "无法唤起编辑器 {{editor}}。请确保已将其加入到系统环境变量 PATH 中。": "Unable to invoke editor {{editor}}. Please ensure it is added to the system PATH environment variable.",
      "复制所有输出": "Copy all output",
      "清空日志": "Clear logs",
      "Console Output (Folded)": "Console Output (Folded)",
      "Edit Configuration": "Edit Configuration",
      "Restart": "Restart",
      "Stop": "Stop",
      "Run": "Run",
      "Enter command name (e.g., Lint):": "Enter command name (e.g., Lint):",
      "Enter exact CLI command:": "Enter exact CLI command:",
      "Edit command name:": "Edit command name:",
      "Edit exact CLI command:": "Edit exact CLI command:"
    }
  },
  zh: {
    translation: {
      "FlashRun": "FlashRun",
      "Welcome to FlashRun": "欢迎使用 FlashRun",
      "点击左侧 \u002B 号添加你的第一个项目接入空间吧！": "点击左侧 \u002B 号添加你的第一个项目接入空间吧！",
      "全局设置": "全局设置",
      "全局终端设置": "全局设置",
      "默认代码编辑器": "默认代码编辑器",
      "当在 TopBar 点击“打开”时，系统将通过此关联唤起对应应用解析该项目目录。": "当在 TopBar 点击“打开”时，系统将通过此关联唤起对应应用解析该项目目录。",
      "完成": "完成",
      "展开侧边栏": "展开侧边栏",
      "收起侧边栏": "收起侧边栏",
      "接入新项目": "接入新项目",
      "Console Commands": "控制台命令",
      "添加自定义命令": "添加自定义命令",
      "在系统资源管理器中打开此目录": "在系统资源管理器中打开此目录",
      "一键起飞打开该项目": "一键起飞打开该项目",
      "在 {{editor}} 中打开": "在 {{editor}} 中打开",
      "打开终端失败": "打开终端失败",
      "终端": "终端",
      "在当前目录打开系统终端": "在当前目录打开系统终端",
      "语言": "显示语言",
      "主题": "界面主题",
      "浅色模式": "浅色",
      "深色模式": "深色",
      "跟随系统": "跟随系统",
      "编辑器": "编辑器",
      "打开文件夹失败:": "打开文件夹失败:",
      "无法唤起编辑器 {{editor}}。请确保已将其加入到系统环境变量 PATH 中。": "无法唤起编辑器 {{editor}}。请确保已将其加入到系统环境变量 PATH 中。",
      "复制所有输出": "复制所有输出",
      "清空日志": "清空日志",
      "Console Output (Folded)": "控制台输出 (已折叠)",
      "Edit Configuration": "编辑配置",
      "Restart": "重启",
      "Stop": "停止",
      "Run": "运行",
      "Enter command name (e.g., Lint):": "请输入命令名称 (如: Lint):",
      "Enter exact CLI command:": "请输入具体的 CLI 命令:",
      "Edit command name:": "修改命令名称:",
      "Edit exact CLI command:": "修改具体的 CLI 命令:"
    }
  }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: "zh", // 预设默认语言，实际会在 App 中被 store 覆盖
    fallbackLng: "en",
    interpolation: {
      escapeValue: false 
    }
  });

export default i18n;
