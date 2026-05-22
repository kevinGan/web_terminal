/**
 * test-merge-split.mjs
 * 验证 mergeTabAsSplit / splitLeafWithPane / moveLeafToSplit store 逻辑。
 * 纯 JS，不依赖浏览器环境。
 * 运行: node scripts/test-merge-split.mjs
 */

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// ---- 辅助函数（与 tabs.ts 同构） ----

function findLeaf(pane, id) {
  if (pane.kind === 'leaf') return pane.id === id ? pane : null;
  return findLeaf(pane.a, id) ?? findLeaf(pane.b, id);
}

function mapLeaf(pane, id, fn) {
  if (pane.kind === 'leaf') return pane.id === id ? fn(pane) : pane;
  return { ...pane, a: mapLeaf(pane.a, id, fn), b: mapLeaf(pane.b, id, fn) };
}

function removeLeaf(pane, id) {
  if (pane.kind === 'leaf') return pane.id === id ? null : pane;
  const a = removeLeaf(pane.a, id);
  const b = removeLeaf(pane.b, id);
  if (a == null && b == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  return { ...pane, a, b };
}

function firstLeaf(pane) {
  if (pane.kind === 'leaf') return pane;
  return firstLeaf(pane.a);
}

function countLeaves(pane) {
  if (pane.kind === 'leaf') return 1;
  return countLeaves(pane.a) + countLeaves(pane.b);
}

// ---- mergeTabAsSplit 模拟 ----

function mergeTabAsSplit(state, targetTabId, sourceTabId, edge) {
  if (targetTabId === sourceTabId) return state;
  const targetTab = state.tabs.find(t => t.id === targetTabId);
  const sourceTab = state.tabs.find(t => t.id === sourceTabId);
  if (!targetTab || !sourceTab) return state;

  const sourcePane = sourceTab.root;
  const dir = (edge === 'left' || edge === 'right') ? 'h' : 'v';
  const sourceFirst = (edge === 'left' || edge === 'top');
  const splitId = 'split_new';
  const root = mapLeaf(targetTab.root, targetTab.activeLeafId, leaf => ({
    kind: 'split',
    id: splitId,
    dir,
    ratio: 0.5,
    a: sourceFirst ? sourcePane : leaf,
    b: sourceFirst ? leaf : sourcePane,
  }));

  const tabs = state.tabs.filter(t => t.id !== sourceTabId);
  return {
    ...state,
    tabs: tabs.map(t => t.id === targetTabId
      ? { ...t, root, activeLeafId: firstLeaf(sourcePane).id }
      : t
    ),
  };
}

// ---- splitLeafWithPane 模拟 ----

function splitLeafWithPane(state, targetTabId, targetLeafId, sourcePane, edge) {
  const tab = state.tabs.find(t => t.id === targetTabId);
  if (!tab || !findLeaf(tab.root, targetLeafId)) return state;

  const dir = (edge === 'left' || edge === 'right') ? 'h' : 'v';
  const sourceFirst = (edge === 'left' || edge === 'top');
  const splitId = 'split_new';
  const root = mapLeaf(tab.root, targetLeafId, leaf => ({
    kind: 'split',
    id: splitId,
    dir,
    ratio: 0.5,
    a: sourceFirst ? sourcePane : leaf,
    b: sourceFirst ? leaf : sourcePane,
  }));

  return {
    ...state,
    tabs: state.tabs.map(t => t.id === targetTabId
      ? { ...t, root, activeLeafId: firstLeaf(sourcePane).id }
      : t
    ),
  };
}

// ---- moveLeafToSplit 模拟 ----

function moveLeafToSplit(state, tabId, sourceLeafId, targetLeafId, edge) {
  const tab = state.tabs.find(t => t.id === tabId);
  if (!tab || sourceLeafId === targetLeafId) return state;
  const sourceLeaf = findLeaf(tab.root, sourceLeafId);
  if (!sourceLeaf) return state;

  const rootAfterRemove = removeLeaf(tab.root, sourceLeafId);
  if (!rootAfterRemove) return state;
  if (!findLeaf(rootAfterRemove, targetLeafId)) return state;

  const dir = (edge === 'left' || edge === 'right') ? 'h' : 'v';
  const sourceFirst = (edge === 'left' || edge === 'top');
  const splitId = 'split_new';
  const root = mapLeaf(rootAfterRemove, targetLeafId, leaf => ({
    kind: 'split',
    id: splitId,
    dir,
    ratio: 0.5,
    a: sourceFirst ? sourceLeaf : leaf,
    b: sourceFirst ? leaf : sourceLeaf,
  }));

  return {
    ...state,
    tabs: state.tabs.map(t => t.id === tabId
      ? { ...t, root, activeLeafId: firstLeaf(sourceLeaf).id }
      : t
    ),
  };
}

// ---- detectEdge 模拟 ----

function detectEdge(rect, clientX, clientY) {
  const relX = (clientX - rect.left) / rect.width;
  const relY = (clientY - rect.top) / rect.height;
  const T = 0.3;
  const dLeft = relX, dRight = 1 - relX, dTop = relY, dBottom = 1 - relY;
  const minD = Math.min(dLeft, dRight, dTop, dBottom);
  if (minD > T) return 'center';
  if (dLeft === minD) return 'left';
  if (dRight === minD) return 'right';
  if (dTop === minD) return 'top';
  return 'bottom';
}

// ---- 测试用例 ----

const leaf1 = { kind: 'leaf', id: 'leaf-1', type: 'terminal', sessionId: 'sess-1', cwd: '/home' };
const leaf2 = { kind: 'leaf', id: 'leaf-2', type: 'terminal', sessionId: 'sess-2', cwd: '/tmp' };
const leaf3 = { kind: 'leaf', id: 'leaf-3', type: 'terminal', sessionId: 'sess-3' };
const split1 = { kind: 'split', id: 'split-1', dir: 'h', ratio: 0.5, a: leaf1, b: leaf2 };

console.log('\n=== mergeTabAsSplit ===');

{
  // 两个单 leaf tab 合并到右侧
  const tabA = { id: 'tab-A', label: 'A', root: leaf1, activeLeafId: 'leaf-1' };
  const tabB = { id: 'tab-B', label: 'B', root: leaf2, activeLeafId: 'leaf-2' };
  const state = { tabs: [tabA, tabB], activeTabId: 'tab-B' };

  const result = mergeTabAsSplit(state, 'tab-B', 'tab-A', 'right');
  assert(result.tabs.length === 1, '合并后只剩 1 个 tab');
  assert(result.tabs[0].id === 'tab-B', '保留的是 target tab');

  const root = result.tabs[0].root;
  assert(root.kind === 'split', 'root 变成 split');
  assert(root.dir === 'h', 'right → 水平分屏');
  assert(root.a.id === 'leaf-2', 'a = targetLeaf (原有)');
  assert(root.b.id === 'leaf-1', 'b = sourcePane (新来)');
  assert(result.tabs[0].activeLeafId === 'leaf-1', 'activeLeafId 指向新面板');
}

{
  // 合并到左侧
  const tabA = { id: 'tab-A', label: 'A', root: leaf1, activeLeafId: 'leaf-1' };
  const tabB = { id: 'tab-B', label: 'B', root: leaf2, activeLeafId: 'leaf-2' };
  const state = { tabs: [tabA, tabB], activeTabId: 'tab-B' };

  const result = mergeTabAsSplit(state, 'tab-B', 'tab-A', 'left');
  const root = result.tabs[0].root;
  assert(root.kind === 'split', 'left → root 变成 split');
  assert(root.dir === 'h', 'left → 水平分屏');
  assert(root.a.id === 'leaf-1', 'a = sourcePane (左边新来)');
  assert(root.b.id === 'leaf-2', 'b = targetLeaf (右边原有)');
}

{
  // 合并到顶部
  const tabA = { id: 'tab-A', label: 'A', root: leaf1, activeLeafId: 'leaf-1' };
  const tabB = { id: 'tab-B', label: 'B', root: leaf2, activeLeafId: 'leaf-2' };
  const state = { tabs: [tabA, tabB], activeTabId: 'tab-B' };

  const result = mergeTabAsSplit(state, 'tab-B', 'tab-A', 'top');
  const root = result.tabs[0].root;
  assert(root.dir === 'v', 'top → 垂直分屏');
  assert(root.a.id === 'leaf-1', 'a = sourcePane (上面新来)');
  assert(root.b.id === 'leaf-2', 'b = targetLeaf (下面原有)');
}

{
  // 合并到底部
  const tabA = { id: 'tab-A', label: 'A', root: leaf1, activeLeafId: 'leaf-1' };
  const tabB = { id: 'tab-B', label: 'B', root: leaf2, activeLeafId: 'leaf-2' };
  const state = { tabs: [tabA, tabB], activeTabId: 'tab-B' };

  const result = mergeTabAsSplit(state, 'tab-B', 'tab-A', 'bottom');
  const root = result.tabs[0].root;
  assert(root.dir === 'v', 'bottom → 垂直分屏');
  assert(root.a.id === 'leaf-2', 'a = targetLeaf (上面原有)');
  assert(root.b.id === 'leaf-1', 'b = sourcePane (下面新来)');
}

{
  // 合并到自己 → 不变
  const tabA = { id: 'tab-A', label: 'A', root: leaf1, activeLeafId: 'leaf-1' };
  const state = { tabs: [tabA], activeTabId: 'tab-A' };
  const result = mergeTabAsSplit(state, 'tab-A', 'tab-A', 'right');
  assert(result === state, '合并到自己 → 状态不变');
}

{
  // 多 leaf tab 合并（保留内部 split 结构）
  const tabA = { id: 'tab-A', label: 'A', root: split1, activeLeafId: 'leaf-1' };
  const tabB = { id: 'tab-B', label: 'B', root: leaf3, activeLeafId: 'leaf-3' };
  const state = { tabs: [tabA, tabB], activeTabId: 'tab-B' };

  const result = mergeTabAsSplit(state, 'tab-B', 'tab-A', 'right');
  const root = result.tabs[0].root;
  assert(root.kind === 'split', '外层是 split');
  assert(root.b.kind === 'split' && root.b.id === 'split-1', 'source 的 split 结构保留');
  assert(countLeaves(root) === 3, '合并后 3 个 leaf');
}

console.log('\n=== splitLeafWithPane ===');

{
  // 在目标 leaf 位置插入分屏
  const tab = { id: 'tab-1', label: 'T', root: leaf1, activeLeafId: 'leaf-1' };
  const state = { tabs: [tab], activeTabId: 'tab-1' };

  const result = splitLeafWithPane(state, 'tab-1', 'leaf-1', leaf2, 'right');
  const root = result.tabs[0].root;
  assert(root.kind === 'split', 'root 变成 split');
  assert(root.a.id === 'leaf-1', 'a = 原有 targetLeaf');
  assert(root.b.id === 'leaf-2', 'b = 插入的 sourcePane');
  assert(result.tabs[0].activeLeafId === 'leaf-2', '焦点给新面板');
}

{
  // 不存在的 targetLeafId → 不变
  const tab = { id: 'tab-1', label: 'T', root: leaf1, activeLeafId: 'leaf-1' };
  const state = { tabs: [tab], activeTabId: 'tab-1' };
  const result = splitLeafWithPane(state, 'tab-1', 'leaf-x', leaf2, 'right');
  assert(result === state, '不存在的 targetLeafId → 不变');
}

console.log('\n=== moveLeafToSplit ===');

{
  // 同 tab 内：将 sourceLeaf 移到 targetLeaf 位置分屏
  const tab = { id: 'tab-1', label: 'T', root: split1, activeLeafId: 'leaf-1' };
  const state = { tabs: [tab], activeTabId: 'tab-1' };

  const result = moveLeafToSplit(state, 'tab-1', 'leaf-1', 'leaf-2', 'right');
  const root = result.tabs[0].root;
  // leaf-1 被移除后 root 变成 leaf-2，然后 leaf-2 被替换为 split{leaf-2, leaf-1}
  assert(result.tabs[0].root.kind === 'split', '最终 root 是 split');
  assert(result.tabs[0].root.a.id === 'leaf-2', 'a = targetLeaf');
  assert(result.tabs[0].root.b.id === 'leaf-1', 'b = sourceLeaf (移过来的)');
}

{
  // 同一个 leaf → 不变
  const tab = { id: 'tab-1', label: 'T', root: leaf1, activeLeafId: 'leaf-1' };
  const state = { tabs: [tab], activeTabId: 'tab-1' };
  const result = moveLeafToSplit(state, 'tab-1', 'leaf-1', 'leaf-1', 'right');
  assert(result === state, '同一 leaf → 不变');
}

{
  // 不存在的 sourceLeafId → 不变
  const tab = { id: 'tab-1', label: 'T', root: split1, activeLeafId: 'leaf-1' };
  const state = { tabs: [tab], activeTabId: 'tab-1' };
  const result = moveLeafToSplit(state, 'tab-1', 'leaf-x', 'leaf-2', 'right');
  assert(result === state, '不存在的 sourceLeafId → 不变');
}

console.log('\n=== detectEdge ===');

{
  const rect = { left: 0, top: 0, width: 1000, height: 800 };

  assert(detectEdge(rect, 100, 400) === 'left', 'x=100 → left');
  assert(detectEdge(rect, 900, 400) === 'right', 'x=900 → right');
  assert(detectEdge(rect, 500, 100) === 'top', 'y=100 → top');
  assert(detectEdge(rect, 500, 700) === 'bottom', 'y=700 → bottom');
  assert(detectEdge(rect, 500, 400) === 'center', '中心 → center');

  // 边界值
  assert(detectEdge(rect, 300, 400) === 'left', 'x=300 (30%) → left (等于阈值不算 center)');
  assert(detectEdge(rect, 299, 400) === 'left', 'x=299 → left (刚过阈值)');
  assert(detectEdge(rect, 700, 400) === 'center', 'x=700 (70%) → center');
  assert(detectEdge(rect, 701, 400) === 'right', 'x=701 → right');
}

{
  // 角落：取最近边缘
  const rect = { left: 0, top: 0, width: 1000, height: 1000 };
  assert(detectEdge(rect, 50, 200) === 'left', '左上偏左 → left');
  assert(detectEdge(rect, 200, 50) === 'top', '左上偏上 → top');
}

console.log('\n=== 综合场景 ===');

{
  // 三个 Tab，Tab A 合并到 Tab B 的左侧
  const tabA = { id: 'tab-A', label: 'A', root: leaf1, activeLeafId: 'leaf-1' };
  const tabB = { id: 'tab-B', label: 'B', root: leaf2, activeLeafId: 'leaf-2' };
  const tabC = { id: 'tab-C', label: 'C', root: leaf3, activeLeafId: 'leaf-3' };
  const state = { tabs: [tabA, tabB, tabC], activeTabId: 'tab-B' };

  const result = mergeTabAsSplit(state, 'tab-B', 'tab-A', 'left');
  assert(result.tabs.length === 2, '合并后 2 个 tab');
  assert(result.tabs.find(t => t.id === 'tab-A') === undefined, 'tab-A 被移除');
  assert(result.tabs.find(t => t.id === 'tab-C') !== undefined, 'tab-C 保留');

  const tabBRoot = result.tabs.find(t => t.id === 'tab-B').root;
  assert(tabBRoot.kind === 'split' && tabBRoot.a.id === 'leaf-1', '左侧是 tab-A 的内容');
}

// ---- 汇总 ----
console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);{
  const rect = { left: 0, top: 0, width: 1000, height: 800 };

  assert(detectEdge(rect, 100, 400) === 'left', 'x=100 → left');
  assert(detectEdge(rect, 900, 400) === 'right', 'x=900 → right');
  assert(detectEdge(rect, 500, 100) === 'top', 'y=100 → top');
  assert(detectEdge(rect, 500, 700) === 'bottom', 'y=700 → bottom');
  assert(detectEdge(rect, 500, 400) === 'center', '中心 → center');

  // 边界值
  assert(detectEdge(rect, 300, 400) === 'left', 'x=300 (30%) → left (等于阈值不算 center)');
  assert(detectEdge(rect, 299, 400) === 'left', 'x=299 → left (刚过阈值)');
  assert(detectEdge(rect, 700, 400) === 'center', 'x=700 (70%) → center');
  assert(detectEdge(rect, 701, 400) === 'right', 'x=701 → right');
}

