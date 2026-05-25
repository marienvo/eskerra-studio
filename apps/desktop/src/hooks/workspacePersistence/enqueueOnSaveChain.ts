import type {MutableRefObject} from 'react';

export function enqueueOnSaveChain(args: {
  saveChainRef: MutableRefObject<Promise<void>>;
  saveActiveRef: MutableRefObject<boolean>;
  run: () => Promise<void>;
  awaitResult?: boolean;
}): Promise<void> {
  const {saveChainRef, saveActiveRef, run, awaitResult = false} = args;
  saveActiveRef.current = true;
  const next = saveChainRef.current.then(run).finally(() => {
    saveActiveRef.current = false;
  });
  saveChainRef.current = next.catch(() => undefined);
  return awaitResult ? next : Promise.resolve();
}
