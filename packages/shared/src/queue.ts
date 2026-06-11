import { z } from "zod";

/** Approval queue item for the VETO path (SPEC §5.9 / §6). */
export const QueueState = z.enum([
  "pending", // queued: intent + decision + route snapshot persisted (NOT a finalized tx)
  "awaiting_device", // approval clicked: fresh tx built, SIGN_REQUEST sent to device
  "signed", // device returned a verified signature
  "settled", // submitted + validated on-ledger
  "rejected", // dashboard reject or device reject/timeout
  "expired", // signing window lapsed before approval
]);
export type QueueState = z.infer<typeof QueueState>;

export const QueueItem = z.object({
  intent_id: z.string(),
  state: QueueState,
  narrative: z.string().optional(), // AI Explainer output, attached async (template fallback)
  tx_hash: z.string().optional(),
  explorer_url: z.string().optional(),
  transitions: z.array(
    z.object({
      state: QueueState,
      at: z.string(), // ISO-8601
      note: z.string().optional(),
    }),
  ),
});
export type QueueItem = z.infer<typeof QueueItem>;
