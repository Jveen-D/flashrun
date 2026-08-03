import React from 'react';
import { useStore } from '../store';
import { CircleStop, FolderOpen, Folder, LoaderCircle, SquareTerminal } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { CustomSelect } from './CustomSelect';
import { useTranslation } from 'react-i18next';
import { EDITOR_LABEL_MAP, EDITOR_OPTIONS } from '../utils/editors';

interface TopBarProps {
  isTerminalOpen: boolean;
  onTerminalToggle: () => void;
}

interface PortTerminationResult {
  port: number;
  killedPids: number[];
}

export const TopBar: React.FC<TopBarProps> = ({
  isTerminalOpen,
  onTerminalToggle,
}) => {
  const { projects, activeProjectId, globalSettings, updateProjectManager, updateGlobalSettings } = useStore();
  const { t } = useTranslation();
  const [portInput, setPortInput] = React.useState('');
  const [isTerminatingPort, setIsTerminatingPort] = React.useState(false);
  const [portResult, setPortResult] = React.useState('');

  const activeProject = projects.find((project) => project.id === activeProjectId);

  const handleOpenEditor = async () => {
    if (!activeProject) {
      return;
    }

    try {
      await invoke('open_in_editor', {
        path: activeProject.path,
        editorKey: globalSettings.defaultEditor,
      });
    } catch (error) {
      console.error('Failed to open editor:', error);
      const editorHint = EDITOR_LABEL_MAP[globalSettings.defaultEditor] || globalSettings.defaultEditor;
      const errorMessage = typeof error === 'string' ? error : String(error);
      alert(t('无法唤起编辑器 {{editor}}。\n\n{{detail}}', { editor: editorHint, detail: errorMessage }));
    }
  };

  const handleTerminatePort = async (event: React.FormEvent) => {
    event.preventDefault();
    const port = Number(portInput);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setPortResult(t('请输入 1 - 65535 的有效端口。'));
      return;
    }

    setIsTerminatingPort(true);
    setPortResult('');
    try {
      const result = await invoke<PortTerminationResult>('terminate_port', { port });
      setPortResult(result.killedPids.length
        ? t('端口 {{port}} 已终止 {{count}} 个进程。', { port, count: result.killedPids.length })
        : t('端口 {{port}} 当前未被占用。', { port }));
    } catch (error) {
      console.error('Failed to terminate port:', error);
      setPortResult(t('终止端口失败：{{error}}', { error: String(error) }));
    } finally {
      setIsTerminatingPort(false);
    }
  };

  if (!activeProject) {
    return <header className="h-12 shrink-0 border-b border-slate-200/80 bg-slate-50/85 backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/65" />;
  }

  return (
    <header className="relative z-10 flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 bg-slate-50/85 px-4 backdrop-blur transition-colors dark:border-slate-800/80 dark:bg-slate-950/65">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <h1 className="flex shrink-0 items-center gap-2 text-[15px] font-semibold leading-tight text-slate-800 transition-colors dark:text-slate-100">
          {activeProject.name}
          <div className="relative group">
            <CustomSelect
              value={activeProject.manager}
              onChange={(value) => updateProjectManager(activeProject.id, value)}
              options={[
                { label: 'NPM', value: 'npm' },
                { label: 'PNPM', value: 'pnpm' },
                { label: 'YARN', value: 'yarn' },
                { label: 'BUN', value: 'bun' },
              ]}
              buttonClassName="flex items-center rounded-md border border-slate-300/80 bg-slate-200/70 px-2.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600 transition-colors hover:bg-white hover:text-slate-900 dark:border-slate-700/80 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:bg-slate-700/80 dark:hover:text-white"
              dropdownClassName="left-0 mt-2 z-50 min-w-[100px]"
            />
          </div>
        </h1>
        <div className="h-4 w-px shrink-0 bg-slate-300/80 dark:bg-slate-700/80" />

        <div className="flex min-w-0 flex-1 items-center rounded-md border border-slate-200/80 bg-white/60 px-1.5 py-1 dark:border-slate-800/70 dark:bg-slate-900/50">
          <button
            onClick={() => revealItemInDir(activeProject.path).catch((error) => console.error(t('打开文件夹失败:'), error))}
            className="mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-slate-400 transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-700 dark:text-slate-500 dark:hover:border-slate-700 dark:hover:bg-slate-900 dark:hover:text-white"
            title={t('在系统资源管理器中打开此目录')}
          >
            <Folder size={14} />
          </button>
          <p className="cursor-default truncate font-mono text-[11px] text-slate-500 transition-colors dark:text-slate-400" title={activeProject.path}>
            {activeProject.path}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <form onSubmit={handleTerminatePort} className="relative flex h-8 items-stretch rounded-md border border-slate-200/80 bg-white/80 dark:border-slate-700/70 dark:bg-slate-900/80">
          <label className="sr-only" htmlFor="port-terminator-input">{t('端口')}</label>
          <input
            id="port-terminator-input"
            type="number"
            min={1}
            max={65535}
            inputMode="numeric"
            value={portInput}
            onChange={(event) => {
              setPortInput(event.target.value);
              setPortResult('');
            }}
            placeholder={t('端口')}
            className="w-[72px] min-w-0 rounded-l-md bg-transparent px-2 font-mono text-[11px] text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200 dark:placeholder:text-slate-500"
          />
          <button
            type="submit"
            disabled={isTerminatingPort}
            className="flex h-full w-8 shrink-0 items-center justify-center rounded-r-md border-l border-slate-200/80 text-rose-500 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700/70 dark:text-rose-400 dark:hover:bg-rose-500/10"
            title={portResult || t('检查并终止占用端口的进程')}
          >
            {isTerminatingPort ? <LoaderCircle size={14} className="animate-spin" /> : <CircleStop size={14} />}
          </button>
          {portResult && (
            <span
              role="status"
              className="absolute right-0 top-full z-50 mt-2 max-w-80 whitespace-normal rounded-md border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-600 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            >
              {portResult}
            </span>
          )}
        </form>

        <button
          onClick={onTerminalToggle}
          title={isTerminalOpen ? t('收起终端') : t('打开终端')}
          className={`flex h-8 w-8 items-center justify-center rounded-md border transition-colors ${
            isTerminalOpen
              ? 'border-blue-500 bg-blue-600 text-white shadow-sm shadow-blue-600/15'
              : 'border-slate-200/80 bg-white/80 text-slate-500 hover:border-blue-400 hover:text-blue-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-400 dark:hover:border-blue-500 dark:hover:text-blue-400'
          }`}
        >
          <SquareTerminal size={15} />
        </button>

        <div className="flex items-stretch rounded-md border border-slate-200/80 bg-slate-100/90 transition-colors dark:border-slate-700/70 dark:bg-slate-900/80">
          <button
            onClick={handleOpenEditor}
            className="flex items-center gap-2 rounded-l-md px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-white hover:text-blue-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-blue-400"
            title={t('一键起飞打开该项目')}
          >
            <FolderOpen size={16} className="shrink-0" />
            <span className="whitespace-nowrap">{t('在 {{editor}} 中打开', { editor: EDITOR_LABEL_MAP[globalSettings.defaultEditor] || t('编辑器') })}</span>
          </button>
          <div className="w-px bg-slate-200 transition-colors dark:bg-slate-700/70" />
          <div className="flex self-stretch rounded-r-md text-slate-500 transition-colors hover:bg-white hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200">
            <CustomSelect
              value={globalSettings.defaultEditor}
              onChange={(value) => updateGlobalSettings({ defaultEditor: value as any })}
              options={EDITOR_OPTIONS.map((option) => ({ label: option.label, value: option.value }))}
              buttonClassName="flex h-full items-center justify-center rounded-r-md px-2.5 text-slate-500 transition-colors hover:text-slate-700 cursor-pointer focus:outline-none dark:text-slate-400 dark:hover:text-slate-200"
              dropdownClassName="right-0 top-full mt-2 w-40"
              hideChevron={false}
              hideLabelDisplay
            />
          </div>
        </div>
      </div>
    </header>
  );
};
