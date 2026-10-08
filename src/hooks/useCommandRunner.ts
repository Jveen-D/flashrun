import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';
import { requestTerminalFit } from '../utils/terminal';

const pendingStarts = new Map<string, Promise<number>>();
const pendingStops = new Map<string, Promise<void>>();
const commandKey = (projectId: string, commandId: string) => JSON.stringify([projectId, commandId]);

function resolveProjectCommand(projectId: string, commandId: string) {
  const state = useStore.getState();
  const project = state.projects.find((item) => item.id === projectId);
  const command = project?.commands.find((item) => item.id === commandId);

  return {
    project,
    command,
  };
}

async function waitForCommandPid(projectId: string, commandId: string) {
  const pending = pendingStarts.get(commandKey(projectId, commandId));
  if (pending) return pending.catch(() => null);
  return resolveProjectCommand(projectId, commandId).command?.pid ?? null;
}

export function useCommandRunner() {
  const updateCommand = useStore((state) => state.updateCommand);
  const setActiveProject = useStore((state) => state.setActiveProject);
  const setTerminalOpen = useStore((state) => state.setTerminalOpen);
  const setProjectActiveCommand = useStore((state) => state.setProjectActiveCommand);
  const syncProjectActiveCommand = useStore((state) => state.syncProjectActiveCommand);

  const runCommand = useCallback(async (projectId: string, commandId: string) => {
    const key = commandKey(projectId, commandId);
    if (pendingStarts.has(key) || pendingStops.has(key)) return;
    const { project, command } = resolveProjectCommand(projectId, commandId);
    if (!project || !command || command.status === 'running') {
      return;
    }

    try {
      setActiveProject(projectId);
      setTerminalOpen(true);
      setProjectActiveCommand(projectId, commandId);
      updateCommand(projectId, commandId, { status: 'running', pid: null });

      const pending = invoke<number>('run_command', {
        path: project.path,
        cmd: command.cmd,
        cmdId: command.id,
        projectId: project.id,
        projectName: project.name,
        commandLabel: command.label,
      });
      pendingStarts.set(key, pending);
      const pid = await pending;

      const latestCommand = resolveProjectCommand(projectId, commandId).command;
      if (!latestCommand) {
        await invoke('kill_command', { pid });
        return;
      }
      if (latestCommand?.status === 'running') {
        updateCommand(projectId, commandId, { pid });
      }
      requestTerminalFit();
    } catch (error) {
      updateCommand(projectId, commandId, { status: 'idle', pid: null });
      syncProjectActiveCommand(projectId);
      throw error;
    } finally {
      pendingStarts.delete(key);
    }
  }, [setActiveProject, setProjectActiveCommand, setTerminalOpen, syncProjectActiveCommand, updateCommand]);

  const stopCommand = useCallback(async (projectId: string, commandId: string) => {
    const key = commandKey(projectId, commandId);
    const existing = pendingStops.get(key);
    if (existing) return existing;
    const { command } = resolveProjectCommand(projectId, commandId);
    if (!command) {
      return;
    }

    const pending = (async () => {
      const pid = command.pid ?? await waitForCommandPid(projectId, commandId);
      if (pid) {
        await invoke('kill_command', { pid });
      }

      updateCommand(projectId, commandId, { status: 'idle', pid: null });
      syncProjectActiveCommand(projectId);
    })();
    pendingStops.set(key, pending);
    try { await pending; } finally { pendingStops.delete(key); }
  }, [syncProjectActiveCommand, updateCommand]);

  const restartCommand = useCallback(async (projectId: string, commandId: string) => {
    const { command } = resolveProjectCommand(projectId, commandId);
    if (!command) {
      return;
    }

    await stopCommand(projectId, commandId);
    await runCommand(projectId, commandId);
  }, [runCommand, stopCommand]);

  const runDefaultCommand = useCallback(async (projectId: string) => {
    const project = useStore.getState().projects.find((item) => item.id === projectId);
    const targetCommand = project?.commands.find((command) => command.isDefault);

    if (!project || !targetCommand) {
      return false;
    }

    await runCommand(projectId, targetCommand.id);
    return true;
  }, [runCommand]);

  return {
    runCommand,
    stopCommand,
    restartCommand,
    runDefaultCommand,
  };
}
