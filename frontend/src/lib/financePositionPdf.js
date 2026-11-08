import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const currencyFormat = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const formatCurrency = (value) => currencyFormat.format(Number(value) || 0);

const formatDateLabel = (value) => {
  if (!value) return "-";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString("id-ID", { dateStyle: "long" });
};

const formatDateTime = (value) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
};

const safeNumber = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
};

/**
 * Ekspor ringkasan posisi keuangan (neraca) + riwayat jurnal ke PDF.
 *
 * @param {object} params
 * @param {object} params.position  Ringkasan posisi keuangan kumulatif.
 * @param {Array}  params.transactions Riwayat jurnal terbaru.
 * @param {string} params.startDate Tanggal mulai filter (YYYY-MM-DD).
 * @param {string} params.endDate   Tanggal akhir filter (YYYY-MM-DD).
 */
export function downloadFinancePositionPDF({ position = {}, transactions = [], startDate, endDate }) {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 14;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(15);
  pdf.text("Warkop Babba POS", pageWidth / 2, 16, { align: "center" });
  pdf.setFontSize(12);
  pdf.text("Laporan Posisi Keuangan (Neraca)", pageWidth / 2, 23, { align: "center" });

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text(`Posisi per: ${formatDateLabel(endDate)}`, pageWidth / 2, 29, { align: "center" });
  pdf.text(
    `Periode jurnal: ${formatDateLabel(startDate)} s.d. ${formatDateLabel(endDate)}`,
    pageWidth / 2,
    34,
    { align: "center" },
  );

  const summaryRows = [
    ["Total Kas & Bank", formatCurrency(position.cash_bank)],
    ["Persediaan", formatCurrency(position.inventory)],
    ["Total Aset", formatCurrency(position.total_assets)],
    ["Total Liabilitas", formatCurrency(position.total_liabilities)],
    ["Ekuitas (akun modal)", formatCurrency(position.equity_accounts)],
    ["Laba Berjalan (kumulatif)", formatCurrency(position.net_profit)],
    ["Total Liabilitas & Ekuitas", formatCurrency(position.total_liabilities_equity)],
  ];

  autoTable(pdf, {
    startY: 40,
    head: [["Ringkasan Posisi Keuangan", "Nilai"]],
    body: summaryRows,
    theme: "grid",
    headStyles: { fillColor: [30, 64, 86], halign: "left" },
    styles: { font: "helvetica", fontSize: 9, cellPadding: 2.5 },
    columnStyles: {
      0: { cellWidth: 110 },
      1: { cellWidth: "auto", halign: "right" },
    },
    margin: { left: margin, right: margin },
  });

  const difference = safeNumber(position.difference);
  let cursorY = (pdf.lastAutoTable?.finalY || 40) + 6;
  pdf.setFontSize(9);
  if (Math.abs(difference) < 0.5) {
    pdf.setTextColor(22, 101, 52);
    pdf.text("Status: Seimbang (Aset = Liabilitas + Ekuitas)", margin, cursorY);
  } else {
    pdf.setTextColor(185, 28, 28);
    pdf.text(`Status: Selisih ${formatCurrency(difference)}`, margin, cursorY);
  }
  pdf.setTextColor(0, 0, 0);

  cursorY += 6;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text("Riwayat Jurnal Terbaru", margin, cursorY);
  pdf.setFont("helvetica", "normal");

  autoTable(pdf, {
    startY: cursorY + 3,
    head: [["Tanggal", "Keterangan", "Kode Akun", "Nilai"]],
    body: (transactions || []).map((row) => {
      const debit = safeNumber(row.debit);
      const credit = safeNumber(row.kredit);
      const isCredit = debit <= 0 && credit > 0;
      return [
        formatDateTime(row.tanggal),
        row.keterangan || "-",
        row.kode_akun || "-",
        `${formatCurrency(isCredit ? credit : debit)}${isCredit ? " K" : ""}`,
      ];
    }),
    theme: "grid",
    headStyles: { fillColor: [30, 64, 86], halign: "center" },
    styles: { font: "helvetica", fontSize: 8, cellPadding: 2.2, overflow: "linebreak" },
    columnStyles: {
      0: { cellWidth: 34 },
      1: { cellWidth: "auto" },
      2: { cellWidth: 24 },
      3: { cellWidth: 34, halign: "right" },
    },
    margin: { left: margin, right: margin, bottom: 20 },
    didDrawPage: () => {
      const pageNumber = pdf.internal.getNumberOfPages();
      pdf.setFontSize(8);
      pdf.setTextColor(120, 120, 120);
      pdf.text(
        `Dicetak: ${new Date().toLocaleString("id-ID")}  |  Halaman ${pageNumber}`,
        pageWidth / 2,
        pageHeight - 8,
        { align: "center" },
      );
      pdf.setTextColor(0, 0, 0);
    },
  });

  const filenameDate = (endDate || new Date().toISOString().slice(0, 10)).replace(/[^0-9-]/g, "");
  pdf.save(`Neraca_Warkop_Babba_${filenameDate}.pdf`);
}
