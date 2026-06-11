import { z } from "zod";

/** Assets in play (SPEC D4): RLUSD in, project-issued EUD out, XRP as the bridge asset. */
export const Currency = z.enum(["RLUSD", "EUD", "XRP"]);
export type Currency = z.infer<typeof Currency>;

export const IntentSource = z.enum(["email", "manual", "agent"]);
export type IntentSource = z.infer<typeof IntentSource>;

export const IntentStatus = z.enum([
  "draft", // intake produced it; awaiting human/agent confirmation (I1)
  "pending", // entered the pipeline
  "auto", // gate -> AUTO, executor running/done
  "veto", // gate -> VETO, in approval queue
  "blocked", // gate -> BLOCK, hard stop
  "settled",
  "rejected",
  "failed",
]);
export type IntentStatus = z.infer<typeof IntentStatus>;

export const Money = z.object({
  value: z.number().positive(),
  currency: Currency,
});
export type Money = z.infer<typeof Money>;

export const Beneficiary = z.object({
  name: z.string().min(1).optional(),
  address: z.string().min(25), // classic XRPL r-address
});
export type Beneficiary = z.infer<typeof Beneficiary>;

/**
 * The unit of work through the whole pipeline (SPEC §6).
 * The Treasury Agent's ONLY actuator is producing one of these via POST /intents (SPEC §5.12).
 */
export const PaymentIntent = z.object({
  id: z.string(), // ulid
  source: IntentSource,
  created_by: z.string(), // "system" | "agent" | "human:<id>"
  beneficiary: Beneficiary,
  amount: Money,
  purpose: z.string().default(""),
  corridor: z.string().optional(), // key into corridors.yaml
  status: IntentStatus.default("draft"),
  created_at: z.string(), // ISO-8601
});
export type PaymentIntent = z.infer<typeof PaymentIntent>;
