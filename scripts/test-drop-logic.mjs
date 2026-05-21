/**
 * 测试 handleDrop 内部的条件逻辑
 * 验证哪些情况会导致 drop 被跳过
 */

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

// 模拟 handleDrop 的条件判断逻辑
function simulateDrop(src, targetPaneId, targetTabId) {
  // 对应: if (src.leafId === pane.id || src.tabId !== tab.id) return;
  if (src.leafId === targetPaneId) return 'BLOCKED_SELF_DROP';
  if (src.tabId !== targetTabId) return 'BLOCKED_CROSS_TAB';
  return 'SWAP_CALLED';
}

console.log('\n测试 handleDrop 条件逻辑');

// 正常跨面板 drop：应该触发 swap
{
  const result = simulateDrop(
    { leafId: 'leaf_A', tabId: 'tab_1' },
    'leaf_B',  // 目标 pane
    'tab_1'    // 目标 tab（同一个）
  );
  assert(result === 'SWAP_CALLED', `正常 drop A→B: ${result}`);
}

// 自己 drop 到自己：应该阻止
{
  const result = simulateDrop(
    { leafId: 'leaf_A', tabId: 'tab_1' },
    'leaf_A',  // 目标是自己
    'tab_1'
  );
  assert(result === 'BLOCKED_SELF_DROP', `自身 drop 阻止: ${result}`);
}

// 跨 tab drop：应该阻止
{
  const result = simulateDrop(
    { leafId: 'leaf_A', tabId: 'tab_1' },
    'leaf_B',
    'tab_2'    // 不同 tab
  );
  assert(result === 'BLOCKED_CROSS_TAB', `跨 tab drop 阻止: ${result}`);
}

// ---- 模拟 dataTransfer 数据丢失场景 ----
console.log('\n测试 dataTransfer 数据解析');

function simulateDropData(rawData) {
  if (!rawData) return 'NO_DATA';
  let src;
  try { src = JSON.parse(rawData); } catch { return 'PARSE_ERROR'; }
  return src;
}

{
  const data = JSON.stringify({ leafId: 'leaf_A', tabId: 'tab_1' });
  const result = simulateDropData(data);
  assert(typeof result === 'object' && result.leafId === 'leaf_A', `正常 JSON 解析: ${JSON.stringify(result)}`);
}

{
  const result = simulateDropData('');
  assert(result === 'NO_DATA', `空数据返回 NO_DATA: ${result}`);
}

{
  const result = simulateDropData(null);
  assert(result === 'NO_DATA', `null 数据返回 NO_DATA: ${result}`);
}

// ---- 模拟 hasLeafMime 检查 ----
console.log('\n测试 MIME 类型检查');

function hasLeafMime(types) {
  return types.includes('application/x-wt-leaf-data')
    || types.contains?.('application/x-wt-leaf-data');
}

{
  const types = ['application/x-wt-leaf-data'];
  assert(hasLeafMime(types) === true, 'Array 包含 leaf mime');
}

{
  // 模拟 Safari DataTransferItemList（不是真正数组，只有 contains 方法）
  const safariTypes = {
    includes: () => false,
    contains: (s) => s === 'application/x-wt-leaf-data'
  };
  assert(hasLeafMime(safariTypes) === true, 'Safari-style types 包含 leaf mime');
}

{
  const types = ['text/plain'];
  assert(hasLeafMime(types) !== true, '不含 leaf mime 时返回 falsy');
}

// ---- 关键：验证事件捕获顺序问题 ----
// dragstart 时 setIsDragging(true) + paneDragStart() 是同步的
// 但 React 的状态更新是批量异步的
// anyPaneDragActive 的更新依赖 useSyncExternalStore
// 而 _paneDragCount 的变化是同步的

console.log('\n测试 paneDrag 计数器逻辑（同步）');

let _paneDragCount = 0;
function paneDragStart() { _paneDragCount++; }
function paneDragEnd() { _paneDragCount = Math.max(0, _paneDragCount - 1); }

paneDragStart();
assert(_paneDragCount === 1, `paneDragStart 后 count=1: ${_paneDragCount}`);
paneDragEnd();
assert(_paneDragCount === 0, `paneDragEnd 后 count=0: ${_paneDragCount}`);
paneDragEnd(); // 多余的 end 不应该让 count 变负
assert(_paneDragCount === 0, `多余 paneDragEnd 后 count 仍为 0: ${_paneDragCount}`);

// ---- 关键发现：useSyncExternalStore 在 dragstart 中是同步的 ----
// 但 React 批处理下，setIsDragging(true) 可能延迟渲染
// overlay 出现前 dragover 已经到了目标 pane
// 分析：dragstart 触发时，paneDragStart() 同步更新 _paneDragCount
//        useSyncExternalStore 会在下一个 React 渲染周期同步读取
//        问题：React 18 concurrent mode 可能会延迟这个渲染
//        但即便 overlay 没出现，pane-drag-wrapper 本身也有 onDragOver 和 onDrop
//        只要 dragover 事件能到达 wrapper div，drop 就能工作

console.log('\n最终验证：基于 tab 引用同一性的 drop 条件');
// 当 handleDrop 在 overlay 上触发时，它闭包里的 pane 和 tab 是 overlay 所在的那个 PaneDragWrapper 实例的
// 这是正确的——overlay 是 non-source pane 的 wrapper 内的

// 验证：如果拖 leaf_A 到含 leaf_B 的 wrapper 的 overlay 上
// overlay 的 handleDrop 捕获的是 leaf_B 的 pane 和 tab
{
  const sourcePaneId = 'leaf_A';
  const sourceTabId = 'tab_1';
  const overlayPaneId = 'leaf_B';  // overlay 所在 wrapper 的 pane.id
  const overlayTabId = 'tab_1';    // overlay 所在 wrapper 的 tab.id

  const result = simulateDrop(
    { leafId: sourcePaneId, tabId: sourceTabId },
    overlayPaneId,
    overlayTabId
  );
  assert(result === 'SWAP_CALLED', `overlay drop 触发 swap: ${result}`);
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
