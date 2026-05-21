/**
 * 纯逻辑单元测试：验证 tabs.ts 中 swapPaneData 的节点交换行为
 * 不依赖任何测试框架，直接用 Node.js 运行
 */

// ---- 复制 tabs.ts 的核心辅助函数 ----

function findLeaf(pane, id) {
  if (pane.kind === 'leaf') return pane.id === id ? pane : null;
  return findLeaf(pane.a, id) ?? findLeaf(pane.b, id);
}

function mapLeaf(pane, id, fn) {
  if (pane.kind === 'leaf') return pane.id === id ? fn(pane) : pane;
  return { ...pane, a: mapLeaf(pane.a, id, fn), b: mapLeaf(pane.b, id, fn) };
}

/** 复制当前 swapPaneData 的实现逻辑 */
function swapPaneData(tab, leafIdA, leafIdB) {
  const leafA = findLeaf(tab.root, leafIdA);
  const leafB = findLeaf(tab.root, leafIdB);
  if (!leafA || !leafB || leafA.kind !== 'leaf' || leafB.kind !== 'leaf') return tab;
  if (leafA.id === leafB.id) return tab;

  const PLACEHOLDER_ID = '\0swap\0';
  const placeholder = { ...leafA, id: PLACEHOLDER_ID };
  let root = mapLeaf(tab.root, leafIdA, () => placeholder);
  root = mapLeaf(root, leafIdB, () => leafA);
  root = mapLeaf(root, PLACEHOLDER_ID, () => leafB);

  let newActive = tab.activeLeafId;
  if (tab.activeLeafId === leafIdA) newActive = leafIdB;
  else if (tab.activeLeafId === leafIdB) newActive = leafIdA;

  return { ...tab, root, activeLeafId: newActive };
}

// ---- 测试工具 ----
let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

// ---- 构造测试数据 ----

function makeTab() {
  const leafA = { kind: 'leaf', id: 'leaf_A', type: 'terminal', sessionId: 'sess_A', cwd: '/home/A', title: 'A' };
  const leafB = { kind: 'leaf', id: 'leaf_B', type: 'terminal', sessionId: 'sess_B', cwd: '/home/B', title: 'B' };
  return {
    id: 'tab_1',
    label: 'test',
    activeLeafId: 'leaf_A',
    root: {
      kind: 'split',
      id: 'split_1',
      dir: 'h',
      ratio: 0.5,
      a: leafA,
      b: leafB,
    }
  };
}

// ---- 测试 1：基本交换 ——  A 和 B 在树中的位置应互换（id 也一起换） ----
console.log('\n测试 1：基本节点位置交换');
{
  const tab = makeTab();
  const result = swapPaneData(tab, 'leaf_A', 'leaf_B');

  // 交换后：split.a 应该是原来的 leafB（id='leaf_B'），split.b 是原来的 leafA（id='leaf_A'）
  assert(result.root.kind === 'split', '根节点仍为 split');
  assert(result.root.a.id === 'leaf_B', 'split.a 的 id 应为 leaf_B（原 B 移到 A 的位置）');
  assert(result.root.b.id === 'leaf_A', 'split.b 的 id 应为 leaf_A（原 A 移到 B 的位置）');
  assert(result.root.a.sessionId === 'sess_B', 'split.a 的 sessionId 仍为 sess_B');
  assert(result.root.b.sessionId === 'sess_A', 'split.b 的 sessionId 仍为 sess_A');
}

// ---- 测试 2：React key 确实发生了变化 ----
console.log('\n测试 2：验证 React key（pane.id）在对应位置确实改变');
{
  const tab = makeTab();
  const before_a_id = tab.root.a.id; // 'leaf_A'
  const before_b_id = tab.root.b.id; // 'leaf_B'
  const result = swapPaneData(tab, 'leaf_A', 'leaf_B');
  const after_a_id = result.root.a.id;
  const after_b_id = result.root.b.id;

  assert(before_a_id !== after_a_id, `split.a 的 key 改变了（${before_a_id} → ${after_a_id}）`);
  assert(before_b_id !== after_b_id, `split.b 的 key 改变了（${before_b_id} → ${after_b_id}）`);
  assert(after_a_id === 'leaf_B', 'split.a 位置现在是 leaf_B');
  assert(after_b_id === 'leaf_A', 'split.b 位置现在是 leaf_A');
}

