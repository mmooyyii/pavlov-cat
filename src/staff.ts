import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

// Engraved staff above the follow-along timeline, so you read the notes the
// way they're written instead of off the piano roll. Rendering is done by
// OpenSheetMusicDisplay straight from the MusicXML; the library is large, so it
// is only fetched the first time a score is shown.
//
// Only the first part is drawn — the same part the timeline follows — as one
// endless line, however long the piece. The line glides sideways in step with
// the clock so that "now" stays at the same x as the timeline's playhead; the
// cursor marks the note being played. Clef, key and time signature stay pinned
// at the left so you never lose track of the key.

const CURSOR_COLOR = '#0a84ff';

interface Stop {
  beat: number;   // quarters from the top of the written score
  idx: number;    // cursor iteration index
  x: number;      // x of the note in the line's own coordinates (px)
}

export class Staff {
  private host: HTMLElement;
  private head: HTMLElement;
  private osmd: OpenSheetMusicDisplay | null = null;
  private loadSeq = 0;
  private stops: Stop[] = [];
  private at = -1;          // iteration index the cursor is on
  private shownStop = -1;
  private zoom = 0.8;

  constructor(host: HTMLElement) {
    this.host = host;
    this.head = document.createElement('div');
    this.head.className = 'rt-staff-head';
    this.head.hidden = true;
    this.head.setAttribute('aria-hidden', 'true');   // a copy of what's already in the line
    host.parentElement?.appendChild(this.head);
  }

  /** Show `xml`, or clear the staff when null. Resolves to whether it rendered. */
  async load(xml: string | null): Promise<boolean> {
    const seq = ++this.loadSeq;
    this.stops = [];
    this.at = -1;
    this.shownStop = -1;
    this.head.hidden = true;
    this.head.replaceChildren();
    if (!xml) { this.clear(); return false; }
    try {
      if (!this.osmd) {
        const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
        if (seq !== this.loadSeq) return false;
        this.osmd = new OpenSheetMusicDisplay(this.host, {
          autoResize: false,          // one endless line: the box width doesn't matter
          backend: 'svg',
          drawingParameters: 'compacttight',
          renderSingleHorizontalStaffline: true,
          drawTitle: false,
          drawSubtitle: false,
          drawComposer: false,
          drawLyricist: false,
          drawCredits: false,
          drawPartNames: false,
          drawPartAbbreviations: false,
          drawMetronomeMarks: false,
          autoBeam: true,
          cursorsOptions: [{ type: 0, color: CURSOR_COLOR, alpha: 0.22, follow: false }],
        });
      }
      this.osmd.Zoom = this.zoom;
      const osmd = this.osmd;
      await osmd.load(xml);
      if (seq !== this.loadSeq) return false;
      osmd.Sheet.Instruments.forEach((ins, i) => { ins.Visible = i === 0; });
      this.layout();
      return true;
    } catch {
      if (seq === this.loadSeq) this.clear();
      return false;
    }
  }

  private layout(): void {
    this.osmd!.render();
    this.stops = [];
    this.indexCursor();
    this.buildHead();
  }

  /** Re-engrave at another size (bigger on a music stand in fullscreen). */
  setZoom(z: number): void {
    if (z === this.zoom) return;
    this.zoom = z;
    if (!this.osmd || !this.stops.length) return;
    this.osmd.Zoom = z;
    this.layout();
  }

  private clear(): void {
    try { this.osmd?.clear(); } catch { /* */ }
    this.host.querySelectorAll('svg, img').forEach(el => el.remove());
  }

  /** x of the cursor in the line's own coordinates, independent of scrolling. */
  private cursorX(): number {
    const el = this.osmd?.cursor.cursorElement;
    if (!el) return 0;
    return el.getBoundingClientRect().left - this.host.getBoundingClientRect().left + this.host.scrollLeft;
  }

  // Walk the cursor once to learn where each stop falls in time and on the
  // line. Repeats make the iterator jump back; the timeline plays the written
  // order straight through, so only stops that move forward in time are kept.
  private indexCursor(): void {
    const c = this.osmd?.cursor;
    if (!c) return;
    c.show();
    c.reset();
    let idx = 0, last = -Infinity;
    while (!c.iterator.EndReached) {
      const beat = c.iterator.currentTimeStamp.RealValue * 4;
      if (beat > last + 1e-6) { this.stops.push({ beat, idx, x: this.cursorX() }); last = beat; }
      c.next();
      idx++;
    }
    c.reset();
    this.at = 0;
    this.shownStop = 0;
    this.host.scrollLeft = 0;
  }

  // A copy of the line clipped to everything left of the first note: clef,
  // key signature and time signature.
  private buildHead(): void {
    const svg = this.host.querySelector('svg');
    const first = this.stops[0];
    if (!svg || !first) return;
    const box = this.host.parentElement!.getBoundingClientRect();
    const r = svg.getBoundingClientRect();
    const clone = svg.cloneNode(true) as SVGElement;
    clone.style.left = `${r.left - box.left + this.host.scrollLeft}px`;
    clone.style.top = `${r.top - box.top}px`;
    this.head.style.width = `${Math.max(0, first.x - 4)}px`;
    this.head.replaceChildren(clone);
  }

  /** Glide the line so `beat` (quarters from the top of the score) sits at
   *  `anchorX` px from the box's left edge, and mark the note sounding there. */
  follow(beat: number, anchorX: number): void {
    const c = this.osmd?.cursor;
    const stops = this.stops;
    if (!c || !stops.length) return;
    // Last stop at or before the beat.
    let lo = 0, hi = stops.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (stops[mid].beat <= beat + 1e-3) lo = mid; else hi = mid - 1;
    }

    // Continuous position: interpolate between this stop and the next, so the
    // line moves with the clock instead of hopping note to note.
    const a = stops[lo], b = stops[lo + 1];
    let x = a.x;
    if (b && beat > a.beat) x += (b.x - a.x) * Math.min(1, (beat - a.beat) / (b.beat - a.beat));
    else if (b && beat < a.beat) x -= (a.beat - beat) * (b.x - a.x) / (b.beat - a.beat);   // lead-in: approach the first note
    // Near the top the line would have to scroll left of 0 to put the note
    // under the playhead; slide the content right instead.
    const left = x - anchorX;
    const scroll = Math.max(0, left);
    if (Math.abs(this.host.scrollLeft - scroll) > 0.5) this.host.scrollLeft = scroll;
    const shift = left < 0 ? `translateX(${-left}px)` : '';
    for (const el of Array.from(this.host.children) as HTMLElement[]) {
      if (el.style.transform !== shift) el.style.transform = shift;
    }
    this.head.hidden = left < 1;

    if (lo === this.shownStop) return;
    this.shownStop = lo;
    const target = a.idx;
    if (target < this.at) { c.reset(); this.at = 0; }
    while (this.at < target) { c.next(); this.at++; }
  }
}
