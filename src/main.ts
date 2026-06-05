import {
  fingeringLabel,
  DEFAULT_MIDIS, PITCH_MIN_MIDI, PITCH_MAX_MIDI,
  spellMidi, buildKeyPool, noteForMidi, TONICS_MAJOR, TONICS_MINOR,
  type Note, type Fingering, type Spelled,
} from './notes';
import { playNote, preloadSounds, setAudioDirectory } from './audio';
import { drawStaff } from './staff';
import { initRealtime, realtimeOnEnter, realtimeOnLeave } from './realtime';

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  mode: 'quiz' as 'quiz' | 'practice' | 'realtime',
  quiz: {
    notes: new Set<number>(DEFAULT_MIDIS), // selected pool, by midi
    spelling: new Map<number, Spelled>(),  // current display spelling per midi
    keyMode: 'major' as 'major' | 'minor',
    type: 'note-to-fingering' as QuizType,
    question: null as QuizQuestion | null,
    answered: false,
    correct: 0,
    total: 0,
  },
  practice: {
    spelling: new Map<number, Spelled>(), // current display spelling per midi
    keyMode: 'major' as 'major' | 'minor',
    midis: [] as number[],                // notes shown in the palette
    activeMidi: null as number | null,    // currently inspected note
    note: null as Note | null,
  },
};

type QuizType = 'note-to-fingering' | 'fingering-to-note' | 'staff-to-note' | 'sound-to-note';

interface QuizQuestion {
  note: Note;
  shownFingering?: Fingering; // for fingering-to-note
  options: string[];          // display labels
  correctIndex: number;
  optionNotes?: Note[];       // for staff-to-note distractors
}

// ── Helpers ────────────────────────────────────────────────────────────────
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickRandom<T>(arr: T[], n: number): T[] {
  return shuffle([...arr]).slice(0, n);
}

// Notes currently selected for the quiz pool, in pitch order.
function quizNotes(): Note[] {
  return [...state.quiz.notes]
    .sort((a, b) => a - b)
    .map(m => noteForMidi(m, state.quiz.spelling.get(m) ?? spellMidi(m, 'sharp')));
}

function midiOctave(m: number): number {
  return Math.floor(m / 12) - 1;
}

function rangeMidis(): number[] {
  const out: number[] = [];
  for (let m = PITCH_MIN_MIDI; m <= PITCH_MAX_MIDI; m++) out.push(m);
  return out;
}

// ── DOM helpers ─────────────────────────────────────────────────────────────
function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

// ── Quiz note pool: key selector + chips ──────────────────────────────────────
function renderChips(): void {
  const groups = new Map<number, number[]>();
  for (const m of rangeMidis()) {
    const o = midiOctave(m);
    if (!groups.has(o)) groups.set(o, []);
    groups.get(o)!.push(m);
  }

  let html = '';
  for (const [oct, list] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    html += `<div class="note-octave">`;
    html += `<button class="note-octave-label" data-octave="${oct}">${oct}组</button>`;
    html += `<div class="note-octave-chips">`;
    for (const m of list) {
      const sp = state.quiz.spelling.get(m) ?? spellMidi(m, 'sharp');
      const on = state.quiz.notes.has(m) ? ' active' : '';
      html += `<button class="note-chip${on}" data-midi="${m}">${sp.name}</button>`;
    }
    html += `</div></div>`;
  }
  el('quiz-note-picker').innerHTML = html;
}

function refreshPickerActive(): void {
  el('quiz-note-picker').querySelectorAll<HTMLButtonElement>('.note-chip').forEach(c => {
    c.classList.toggle('active', state.quiz.notes.has(Number(c.dataset.midi)));
  });
}

function fillTonicSelect(sel: HTMLSelectElement, keyMode: 'major' | 'minor'): void {
  const tonics = keyMode === 'major' ? TONICS_MAJOR : TONICS_MINOR;
  const suffix = keyMode === 'major' ? '大调' : '小调';
  const prev = sel.value;
  sel.innerHTML = `<option value="">自定义</option>` +
    tonics.map(t => `<option value="${t}">${t}${suffix}</option>`).join('');
  sel.value = tonics.includes(prev) ? prev : '';
}

// Fill the pool from the selected key (empty tonic = leave manual selection).
function applyKey(): void {
  const tonic = el<HTMLSelectElement>('key-tonic').value;
  if (!tonic) return;
  const { midis, spelling } = buildKeyPool(tonic, state.quiz.keyMode);
  state.quiz.spelling = spelling;
  state.quiz.notes = new Set(midis);
  renderChips();
  onPoolChange();
}