// ---- 测试 3：activeLeafId 跟随内容移动 ----
console.log('\n测试 3：activeLeafId 跟随内容移动');
{
  // 激活 A，交换后应激活 B（因为原来 A 的内容现在在 B 的 id 下）
  const tab = makeTab(); // activeLeafId = 'leaf_A'
  const result = swapPaneData(tab, 'leaf_A', 'leaf_B');
  assert(result.activeLeafId === 'leaf_B', `activeLeafId 从 leaf_A 跟随到 leaf_B（当前=${result.activeLeafId}）`);

  // 反向：激活 B，交换后应激活 A
  const tab2 = { ...makeTab(), activeLeafId: 'leaf_B' };
  const result2 = swapPaneData(tab2, 'leaf_A', 'leaf_B');
  assert(result2.activeLeafId === 'leaf_A', `activeLeafId 从 leaf_B 跟随到 leaf_A（当前=${result2.activeLeafId}）`);

  // 非激活节点不受影响
  const leafC = { kind: 'leaf', id: 'leaf_C', type: 'terminal', sessionId: 'sess_C' };
  const tab3Root = {
    kind: 'split', id: 'split_root', dir: 'h', ratio: 0.5,
    a: { ...makeTab().root.a },
    b: { kind: 'split', id: 'split_inner', dir: 'v', ratio: 0.5,
         a: { ...makeTab().root.b },
         b: leafC }
  };
  const tab3 = { id: 'tab_3', label: 'test', activeLeafId: 'leaf_C', root: tab3Root };
  const result3 = swapPaneData(tab3, 'leaf_A', 'leaf_B');
  assert(result3.activeLeafId === 'leaf_C', '激活 leaf_C 时交换 A/B，activeLeafId 不变');
}

// ---- 测试 4：三层嵌套树中的交换 ----
console.log('\n测试 4：深层嵌套树');
{
  const leafA = { kind: 'leaf', id: 'leaf_A', type: 'terminal', sessionId: 'sess_A' };
  const leafB = { kind: 'leaf', id: 'leaf_B', type: 'terminal', sessionId: 'sess_B' };
  const leafC = { kind: 'leaf', id: 'leaf_C', type: 'terminal', sessionId: 'sess_C' };
  const root = {
    kind: 'split', id: 's1', dir: 'h', ratio: 0.5,
    a: leafA,
    b: {
      kind: 'split', id: 's2', dir: 'v', ratio: 0.5,
      a: leafB,
      b: leafC
    }
  };
  const tab = { id: 'tab_1', label: 'x', activeLeafId: 'leaf_A', root };

  // 交换 A（在左侧）和 C（嵌套在右侧内部的下方）
  const result = swapPaneData(tab, 'leaf_A', 'leaf_C');

  const newA_slot = findLeaf(result.root, 'leaf_C'); // C 移到了原来 A 的位置
  const newC_slot = findLeaf(result.root, 'leaf_A'); // A 移到了原来 C 的位置

  assert(result.root.a.id === 'leaf_C', '顶层 split.a 现在是 leaf_C');
  assert(result.root.b.b.id === 'leaf_A', '嵌套 split.b.b 现在是 leaf_A');
  assert(newA_slot !== null && newA_slot.sessionId === 'sess_C', 'leaf_C 位置的 sessionId 仍是 sess_C');
  assert(newC_slot !== null && newC_slot.sessionId === 'sess_A', 'leaf_A 位置的 sessionId 仍是 sess_A');
}

// ---- 测试 5：幂等性（交换两次等于没换）----
console.log('\n测试 5：幂等性（交换两次还原）');
{
  const tab = makeTab();
  const once = swapPaneData(tab, 'leaf_A', 'leaf_B');
  const twice = swapPaneData(once, 'leaf_A', 'leaf_B');

  assert(twice.root.a.id === tab.root.a.id, '二次交换后 split.a.id 还原');
  assert(twice.root.b.id === tab.root.b.id, '二次交换后 split.b.id 还原');
  assert(twice.activeLeafId === tab.activeLeafId, '二次交换后 activeLeafId 还原');
}

// ---- 测试 6：验证 placeholder 不会泄漏到最终树中 ----
console.log('\n测试 6：placeholder id 不泄漏');
{
  const tab = makeTab();
  const result = swapPaneData(tab, 'leaf_A', 'leaf_B');
  const PLACEHOLDER_ID = '\0swap\0';
  const leaked = findLeaf(result.root, PLACEHOLDER_ID);
  assert(leaked === null, 'placeholder id 在最终树中不存在');
}

// ---- 汇总 ----
console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
