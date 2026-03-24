import React from 'react';
import { useStore, Command } from '../store';
import { Play, Square, TerminalSquare, Plus, Settings2, RefreshCw } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

export const ActionGrid: React.FC = () => {
  const { projects, activeProjectId, updateCommand, addCommand } = useStore();
  const activeProject = projects.find(p => p.id === activeProjectId);

  if (!activeProject) return null;

  const handleRun = async (cmd: Command) => {
    if (cmd.status === 'running') return;
    
    try {
      updateCommand(activeProject.id, cmd.id, { status: 'running' });
      const pid = await invoke<number>("run_command", {
        path: activeProject.path,
        cmd: cmd.cmd,
        cmdId: cmd.id
      });
      updateCommand(activeProject.id, cmd.id, { pid });
    } catch (e) {
      console.error(e);
      updateCommand(activeProject.id, cmd.id, { status: 'idle', pid: null });
    }
  };

  const handleStop = async (cmd: Command) => {
    if (cmd.status !== 'running' || !cmd.pid) return;
    
    try {
      await invoke("kill_command", { pid: cmd.pid });
      updateCommand(activeProject.id, cmd.id, { status: 'idle', pid: null });
    } catch (e) {
      console.error(e);
      updateCommand(activeProject.id, cmd.id, { status: 'idle', pid: null });
    }
  };

  const handleRestart = async (cmd: Command) => {
    if (cmd.status !== 'running' || !cmd.pid) return;
    
    try {
      await invoke("kill_command", { pid: cmd.pid });
    } catch (e) {
      console.error("Kill failed during restart", e);
    }
    
    updateCommand(activeProject.id, cmd.id, { status: 'idle', pid: null });
    
    // 给系统释放端口留出 600ms 余量，然后再重新执行
    setTimeout(async () => {
      try {
        updateCommand(activeProject.id, cmd.id, { status: 'running' });
        const pid = await invoke<number>("run_command", {
          path: activeProject.path,
          cmd: cmd.cmd,
          cmdId: cmd.id
        });
        updateCommand(activeProject.id, cmd.id, { pid });
      } catch (e) {
        console.error("Restart error", e);
        updateCommand(activeProject.id, cmd.id, { status: 'idle', pid: null });
      }
    }, 600);
  };

  const handleAddCustom = () => {
    const customLabel = prompt("Enter command name (e.g., Lint):", "new-command");
    if (!customLabel) return;
    const customCmd = prompt("Enter exact CLI command:", "npm run lint");
    if (!customCmd) return;

    addCommand(activeProject.id, customLabel, customCmd);
  };

  const handleEdit = (cmd: Command, e: React.MouseEvent) => {
    e.stopPropagation(); // 阻止冒泡
    const newLabel = prompt("Edit command name:", cmd.label);
    if (!newLabel) return;
    const newCmd = prompt("Edit exact CLI command:", cmd.cmd);
    if (!newCmd) return;

    updateCommand(activeProject.id, cmd.id, { label: newLabel, cmd: newCmd });
  };

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold text-slate-100 mb-6 flex items-center">
        <TerminalSquare className="mr-3 text-blue-500" />
        Console Commands
      </h2>

      <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
        {activeProject.commands.map(cmd => {
          const isRunning = cmd.status === 'running';

          return (
            <div 
              key={cmd.id} 
              className={`group relative p-5 rounded-2xl transition-all duration-300 flex flex-col min-h-[140px] ${
                isRunning 
                  ? 'bg-blue-600/10 border border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.2)]' 
                  : 'bg-slate-800/40 border border-slate-700/50 hover:border-blue-500/50 hover:bg-slate-800/60'
              }`}
            >
              {/* Header / Name */}
              <div className="flex justify-between items-start mb-auto">
                <span className="font-semibold text-slate-200 tracking-tight text-lg">
                  {cmd.label}
                </span>
                <div className="flex space-x-2">
                  <button 
                    onClick={(e) => handleEdit(cmd, e)}
                    className="text-slate-500 hover:text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Edit Configuration"
                  >
                    <Settings2 size={18} />
                  </button>
                  
                  {isRunning ? (
                    <>
                      <button 
                        onClick={() => handleRestart(cmd)}
                        className="flex items-center space-x-1.5 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-500 px-3 py-1.5 rounded-lg border border-yellow-500/20 font-medium text-sm transition-colors"
                        title="Restart"
                      >
                        <RefreshCw size={14} />
                        <span>Restart</span>
                      </button>
                      <button 
                        onClick={() => handleStop(cmd)}
                        className="flex items-center space-x-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 px-3 py-1.5 rounded-lg border border-red-500/20 font-medium text-sm transition-colors"
                        title="Stop"
                      >
                        <Square size={14} className="fill-current" />
                        <span>Stop</span>
                      </button>
                    </>
                  ) : (
                    <button 
                      onClick={() => handleRun(cmd)}
                      className="flex items-center space-x-1.5 bg-blue-600 text-white hover:bg-blue-500 px-3 py-1.5 rounded-lg border border-transparent font-medium text-sm transition-colors shadow-sm shadow-blue-500/30 group-hover:shadow-blue-500/50"
                      title="Run"
                    >
                      <Play size={14} className="fill-current" />
                      <span>Run</span>
                    </button>
                  )}
                </div>
              </div>
              
              {/* Cmd String */}
              <p className="font-mono text-xs text-slate-400 opacity-50 truncate mt-4 pt-4 border-t border-slate-700/50" title={cmd.cmd}>
                $ {cmd.cmd}
              </p>
            </div>
          );
        })}
        
        {/* ADD Custom Command */}
        <button 
          onClick={handleAddCustom}
          className="rounded-2xl border-2 border-dashed border-slate-700 bg-slate-800/20 flex flex-col items-center justify-center p-6 text-slate-500 hover:bg-slate-800/40 hover:border-blue-500/50 hover:text-blue-400 transition-all min-h-[140px] group"
        >
          <Plus size={28} className="mb-2 group-hover:scale-110 transition-transform" />
          <span className="font-medium text-sm tracking-wide">添加自定义命令</span>
        </button>
      </div>
    </div>
  );
};
