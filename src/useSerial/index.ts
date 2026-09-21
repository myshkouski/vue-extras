import { isClient, useEventListener } from "@vueuse/core"
import { computed, readonly, shallowRef, toValue, watch, type MaybeRefOrGetter, type Reactive, type Ref } from 'vue'
import { customReactive } from "../customReactive"

const EVENT_CONNECT = "connect"
const EVENT_DISCONNECT = "dis" + EVENT_CONNECT

export function useSerial(options?: UseSerialOptions): UseSerialReturn {
  const serial = shallowRef<Serial>()
  const ports = shallowRef<SerialPort[]>([])
  const error = shallowRef<Error>()

  const instance = computed(() => {
    return options?.instance ? toValue(options.instance) : navigator.serial
  })

  async function tryUpdatePorts() {
    if (!serial.value) return
    try {
      ports.value = [...await serial.value.getPorts()].map(port => {
        const reactivePort = toReactiveSerialPort(port, {
          updatePorts() {
            tryUpdatePorts()
          }
        })

        return reactivePort
      })
    } catch (e) {
      error.value = error as unknown as Error
    }
  }

  watch(serial, () => {
    tryUpdatePorts()
  })

  useEventListener(serial, [EVENT_CONNECT, EVENT_DISCONNECT], () => {
    tryUpdatePorts()
  })

  const isSupported = () => isClient && !!instance.value

  const init = () => {
    if (!serial.value && isSupported()) {
      serial.value = instance.value
    }
    return serial.value
  }

  const immediate = options?.immediate ?? true

  if (immediate) {
    init()
  }

  const disconnect = async (port: SerialPort) => {
    await port.forget()
  }

  const connect = async (options?: SerialPortRequestOptions) => {
    const serial = init()
    if (!serial) {
      throw new Error(`Serial port is ${serial}`)
    }
    const port = await serial.requestPort(options)
    await tryUpdatePorts()
    return port
  }

  return {
    isSupported: computed(isSupported),
    error: readonly(error),
    ports: readonly(ports),
    connect,
    disconnect,
  }
}

export interface UseSerialOptions {
  instance?: MaybeRefOrGetter<Serial | undefined>
  immediate?: boolean
}

export interface UseSerialReturn {
  isSupported: Readonly<Ref<boolean>>;
  error: Readonly<Ref<Error | undefined>>
  ports: Readonly<Ref<readonly SerialPort[]>>;
  connect(options?: SerialPortRequestOptions): Promise<SerialPort>;
  disconnect(port: SerialPort): Promise<void>
}

interface ProxyHooks {
  updatePorts?: () => void
}

function toReactiveSerialPort<T extends SerialPort>(
  port: T,
  hooks?: ProxyHooks
): Reactive<T> {
  return customReactive<SerialPort, keyof SerialPort>(port, {
    track: [
      "connected",
      "readable",
      "writable",
    ],
    actions: {
      open: ["readable", "writable"],
      close: ["readable", "writable"],
      setSignals: ["getSignals"],
      forget: [
        "connected",
        "getInfo",
        () => hooks?.updatePorts?.(),
      ],
    },
    hooks: {
      [EVENT_CONNECT]: ["connected"],
      [EVENT_DISCONNECT]: ["connected"],
    },
  }) as Reactive<T>
}
