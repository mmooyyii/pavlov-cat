import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

// Engraved staff above the follow-along timeline, so you read the notes the
// way they're written instead of off the piano roll. Rendering is done by
// OpenSheetMusicDisplay straight from the MusicXML; the library is large, so it
// is only fetched the first time a score is shown.
//
// Only the first part is drawn — the same part the timeline follows — as one
// endless line, however long the piece. A cursor sits on the note under the
// playhead, and the line scrolls sideways to keep the cursor at the same x as
// the timeline's playhead, so the staff and the piano roll read as one.

const CURSOR_COLOR = '#64d2ff';   // matches the timeline playhead
const INK = '#e5e5ea';            // notes/lines on the dark stage

export class Staff {
  private host: HTMLElement;
  private osmd: OpenSheetMusicDisplay | null = null;
  private loadSeq = 0;
  private steps: { beat: number; idx: number }[] = [];   // cursor stops, beat in quarters from the top
  private at = -1;                                       // iteration index the cursor is on
  private shownStep = -1;

  private anchorX = 0;              // px from the box's left edge where the cursor should sit

  constructor(host: HTMLElement) {
    this.host = host;
  }

  /** Show `xml`, or clear the staff when null. Resolves to whether it rendered. */
  async load(xml: string | null): Promise<boolean> {
    const seq = ++this.loadSeq;
    this.steps = [];
    this.at = -1;
    this.shownStep = -1;
    if (!xml) { this.clear(); return false; }
    try {
      if (!this.osmd) {
        const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
        if (seq !== this.loadSeq) return false;
        this.osmd = new OpenSheetMusicDisplay(this.host, {
          autoResize: true,
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
          defaultColorMusic: INK,
          cursorsOptions: [{ type: 0, color: CURSOR_COLOR, alpha: 0.35, follow: false }],
        });
        this.osmd.Zoom = 0.75;
      }
      const osmd = this.osmd;
      await osmd.load(xml);
      if (seq !== this.loadSeq) return false;
      osmd.Sheet.Instruments.forEach((ins, i) => { ins.Visible = i === 0; });
      osmd.render();
      this.indexCursor();
      return true;
    } catch {
      if (seq === this.loadSeq) this.clear();
      return false;
    }
  }

  private clear(): void {
    try { this.osmd?.clear(); } catch { /* */ }
    this.host.querySelectorAll('svg, img').forEach(el => el.remove());
  }

  // Walk the cursor once to learn where each stop falls in time. Repeats make
  // the iterator jump back; the timeline plays the written order straight
  // through, so only stops that move forward in time are kept.
  private indexCursor(): void {
    const c = this.osmd?.cursor;
    if (!c) return;
    c.reset();
    let idx = 0, last = -Infinity;
    while (!c.iterator.EndReached) {
      const beat = c.iterator.currentTimeStamp.RealValue * 4;
      if (beat > last + 1e-6) { this.steps.push({ beat, idx }); last = beat; }
      c.next();
      idx++;
    }
    c.reset();
    c.show();
    this.at = 0;
    this.shownStep = 0;
    this.host.scrollLeft = 0;
  }

  /** Put the cursor on whatever is sounding at `beat` (quarters from the top of
   *  the score), scrolled to `anchorX` px from the box's left edge. */
  follow(beat: number, anchorX: number): void {
    const moved = Math.abs(anchorX - this.anchorX) > 1;
    this.anchorX = anchorX;
    const c = this.osmd?.cursor;
    const steps = this.steps;
    if (!c || !steps.length) return;
    // Last stop at or before the beat.
    let lo = 0, hi = steps.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (steps[mid].beat <= beat + 1e-3) lo = mid; else hi = mid - 1;
    }
    if (lo === this.shownStep) {
      if (moved) this.scrollToCursor();
      return;
    }
    this.shownStep = lo;
    const target = steps[lo].idx;
    if (target < this.at) { c.reset(); this.at = 0; }
    while (this.at < target) { c.next(); this.at++; }
    this.scrollToCursor();
  }

  private scrollToCursor(): void {
    const el = this.osmd?.cursor.cursorElement;
    if (!el) return;
    const x = el.getBoundingClientRect().left - this.host.getBoundingClientRect().left;
    const left = Math.max(0, this.host.scrollLeft + x - this.anchorX);
    if (Math.abs(this.host.scrollLeft - left) > 2) this.host.scrollTo({ left, behavior: 'smooth' });
  }
}
