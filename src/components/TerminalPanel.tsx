import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import TerminalWindow from '../TerminalWindow';
import { useStore } from '../store';

interface Props { className?: string; onClose?: () => void; activeProjectId?: string | null; isOpen?: boolean }
export default function TerminalPanel({ className = '', onClose, activeProjectId, isOpen = false }: Props) {
  const projects = useStore((s) => s.projects);
  const terminals = useStore((s) => s.projectTerminals);
  const selectedCommands = useStore((s) => s.activeCommandByProject);
  const addTab = useStore((s) => s.addTerminalTab);
  const closeTab = useStore((s) => s.closeTerminalTab);
  const selectTab = useStore((s) => s.setActiveTerminalTab);
  const project = projects.find((p) => p.id === activeProjectId);
  const terminalState = activeProjectId ? terminals[activeProjectId] : undefined;
  const runningId = activeProjectId ? selectedCommands[activeProjectId] : null;
  const [commandId, setCommandId] = useState<string | null>(runningId ?? null);
  useEffect(() => { if (runningId) setCommandId(runningId); }, [runningId]);
  if (!project || !terminalState) return null;
  const command = project.commands.find((c) => c.id === commandId);
  const shellTab = terminalState.tabs.find((tab) => tab.id === terminalState.activeTabId);
  return <div className={`flex h-full flex-col bg-[#0B1120] ${className}`}>
    <div className="flex h-8 shrink-0 items-center gap-2 overflow-x-auto bg-slate-900 px-2 text-xs text-slate-200">
      <select aria-label="Command output" className="max-w-44 rounded bg-slate-800 p-1" value={command?.id ?? ''}
        onChange={(event) => setCommandId(event.target.value || null)}>
        <option value="">Shell</option>
        {project.commands.map((c) => <option key={c.id} value={c.id}>{c.label}{c.status === 'running' ? ' ●' : ''}</option>)}
      </select>
      {terminalState.tabs.map((tab) => <div key={tab.id} className="flex shrink-0 items-center">
        <button className={`rounded px-2 py-1 ${!command && shellTab?.id === tab.id ? 'bg-blue-700' : 'bg-slate-800'}`}
          onClick={() => { setCommandId(null); selectTab(project.id, tab.id); }}>{tab.title}</button>
        <button aria-label={`Close ${tab.title}`} onClick={() => closeTab(project.id, tab.id)} className="p-1"><X size={12} /></button>
      </div>)}
      <button aria-label="New terminal" onClick={() => { setCommandId(null); addTab(project.id); }} className="p-1"><Plus size={14} /></button>
      <button aria-label="Hide terminal" onClick={onClose} className="ml-auto p-1"><X size={14} /></button>
    </div>
    <div className="min-h-0 flex-1">
      {isOpen && (command || shellTab) && <TerminalWindow
        key={command ? `command-${command.id}` : shellTab!.id}
        projectId={project.id} workingDir={project.path}
        sessionId={command ? undefined : shellTab?.id} commandId={command?.id}
        pid={command?.pid} active={isOpen} />}
    </div>
  </div>;
}
