/**
 * Shapes of what MEW3 Apartments' daily Finance documents say, once read.
 * Every field the paperwork might leave blank is nullable — a handwritten
 * register rarely has every column filled in.
 */

/** How a guest paid, after normalising whatever was written on the receipt. */
export type PaymentMethod = "cash" | "airtel" | "mtn" | "moneywise" | "bank" | "card" | "other" | "unknown";

/** Payment methods grouped the way the money has to be reconciled. */
export type MoneyChannel = "cash" | "mobile" | "moneywise" | "other";

/** One line of the guest register: a guest (or party) checking in. */
export interface GuestStay {
  guestName: string;
  room: string | null;
  /** YYYY-MM-DD. */
  checkIn: string | null;
  checkOut: string | null;
  nights: number | null;
  /** Number of people in the party. */
  guests: number | null;
  phone: string | null;
  receiptNumber: string | null;
  /** Amount written on the register, when the register has an amount column. */
  amount: number | null;
  paymentMethod: PaymentMethod | null;
  /** Further register fields, kept for the record. Optional: rows saved before they were read lack them. */
  address?: string | null;
  nationality?: string | null;
  /** NRC or passport number. */
  idNumber?: string | null;
  email?: string | null;
  company?: string | null;
  /** "single" or "double" occupancy, as ticked. */
  occupancy?: string | null;
  /** Columns an admin added under "AI Data Extraction Fields", keyed by field key. */
  extra?: Record<string, string | null>;
}

export interface Receipt {
  receiptNumber: string | null;
  /** YYYY-MM-DD the receipt was issued. */
  date: string | null;
  guestName: string;
  room: string | null;
  checkIn: string | null;
  checkOut: string | null;
  nights: number | null;
  amount: number;
  paymentMethod: PaymentMethod;
  /** The method exactly as written, for the report. */
  methodWritten: string | null;
  extra?: Record<string, string | null>;
}

/** One deposit slip or transfer confirmation on the proof of deposit. */
export interface Deposit {
  date: string | null;
  amount: number;
  /** Where the money came from — cash takings, Airtel Money float, etc. */
  source: PaymentMethod;
  /** Where it went — e.g. "MoneyWise", "Zanaco". */
  destination: string | null;
  reference: string | null;
  extra?: Record<string, string | null>;
}

/** A MoneyWise transaction, reduced to what the reconciliation needs. */
export interface MwTxn {
  id: string;
  date: string | null;
  amount: number;
  direction: "in" | "out";
  description: string;
  reference: string | null;
  category: string | null;
  wallet: string | null;
  /** Booked as revenue/income/sales rather than a transfer or deposit. */
  isRevenue: boolean;
}

export type Mew3DocKind = "guestRegister" | "receipts" | "deposits";