{
  // 角落：取最近边缘
  const rect = { left: 0, top: 0, width: 1000, height: 1000 };
  assert(detectEdge(rect, 50, 200) === 'left', '左上偏左 → left');
  assert(detectEdge(rect, 200, 50) === 'top', '左上偏上 → top');
}

console.log('\n=== 综合场景 ===');

{
  // 三个 Tab，Tab A 合并到 Tab B 的左侧
  const tabA = { id: 'tab-A', label: 'A', root: leaf1, activeLeafId: 'leaf-1' };
  const tabB = { id: 'tab-B', label: 'B', root: leaf2, activeLeafId: 'leaf-2' };
  const tabC = { id: 'tab-C', label: 'C', root: leaf3, activeLeafId: 'leaf-3' };
  const state = { tabs: [tabA, tabB, tabC], activeTabId: 'tab-B' };

  const result = mergeTabAsSplit(state, 'tab-B', 'tab-A', 'left');
  assert(result.tabs.length === 2, '合并后 2 个 tab');
  assert(result.tabs.find(t => t.id === 'tab-A') === undefined, 'tab-A 被移除');
  assert(result.tabs.find(t => t.id === 'tab-C') !== undefined, 'tab-C 保留');

  const tabBRoot = result.tabs.find(t => t.id === 'tab-B').root;
  assert(tabBRoot.kind === 'split' && tabBRoot.a.id === 'leaf-1', '左侧是 tab-A 的内容');
}

// ---- 汇总 ----
console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
