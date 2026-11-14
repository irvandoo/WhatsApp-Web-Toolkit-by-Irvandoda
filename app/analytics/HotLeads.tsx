import { openChatRoom } from './openchat';
import { useMemo } from 'react';
import type { Interaction } from '../shared/analytics-types';
import type { CrmMsg } from '../shared/crm-types';
import { formatDuration } from '../shared/analytics-logic';
import { exportLeadIntelCsv, firstName, hotLeads, INTEL_NOTE, MOMENTUM_GLYPH, MOMENTUM_LABEL, slippingLeads, TEMP_LABEL, type LeadIntel } from '../shared/lead-intel-logic';
import { ScrollTable } from '../shared/ui/ScrollTable';
import { downloadCsv, fmtDateTime, PRIO_LABEL, stamp } from './util';

interface Props { intel: Map<string, LeadIntel>; interactions: Interaction[]; accountId: string; includeGroups: boolean; accountNames: Map<string, string>; toast: (m: string) => void }

function Table({ rows, accountNames, toast, empty }: { rows: LeadIntel[]; accountNames: Map<string, string>; toast: (m: string) => void; empty: string }) {
  async function openRoom(l: LeadIntel) { const x = await openChatRoom(l); toast(x.text); }

  async function remind(l: LeadIntel) {
    const msg: CrmMsg = { kind: 'crm:reminder:add', contactKey: l.key, text: `Follow up ${l.name || l.phone}: ${l.reason}`, dueAt: Date.now() + 3600e3 };
    try { await chrome.runtime.sendMessage(msg); toast('Pengingat dibuat (1 jam lagi).'); } catch { toast('Gagal membuat pengingat.'); }
  }
  async function copyMsg(l: LeadIntel) {
    try { await navigator.clipboard.writeText(l.suggestedMessage ?? ''); toast(`Pesan saran untuk ${firstName(l.name)} disalin. Tempel di chat lalu sesuaikan.`); } catch { toast('Gagal menyalin (izin clipboard diblokir).'); }
  }
  const hourTxt = (h: number | null | undefined) => (h == null ? '' : `${String(h).padStart(2, '0')}.00`);
  return (
    <ScrollTable stickyFirst maxHeight="max(260px, 62vh)" label="Tabel lead">
      <table>
        <thead><tr>
          <th scope="col">Nama</th><th scope="col">Nomor</th><th scope="col">Akun</th><th scope="col">Temperature</th><th scope="col" className="num">Engagement</th>
          <th scope="col">Momentum</th><th scope="col">Prioritas</th><th scope="col" className="wrap">Alasan</th><th scope="col" className="wrap">Saran</th><th scope="col" className="wrap">Pesan saran</th><th scope="col">Terakhir</th><th scope="col"><span className="sr">Aksi</span></th>
        </tr></thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.key}>
              <td>{l.name || '-'}</td><td>{l.phone || '-'}</td><td>{accountNames.get(l.accountId) ?? l.accountId}</td>
              <td><span className={`badge t-${l.temperature}`}>{TEMP_LABEL[l.temperature]}</span></td>
              <td className="num"><span className="eng" aria-hidden="true"><i style={{ width: `${l.engagement}%` }} /></span>{l.engagement}</td>
              <td>{MOMENTUM_GLYPH[l.momentum]} {MOMENTUM_LABEL[l.momentum]}</td>
              <td><span className={`badge b-${l.followUpPriority}`}>{PRIO_LABEL[l.followUpPriority]}</span></td>
              <td className="wrap">{l.reason}</td>
              <td className="wrap">{l.nextAction}{l.bestHour != null && <div className="muted" style={{ fontSize: 12 }}>Biasanya aktif sekitar pukul {hourTxt(l.bestHour)}</div>}</td>
              <td className="wrap">{l.suggestedMessage ? <><div style={{ maxWidth: 320, whiteSpace: 'pre-wrap' }}>{l.suggestedMessage}</div><button onClick={() => void copyMsg(l)}>Salin pesan</button></> : <span className="muted">-</span>}</td>
              <td>{l.lastActivityTs ? `${l.lastSender === 'in' ? 'Mereka' : 'Kita'}, ${fmtDateTime(l.lastActivityTs)}` : '-'}</td>
              <td><div className="row"><button className="pri" onClick={() => void openRoom(l)}>Buka chat</button><button onClick={() => void remind(l)}>Buat pengingat</button></div></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={12} className="empty">{empty}</td></tr>}
        </tbody>
      </table>
    </ScrollTable>
  );
}

export function HotLeads({ intel, interactions, accountId, includeGroups, accountNames, toast }: Props) {
  const groupKeys = useMemo(() => new Set(interactions.filter((i) => i.isGroup).map((i) => i.key)), [interactions]);
  const scoped = useMemo(() => [...intel.values()].filter((l) =>
    (!accountId || l.accountId === accountId) && (includeGroups || !groupKeys.has(l.key))), [intel, accountId, includeGroups, groupKeys]);
  const hot = useMemo(() => hotLeads(scoped), [scoped]);
  const slipping = useMemo(() => slippingLeads(scoped), [scoped]);
  const all = useMemo(() => [...hot, ...slipping.filter((s) => !hot.includes(s))], [hot, slipping]);
  const waitingHot = hot.filter((l) => l.waitingMs > 0);

  return (
    <div>
      <div className="counts">
        <div className="card"><b className="w-urgent">{hot.length}</b><span className="muted">Lead panas</span></div>
        <div className="card"><b className="w-urgent">{waitingHot.length}</b><span className="muted">Panas belum dibalas{waitingHot[0] ? ` (terlama ${formatDuration(Math.max(...waitingHot.map((l) => l.waitingMs)))})` : ''}</span></div>
        <div className="card"><b className="w-high">{slipping.length}</b><span className="muted">Mulai kehilangan momentum</span></div>
      </div>
      <div className="btns">
        <button onClick={() => downloadCsv(`lead-panas-${stamp()}.csv`, exportLeadIntelCsv(all))} disabled={!all.length}>Ekspor CSV</button>
      </div>
      <h2>Lead Panas</h2>
      <Table rows={hot} accountNames={accountNames} toast={toast} empty="Belum ada lead panas saat ini." />
      <h2 style={{ marginTop: 14 }}>Mulai kehilangan momentum</h2>
      <p className="muted" style={{ margin: '0 0 6px' }}>Lead dengan engagement tinggi yang percakapannya melambat atau berhenti. Segera follow-up.</p>
      <Table rows={slipping} accountNames={accountNames} toast={toast} empty="Tidak ada lead yang kehilangan momentum." />
      <p className="muted" style={{ fontSize: 12 }}>{INTEL_NOTE} Isi pesan tidak disimpan, jadi intent hanya terbaca di panel chat yang sedang dibuka.</p>
    </div>
  );
}