function setupQuizPool(): void {
  // Default spelling: sharps for black keys across the whole range.
  for (const m of rangeMidis()) state.quiz.spelling.set(m, spellMidi(m, 'sharp'));

  fillTonicSelect(el('key-tonic'), state.quiz.keyMode);
  renderChips();

  // chip toggle + whole-octave toggle (event delegation; survives re-render)
  el('quiz-note-picker').addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const chip = target.closest<HTMLButtonElement>('.note-chip');
    if (chip) {
      const m = Number(chip.dataset.midi);
      if (state.quiz.notes.has(m)) state.quiz.notes.delete(m);
      else state.quiz.notes.add(m);
      chip.classList.toggle('active');
      onPoolChange();
      return;
    }
    const octBtn = target.closest<HTMLButtonElement>('.note-octave-label');
    if (octBtn) {
      const oct = Number(octBtn.dataset.octave);
      const ms = rangeMidis().filter(m => midiOctave(m) === oct);
      const allOn = ms.every(m => state.quiz.notes.has(m));
      for (const m of ms) { if (allOn) state.quiz.notes.delete(m); else state.quiz.notes.add(m); }
      refreshPickerActive();
      onPoolChange();
    }
  });

  // 全选 / 清空
  el('quiz-panel').querySelectorAll<HTMLButtonElement>('.note-pool-head .toggle[data-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.act === 'all') for (const m of rangeMidis()) state.quiz.notes.add(m);
      else state.quiz.notes.clear();
      refreshPickerActive();
      onPoolChange();
    });
  });

  // 大调 / 小调 toggle
  el('key-mode').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.toggle');
    if (!btn) return;
    el('key-mode').querySelectorAll('.toggle').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    state.quiz.keyMode = btn.dataset.mode as 'major' | 'minor';
    fillTonicSelect(el('key-tonic'), state.quiz.keyMode);
    applyKey();
  });

  el('key-tonic').addEventListener('change', applyKey);
}

function onPoolChange(): void {
  state.quiz.question = null;
  state.quiz.answered = false;
  newQuestion();
}

// ── Tabs ────────────────────────────────────────────────────────────────────
function setupTabs(): void {
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const prev = state.mode;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.mode = tab.dataset.mode as 'quiz' | 'practice' | 'realtime';
      el('quiz-panel').classList.toggle('active', state.mode === 'quiz');
      el('practice-panel').classList.toggle('active', state.mode === 'practice');
      el('realtime-panel').classList.toggle('active', state.mode === 'realtime');
      document.body.classList.toggle('mode-realtime', state.mode === 'realtime');
      if (prev === 'realtime' && state.mode !== 'realtime') realtimeOnLeave();
      if (state.mode === 'quiz') newQuestion();
      else if (state.mode === 'practice') renderPractice();
      else if (state.mode === 'realtime') realtimeOnEnter();
    });
  });
}

// ── Quiz Mode ───────────────────────────────────────────────────────────────
function setupQuiz(): void {
  el('quiz-type').addEventListener('change', (e) => {
    state.quiz.type = (e.target as HTMLSelectElement).value as QuizType;
    newQuestion();
  });

  el('next-btn').addEventListener('click', newQuestion);

  el('quiz-play-btn').addEventListener('click', () => {
    if (state.quiz.question) {
      const n = state.quiz.question.note;
      playNote(n.name, n.frequency);
    }
  });
}

function newQuestion(): void {
  const notes = quizNotes();
  if (notes.length < 4) {
    el('quiz-question-text').textContent = '请至少选择4个可用音符的配置';
    el('quiz-options').innerHTML = '';
    return;
  }

  const q = generateQuestion(state.quiz.type, notes);
  if (!q) {
    // Fingering question types need notes that actually have fingerings.
    el('quiz-question-text').textContent = '当前音符没有指法数据，请改用「五线谱 / 声音」题型，或选择含指法的音';
    el('quiz-options').innerHTML = '';
    el('quiz-feedback').textContent = '';
    el('quiz-play-btn').style.display = 'none';
    el<HTMLCanvasElement>('quiz-canvas').style.display = 'none';
    return;
  }
  state.quiz.question = q;
  state.quiz.answered = false;
  renderQuestion(q);
}

