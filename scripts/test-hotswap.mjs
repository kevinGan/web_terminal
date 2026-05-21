/**
 * test-hotswap.mjs
 * 验证 usePTY 热切换触发逻辑的核心过滤条件（纯 JS，无需浏览器环境）。
 * 运行: node scripts/test-hotswap.mjs
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

// ---- 模拟核心过滤逻辑 ----
// 对应 usePTY subscribe 回调中的判断
function shouldHotSwap({ newSid, selfSessionRef, sessionIdRef, connRef }) {
  if (!newSid) return false;                       // 尚未分配 sessionId
  if (newSid === selfSessionRef.current) return false; // 自身 ready 写入
  if (newSid === sessionIdRef.current) return false;   // 无变化
  if (!connRef.current) return false;              // effect 已卸载
  return true;
}

// ---- 模拟 findLeafInState ----
function findLeafInState(tabs, leafId) {
  function findLeaf(pane, id) {
    if (pane.kind === 'leaf') return pane.id === id ? pane : null;
    if (pane.kind === 'split') return findLeaf(pane.a, id) ?? findLeaf(pane.b, id);
    return null;
  }
  for (const t of tabs) {
    const found = findLeaf(t.root, leafId);
    if (found) return found;
  }
  return null;
}

// ---- 测试用例 ----

console.log('\n=== shouldHotSwap 过滤逻辑 ===');

{
  // 正常热切换：外部 swap 改了 sessionId
  const result = shouldHotSwap({
    newSid: 'session-B',
    selfSessionRef: { current: 'session-A' },
    sessionIdRef: { current: 'session-A' },
    connRef: { current: {} }
  });
  assert(result === true, '外部 swap → 应触发热切换');
}

{
  // 自身 ready 写入：selfSessionRef 已更新
  const result = shouldHotSwap({
    newSid: 'session-A',
    selfSessionRef: { current: 'session-A' },
    sessionIdRef: { current: 'session-A' },
    connRef: { current: {} }
  });
  assert(result === false, '自身 ready 写入（newSid === selfSessionRef）→ 不触发');
}

{
  // sessionIdRef 已是最新（subscribe 触发两次同一值）
  const result = shouldHotSwap({
    newSid: 'session-B',
    selfSessionRef: { current: 'session-A' },
    sessionIdRef: { current: 'session-B' },
    connRef: { current: {} }
  });
  assert(result === false, '重复触发（newSid === sessionIdRef）→ 不触发');
}

{
  // effect 已卸载
  const result = shouldHotSwap({
    newSid: 'session-B',
    selfSessionRef: { current: 'session-A' },
    sessionIdRef: { current: 'session-A' },
    connRef: { current: null }
  });
  assert(result === false, 'connRef.current = null（已卸载）→ 不触发');
}

{
  // sessionId 尚未分配
  const result = shouldHotSwap({
    newSid: undefined,
    selfSessionRef: { current: undefined },
    sessionIdRef: { current: undefined },
    connRef: { current: {} }
  });
  assert(result === false, 'sessionId 未分配 → 不触发');
}

{
  // 热切换中间状态：selfSessionRef 已预先更新为 newSid，防止重入
  const result = shouldHotSwap({
    newSid: 'session-B',
    selfSessionRef: { current: 'session-B' }, // 热切换时预先设置
    sessionIdRef: { current: 'session-A' },
    connRef: { current: {} }
  });
  assert(result === false, 'selfSessionRef 预先标记（防重入）→ 不触发');
}

console.log('\n=== findLeafInState ===');

{
  const tabs = [
    {
      id: 'tab1',
      root: {
        kind: 'split', id: 'split1', dir: 'h', ratio: 0.5,
        a: { kind: 'leaf', id: 'leaf-A', type: 'terminal', sessionId: 'sess-A' },
        b: { kind: 'leaf', id: 'leaf-B', type: 'terminal', sessionId: 'sess-B' }
      }
    }
  ];

  const leafA = findLeafInState(tabs, 'leaf-A');
  assert(leafA !== null && leafA.sessionId === 'sess-A', '找到 leaf-A，sessionId 正确');

  const leafB = findLeafInState(tabs, 'leaf-B');
  assert(leafB !== null && leafB.sessionId === 'sess-B', '找到 leaf-B，sessionId 正确');

  const notFound = findLeafInState(tabs, 'leaf-X');
  assert(notFound === null, '不存在的 leafId → 返回 null');
}

{
  // 多级嵌套
  const tabs = [
    {
      id: 'tab1',
      root: {
        kind: 'split', id: 's1', dir: 'v', ratio: 0.5,
        a: {
          kind: 'split', id: 's2', dir: 'h', ratio: 0.5,
          a: { kind: 'leaf', id: 'leaf-deep', type: 'terminal', sessionId: 'deep-sess' },
          b: { kind: 'leaf', id: 'leaf-c', type: 'terminal', sessionId: 'sess-c' }
        },
        b: { kind: 'leaf', id: 'leaf-d', type: 'terminal', sessionId: 'sess-d' }
      }
    }
  ];

  const deep = findLeafInState(tabs, 'leaf-deep');
  assert(deep !== null && deep.sessionId === 'deep-sess', '深层嵌套 leaf-deep 查找成功');
}

{
  // 多 tab
  const tabs = [
    { id: 'tab1', root: { kind: 'leaf', id: 'leaf-1', type: 'terminal', sessionId: 'sess-1' } },
    { id: 'tab2', root: { kind: 'leaf', id: 'leaf-2', type: 'terminal', sessionId: 'sess-2' } }
  ];

  const leaf2 = findLeafInState(tabs, 'leaf-2');
  assert(leaf2 !== null && leaf2.sessionId === 'sess-2', '跨 tab 查找成功');
}

console.log('\n=== swapPaneData 后双向热切换模拟 ===');

{
  // 模拟 swapPaneData 前后，两个 usePTY 实例各自的 subscribe 触发情况
  const leafA_selfRef = { current: 'sess-A' };
  const leafA_sessionRef = { current: 'sess-A' };
  const leafB_selfRef = { current: 'sess-B' };
  const leafB_sessionRef = { current: 'sess-B' };
  const conn = {};

  // 执行 swap：leaf-A 的 sessionId 变成 sess-B，leaf-B 的 sessionId 变成 sess-A
  const newSidForA = 'sess-B'; // leaf-A 新 sessionId
  const newSidForB = 'sess-A'; // leaf-B 新 sessionId

  const shouldSwapA = shouldHotSwap({
    newSid: newSidForA,
    selfSessionRef: leafA_selfRef,
    sessionIdRef: leafA_sessionRef,
    connRef: { current: conn }
  });
  assert(shouldSwapA === true, 'swap 后 leaf-A 应热切换到 sess-B');

  const shouldSwapB = shouldHotSwap({
    newSid: newSidForB,
    selfSessionRef: leafB_selfRef,
    sessionIdRef: leafB_sessionRef,
    connRef: { current: conn }
  });
  assert(shouldSwapB === true, 'swap 后 leaf-B 应热切换到 sess-A');

  // 热切换完成后，selfSessionRef 和 sessionIdRef 都更新为新值
  // 再次触发 subscribe 时应跳过
  leafA_selfRef.current = newSidForA;
  leafA_sessionRef.current = newSidForA;

  const shouldSwapA2 = shouldHotSwap({
    newSid: newSidForA,
    selfSessionRef: leafA_selfRef,
    sessionIdRef: leafA_sessionRef,
    connRef: { current: conn }
  });
  assert(shouldSwapA2 === false, '热切换完成后 leaf-A 重复触发应跳过');
}

// ---- 汇总 ----
console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
