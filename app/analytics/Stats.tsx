import type { Summary } from '../shared/analytics-types';
import { formatDuration } from '../shared/analytics-logic';
import { WEEKDAYS_FULL, type Stats as StatsT } from '../shared/stats-logic';
import { ScrollTable } from '../shared/ui/ScrollTable';
import { Icon, SectionTitle } from './Icons';
import { Donut, Funnel, Histogram, SmallMultiple } from './Viz';
import { fmtNum } from './util';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const fmtDay = (s: string) => { const [y, m, d] = s.split('-').map(Number); return m ? `${d} ${MON[m - 1]} ${y}` : s; };
const dur = (ms: number | null) => (ms == null ? '-' : formatDuration(ms));
const pc = (p: number | null) => (p == null ? '-' : `${p}%`);

export function Insights({ items, limit, grid }: { items: string[]; limit?: number; grid?: boolean }) {
  const list = limit ? items.slice(0, limit) : items;
  if (!list.length) return <p className="muted" style={{ margin: 0 }}>Belum cukup data untuk membuat insight. Insight muncul setelah ada pesan masuk dan balasan pada periode ini.</p>;
  return <ul className={`insights${grid ? ' grid' : ''}`}>{list.map((t) => <li key={t}><span className="dot"><Icon name="bulb" /></span><span>{t}</span></li>)}</ul>;
}

function Tile({ l, v, s }: { l: string; v: string; s?: string }) {
  return <div className="card tile"><div className="l">{l}</div><div className="v">{v}</div>{s && <div className="s">{s}</div>}</div>;
}

/** Highlights shown on the Ringkasan tab. */
export function StatHighlights({ stats, onMore }: { stats: StatsT; onMore: () => void }) {
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <SectionTitle icon="bulb">Sorotan statistik</SectionTitle>
      {stats.empty ? <p className="muted" style={{ margin: 0 }}>Belum ada aktivitas pada periode ini.</p> : (
        <>
          <div className="tiles" style={{ marginBottom: 12 }}>
            <Tile l="Median balasan pertama" v={dur(stats.response.median)} s={stats.response.n ? `dari ${fmtNum(stats.response.n)} lead` : 'belum ada balasan'} />
            <Tile l="Lead dibalas" v={pc(stats.rate.repliedPct)} s={`${pc(stats.rate.within1hPct)} dalam 1 jam`} />
            <Tile l="Jam tersibuk" v={stats.busiest.topHour == null ? '-' : `${String(stats.busiest.topHour).padStart(2, '0')}.00`} s={stats.busiest.topWeekday == null ? undefined : `teramai: ${WEEKDAYS_FULL[stats.busiest.topWeekday]}`} />
            <Tile l="Pesan per chat" v={stats.avgMsgsPerChat == null ? '-' : stats.avgMsgsPerChat.toLocaleString('id-ID')} s={stats.ratio == null ? undefined : `masuk:keluar ${stats.ratio.toLocaleString('id-ID')}:1`} />
          </div>
          <Insights items={stats.insights} limit={3} grid />
        </>
      )}
      <p className="mini-note"><button className="linkbtn" onClick={onMore}>Lihat semua statistik</button></p>
    </section>
  );
}

