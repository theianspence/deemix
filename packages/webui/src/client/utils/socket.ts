class CustomSocket extends WebSocket {
	// Multiple callbacks per key, stored so they can be individually removed.
	listeners: Record<string, ((ev: any) => any)[]>;
	// One native message listener per key routes to all registered callbacks.
	nativeListeners: Record<string, (ev: MessageEvent<any>) => any>;

	constructor(args: string | URL) {
		super(args);
		this.listeners = {};
		this.nativeListeners = {};
	}

	emit(key: string, data?: any) {
		if (this.readyState !== WebSocket.OPEN) return false;

		this.send(JSON.stringify({ key, data }));
	}

	on(key: string, cb: (ev: any) => any) {
		if (!this.listeners[key]) {
			this.listeners[key] = [];

			const native = (event: MessageEvent<any>) => {
				const messageData = JSON.parse(event.data);
				if (messageData.key === key) {
					this.listeners[key]?.forEach((fn) => fn(messageData.data));
				}
			};
			this.nativeListeners[key] = native;
			this.addEventListener("message", native);
		}

		if (!this.listeners[key].includes(cb)) {
			this.listeners[key].push(cb);
		}
	}

	// Pass cb to remove a specific listener; omit to remove all listeners for key.
	off(key: string, cb?: (ev: any) => any) {
		if (!this.listeners[key]) return;

		if (cb) {
			this.listeners[key] = this.listeners[key].filter((fn) => fn !== cb);
		} else {
			this.listeners[key] = [];
		}

		if (this.listeners[key].length === 0) {
			this.removeEventListener("message", this.nativeListeners[key]);
			delete this.nativeListeners[key];
			delete this.listeners[key];
		}
	}
}

export const socket = new CustomSocket(
	(location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/"
);
