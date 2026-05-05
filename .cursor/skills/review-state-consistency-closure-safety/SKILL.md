---
name: review-state-consistency-closure-safety
description: >-
  Reviews React and async code for stale closures, ref/state drift, hook
  dependency gaps, unsafe setState, and async races. Use when debugging
  intermittent UI or persistence bugs, reviewing hooks and callbacks in the
  desktop editor, Today Hub, or workspace switching, or when the user mentions
  stale state, closure safety, race conditions, or multiple sources of truth.
---

# State Consistency & Closure Safety

This skill prioritizes real-world correctness over theoretical React rules. Only flag issues that can realistically break behavior over time.

## Why it exists

This codebase has complex state interactions across refs, React state, and async flows (editor, Today Hub, workspace switching). Bugs here are hard to detect, often intermittent, and can lead to stale UI, lost updates, or incorrect persistence. These issues have historically caused high debugging cost.

## Failure modes

- Stale closures capturing outdated state or props
- Ref and state divergence (`ref.current !== state`)
- Async race conditions (out-of-order updates, overwrites)
- State updates based on outdated values (missing functional updates)
- Effects relying on incomplete dependency arrays
- Event handlers that trigger async or delayed work using values that may change before execution
- Multiple conceptual owners for the same state (unclear authority; drift over time)

## Severity guidelines

Focus on issues that can cause **real runtime bugs**, not theoretical correctness. Prefer asking **“can this actually go wrong?”** over reflex lint-style alerts.

**Default ordering for this app (rough priority):** race conditions and async overwrites → ref/state drift that affects correctness → dependency-array gaps that only matter when values truly change.

### High severity

- Race conditions that can overwrite newer state
- Ref/state divergence that affects rendering or persistence
- Stale closures inside async or delayed execution

### Medium severity

- Missing dependencies that can realistically change over time
- Event handlers that trigger async or delayed work using values that may change before execution

### Low severity (avoid flagging unless clearly problematic)

- Dependency array completeness for values that are stable in practice
- Minor style or optimization concerns

### Red flags (always worth calling out)

- Async result writes to state without verifying it is still relevant
- Async logic that does not cancel, ignore, or supersede outdated work
- Ref used as state without clear synchronization strategy
- State update based on a captured value instead of a functional update

This tiering cuts most noisy comments.

## What to check

- Any async, delayed, or multi-step logic using values from React state or props:
  - Can those values change before the logic completes?
  - Could this lead to outdated writes or incorrect UI?
- `useEffect` / `useCallback` / `useMemo` dependency arrays:
  - Are all referenced values included where omission could cause stale or incorrect behavior?
  - If not, is there a deliberate and **documented** reason?
  - Prefer explicit comments explaining why omission is safe
- `setState` usage:
  - If based on previous state → must use functional update (`prev => ...`)
- Refs used as mutable state:
  - Is there a clear reason this is not React state?
  - Is synchronization between ref and state explicit and safe?
- Async flows:
  - Can multiple calls overlap?
  - Can earlier results overwrite newer ones?
  - Workspace / note switching scenarios:
    - Can in-flight async work apply to the wrong workspace or note?
    - Is there protection against outdated results after a switch?
  - Time sensitivity:
    - Does correctness depend on execution order or timing?
    - Would this still behave correctly under slow network, rapid switching, or repeated user actions?
- Event handlers:
  - Do they trigger async or delayed work using values that may change before execution?
- Multiple sources of truth:
  - Is the same conceptual state stored in both ref and state, or in multiple states?
  - If so, which one is authoritative?
  - Can they drift apart over time?

## When to ignore

- Stable values that never change (constants, static config)
- Intentionally memoized callbacks with documented reasoning
- Refs explicitly used as escape hatches (must be clearly justified)
- Performance optimizations that are safe and well-documented

## Examples (bad)

```ts
// ❌ Stale closure in async context
const handleClick = () => {
  setTimeout(() => {
    doSomething(count); // count may be stale
  }, 100);
};

// ❌ Missing dependency
useEffect(() => {
  fetchData(id);
}, []); // id missing

// ❌ Unsafe state update
setItems(items.concat(newItem));

// ❌ Ref/state drift
ref.current = value;
// state not updated or synced

// ❌ Race condition
const load = async () => {
  const result = await fetchData(query);
  setData(result); // may overwrite newer query result
};

// ❌ Switching race condition
const loadNote = async (id) => {
  const data = await fetchNote(id);
  setNote(data); // may apply to wrong note after fast switching
};
```

## Examples (good)

```ts
// ✅ Functional update
setItems((prev) => prev.concat(newItem));

// ✅ Correct dependencies
useEffect(() => {
  fetchData(id);
}, [id]);

// ✅ Ref + state sync clearly defined
useLayoutEffect(() => {
  ref.current = stateValue;
}, [stateValue]);

// ✅ Race condition guarded
let currentRequestId = 0;

const load = async () => {
  const requestId = ++currentRequestId;
  const result = await fetchData(query);

  if (requestId === currentRequestId) {
    setData(result);
  }
};

// ✅ Switching-safe async
const loadNote = async (id) => {
  const currentId = id;

  const data = await fetchNote(id);

  if (currentId === getCurrentNoteId()) {
    setNote(data);
  }
};

// ✅ Intentional ref usage (documented)
// Using ref to avoid re-renders during rapid input
```