export function StatsView({ stats, summary }: { stats: StatsT; summary: Summary }) {
  if (stats.empty) return <div className="card empty"><b>Belum ada statistik.</b><br />Statistik dihitung dari pesan pada rentang dan akun yang dipilih. Coba perluas rentang waktu.</div>;
  const d = stats.daily, days = summary.days;
  const trendWord = d.dayCount < 3 ? 'belum cukup data' : d.trend.direction;
  return (
    <div className="section-gap">
      <section className="card">
        <SectionTitle icon="bulb">Insight</SectionTitle>
        <Insights items={stats.insights} grid />
      </section>

      <div className="tiles">
        <Tile l="Median balasan pertama" v={dur(stats.response.median)} />
        <Tile l="Rata-rata balasan" v={dur(stats.response.mean)} />
        <Tile l="P90 balasan" v={dur(stats.response.p90)} s="9 dari 10 lead lebih cepat" />
        <Tile l="Lead dibalas" v={pc(stats.rate.repliedPct)} s={`${fmtNum(stats.rate.replied)} dari ${fmtNum(stats.rate.leads)}`} />
        <Tile l="Dibalas < 1 jam" v={pc(stats.rate.within1hPct)} s={`${fmtNum(stats.rate.within1h)} lead`} />
      </div>

      <div className="grid-eq">
        <section className="card">
          <SectionTitle icon="clock">Waktu balasan pertama</SectionTitle>
          {stats.response.n ? <Histogram dist={stats.response} /> : <p className="muted">Belum ada lead baru yang dibalas pada periode ini.</p>}
          <p className="mini-note">Batas kelompok: &lt;5 menit, 5-15 menit, 15-60 menit, 1-4 jam, 4-24 jam, &gt;24 jam.</p>
        </section>
        <section className="card">
          <SectionTitle icon="funnel">Funnel lead baru</SectionTitle>
          {stats.funnel[0].count ? <Funnel steps={stats.funnel} /> : <p className="muted">Belum ada lead baru pada periode ini.</p>}
          <p className="mini-note">Lead baru, dibalas, mereka membalas lagi, lalu kita menindaklanjuti (2+ pesan keluar).</p>
        </section>
      </div>

      <div className="grid-eq">
        <section className="card">
          <SectionTitle icon="pie">Pesan masuk vs keluar</SectionTitle>
          <Donut aria={`Pesan masuk ${stats.inbound}, pesan keluar ${stats.outbound}`} center={stats.inboundShare == null ? '-' : `${Math.round(stats.inboundShare)}%`} sub="masuk"
            slices={[{ label: 'Masuk', value: stats.inbound, color: 'var(--c-in)' }, { label: 'Keluar', value: stats.outbound, color: 'var(--c-out)' }]} />
          <p className="mini-note">{stats.ratio == null ? 'Belum ada pesan keluar.' : `Rasio masuk:keluar ${stats.ratio.toLocaleString('id-ID')} : 1.`} {stats.avgMsgsPerChat != null && `Rata-rata ${stats.avgMsgsPerChat.toLocaleString('id-ID')} pesan per chat aktif.`}</p>
        </section>
        <section className="card">
          <SectionTitle icon="users">Lead baru vs lama</SectionTitle>
          <Donut aria={`Chat baru ${stats.newShare.newLeads}, chat lama ${stats.newShare.returning}`} center={stats.newShare.newPct == null ? '-' : `${Math.round(stats.newShare.newPct)}%`} sub="baru"
            slices={[{ label: 'Baru', value: stats.newShare.newLeads, color: 'var(--c-new)' }, { label: 'Lama', value: stats.newShare.returning, color: 'var(--c-fu)' }]} />
          <p className="mini-note">Chat lama = chat aktif yang bukan lead baru pada periode ini.</p>
        </section>
      </div>

      <div className="grid-eq">
        <section className="card">
          <SectionTitle icon="clock">Jam dan hari tersibuk</SectionTitle>
          <p style={{ margin: '0 0 12px' }}>{stats.busiest.sentence}</p>
          {stats.busiest.total > 0 && <HourBars hours={stats.busiest.hours} weekdays={stats.busiest.weekdays} />}
        </section>
        <section className="card">
          <SectionTitle icon="trend">Aktivitas harian</SectionTitle>
          <div className="tiles" style={{ marginBottom: 0 }}>
            <Tile l="Rata-rata per hari" v={fmtNum(Math.round(d.avgPerDay))} s="pesan masuk + keluar" />
            <Tile l="Tren" v={trendWord} s={d.dayCount >= 3 ? `${d.trend.relative > 0 ? '+' : ''}${Math.round(d.trend.relative * 100)}% sepanjang periode` : undefined} />
            <Tile l="Hari terbaik" v={d.best ? fmtNum(d.best.total) : '-'} s={d.best ? fmtDay(d.best.date) : undefined} />
            <Tile l="Hari terendah" v={d.worst ? fmtNum(d.worst.total) : '-'} s={d.worst ? fmtDay(d.worst.date) : undefined} />
            <Tile l="Chat belum dibalas berturut-turut" v={`${stats.backlog.streak} hari`} s={stats.backlog.peak ? `puncak ${fmtNum(stats.backlog.peak)} chat` : 'tidak ada tunggakan'} />
          </div>
        </section>
      </div>

      <section className="card">
        <SectionTitle icon="grid">Perbandingan harian</SectionTitle>
        <div className="sm">
          <SmallMultiple title="WA Baru" values={days.map((x) => x.newLeads)} color="var(--c-new)" total={summary.newLeads} />
          <SmallMultiple title="Follow-up" values={days.map((x) => x.followUps)} color="var(--c-fu)" total={summary.followUps} />
          <SmallMultiple title="Pesan masuk" values={days.map((x) => x.inbound)} color="var(--c-in)" total={summary.inbound} />
          <SmallMultiple title="Pesan keluar" values={days.map((x) => x.outbound)} color="var(--c-out)" total={summary.outbound} />
        </div>
      </section>

      {stats.compare.length > 0 && (
        <section className="card">
          <SectionTitle icon="compare">Dibanding periode sebelumnya</SectionTitle>
          <ScrollTable maxHeight="40vh" label="Perbandingan periode"><table>
            <caption className="sr">Perbandingan dengan periode sebelumnya</caption>
            <thead><tr><th scope="col">Metrik</th><th scope="col" className="num">Sekarang vs lalu</th><th scope="col" className="num">Perubahan</th></tr></thead>
            <tbody>{stats.compare.map((c) => {
              const good = c.pct == null || c.pct === 0 ? null : c.invert ? c.pct < 0 : c.pct > 0;
              return (
                <tr key={c.label}><th scope="row">{c.label}</th><td className="num">{c.text}</td>
                  <td className="num">{c.pct == null ? <span className="muted">-</span> : <span className={`delta ${good == null ? 'flat' : good ? 'up' : 'down'}`}><Icon name={c.pct > 0 ? 'up' : c.pct < 0 ? 'down' : 'flat'} />{Math.abs(c.pct)}%</span>}</td></tr>
              );
            })}</tbody>
          </table></ScrollTable>
        </section>
      )}

      {stats.accounts.length > 1 && (
        <section className="card">
          <SectionTitle icon="users">Perbandingan akun</SectionTitle>
          <ScrollTable maxHeight="40vh" stickyFirst label="Perbandingan akun"><table>
            <caption className="sr">Perbandingan per akun</caption>
            <thead><tr><th scope="col">Akun</th><th scope="col" className="num">Pesan</th><th scope="col" className="num">WA Baru</th><th scope="col" className="num">Median balasan</th><th scope="col" className="num">Belum dibalas</th></tr></thead>
            <tbody>{stats.accounts.map((a) => (
              <tr key={a.accountId}><th scope="row">{a.name}</th><td className="num">{fmtNum(a.messages)}</td><td className="num">{fmtNum(a.newLeads)}</td><td className="num">{dur(a.medianMs)}</td><td className="num">{fmtNum(a.unanswered)}</td></tr>
            ))}</tbody>
          </table></ScrollTable>
        </section>
      )}
    </div>
  );
}

