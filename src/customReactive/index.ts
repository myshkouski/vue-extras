import {
  ReactiveFlags,
  toRaw,
  track,
  TrackOpTypes,
  trigger,
  TriggerOpTypes,
} from "@vue/reactivity";
import { isArray, isFunction, isPromise } from "@vue/shared";
import { isClient, isWorker, type AnyFn } from "@vueuse/core";
import { warn, onScopeDispose } from "vue";

export function customReactive<T extends object, TProps extends PropType<T>>(
  target: T,
  options: CustomReactiveOptions<T, TProps>,
): T {
  target = toRaw(target);

  const trackedProps = options?.track;
  const setters = options?.setters;
  const actions = options?.actions;

  const proxyHandler: ProxyHandler<T> = {};

  if (trackedProps?.length) {
    let proxyMethodsMap: WeakMap<AnyFn, AnyFn>;

    proxyHandler.has = (target, prop) => {
      const has = Reflect.has(target, prop);
      trackProp(target, prop, trackedProps, TrackOpTypes.HAS);
      return has;
    };

    proxyHandler.get = (target, prop, receiver) => {
      switch (prop) {
        case ReactiveFlags.RAW:
          return target;
        case ReactiveFlags.SKIP:
          return true;
      }

      const trackedProp = trackProp(target, prop, trackedProps, TrackOpTypes.GET);

      let value: any = Reflect.get(target, prop, trackedProp ? target : receiver);

      if (isFunction(value)) {
        proxyMethodsMap ||= new WeakMap();
        value = createProxyMethod(
          target,
          value as AnyFn,
          proxyMethodsMap,
          (
            actions as
              | { [name: string | symbol]: CustomReactiveDependencies<PropType<T>> }
              | undefined
          )?.[prop],
        );
      }

      return value;
    };
  }

  if (setters?.length) {
    proxyHandler.set = (target, prop, newValue, receiver) => {
      const isSet = Reflect.set(target, prop, newValue, receiver);

      if (isSet && (setters as (string | symbol)[]).includes(prop)) {
        triggerSet(target, prop);
      }

      return isSet;
    };
  }

  const proxy = new Proxy(target, proxyHandler);

  const hooks = options?.hooks;

  if (hooks && (isClient || isWorker)) {
    for (const [eventType, dep] of Object.entries(hooks)) {
      if (dep) {
        const eventTarget = target as EventTarget;
        const cb = () => {
          triggerDependencies(target, dep);
        };
        eventTarget.addEventListener(eventType, cb);
        onScopeDispose(() => {
          eventTarget.removeEventListener(eventType, cb);
        }, true);
      }
    }
  }

  return proxy;
}

function triggerSet(target: object, prop: string | symbol) {
  trigger(target, TriggerOpTypes.SET, prop);
}

function triggerDependencies<T extends object, TProps extends PropType<T>>(
  target: T,
  dependencies: CustomReactiveDependencies<TProps>,
) {
  const deps: CustomReactiveEffectOrProp<TProps>[] = isArray(dependencies)
    ? dependencies
    : [dependencies];

  const trigger = triggerSet.bind(void 0, target);

  for (const effectOrProp of deps) {
    if (isFunction(effectOrProp)) {
      try {
        effectOrProp(trigger);
      } catch (e) {
        warn("Unable to call reactivity hook", e, target);
      }
    } else {
      trigger(effectOrProp);
    }
  }
}

function createProxyMethod<T extends object, Fn extends AnyFn>(
  target: T,
  originalMethod: Fn,
  proxyMethodsMap: WeakMap<AnyFn, AnyFn>,
  deps: CustomReactiveDependencies<PropType<T>> | undefined,
): AnyFn {
  let proxyMethod: AnyFn;

  if (proxyMethodsMap.has(originalMethod)) {
    proxyMethod = proxyMethodsMap.get(originalMethod)!;
  } else {
    if (deps) {
      proxyMethod = (...args: Parameters<Fn>) => {
        const result = originalMethod.apply(target, args);

        if (isPromise(result)) {
          return result.then((result) => {
            triggerDependencies(target, deps);
            return result;
          });
        }

        triggerDependencies(target, deps);

        return result;
      };
    } else {
      proxyMethod = originalMethod.bind(target);
    }

    proxyMethodsMap.set(originalMethod, proxyMethod);
  }

  return proxyMethod;
}

function trackProp<T extends object>(
  target: T,
  prop: string | symbol,
  tracked: readonly (string | symbol)[],
  op: TrackOpTypes,
) {
  if (tracked.includes(prop)) {
    track(target, op, prop);
    return true;
  }
  return false;
}

export type PropType<T extends object = { [key: string | number | symbol]: any }> = Exclude<
  keyof T,
  number
>;

export type CustomReactiveActionsOptions<T extends object> = {
  [
    K in PropType<T> as T[K] extends (...args: any[]) => any ? K : never
  ]?: CustomReactiveDependencies<PropType<T>>;
};

export type CustomReactiveHooksOptions<
  T extends object,
  TProps extends PropType<T>,
> = T extends EventTarget
  ? { [K in EventTargetEventType<T>]?: CustomReactiveDependencies<TProps> }
  : never;

export interface CustomReactiveOptions<T extends object, TProps extends PropType<T>> {
  track?: readonly TProps[];
  setters?: (keyof T)[];
  actions?: CustomReactiveActionsOptions<T>;
  hooks?: CustomReactiveHooksOptions<T, TProps>;
}

type EventTargetEventType<T extends EventTarget> = T extends {
  addEventListener: (type: infer E extends string, ...other: any) => any;
}
  ? E
  : never;

export type CustomReactiveDependencies<TProps extends PropType> =
  | CustomReactiveEffect<TProps>
  | readonly CustomReactiveEffectOrProp<TProps>[];

export type CustomReactiveEffect<TProps extends PropType> = (
  trigger: (props: TProps) => void,
) => void;

export type CustomReactiveEffectOrProp<TProps extends PropType> =
  | CustomReactiveEffect<TProps>
  | TProps;
