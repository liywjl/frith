import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { COMBOS, activePaletteName, applyPalette, type Combo } from '../lib/palette';

/** Try on a colour combo: click a card, the whole app re-dresses live.
 *  Experiments persist per-browser; a keeper graduates into a real theme. */
export function PaletteModal({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState<string | null>(activePaletteName());
  const [filter, setFilter] = useState('');

  const cats = useMemo(() => [...new Set(COMBOS.map((c) => c.cat))], []);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q
      ? COMBOS.filter((c) => `${c.name} ${c.cat} ${c.colors.join(' ')}`.toLowerCase().includes(q))
      : COMBOS;
  }, [filter]);

  function tryOn(combo: Combo) {
    applyPalette(combo);
    setActive(combo.name);
  }

  return (
    <Modal title="Palette try-on" onClose={onClose}>
      <p className="modal-empty">
        {COMBOS.length} combos from the Figma reference. Click to try one on — it sticks on this device until you
        reset. A keeper becomes a real theme.
      </p>
      <div className="palette-bar">
        <input
          className="palette-search"
          placeholder="Search names, categories, hex…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          className="btn"
          disabled={!active}
          onClick={() => {
            applyPalette(null);
            setActive(null);
          }}
        >
          Reset to theme
        </button>
      </div>
      <div className="palette-list">
        {cats.map((cat) => {
          const inCat = shown.filter((c) => c.cat === cat);
          if (inCat.length === 0) return null;
          return (
            <section key={cat}>
              <div className="palette-cat">{cat}</div>
              <div className="palette-grid">
                {inCat.map((combo) => (
                  <button
                    key={combo.name}
                    className={`palette-card ${active === combo.name ? 'active' : ''}`}
                    title={combo.colors.join(' ')}
                    onClick={() => tryOn(combo)}
                  >
                    <span className="palette-name">{combo.name}</span>
                    <span className="palette-swatches">
                      {combo.colors.map((hex) => (
                        <span key={hex} style={{ background: hex }} />
                      ))}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
        {shown.length === 0 && <p className="modal-empty">Nothing matches.</p>}
      </div>
    </Modal>
  );
}
