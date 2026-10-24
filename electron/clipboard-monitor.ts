import { readClipboardItems, type ImageClipboardItem } from "./clipboard-images";
import { NATIVE_FILE_URL } from "./clipboard-files";

type FileFormats = [hasUriList: boolean, hasNativeFileUrl: boolean];

/** One enumeration per admitted image/file poll, never cached across polling turns. */
export class ClipboardFormatRead {
  readonly items: Promise<ImageClipboardItem[]>;
  private availableItems: ImageClipboardItem[] | null = null;

  constructor(read: () => Promise<ImageClipboardItem[]>) {
    // Start the existing image-side enumeration first. Only a ready result may
    // replace the independent text format checks; no extra timer or wait is added.
    let enumeration: Promise<ImageClipboardItem[]>;
    try { enumeration = read(); }
    catch (error) { enumeration = Promise.reject(error); }
    void enumeration.then(items => { this.availableItems = items; }, () => undefined);
    this.items = readClipboardItems(() => enumeration);
  }

  fileFormats(fallback: () => Promise<FileFormats>): Promise<FileFormats> {
    return Promise.resolve().then(() => {
      const items = this.availableItems;
      if (!items) return fallback();
      return [items.some(item => item.types.includes("text/uri-list")),
        items.some(item => item.types.includes(NATIVE_FILE_URL))] as FileFormats;
    });
  }
}

/** Own only timer lifetime; capture locks and generation checks stay in main. */
export class ClipboardPollingTimer {
  private timer: NodeJS.Timeout | null = null;
  private generation = 0;
  private disposed = false;

  constructor(private readonly intervalMs: number, private readonly poll: () => void) {}

  start(): void {
    if (this.timer || this.disposed) return;
    const generation = ++this.generation;
    this.timer = setInterval(() => {
      if (this.timer && !this.disposed && generation === this.generation) this.poll();
    }, this.intervalMs);
  }

  stop(): void {
    ++this.generation;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
  }
}
