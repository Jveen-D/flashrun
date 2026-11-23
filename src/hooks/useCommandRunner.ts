import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';
import { getLastTerminalSize, requestTerminalFit } from '../utils/terminal';

const pendingStarts = new Map<string, Promise<number>>();
const pendingStops = new Map<string, Promise<void>>();
const manuallyStoppedPids = new Set<number>();
const commandKey = (projectId: string, commandId: string) => JSON.stringify([projectId, commandId]);

export function consumeManuallyStoppedPid(pid: number): boolean {
  if (!manuallyStoppedPids.has(pid)) {
    return false;
  }
  manuallyStoppedPids.delete(pid);
  return true;
}

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
      useStore.getState().markCommandStarted?.(projectId, commandId);
      updateCommand(projectId, commandId, { status: 'running', pid: null });

      const { rows, cols } = getLastTerminalSize();
      const pending = invoke<number>('run_command', {
        path: project.path,
        cmd: command.cmd,
        cmdId: command.id,
        projectId: project.id,
        projectName: project.name,
        commandLabel: command.label,
        rows,
        cols,
        ...(command.cwd ? { cwd: command.cwd } : {}),
        ...(command.env && Object.keys(command.env).length > 0 ? { envVars: command.env } : {}),
        ...(command.envFile ? { envFile: command.envFile } : {}),
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
        manuallyStoppedPids.add(pid);
        try {
          await invoke('kill_command', { pid });
        } catch (error) {
          manuallyStoppedPids.delete(pid);
          throw error;
        }
      }

      useStore.getState().markCommandExited?.(projectId, commandId, null);
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

  const stopProjectCommands = useCallback(async (projectId: string) => {
    const project = useStore.getState().projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }

    const targets = project.commands.filter((command) => (
      command.status === 'running'
      || command.pid !== null
      || pendingStarts.has(commandKey(projectId, command.id))
    ));
    if (!targets.length) {
      return;
    }

    const results = await Promise.allSettled(
      targets.map((command) => stopCommand(projectId, command.id)),
    );
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) {
      throw failed.reason;
    }
  }, [stopCommand]);

  const stopAllCommands = useCallback(async () => {
    const projects = useStore.getState().projects;
    const results = await Promise.allSettled(
      projects.map((project) => stopProjectCommands(project.id)),
    );
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) {
      throw failed.reason;
    }
  }, [stopProjectCommands]);

  const runLaunchGroup = useCallback(async (groupId: string) => {
    const group = useStore.getState().launchGroups.find((item) => item.id === groupId);
    if (!group || !group.items.length) {
      return 0;
    }

    let started = 0;
    const results = await Promise.allSettled(
      group.items.map(async (item) => {
        const { command } = resolveProjectCommand(item.projectId, item.commandId);
        if (!command || command.status === 'running') {
          return;
        }
        await runCommand(item.projectId, item.commandId);
        started += 1;
      }),
    );
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) {
      throw failed.reason;
    }
    return started;
  }, [runCommand]);

  const stopLaunchGroup = useCallback(async (groupId: string) => {
    const group = useStore.getState().launchGroups.find((item) => item.id === groupId);
    if (!group || !group.items.length) {
      return;
    }

    const results = await Promise.allSettled(
      group.items.map((item) => stopCommand(item.projectId, item.commandId)),
    );
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) {
      throw failed.reason;
    }
  }, [stopCommand]);

  return {
    runCommand,
    stopCommand,
    stopProjectCommands,
    stopAllCommands,
    restartCommand,
    runDefaultCommand,
    runLaunchGroup,
    stopLaunchGroup,
  };
}
