/* Thin wrapper around web-gphoto2's WebAssembly build (vendor/web-gphoto2, LGPL-2.1).
   Every camera call goes through one queue, because the camera can only do one thing at a time. */

const PTP_CLASS = 6;      // still image
const PTP_SUBCLASS = 1;

let modulePromise = null;

export class Camera {
  #queue = Promise.resolve();
  #context = null;

  static supported() {
    return 'usb' in navigator;
  }

  /* Opens Chrome's USB picker. Must be called from a tap. */
  static async pick() {
    await navigator.usb.requestDevice({ filters: [{ classCode: PTP_CLASS, subclassCode: PTP_SUBCLASS }] });
  }

  static async alreadyAllowed() {
    return (await navigator.usb.getDevices()).length > 0;
  }

  get connected() {
    return !!this.#context;
  }

  async connect() {
    if (!modulePromise) {
      modulePromise = import('./vendor/web-gphoto2/libapi.mjs').then(m => m.default());
      modulePromise.catch(() => { modulePromise = null; });
    }
    const Module = await modulePromise;
    await this.#queue;   // a disconnect may still be closing the previous session
    this.#context = await new Module.Context();
  }

  disconnect() {
    const context = this.#context;
    this.#context = null;
    // Let whatever is running finish before the context goes away.
    this.#queue = this.#queue.then(() => {
      if (context && !context.isDeleted()) context.delete();
    }).catch(() => {});
    return this.#queue;
  }

  #schedule(op) {
    const res = this.#queue.then(() => {
      if (!this.#context) throw new Error('Camera is not connected');
      return op(this.#context);
    });
    this.#queue = res.catch(() => {});
    return res;
  }

  supportedOps() {
    return this.#schedule(c => c.supportedOps());
  }

  config() {
    return this.#schedule(c => c.configToJS());
  }

  /* Toggles want a boolean, ranges a number, everything else a string. */
  set(name, value) {
    return this.#schedule(c => c.setConfigValue(name, value));
  }

  previewFrame() {
    return this.#schedule(c => c.capturePreviewAsBlob());
  }

  capture() {
    return this.#schedule(c => c.captureImageAsFile());
  }

  /* Resolves to true when something changed on the camera (a dial was turned, etc). */
  events() {
    return this.#schedule(c => c.consumeEvents());
  }
}

/* Depth-first search of the config tree for a setting by its gphoto2 name. */
export function findConfig(node, name) {
  if (!node) return null;
  if (node.name === name && !node.children) return node;
  if (node.children) {
    for (const child of Object.values(node.children)) {
      const hit = findConfig(child, name);
      if (hit) return hit;
    }
  }
  return null;
}
