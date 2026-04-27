import type { Note } from './notes';

const LINE_SPACING = 14;   // pixels between staff lines
const STEP_PX     = LINE_SPACING / 2; // pixels per diatonic step

export function drawStaff(canvas: HTMLCanvasElement, note: Note | null, showNoteName = false): void {
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#fafaf8';
  ctx.fillRect(0, 0, W, H);

  // Staff geometry
  const staffLeft  = 70;
  const staffRight = W - 20;
  const bottomY    = H * 0.62; // E4 (step 0) sits here

  // Draw 5 staff lines (steps 0,2,4,6,8 = E4,G4,B4,D5,F5)
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const y = bottomY - i * LINE_SPACING;
    ctx.beginPath();
    ctx.moveTo(staffLeft, y);
    ctx.lineTo(staffRight, y);
    ctx.stroke();
  }

  // Treble clef: draw the 𝄞 glyph
  // Anchored so its G-line (2nd line = step 2) aligns correctly
  ctx.fillStyle = '#333';
  ctx.font = `${LINE_SPACING * 7}px "Bravura", "Bravura Text", "FreeSerif", "Symbola", serif`;
  ctx.textBaseline = 'alphabetic';
  // The glyph's G-curl sits roughly at 65% from top of em-square
  const clefY = bottomY - LINE_SPACING + LINE_SPACING * 7 * 0.2;
  ctx.fillText('\u{1D11E}', staffLeft - 12, clefY);

  if (!note) return;

  const step  = note.staffStep;
  const noteX = staffLeft + (staffRight - staffLeft) * 0.55;
  const noteY = bottomY - step * STEP_PX;

  // Ledger lines below staff (step < 0)
  if (step < 0) {
    const lowestEven = step % 2 === 0 ? step : step + 1;
    for (let s = -2; s >= lowestEven; s -= 2) {
      drawLedger(ctx, noteX, bottomY - s * STEP_PX);
    }
  }

  // Ledger lines above staff (step > 8, top line = F5)
  if (step > 8) {
    const highestEven = step % 2 === 0 ? step : step - 1;
    for (let s = 10; s <= highestEven; s += 2) {
      drawLedger(ctx, noteX, bottomY - s * STEP_PX);
    }
  }

  // Sharp accidental
  if (note.name.includes('#')) {
    ctx.fillStyle = '#1a1a1a';
    ctx.font = `${LINE_SPACING * 2}px "Bravura", "Bravura Text", "FreeSerif", "Symbola", serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText('♯', noteX - 18, noteY);
  }

  // Note head (filled oval, slightly tilted)
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.ellipse(noteX, noteY, 7, 5.2, -0.18, 0, Math.PI * 2);
  ctx.fill();

  // Stem: up if note below B4 (step<4), down otherwise
  const stemUp = step < 4;
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (stemUp) {
    ctx.moveTo(noteX + 6.5, noteY - 1);
    ctx.lineTo(noteX + 6.5, noteY - 36);
  } else {
    ctx.moveTo(noteX - 6.5, noteY + 1);
    ctx.lineTo(noteX - 6.5, noteY + 36);
  }
  ctx.stroke();

  // Optional note name label
  if (showNoteName) {
    ctx.fillStyle = '#555';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    ctx.fillText(note.name, noteX, bottomY + LINE_SPACING * 4 + 4);
  }
}

function drawLedger(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 13, y);
  ctx.lineTo(x + 13, y);
  ctx.stroke();
}
