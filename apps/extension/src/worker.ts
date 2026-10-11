import { ExtensionBridge } from './bridge';

const bridge = new ExtensionBridge(chrome);
void bridge.start().catch(() => { /* No credentials or raw browser data in diagnostics. */ });
