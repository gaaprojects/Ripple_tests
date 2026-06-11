import type { DeviceInfo, SignRequest, SignResponse } from "@fx/shared";
import type { DeviceSigner } from "./signer.js";

/**
 * Hardware transport (DEVICE_MODE=hardware) — Firefly Pixie over USB serial, JSON-lines.
 * P0 scope: GET_INFO returns the device pubkey (proven boot gate). SIGN_REQUEST round-trip
 * is wired to the protocol but exercised end-to-end in P4 (firmware signing). `serialport`
 * is an optionalDependency so simulator mode never requires the native build.
 */
export class HardwareSigner implements DeviceSigner {
  readonly simulated = false;
  private port: any;
  private parser: any;
  private buffer: ((line: string) => void) | null = null;

  constructor(
    private readonly path: string,
    private readonly baudRate = 115200,
  ) {}

  private async ensureOpen(): Promise<void> {
    if (this.port?.isOpen) return;
    let SerialPortMod: any;
    try {
      SerialPortMod = await import("serialport");
    } catch {
      throw new Error(
        "DEVICE_MODE=hardware but `serialport` is not installed. Run `pnpm --filter @fx/bridge install` or use DEVICE_MODE=simulator.",
      );
    }
    const { SerialPort, ReadlineParser } = SerialPortMod as typeof import("serialport");
    this.port = new SerialPort({ path: this.path, baudRate: this.baudRate });
    this.parser = this.port.pipe(new ReadlineParser({ delimiter: "\n" }));
    this.parser.on("data", (line: string) => this.buffer?.(line.trim()));
    await new Promise<void>((res, rej) => {
      this.port.on("open", res);
      this.port.on("error", rej);
    });
  }

  /** Send one JSON command, await the next JSON line, with timeout. */
  private async rpc<T>(cmd: Record<string, unknown>, timeoutMs: number): Promise<T> {
    await this.ensureOpen();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.buffer = null;
        reject(new Error("device serial timeout"));
      }, timeoutMs);
      this.buffer = (line: string) => {
        if (!line) return;
        clearTimeout(timer);
        this.buffer = null;
        try {
          resolve(JSON.parse(line) as T);
        } catch (e) {
          reject(e);
        }
      };
      this.port.write(JSON.stringify(cmd) + "\n");
    });
  }

  async getInfo(): Promise<DeviceInfo> {
    const res = await this.rpc<{ pubkey: string; fw_version: string }>(
      { cmd: "GET_INFO" },
      5000,
    );
    return { pubkey: res.pubkey, fw_version: res.fw_version, simulated: false };
  }

  async sign(req: SignRequest, onAwaiting?: () => void): Promise<SignResponse> {
    onAwaiting?.();
    const res = await this.rpc<{
      request_id: string;
      outcome?: string;
      signature_der_hex?: string;
    }>(
      {
        cmd: "SIGN_REQUEST",
        request_id: req.request_id,
        digest_hex: req.digest_hex,
        display: req.display,
      },
      req.timeout_ms,
    );
    const outcome =
      res.outcome === "REJECTED"
        ? "REJECTED"
        : res.signature_der_hex
          ? "SIGNED"
          : "TIMEOUT";
    return {
      request_id: req.request_id,
      outcome,
      signature_der_hex: res.signature_der_hex,
    };
  }
}
