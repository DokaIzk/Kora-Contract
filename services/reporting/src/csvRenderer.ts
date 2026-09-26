/**
 * Reporting Service — CSV Renderer
 *
 * Renders UserStatement and ProtocolStatement objects to CSV bytes.
 * Output is reproducible: same inputs → same bytes (no timestamps injected
 * during rendering).
 *
 * Issue #770
 */

import { UserStatement, ProtocolStatement } from "./types";

export class CsvRenderer {
  /**
   * Render a per-user statement as a multi-section CSV string.
   */
  renderUserStatement(stmt: UserStatement): string {
    const lines: string[] = [];

    lines.push("# Kora Protocol — User Statement");
    lines.push(`# Address: ${stmt.userAddress}`);
    lines.push(`# Period: ${toIso(stmt.fromTs)} to ${toIso(stmt.toTs)}`);
    lines.push("");

    // Funding section
    lines.push("## Funding");
    lines.push("invoice_id,asset,amount_stroops,timestamp_utc,tx_hash");
    for (const e of stmt.funding) {
      lines.push(`${e.invoiceId},${e.asset},${e.amount},${toIso(e.timestamp)},${e.txHash}`);
    }
    lines.push("");

    // Repayments section
    lines.push("## Repayments");
    lines.push("invoice_id,asset,amount_stroops,timestamp_utc,tx_hash");
    for (const e of stmt.repayments) {
      lines.push(`${e.invoiceId},${e.asset},${e.amount},${toIso(e.timestamp)},${e.txHash}`);
    }
    lines.push("");

    // Yield section
    lines.push("## Yield");
    lines.push("invoice_id,asset,principal_stroops,yield_stroops,timestamp_utc,tx_hash");
    for (const e of stmt.yields) {
      lines.push(
        `${e.invoiceId},${e.asset},${e.principalReturned},${e.yieldAmount},${toIso(e.timestamp)},${e.txHash}`
      );
    }
    lines.push("");

    // Fees section
    lines.push("## Fees");
    lines.push("invoice_id,asset,fee_amount_stroops,fee_bps,timestamp_utc,tx_hash");
    for (const e of stmt.fees) {
      lines.push(
        `${e.invoiceId},${e.asset},${e.feeAmount},${e.feeBps},${toIso(e.timestamp)},${e.txHash}`
      );
    }
    lines.push("");

    // Summary by asset
    lines.push("## Summary by Asset");
    lines.push("asset,total_funded_stroops,total_repaid_stroops,total_yield_stroops,total_fees_stroops");
    for (const s of stmt.summaryByAsset) {
      lines.push(
        `${s.asset},${s.totalFunded},${s.totalRepaid},${s.totalYield},${s.totalFees}`
      );
    }

    return lines.join("\n");
  }

  /**
   * Render a protocol-wide aggregate statement as CSV.
   */
  renderProtocolStatement(stmt: ProtocolStatement): string {
    const lines: string[] = [];

    lines.push("# Kora Protocol — Protocol-Wide Statement");
    lines.push(`# Period: ${toIso(stmt.fromTs)} to ${toIso(stmt.toTs)}`);
    lines.push("");

    lines.push("## Invoice Counts");
    lines.push("metric,value");
    lines.push(`total_invoices_financed,${stmt.totalInvoicesFinanced}`);
    lines.push(`total_invoices_repaid,${stmt.totalInvoicesRepaid}`);
    lines.push(`total_invoices_defaulted,${stmt.totalInvoicesDefaulted}`);
    lines.push("");

    lines.push("## Summary by Asset");
    lines.push("asset,total_funded_stroops,total_repaid_stroops,total_yield_stroops,total_fees_stroops");
    for (const s of stmt.summaryByAsset) {
      lines.push(
        `${s.asset},${s.totalFunded},${s.totalRepaid},${s.totalYield},${s.totalFees}`
      );
    }

    return lines.join("\n");
  }
}

function toIso(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString();
}
