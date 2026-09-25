// Test-only React 18 commit observer. Never loaded by the application.
const renderAuditSource = `(${function installRenderAudit() {
  window.__auditRenders = [];
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    inject: () => 1,
    onCommitFiberRoot: (_id, root) => {
      let todos = 0, dayCells = 0, functions = 0;
      const walk = (fiber) => {
        if (!fiber) return;
        if (typeof fiber.type === 'function' && (fiber.flags & 1)) {
          functions += 1;
          if (fiber.memoizedProps?.item?.noteId && (fiber.memoizedProps?.noteId || fiber.memoizedProps?.note?.id)) todos += 1;
          if (fiber.memoizedProps?.dateStr && Array.isArray(fiber.memoizedProps?.events)) dayCells += 1;
        }
        // Bailout reuses the alternate's child list, including old work flags.
        // Skip that whole subtree; avoid allocating a fiber set on every commit.
        if (fiber.child !== fiber.alternate?.child) walk(fiber.child);
        walk(fiber.sibling);
      };
      walk(root.current);
      window.__auditRenders.push({ at: performance.now(), todos, dayCells, functions });
    },
    onCommitFiberUnmount: () => {},
    onPostCommitFiberRoot: () => {},
  };
}.toString()})();`;

module.exports = { renderAuditSource };
