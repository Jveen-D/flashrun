import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CustomSelect } from './CustomSelect';
import { useStore } from '../store';
import { EDITOR_LABEL_MAP, EDITOR_OPTIONS } from '../utils/editors';
import {
  createShortcutFromKeyboardEvent,
  formatShortcut,
  getDefaultTerminalShortcut,
  hasShortcutModifier,
} from '../utils/shortcuts';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onToggleCompactMode: () => void;
}

type SettingsSection = 'general' | 'editor' | 'shortcut' | 'compact';

const SECTION_IDS: SettingsSection[] = ['general', 'editor', 'shortcut', 'compact'];

export function SettingsModal({ open, onClose, onToggleCompactMode }: SettingsModalProps) {

  const { t } = useTranslation();
  const { globalSettings, updateGlobalSettings } = useStore();
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [isRecordingShortcut, setIsRecordingShortcut] = useState(false);
  const [recordingMessage, setRecordingMessage] = useState('');

  useEffect(() => {
    if (!open) {
      setActiveSection('general');
      setIsRecordingShortcut(false);
      setRecordingMessage('');
    }
  }, [open]);

  const sections = useMemo(() => ([
    {
      id: 'general' as const,
      title: t('通用设置'),
      description: t('语言、主题与全局界面基础偏好'),
    },
    {
      id: 'editor' as const,
      title: t('编辑器关联'),
      description: t('默认编辑器与路径检测策略'),
    },
    {
      id: 'shortcut' as const,
      title: t('快捷键配置'),
      description: t('查看和自定义终端切换快捷键'),
    },
    {
      id: 'compact' as const,
      title: t('精简模式偏好'),
      description: t('吸顶悬浮、自动隐藏与感应区设置'),
    },
  ]), [t]);

  if (!open) {
    return null;
  }

  const currentShortcutText = formatShortcut(globalSettings.terminalToggleShortcut);

  const handleShortcutKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      setIsRecordingShortcut(false);
      setRecordingMessage('');
      return;
    }

    const shortcut = createShortcutFromKeyboardEvent(event.nativeEvent);
    if (!shortcut) {
      setRecordingMessage(t('请按下包含主键的组合键。'));
      return;
    }

    if (!hasShortcutModifier(shortcut)) {
      setRecordingMessage(t('请至少包含一个修饰键（Ctrl / Command / Alt / Shift）。'));
      return;
    }

    updateGlobalSettings({ terminalToggleShortcut: shortcut });
    setIsRecordingShortcut(false);
    setRecordingMessage(t('快捷键已更新为 {{shortcut}}', { shortcut: formatShortcut(shortcut) }));
  };

  const renderSectionContent = () => {
    switch (activeSection) {
      case 'general':
        return (
          <div className="space-y-6">
            <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50 p-5">
              <h4 className="text-base font-bold text-slate-900 dark:text-white mb-1">{t('界面外观')}</h4>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">{t('统一管理 FlashRun 的语言与主题表现。')}</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">{t('主题')}</label>
                  <CustomSelect
                    value={globalSettings.theme}
                    onChange={(value) => updateGlobalSettings({ theme: value as any })}
                    options={[
                      { label: t('跟随系统'), value: 'system' },
                      { label: t('浅色模式'), value: 'light' },
                      { label: t('深色模式'), value: 'dark' },
                    ]}
                    buttonClassName="flex items-center justify-between w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-3 text-sm text-slate-700 dark:text-slate-200"
                    dropdownClassName="left-0 mt-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">{t('语言')}</label>
                  <CustomSelect
                    value={globalSettings.language}
                    onChange={(value) => updateGlobalSettings({ language: value as any })}
                    options={[
                      { label: '中文', value: 'zh' },
                      { label: 'English', value: 'en' },
                    ]}
                    buttonClassName="flex items-center justify-between w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-3 text-sm text-slate-700 dark:text-slate-200"
                    dropdownClassName="left-0 mt-2"
                  />
                </div>
              </div>
            </section>
          </div>
        );
      case 'editor':
        return (
          <div className="space-y-6">
            <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50 p-5">
              <h4 className="text-base font-bold text-slate-900 dark:text-white mb-1">{t('默认编辑器')}</h4>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">{t('当在 TopBar 点击“打开”时，系统将通过此关联唤起对应应用解析该项目目录。')}</p>
              <CustomSelect
                value={globalSettings.defaultEditor}
                onChange={(value) => updateGlobalSettings({ defaultEditor: value as any })}
                options={EDITOR_OPTIONS.map((option) => ({
                  ...option,
                  label: `${option.label}${option.value === globalSettings.defaultEditor ? ` · ${t('当前默认')}` : ''}`,
                }))}
                buttonClassName="flex items-center justify-between w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-3 text-sm text-slate-700 dark:text-slate-200"
                dropdownClassName="left-0 mt-2"
              />
            </section>

            <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 p-5">
              <h4 className="text-base font-bold text-slate-900 dark:text-white mb-1">{t('路径检测')}</h4>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{t('FlashRun 会按平台自动探测编辑器安装位置，无需手动填写绝对路径。')}</p>
              <div className="grid gap-3 text-sm text-slate-600 dark:text-slate-300">
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 px-4 py-3">
                  <div className="font-semibold text-slate-800 dark:text-slate-100 mb-1">Windows</div>
                  <div>{t('检测顺序：PATH / CLI → App Paths 注册表 → Uninstall 注册表 → LocalAppData / Program Files 常见目录。')}</div>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 px-4 py-3">
                  <div className="font-semibold text-slate-800 dark:text-slate-100 mb-1">macOS / Linux</div>
                  <div>{t('检测顺序：优先使用已暴露到 PATH 的编辑器 CLI 命令。')}</div>
                </div>
                <div className="rounded-xl border border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 px-4 py-3 text-blue-700 dark:text-blue-300">
                  {t('当前默认编辑器：{{editor}}', { editor: EDITOR_LABEL_MAP[globalSettings.defaultEditor] || globalSettings.defaultEditor })}
                </div>
              </div>
            </section>
          </div>
        );
      case 'shortcut':
        return (
          <div className="space-y-6">
            <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50 p-5">
              <h4 className="text-base font-bold text-slate-900 dark:text-white mb-1">{t('终端切换快捷键')}</h4>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">{t('用于切换底部终端显隐，并在展开后自动重新计算终端尺寸。')}</p>
              <div className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-4">
                <div>
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t('当前绑定')}</div>
                  <div className="text-2xl font-black tracking-tight text-blue-600 dark:text-blue-400 mt-1">{currentShortcutText}</div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">{t('默认组合：Windows / Linux 为 Ctrl + J，macOS 为 Command + J。')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      updateGlobalSettings({ terminalToggleShortcut: getDefaultTerminalShortcut() });
                      setRecordingMessage(t('已恢复默认快捷键。'));
                      setIsRecordingShortcut(false);
                    }}
                    className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    {t('恢复默认')}
                  </button>
                  <button
                    type="button"
                    data-shortcut-recorder="true"
                    onClick={() => {
                      setIsRecordingShortcut(true);
                      setRecordingMessage(t('开始监听，请按下新的组合键。按 Esc 取消。'));
                    }}
                    onKeyDown={isRecordingShortcut ? handleShortcutKeyDown : undefined}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                      isRecordingShortcut
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                        : 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:opacity-90'
                    }`}
                  >
                    {isRecordingShortcut ? t('正在监听...') : t('录制快捷键')}
                  </button>
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-3 text-sm text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/40">
                {recordingMessage || t('录制时建议至少带一个修饰键，避免与普通输入冲突。')}
              </div>
            </section>
          </div>
        );
      case 'compact':
        return (
          <div className="space-y-6">
            <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50 p-5 space-y-4">
              <div>
                <h4 className="text-base font-bold text-slate-900 dark:text-white mb-1">{t('精简模式')}</h4>
                <p className="text-sm text-slate-500 dark:text-slate-400">{t('开启后窗口会收缩为仅保留左侧边栏的悬浮启动器。')}</p>
              </div>

              <button
                type="button"
                onClick={onToggleCompactMode}
                className={`w-full rounded-2xl border px-4 py-4 text-left transition-colors ${

                  globalSettings.compactMode
                    ? 'border-blue-300 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-500/10'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950'
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t('启用精简模式')}</div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('标题栏按钮与此设置保持同步，可随时切换。')}</p>
                  </div>
                  <div className={`h-6 w-11 rounded-full transition-colors ${globalSettings.compactMode ? 'bg-blue-500' : 'bg-slate-300 dark:bg-slate-700'}`}>
                    <div className={`h-5 w-5 rounded-full bg-white shadow transition-transform mt-0.5 ${globalSettings.compactMode ? 'translate-x-5 ml-0.5' : 'translate-x-0.5'}`} />
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => updateGlobalSettings({ compactModeAutoHide: !globalSettings.compactModeAutoHide })}
                className={`w-full rounded-2xl border px-4 py-4 text-left transition-colors ${
                  globalSettings.compactModeAutoHide
                    ? 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950'
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t('鼠标移出后自动吸顶隐藏')}</div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('开启后离开窗口即向上收起，仅保留顶部感应细缝。')}</p>
                  </div>
                  <div className={`h-6 w-11 rounded-full transition-colors ${globalSettings.compactModeAutoHide ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`}>
                    <div className={`h-5 w-5 rounded-full bg-white shadow transition-transform mt-0.5 ${globalSettings.compactModeAutoHide ? 'translate-x-5 ml-0.5' : 'translate-x-0.5'}`} />
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => updateGlobalSettings({ compactTriggerBandDebug: !globalSettings.compactTriggerBandDebug })}
                className={`w-full rounded-2xl border px-4 py-4 text-left transition-colors ${
                  globalSettings.compactTriggerBandDebug
                    ? 'border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950'
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t('显示顶部触发带调试')}</div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('高亮精简模式顶部唤出带，方便排查命中范围与唤出问题。')}</p>
                  </div>
                  <div className={`h-6 w-11 rounded-full transition-colors ${globalSettings.compactTriggerBandDebug ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-700'}`}>
                    <div className={`h-5 w-5 rounded-full bg-white shadow transition-transform mt-0.5 ${globalSettings.compactTriggerBandDebug ? 'translate-x-5 ml-0.5' : 'translate-x-0.5'}`} />
                  </div>
                </div>
              </button>
            </section>

            <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 p-5">
              <div className="flex items-center justify-between gap-4 mb-3">
                <div>
                  <h4 className="text-base font-bold text-slate-900 dark:text-white">{t('顶部感应区高度')}</h4>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{t('用于唤出吸顶后的精简窗口，范围 2 - 5px。')}</p>
                </div>
                <div className="text-2xl font-black text-blue-600 dark:text-blue-400">{globalSettings.compactPeekHeight}px</div>
              </div>
              <input
                type="range"
                min={2}
                max={5}
                step={1}
                value={globalSettings.compactPeekHeight}
                onChange={(event) => updateGlobalSettings({ compactPeekHeight: Number(event.target.value) })}
                className="w-full accent-blue-500"
              />
            </section>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 p-5 backdrop-blur-sm dark:bg-black/70">
      <div className="flex h-[680px] w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-2xl dark:border-slate-700/70 dark:bg-slate-900/95">
        <aside className="flex w-72 flex-col border-r border-slate-200/80 bg-slate-50/90 p-5 dark:border-slate-800/80 dark:bg-slate-950/50">
          <div className="mb-6 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{t('全局设置')}</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('按分类管理 FlashRun 的全局行为与窗口偏好。')}</p>
            </div>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-slate-400 transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-700 dark:hover:border-slate-700 dark:hover:bg-slate-900 dark:hover:text-white"
              title={t('关闭')}
            >
              <X size={16} />
            </button>
          </div>

          <nav className="space-y-2">
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveSection(section.id)}
                className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                  activeSection === section.id
                    ? 'border-blue-500 bg-blue-600 text-white shadow-sm shadow-blue-600/20'
                    : 'border-transparent text-slate-700 hover:border-slate-200 hover:bg-white dark:text-slate-300 dark:hover:border-slate-800 dark:hover:bg-slate-900'
                }`}
              >
                <div className="text-sm font-semibold">{section.title}</div>
                <div className={`mt-1 text-xs ${activeSection === section.id ? 'text-blue-100' : 'text-slate-500 dark:text-slate-400'}`}>{section.description}</div>
              </button>
            ))}
          </nav>

          <div className="mt-auto pt-6 text-xs leading-5 text-slate-400 dark:text-slate-500">
            {t('使用 {{shortcut}} 可快速切换终端。', { shortcut: currentShortcutText })}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-slate-200/80 bg-white/85 px-8 py-5 backdrop-blur dark:border-slate-800/80 dark:bg-slate-900/80">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
              {SECTION_IDS.indexOf(activeSection) + 1} / {SECTION_IDS.length}
            </div>
            <h4 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">{sections.find((section) => section.id === activeSection)?.title}</h4>
          </div>
          <div className="flex-1 overflow-y-auto bg-white/90 p-8 dark:bg-slate-900">
            {renderSectionContent()}
          </div>
          <div className="flex justify-end border-t border-slate-200/80 bg-slate-50/90 px-8 py-4 dark:border-slate-800/80 dark:bg-slate-950/50">
            <button
              onClick={onClose}
              className="rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
            >
              {t('完成')}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