function generateQuestion(type: QuizType, notes: Note[]): QuizQuestion | null {
  const pickAny = () => notes[Math.floor(Math.random() * notes.length)];

  if (type === 'note-to-fingering') {
    // Show note name (+ play), choose correct fingering. Answer must have one.
    const fingered = notes.filter(n => n.fingerings.length > 0);
    if (fingered.length === 0) return null;
    const note = fingered[Math.floor(Math.random() * fingered.length)];
    const correctF = note.fingerings[Math.floor(Math.random() * note.fingerings.length)];
    const correctLabel = fingeringLabel(correctF);

    // Wrong: fingerings from other notes
    const otherFingerings: Fingering[] = [];
    for (const n of notes) {
      if (n.name === note.name) continue;
      otherFingerings.push(...n.fingerings);
    }
    if (otherFingerings.length < 3) return null;
    const wrongs = pickRandom(otherFingerings, 3).map(fingeringLabel);

    const options = [correctLabel, ...wrongs];
    shuffle(options);
    return { note, options, correctIndex: options.indexOf(correctLabel) };
  }

  if (type === 'fingering-to-note') {
    // Show fingering, choose correct note name. Answer must have one.
    const fingered = notes.filter(n => n.fingerings.length > 0);
    if (fingered.length === 0) return null;
    const note = fingered[Math.floor(Math.random() * fingered.length)];
    const shownFingering = note.fingerings[Math.floor(Math.random() * note.fingerings.length)];
    const wrongNotes = pickRandom(notes.filter(n => n.name !== note.name), 3);
    const options = [note.name, ...wrongNotes.map(n => n.name)];
    shuffle(options);
    return { note, shownFingering, options, correctIndex: options.indexOf(note.name) };
  }

  if (type === 'staff-to-note') {
    // Show staff without name, choose correct note name
    const note = pickAny();
    const wrongNotes = pickRandom(notes.filter(n => n.name !== note.name), 3);
    const options = [note.name, ...wrongNotes.map(n => n.name)];
    shuffle(options);
    return { note, options, correctIndex: options.indexOf(note.name) };
  }

  if (type === 'sound-to-note') {
    // Play sound only, choose correct note name
    const note = pickAny();
    const wrongNotes = pickRandom(notes.filter(n => n.name !== note.name), 3);
    const options = [note.name, ...wrongNotes.map(n => n.name)];
    shuffle(options);
    return { note, options, correctIndex: options.indexOf(note.name) };
  }

  return null;
}

function renderQuestion(q: QuizQuestion): void {
  const type = state.quiz.type;
  const questionEl = el('quiz-question-text');
  const canvas = el<HTMLCanvasElement>('quiz-canvas');
  const playBtn = el('quiz-play-btn');
  const feedbackEl = el('quiz-feedback');
  const optionsEl = el('quiz-options');

  feedbackEl.textContent = '';
  feedbackEl.className = 'feedback';

  if (type === 'note-to-fingering') {
    questionEl.textContent = q.note.name;
    drawStaff(canvas, null);
    canvas.style.display = 'none';
    playBtn.style.display = 'inline-block';
  } else if (type === 'fingering-to-note') {
    questionEl.textContent = q.shownFingering ? fingeringLabel(q.shownFingering) : '';
    drawStaff(canvas, null);
    canvas.style.display = 'none';
    playBtn.style.display = 'none';
  } else if (type === 'staff-to-note') {
    questionEl.textContent = '';
    canvas.style.display = 'block';
    drawStaff(canvas, q.note, false);
    playBtn.style.display = 'none';
  } else if (type === 'sound-to-note') {
    questionEl.textContent = '听声音，选音名';
    drawStaff(canvas, null);
    canvas.style.display = 'none';
    playBtn.style.display = 'inline-block';
    playNote(q.note.name, q.note.frequency);
  }

  // Render option buttons
  const labels = ['A', 'B', 'C', 'D'];
  optionsEl.innerHTML = q.options.map((opt, i) => `
    <button class="option-btn" data-index="${i}">
      <span class="label">${labels[i]}.</span>
      <span>${opt}</span>
    </button>
  `).join('');

  optionsEl.querySelectorAll<HTMLButtonElement>('.option-btn').forEach(btn => {
    btn.addEventListener('click', () => onAnswer(Number(btn.dataset.index)));
  });
}

