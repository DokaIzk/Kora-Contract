/**
 * Reporting Service — PDF Renderer
 *
 * Renders UserStatement and ProtocolStatement objects to PDF buffers using
 * PDFKit.  Output is reproducible given identical inputs (no Date.now() or
 * random IDs injected into the PDF content itself).
 *
 * Issue #770
 */

import PDFDocument from "pdfkit";
import { UserStatement, ProtocolStatement } from "./types";

export class PdfRenderer {
  /**
   * Render a per-user statement as a PDF buffer.
   * Returns a Promise<Buffer> — PDF generation is async (stream-based).
   */
  async renderUserStatement(stmt: UserStatement): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // Header
      doc.fontSize(18).text("Kora Protocol — User Statement", { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Address: ${stmt.userAddress}`);
      doc.text(`Period: ${toIso(stmt.fromTs)} — ${toIso(stmt.toTs)}`);
      doc.moveDown(1);

      // Funding
      this._section(doc, "Funding");
      this._tableHeader(doc, ["Invoice", "Asset", "Amount (stroops)", "Date", "Tx Hash"]);
      for (const e of stmt.funding) {
        this._tableRow(doc, [e.invoiceId, e.asset, e.amount.toString(), toIso(e.timestamp), short(e.txHash)]);
      }
      doc.moveDown(0.5);

      // Repayments
      this._section(doc, "Repayments");
      this._tableHeader(doc, ["Invoice", "Asset", "Amount (stroops)", "Date", "Tx Hash"]);
      for (const e of stmt.repayments) {
        this._tableRow(doc, [e.invoiceId, e.asset, e.amount.toString(), toIso(e.timestamp), short(e.txHash)]);
      }
      doc.moveDown(0.5);

      // Yield
      this._section(doc, "Yield");
      this._tableHeader(doc, ["Invoice", "Asset", "Principal", "Yield", "Date"]);
      for (const e of stmt.yields) {
        this._tableRow(doc, [
          e.invoiceId,
          e.asset,
          e.principalReturned.toString(),
          e.yieldAmount.toString(),
          toIso(e.timestamp),
        ]);
      }
      doc.moveDown(0.5);

      // Summary by asset
      this._section(doc, "Summary by Asset");
      this._tableHeader(doc, ["Asset", "Funded", "Repaid", "Yield", "Fees"]);
      for (const s of stmt.summaryByAsset) {
        this._tableRow(doc, [
          s.asset,
          s.totalFunded.toString(),
          s.totalRepaid.toString(),
          s.totalYield.toString(),
          s.totalFees.toString(),
        ]);
      }

      doc.end();
    });
  }

  /**
   * Render a protocol-wide statement as a PDF buffer.
   */
  async renderProtocolStatement(stmt: ProtocolStatement): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      doc.fontSize(18).text("Kora Protocol — Protocol-Wide Statement", { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Period: ${toIso(stmt.fromTs)} — ${toIso(stmt.toTs)}`);
      doc.moveDown(1);

      this._section(doc, "Invoice Counts");
      doc.text(`Total financed:  ${stmt.totalInvoicesFinanced}`);
      doc.text(`Total repaid:    ${stmt.totalInvoicesRepaid}`);
      doc.text(`Total defaulted: ${stmt.totalInvoicesDefaulted}`);
      doc.moveDown(1);

      this._section(doc, "Summary by Asset");
      this._tableHeader(doc, ["Asset", "Funded", "Repaid", "Yield", "Fees"]);
      for (const s of stmt.summaryByAsset) {
        this._tableRow(doc, [
          s.asset,
          s.totalFunded.toString(),
          s.totalRepaid.toString(),
          s.totalYield.toString(),
          s.totalFees.toString(),
        ]);
      }

      doc.end();
    });
  }

  // ---------------------------------------------------------------------------
  // PDFKit helpers
  // ---------------------------------------------------------------------------

  private _section(doc: PDFKit.PDFDocument, title: string): void {
    doc.fontSize(12).font("Helvetica-Bold").text(title);
    doc.font("Helvetica").fontSize(9);
  }

  private _tableHeader(doc: PDFKit.PDFDocument, cols: string[]): void {
    doc.font("Helvetica-Bold").text(cols.join("  |  "));
    doc.font("Helvetica");
  }

  private _tableRow(doc: PDFKit.PDFDocument, cols: string[]): void {
    doc.text(cols.join("  |  "));
  }
}

function toIso(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString();
}

function short(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash;
}
