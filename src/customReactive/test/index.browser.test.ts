import { describe, expect, it } from "vitest";
import { computed, watch } from "vue";
import { customReactive } from "..";

describe("customReactive", async () => {
  it("reactive AbortController", async () => {
    const { isAborted, reason, abort } = useAbort();

    expect(isAborted.value).toBe(false);
    expect(reason.value).toBeUndefined();

    const { promise, resolve } = Promise.withResolvers<void>();

    watch(
      [reason, isAborted],
      () => {
        resolve();
      },
      {
        flush: "post",
      },
    );

    abort({ message: "aborted" });

    await promise;

    expect(isAborted.value).toBe(true);
    expect(reason.value).toStrictEqual({ message: "aborted" });
  });

  it("preserves 'this' in target's own method ", () => {
    let capturedThis: any;

    const raw = {
      prop: "own_prop",
      getProp() {
        // eslint-disable-next-line ts/no-this-alias
        capturedThis = this;
        return this.prop;
      },
    };

    const reactive = customReactive(raw, {
      // no need in reactivity for that test case
      // track: ['prop']
    });

    expect(reactive.getProp()).toBe("own_prop");
    expect(capturedThis).toStrictEqual(raw);
  });
});

function useAbort() {
  const abortController = new AbortController();

  const reactiveSignal = customReactive(abortController.signal, {
    track: ["aborted", "reason"],
    hooks: {
      abort: ["aborted", "reason"],
    },
  });

  return {
    reason: computed(() => {
      return reactiveSignal.reason;
    }),
    isAborted: computed(() => {
      return reactiveSignal.aborted;
    }),
    abort: abortController.abort.bind(abortController),
  };
}
