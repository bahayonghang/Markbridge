export const PROTOCOL_VERSION = 1 as const;
export const OFFICIAL_EXTENSION_ID = 'caimbneegiphplhknaokehleclahckoa' as const;
export const OFFICIAL_EXTENSION_ORIGIN = 'chrome-extension://caimbneegiphplhknaokehleclahckoa' as const;
export const BRIDGE_PORT_START = 49153 as const;
export const BRIDGE_PORT_END = 49160 as const;

export * from './startup';
export * from './wire';
export * from './bridge';
export * from './ai';
export * from './organization';
export * from './maintenance';
export * from './batch-edit';
export * from './history';
export * from './diagnostics';
export * from './ui-fonts';

export * from './semantic';
