export function download(name: string, data: string, mime: string, bom = false) {
  const url = URL.createObjectURL(new Blob([bom ? '﻿' + data : data], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export const downloadCsv = (name: string, csv: string) => download(name, csv, 'text/csv;charset=utf-8', true);
export const fmtDateTime = (ts: number) => new Date(ts).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtNum = (n: number) => n.toLocaleString('id-ID');
export const stamp = () => new Date().toISOString().slice(0, 10);
export const PRIO_LABEL = { urgent: 'Mendesak', high: 'Tinggi', normal: 'Normal', low: 'Rendah' } as const;
export const KIND_LABEL = { new: 'WA Baru', followup: 'Follow-up', existing: 'Lama' } as const;
