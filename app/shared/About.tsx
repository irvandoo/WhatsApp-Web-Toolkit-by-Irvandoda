import { CREDIT, IS_FULL } from './credit';

export function About() {
  return (
    <div style={{ font: '14px system-ui', padding: 16, minWidth: 280 }}>
      <h3 style={{ margin: 0 }}>{CREDIT.product}</h3>
      <p style={{ color: '#667' }}>Build: {IS_FULL ? 'full' : 'store'}</p>
      <p>
        {CREDIT.name} ({CREDIT.nickname})<br />
        <a href={`mailto:${CREDIT.email}`}>{CREDIT.email}</a><br />
        <a href={CREDIT.web} target="_blank" rel="noreferrer">irvandoda.web.id</a>
      </p>
    </div>
  );
}
