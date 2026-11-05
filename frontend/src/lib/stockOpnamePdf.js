import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const quantityFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
const currencyFormat = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const formatQuantity = (value, unit) => `${quantityFormat.format(Number(value) || 0)} ${unit || ""}`.trim();

export function downloadStockOpnamePDF(report) {
  const documentDate = new Date(report.created_at);
  const dateLabel = documentDate.toLocaleDateString("id-ID", { dateStyle: "long" });
  const filenameDate = [
    documentDate.getFullYear(),
    String(documentDate.getMonth() + 1).padStart(2, "0"),
    String(documentDate.getDate()).padStart(2, "0"),
  ].join("-");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text("Laporan Stok Opname - Warkop Babba", pageWidth / 2, 16, { align: "center" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text(`Tanggal laporan: ${dateLabel}`, pageWidth / 2, 24, { align: "center" });

  autoTable(pdf, {
    startY: 31,
    head: [["Nama Barang", "Stok Sistem", "Stok Fisik", "Selisih", "Nilai Kerugian", "Keterangan"]],
    body: (report.items || []).map((item) => [
      item.item_name,
      formatQuantity(item.system_qty, item.unit),
      formatQuantity(item.physical_qty, item.unit),
      formatQuantity(item.difference, item.unit),
      Number(item.loss_value) > 0 ? currencyFormat.format(Number(item.loss_value)) : "-",
      item.notes || "-",
    ]),
    theme: "grid",
    headStyles: { fillColor: [30, 64, 86], halign: "center" },
    styles: { font: "helvetica", fontSize: 8, cellPadding: 2.5, overflow: "linebreak" },
    columnStyles: {
      0: { cellWidth: 42 },
      1: { cellWidth: 30, halign: "right" },
      2: { cellWidth: 30, halign: "right" },
      3: { cellWidth: 30, halign: "right" },
      4: { cellWidth: 34, halign: "right" },
      5: { cellWidth: "auto" },
    },
    margin: { left: 12, right: 12, bottom: 42 },
  });

  const needsSignaturePage = pdf.lastAutoTable.finalY > pageHeight - 48;
  if (needsSignaturePage) pdf.addPage();
  const signatureY = needsSignaturePage
    ? pageHeight - 37
    : Math.max(pdf.lastAutoTable.finalY + 18, pageHeight - 37);
  const signatureWidth = 72;
  const signatureCenters = [pageWidth * 0.3, pageWidth * 0.7];
  pdf.setDrawColor(80);
  signatureCenters.forEach((center) => {
    pdf.line(center - signatureWidth / 2, signatureY + 12, center + signatureWidth / 2, signatureY + 12);
  });
  pdf.setFontSize(9);
  pdf.text("Dibuat Oleh (Admin/Kasir)", signatureCenters[0], signatureY + 19, { align: "center" });
  pdf.text("Disetujui Oleh (Owner)", signatureCenters[1], signatureY + 19, { align: "center" });

  pdf.save(`Stok_Opname_Warkop_Babba_${filenameDate}.pdf`);
}