const WD_SHORT = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
/** Two compact bar rows: 24 hours and 7 weekdays (Mon-first), peak outlined and labelled. */
function HourBars({ hours, weekdays }: { hours: number[]; weekdays: number[] }) {
  const row = (vals: number[], labels: string[], every: number, name: string) => {
    const W = 360, H = 80, B = 16, T = 12;
    const max = Math.max(1, ...vals), peak = vals.indexOf(Math.max(...vals));
    const bw = W / vals.length;
    return (
      <div className="chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${name}: puncak ${labels[peak]} (${vals[peak]} pesan)`}>
          {vals.map((v, i) => {
            const h = (v / max) * (H - B - T);
            return (
              <g key={i}>
                <rect x={i * bw + bw * 0.15} y={H - B - h} width={bw * 0.7} height={Math.max(v ? 2 : 0, h)} rx={3} fill="var(--c-in)" opacity={i === peak ? 1 : 0.55} />
                {i === peak && <text x={i * bw + bw / 2} y={H - B - h - 3} textAnchor="middle" style={{ fill: 'var(--fg)', fontWeight: 600 }}>{v}</text>}
                {i % every === 0 && <text x={i * bw + bw / 2} y={H - 3} textAnchor="middle">{labels[i]}</text>}
              </g>
            );
          })}
        </svg>
      </div>
    );
  };
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div>
      <h3>Per jam</h3>
      {row(hours, hours.map((_, h) => String(h)), 3, 'Pesan masuk per jam')}
      <h3 style={{ marginTop: 8 }}>Per hari</h3>
      {row(order.map((d) => weekdays[d]), order.map((d) => WD_SHORT[d]), 1, 'Pesan masuk per hari')}
    </div>
  );
}
