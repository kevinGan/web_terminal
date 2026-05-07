import { useEffect } from 'react';
import { useClaudeCommandsStore } from '../store/claudeCommands';
import { useLayoutStore } from '../store/layout';
import { CommandPicker } from './CommandPicker';

interface Props { onClose: () => void; }

export function ClaudeCommandPicker({ onClose }: Props) {
  const list = useClaudeCommandsStore((s) => s.list);
  const loaded = useClaudeCommandsStore((s) => s.loaded);
  const load = useClaudeCommandsStore((s) => s.load);
  const selectPanel = useLayoutStore((s) => s.selectPanel);

  useEffect(() => { if (!loaded) load(); }, [loaded, load]);

  return (
    <CommandPicker
      title="选择指令"
      items={list}
      empty="没有保存的指令。点 ⚙ 添加。"
      onClose={onClose}
      onManage={() => { selectPanel('settings'); onClose(); }}
    />
  );
}
