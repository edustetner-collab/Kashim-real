// Detecção de plataforma centralizada — substitui as verificações duplicadas
// de `window.Capacitor?.isNativePlatform?.()` espalhadas pelo código.
// O valor não muda em runtime, então é um const module-level, não estado.

export const isNativeApp: boolean =
  typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.();

export interface PlatformInfo {
  isNative: boolean;
  isWeb: boolean;
}

export function usePlatform(): PlatformInfo {
  return { isNative: isNativeApp, isWeb: !isNativeApp };
}