function onAnswer(chosen: number): void {
  if (state.quiz.answered) return;
  state.quiz.answered = true;
  const q = state.quiz.question!;
  const correct = chosen === q.correctIndex;

  state.quiz.total++;
  if (correct) state.quiz.correct++;

  // Update score
  el('quiz-score').textContent = `${state.quiz.correct} / ${state.quiz.total}`;

  // Color options
  el('quiz-options').querySelectorAll<HTMLButtonElement>('.option-btn').forEach((btn, i) => {
    btn.disabled = true;
    if (i === q.correctIndex) btn.classList.add('correct');
    else if (i === chosen)    btn.classList.add('wrong');
  });

  // Feedback
  const feedbackEl = el('quiz-feedback');
  if (correct) {
    feedbackEl.textContent = '正确！';
    feedbackEl.className = 'feedback correct';
  } else {
    feedbackEl.textContent = `错误。正确答案：${q.options[q.correctIndex]}`;
    feedbackEl.className = 'feedback wrong';
  }

  // Show staff after answering
  if (state.quiz.type === 'note-to-fingering' || state.quiz.type === 'sound-to-note') {
    const canvas = el<HTMLCanvasElement>('quiz-canvas');
    canvas.style.display = 'block';
    drawStaff(canvas, q.note, true);
  }
}

// ── Practice Mode ───────────────────────────────────────────────────────────
// Same key control as the quiz: pick 大调/小调 + 主音 to show that scale's notes
// (full chromatic range when 自定义). Click a note to inspect staff + fingerings.
function setupPracticePool(): void {
  for (const m of rangeMidis()) state.practice.spelling.set(m, spellMidi(m, 'sharp'));
  state.practice.midis = rangeMidis();

  fillTonicSelect(el('practice-key-tonic'), state.practice.keyMode);
  buildPracticeNotes();

  el('practice-key-mode').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.toggle');
    if (!btn) return;
    el('practice-key-mode').querySelectorAll('.toggle').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    state.practice.keyMode = btn.dataset.mode as 'major' | 'minor';
    fillTonicSelect(el('practice-key-tonic'), state.practice.keyMode);
    applyPracticeKey();
  });

  el('practice-key-tonic').addEventListener('change', applyPracticeKey);
}

function applyPracticeKey(): void {
  const tonic = el<HTMLSelectElement>('practice-key-tonic').value;
  if (!tonic) {
    for (const m of rangeMidis()) state.practice.spelling.set(m, spellMidi(m, 'sharp'));
    state.practice.midis = rangeMidis();
  } else {
    const { midis, spelling } = buildKeyPool(tonic, state.practice.keyMode);
    state.practice.spelling = spelling;
    state.practice.midis = midis;
  }
  // Drop the inspected note if it's no longer shown.
  if (state.practice.activeMidi !== null && !state.practice.midis.includes(state.practice.activeMidi)) {
    state.practice.activeMidi = null;
    state.practice.note = null;
  }
  buildPracticeNotes();
  renderPractice();
}

function buildPracticeNotes(): void {
  const palette = el('note-palette');

  palette.innerHTML = state.practice.midis.map(m => {
    const sp = state.practice.spelling.get(m) ?? spellMidi(m, 'sharp');
    const on = state.practice.activeMidi === m ? ' active' : '';
    return `<button class="note-btn${on}" data-midi="${m}">${sp.name}</button>`;
  }).join('');

  palette.querySelectorAll<HTMLButtonElement>('.note-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('active')) return;
      const m = Number(btn.dataset.midi);
      const sp = state.practice.spelling.get(m) ?? spellMidi(m, 'sharp');
      state.practice.activeMidi = m;
      state.practice.note = noteForMidi(m, sp);
      palette.querySelectorAll('.note-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderPractice();
      playNote(state.practice.note.name, state.practice.note.frequency);
    });
  });
}

function renderPractice(): void {
  const note = state.practice.note;
  const canvas = el<HTMLCanvasElement>('practice-canvas');
  const nameEl = el('practice-note-name');
  const fingeringsEl = el('practice-fingerings');

  if (!note) {
    drawStaff(canvas, null);
    nameEl.textContent = '';
    fingeringsEl.innerHTML = '';
    return;
  }

  drawStaff(canvas, note, false);
  nameEl.textContent = note.name;
  fingeringsEl.innerHTML = note.fingerings.length
    ? note.fingerings.map(f => `<span class="fingering-tag">${fingeringLabel(f)}</span>`).join('')
    : `<span class="palette-empty">无指法数据</span>`;
}

// ── Audio directory picker ────────────────────────────────────────────────────
function setupAudioDirPicker(): void {
  el('pick-audio-dir').addEventListener('click', async () => {
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: 'read' });
      setAudioDirectory(handle);
      el('audio-dir-name').textContent = handle.name;
    } catch {
      // user cancelled
    }
  });
}

// ── Boot ─────────────────────────────────────────────────────────────────────
setupQuizPool();
setupTabs();
setupQuiz();
setupAudioDirPicker();
setupPracticePool();
newQuestion();
initRealtime();

// Release mic if user navigates away from the page entirely
window.addEventListener('beforeunload', () => realtimeOnLeave());
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') realtimeOnLeave();
});
