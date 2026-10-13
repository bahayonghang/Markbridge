// Instrument only the service worker of a disposable, test-loaded extension.
// Production assets are unchanged. No token, tree or raw message is retained.
export async function installMoveFault(worker, mode, at = 40) {
  if (!['disconnect_before', 'drop_ack', 'pause_before'].includes(mode)) throw new Error('INVALID_TEST_FAULT');
  await worker.evaluate(`(() => {
    if(globalThis.__r04Fault) throw new Error('FAULT_ALREADY_INSTALLED');
    const originalMove=chrome.bookmarks.move;
    const originalSend=WebSocket.prototype.send;
    const state={mode:${JSON.stringify(mode)},at:${at},calls:0,effects:0,receipts:0,hit:false,socket:null,droppedRequest:null,release:null};
    globalThis.__r04Fault=state;
    chrome.bookmarks.move=async function(...args) {
      state.calls++;
      if(state.calls===state.at) {
        state.hit=true;
        if(state.mode==='disconnect_before') { state.socket?.close(); throw new Error('SYNTHETIC_DISCONNECT'); }
        if(state.mode==='pause_before') await new Promise(resolve=>{state.release=resolve;});
      }
      const result=await originalMove.apply(chrome.bookmarks,args);
      state.effects++;
      return result;
    };
    WebSocket.prototype.send=function(data) {
      state.socket=this;
      let message;
      try { message=JSON.parse(data); } catch { return originalSend.call(this,data); }
      if(message.type==='operation_receipt') {
        state.receipts++;
        if(state.mode==='drop_ack' && (state.receipts===state.at || state.droppedRequest===message.requestId)) {
          state.hit=true; state.droppedRequest=message.requestId; return;
        }
      }
      return originalSend.call(this,data);
    };
    state.restore=()=>{chrome.bookmarks.move=originalMove;WebSocket.prototype.send=originalSend;state.release?.();};
    return true;
  })()`);
}
export function faultCounts(worker) {
  return worker.evaluate('(() => {const s=globalThis.__r04Fault;return s?{calls:s.calls,effects:s.effects,receipts:s.receipts,hit:s.hit,paused:!!s.release}:null;})()');
}
export function releaseMove(worker) { return worker.evaluate('(() => {const s=globalThis.__r04Fault;s.release?.();s.release=null;return true;})()'); }
export function clearMoveFault(worker) { return worker.evaluate('(() => {const s=globalThis.__r04Fault;if(s){s.restore();delete globalThis.__r04Fault;}return true;})()'); }
