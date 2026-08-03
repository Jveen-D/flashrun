import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';
import { requestTerminalFit } from '../utils/terminal';

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
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { command } = resolveProjectCommand(projectId, commandId);
    if (!command || command.status !== 'running') {
      return null;
    }
    if (command.pid) {
      return command.pid;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }

  return resolveProjectCommand(projectId, commandId).command?.pid ?? null;
}

export function useCommandRunner() {
  const updateCommand = useStore((state) => state.updateCommand);
  const setActiveProject = useStore((state) => state.setActiveProject);
  const setTerminalOpen = useStore((state) => state.setTerminalOpen);
  const setProjectActiveCommand = useStore((state) => state.setProjectActiveCommand);
  const syncProjectActiveCommand = useStore((state) => state.syncProjectActiveCommand);

  const runCommand = useCallback(async (projectId: string, commandId: string) => {
    const { project, command } = resolveProjectCommand(projectId, commandId);
    if (!project || !command || command.status === 'running') {
      return;
    }

    try {
      setActiveProject(projectId);
      setTerminalOpen(true);
      setProjectActiveCommand(projectId, commandId);
      updateCommand(projectId, commandId, { status: 'running' });

      const pid = await invoke<number>('run_command', {
        path: project.path,
        cmd: command.cmd,
        cmdId: command.id,
        projectId: project.id,
        projectName: project.name,
        commandLabel: command.label,
      });

      const latestCommand = resolveProjectCommand(projectId, commandId).command;
      if (latestCommand?.status === 'running') {
        updateCommand(projectId, commandId, { pid });
      }
      requestTerminalFit();
    } catch (error) {
      updateCommand(projectId, commandId, { status: 'idle', pid: null });
      syncProjectActiveCommand(projectId);
      throw error;
    }
  }, [setActiveProject, setProjectActiveCommand, setTerminalOpen, syncProjectActiveCommand, updateCommand]);

  const stopCommand = useCallback(async (projectId: string, commandId: string) => {
    const { command } = resolveProjectCommand(projectId, commandId);
    if (!command) {
      return;
    }

    const pid = command.pid ?? await waitForCommandPid(projectId, commandId);
    if (pid) {
      await invoke('kill_command', { pid });
    }

    updateCommand(projectId, commandId, { status: 'idle', pid: null });
    syncProjectActiveCommand(projectId);
  }, [syncProjectActiveCommand, updateCommand]);

  const restartCommand = useCallback(async (projectId: string, commandId: string) => {
    const { command } = resolveProjectCommand(projectId, commandId);
    if (!command) {
      return;
    }

    const pid = command.pid ?? await waitForCommandPid(projectId, commandId);
    if (pid) {
      await invoke('kill_command', { pid });
    }

    updateCommand(projectId, commandId, { status: 'idle', pid: null });
    syncProjectActiveCommand(projectId);

    await new Promise((resolve) => window.setTimeout(resolve, 600));
    await runCommand(projectId, commandId);
  }, [runCommand, syncProjectActiveCommand, updateCommand]);

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
