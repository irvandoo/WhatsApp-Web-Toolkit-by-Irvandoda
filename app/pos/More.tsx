import { useEffect, useState } from 'react';

export const PAGE = 200;

/** Incremental rendering: show `n` rows, grow by PAGE; resets when `resetKey` changes (filter change). */
export function useLimit(resetKey: string): [number, () => void] {
  const [n, setN] = useState(PAGE);
  useEffect(() => { setN(PAGE); }, [resetKey]);
  return [n, () => setN((x) => x + PAGE)];
}

export function More({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  return (
    <div className="bar more">
      {total > shown && <button onClick={onMore}>Tampilkan {Math.min(PAGE, total - shown)} lagi</button>}
      <small className="mut">Menampilkan {Math.min(shown, total)} dari {total}</small>
    </div>
  );
}
