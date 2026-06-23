export interface OrderBreakdownData {
  company: {
    name: string;
    addressLines: string[];
    email: string | null;
    companyRegNo: string | null;
    vatRegNo: string | null;
  };
  order: {
    orderNumber: number;
    orderDate: Date | null;
    dispatchDate: Date | null;
    customerPo: string | null;
  };
  customerAccount: string;
  invoiceAddress: string[];
  deliveryAddress: string[];
  generatedOn: Date;
  items: {
    modelCode: string | null;
    description: string | null;
    serialNumber: string;
    patient: string | null;
    refNo: string | null;
    side: string | null;
    price: number | null;
  }[];
  totals: {
    excVat: number;
    vatRate: number;
    vatAmount: number;
    incVat: number;
  };
}

function fmt(date: Date | null | undefined): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-GB');
}

function fmtPrice(p: number | null | undefined): string {
  if (p == null) return '';
  return `£${p.toFixed(2)}`;
}

function formatOrderNumber(n: number): string {
  return `SLI${String(n).padStart(6, '0')}`;
}

function esc(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderOrderBreakdownHtml(data: OrderBreakdownData): string {
  const itemRows = data.items
    .map(
      (item) => `
    <tr>
      <td>${esc(item.modelCode)}</td>
      <td>${esc(item.description)}</td>
      <td>${esc(item.serialNumber)}</td>
      <td>${esc(item.patient)}</td>
      <td>${esc(item.refNo)}</td>
      <td class="col-centre">${esc(item.side)}</td>
      <td class="col-right">${fmtPrice(item.price)}</td>
    </tr>`,
    )
    .join('');

  const invoiceAddressLines = data.invoiceAddress.map((l) => `<div>${esc(l)}</div>`).join('');
  const deliveryAddressLines = data.deliveryAddress.map((l) => `<div>${esc(l)}</div>`).join('');
  const companyAddressLines = data.company.addressLines.map((l) => `<div>${esc(l)}</div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, sans-serif;
    font-size: 9pt;
    color: #222;
    padding: 16mm 14mm 20mm 14mm;
  }

  /* ── Header ─────────────────────────────────────────────── */
  .header-rule { height: 3px; background: #4472C4; }
  .header-title {
    text-align: center;
    font-size: 17pt;
    font-weight: bold;
    padding: 5px 0 6px;
    color: #111;
  }

  /* ── Info row ────────────────────────────────────────────── */
  .info-row {
    display: flex;
    gap: 14px;
    padding: 12px 0 6px;
    align-items: flex-start;
  }
  .company-block { flex: 0 0 200px; line-height: 1.5; }
  .company-name  { font-size: 16pt; font-weight: bold; margin-bottom: 2px; }

  .address-box {
    flex: 1;
    border: 1px solid #aaa;
    padding: 8px 10px 8px;
    position: relative;
    line-height: 1.5;
    min-height: 70px;
  }
  .address-box-label {
    position: absolute;
    top: -8px;
    left: 8px;
    background: #fff;
    padding: 0 4px;
    font-style: italic;
    font-weight: bold;
    color: #4472C4;
    font-size: 8.5pt;
  }

  .doc-date {
    text-align: right;
    font-size: 8pt;
    padding: 4px 0 8px;
    color: #444;
  }

  /* ── Order metadata ──────────────────────────────────────── */
  .meta-section { margin-bottom: 10px; }
  .meta-rule { height: 2px; background: #4472C4; margin-bottom: 0; }
  .meta-row {
    display: flex;
    align-items: baseline;
    border-bottom: 1px solid #d0d8ea;
    padding: 3px 0;
  }
  .meta-label {
    font-weight: bold;
    color: #4472C4;
    width: 130px;
    flex-shrink: 0;
    font-size: 9pt;
  }
  .meta-value { flex: 1; }
  .meta-label-2 {
    font-weight: bold;
    color: #4472C4;
    width: 130px;
    flex-shrink: 0;
    margin-left: 30px;
  }
  .meta-value-2 { flex: 1; }

  /* ── Items table ─────────────────────────────────────────── */
  .items-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 10px;
    font-size: 8.5pt;
  }
  .items-table thead tr th {
    font-style: italic;
    font-weight: bold;
    color: #4472C4;
    border-top: 1.5px solid #4472C4;
    border-bottom: 1.5px solid #4472C4;
    padding: 4px 6px;
    text-align: left;
    white-space: nowrap;
  }
  .items-table tbody tr td {
    padding: 3px 6px;
    border-bottom: 1px solid #ddd;
    vertical-align: middle;
  }
  .col-right  { text-align: right; }
  .col-centre { text-align: center; }

  /* ── Totals ──────────────────────────────────────────────── */
  .totals-wrapper { display: flex; justify-content: flex-end; margin-top: 14px; }
  .totals-table { border-collapse: collapse; min-width: 220px; }
  .totals-table td {
    padding: 3px 8px;
    border-top: 1px solid #bbb;
  }
  .totals-label {
    font-style: italic;
    font-weight: bold;
    color: #4472C4;
    text-align: right;
    white-space: nowrap;
  }
  .totals-value { text-align: right; font-weight: bold; white-space: nowrap; }
</style>
</head>
<body>

<!-- ── Header ───────────────────────────────────────────────── -->
<div class="header-rule"></div>
<div class="header-title">Order Breakdown</div>
<div class="header-rule"></div>

<!-- ── Info row ─────────────────────────────────────────────── -->
<div class="info-row">

  <div class="company-block">
    <div class="company-name">${esc(data.company.name)}</div>
    ${companyAddressLines}
    ${data.company.email ? `<div>Email: ${esc(data.company.email)}</div>` : ''}
    ${data.company.companyRegNo ? `<div>Company Registration No.: ${esc(data.company.companyRegNo)}</div>` : ''}
    ${data.company.vatRegNo ? `<div>VAT Registration No.: ${esc(data.company.vatRegNo)}</div>` : ''}
  </div>

  <div class="address-box">
    <span class="address-box-label">Invoice Address</span>
    ${invoiceAddressLines}
  </div>

  <div class="address-box">
    <span class="address-box-label">Delivery Address</span>
    ${deliveryAddressLines}
  </div>

</div>

<div class="doc-date">Document created on ${fmt(data.generatedOn)}</div>

<!-- ── Order metadata ───────────────────────────────────────── -->
<div class="meta-section">
  <div class="meta-rule"></div>
  <div class="meta-row">
    <span class="meta-label">Customer Account</span>
    <span class="meta-value">${esc(data.customerAccount)}</span>
    <span class="meta-label-2">Customer PO</span>
    <span class="meta-value-2">${esc(data.order.customerPo) || 'TBC'}</span>
  </div>
  <div class="meta-row">
    <span class="meta-label">Order Date</span>
    <span class="meta-value">${fmt(data.order.orderDate)}</span>
    <span class="meta-label-2">Dispatch Date</span>
    <span class="meta-value-2">${fmt(data.order.dispatchDate)}</span>
  </div>
  <div class="meta-row">
    <span class="meta-label">Order Number</span>
    <span class="meta-value">${formatOrderNumber(data.order.orderNumber)}</span>
  </div>
</div>

<!-- ── Items table ───────────────────────────────────────────── -->
<table class="items-table">
  <thead>
    <tr>
      <th>Product</th>
      <th>Description</th>
      <th>Serial No</th>
      <th>Patient</th>
      <th>Ref No</th>
      <th class="col-centre">Side</th>
      <th class="col-right">Price</th>
    </tr>
  </thead>
  <tbody>
    ${itemRows}
  </tbody>
</table>

<!-- ── Totals ────────────────────────────────────────────────── -->
<div class="totals-wrapper">
  <table class="totals-table">
    <tr>
      <td class="totals-label">Total Exc VAT</td>
      <td class="totals-value">${fmtPrice(data.totals.excVat)}</td>
    </tr>
    <tr>
      <td class="totals-label">Total VAT at ${data.totals.vatRate}%</td>
      <td class="totals-value">${fmtPrice(data.totals.vatAmount)}</td>
    </tr>
    <tr>
      <td class="totals-label">Total Inc VAT</td>
      <td class="totals-value">${fmtPrice(data.totals.incVat)}</td>
    </tr>
  </table>
</div>

</body>
</html>`;
}
