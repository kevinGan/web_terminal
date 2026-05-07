import { CommandPicker, type CmdItem } from './CommandPicker';

const GIT_CMDS: CmdItem[] = [
  { id: 'git-pull',  label: 'git pull',         command: 'git pull',         autoSubmit: true },
  { id: 'git-stat',  label: 'git status',       command: 'git status',       autoSubmit: true },
  { id: 'git-push',  label: 'git push',         command: 'git push',         autoSubmit: true },
  // Destructive — type into prompt but don't auto-submit. User confirms by pressing Enter.
  { id: 'git-rst',   label: 'git reset --hard', command: 'git reset --hard', autoSubmit: false }
];

interface Props { onClose: () => void; }

export function GitCommandPicker({ onClose }: Props) {
  return (
    <CommandPicker
      title="Git 指令"
      items={GIT_CMDS}
      onClose={onClose}
    />
  );
}
