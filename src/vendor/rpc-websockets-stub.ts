// SSR-only stub for rpc-websockets. The real package has no workerd export
// condition, but the SSR bundle never opens a websocket (RPC subscriptions
// run in the browser via /api/rpc). This stub keeps the SSR build happy.
export class Client {
  constructor() {}
  on() {}
  off() {}
  call() { return Promise.resolve(); }
  notify() {}
  close() {}
  connect() {}
  subscribe() { return Promise.resolve(); }
  unsubscribe() { return Promise.resolve(); }
}
export class CommonClient extends Client {}
export class WebSocketClient extends Client {}
export default Client;
