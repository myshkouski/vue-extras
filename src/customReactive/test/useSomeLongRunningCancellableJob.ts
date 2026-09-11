import type { MaybeRefOrGetter, WatchHandle } from "vue";
import { useTimestamp } from "@vueuse/core";
import { computed, shallowReadonly, shallowRef, toValue, watch } from "vue";

export interface JobResult {
  message: string;
}

export function useSomeLongRunningCancellableJob(signal: MaybeRefOrGetter<AbortSignal>) {
  const status = shallowRef<"idle" | "pending" | "cancelled" | "done" | "error">("idle");

  const aborted = computed(() => !!toValue(signal)?.aborted);

  watch(aborted, (aborted) => {
    if (aborted) {
      status.value = "cancelled";
    }
  });

  const result = shallowRef<JobResult>();

  const { timeRemains: secondsToDone } = useSecondsRemain();

  function runJob(jobTimeoutMs: number): Promise<JobResult> {
    return new Promise((resolve, reject) => {
      secondsToDone.value = jobTimeoutMs;

      let cleanupWatcher: WatchHandle | undefined;

      const timeout = setTimeout(() => {
        cleanupWatcher?.stop();
        resolve({ message: "job done and has not been cancelled." });
      }, jobTimeoutMs);

      cleanupWatcher = watch(
        aborted,
        (aborted) => {
          if (aborted) {
            clearTimeout(timeout);
            reject();
          }
        },
        {
          immediate: true,
        },
      );
    });
  }

  async function execute(): Promise<void> {
    if (status.value !== "idle") return;

    status.value = "pending";
    try {
      result.value = await runJob(10_000);
      status.value = "done";
    } catch {}
  }

  return {
    reason: computed(() => toValue(signal).reason),
    status: shallowReadonly(status),
    secondsToDone,
    execute,
    result,
  };
}

function useSecondsRemain() {
  const timestamp = useTimestamp();
  const endOfJob = shallowRef(-1);
  const timeRemains = computed<number>({
    get() {
      if (endOfJob.value < 0) return 0;
      return (endOfJob.value - timestamp.value) / 1000;
    },
    set(value: number) {
      endOfJob.value = timestamp.value + value;
    },
  });

  return { timeRemains };
}
