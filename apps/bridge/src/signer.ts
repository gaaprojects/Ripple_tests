import type { DeviceInfo, SignRequest, SignResponse } from "@fx/shared";

/**
 * Transport-agnostic device interface (SPEC §5.2). The bridge swaps the concrete
 * implementation by DEVICE_MODE; the HTTP/WS API above it is identical (D12).
 */
export interface DeviceSigner {
  readonly simulated: boolean;
  getInfo(): Promise<DeviceInfo>;
  /**
   * Sign a 32-byte digest. The device renders display fields and (hardware) waits
   * for a physical button; returns a canonical low-S DER secp256k1 signature, or
   * REJECTED / TIMEOUT. `onAwaiting` fires once the device is prompting the human.
   */
  sign(req: SignRequest, onAwaiting?: () => void): Promise<SignResponse>;
}
