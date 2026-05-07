import { useTabsStore, countLeaves } from '../store/tabs';

interface Props {
  tabId: string;
  leafId: string;
}

/**
 * Renders a small × in the top-right of a pane that closes only that pane,
 * leaving siblings intact. Hidden when the tab has only one leaf — in that
 * case the pane *is* the tab, so users should use the tab close button.
 */
export function PaneCloseButton({ tabId, leafId }: Props) {
  const tab = useTabsStore((s) => s.tabs.find((t) => t.id === tabId));
  const closeLeaf = useTabsStore((s) => s.closeLeaf);
  if (!tab) return null;
  const leafCount = countLeaves(tab.root);
  if (leafCount < 2) return null;
  return (
    <button
      className="pane-close"
      title="关闭此分屏"
      aria-label="close pane"
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        closeLeaf(tabId, leafId);
      }}
    >×</button>
  );
}
