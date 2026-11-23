import { invoke } from '@tauri-apps/api/core';
import { confirm } from '@tauri-apps/plugin-dialog';
import { useStore } from '../store';
import { toast } from './toast';

interface PortProcess {
  pid: number;
  name: string;
}

interface PortTerminationResult {
  port: number;
  killedPids: number[];
}

export async function freeConflictingPortAndRestart(params: {
  projectId: string;
  commandId: string;
  port: number;
  restart: (projectId: string, commandId: string) => Promise<void>;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const { projectId, commandId, port, restart, t } = params;

  try {
    const expected = await invoke<PortProcess[]>('inspect_port', { port, protocol: 'tcp' });
    if (expected.length > 0) {
      const processList = expected.map((process) => `${process.name} (PID ${process.pid})`).join('\n');
      const approved = await confirm(
        t('{{protocol}} {{port}}\n{{processes}}\n\n终止这些进程？未保存的工作可能丢失。', {
          protocol: 'TCP',
          port,
          processes: processList,
        }),
        { title: t('释放端口'), kind: 'warning' },
      );
      if (!approved) {
        return;
      }

      const result = await invoke<PortTerminationResult>('terminate_port', {
        port,
        protocol: 'tcp',
        expected,
      });
      toast.success(
        t('端口 {{port}} 已终止 {{count}} 个进程。', { port, count: result.killedPids.length }),
      );
    } else {
      toast.info(t('端口 {{port}} 当前未被占用。', { port }));
    }

    useStore.getState().clearCommandPortConflict(projectId, commandId);
    await restart(projectId, commandId);
  } catch (error) {
    console.error('Failed to resolve port conflict:', error);
    toast.error(t('终止端口失败：{{error}}', { error: String(error) }));
  }
}
