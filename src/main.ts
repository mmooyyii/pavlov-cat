import { getFilteredNotes, fingeringLabel, NOTES_BY_NAME, type Note, type StringName, type Fingering } from './notes';
import { playNote, preloadSounds, setAudioDirectory } from './audio';
import { drawStaff } from './staff';

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  positions: [1] as number[],
  strings: ['G', 'D', 'A', 'E'] as StringName[],
  mode: 'quiz' as 'quiz' | 'practice',
  quiz: {
    type: 'note-to-fingering' as QuizType,
    question: null as QuizQuestion | null,
    answered: false,
    correct: 0,
    total: 0,
  },
  practice: {
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

function filteredNotes(): Note[] {
  return getFilteredNotes(state.positions, state.strings);
}

// ── DOM helpers ─────────────────────────────────────────────────────────────
function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

// ── Config toggles ──────────────────────────────────────────────────────────
function setupConfig(): void {
  el('position-toggles').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.toggle');
    if (!btn) return;
    const val = Number(btn.dataset.value);
    const idx = state.positions.indexOf(val);
    if (idx >= 0) {
      if (state.positions.length === 1) return; // keep at least one
      state.positions.splice(idx, 1);
      btn.classList.remove('active');
    } else {
      state.positions.push(val);
      btn.classList.add('active');
    }
    onConfigChange();
  });

  el('string-toggles').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.toggle');
    if (!btn) return;
    const val = btn.dataset.value as StringName;
    const idx = state.strings.indexOf(val);
    if (idx >= 0) {
      if (state.strings.length === 1) return;
      state.strings.splice(idx, 1);
      btn.classList.remove('active');
    } else {
      state.strings.push(val);
      btn.classList.add('active');
    }
    onConfigChange();
  });
}

function onConfigChange(): void {
  state.quiz.question = null;
  state.quiz.answered = false;
  buildPracticeNotes();
  if (state.mode === 'quiz') newQuestion();
  else renderPractice();
}

// ── Tabs ────────────────────────────────────────────────────────────────────
function setupTabs(): void {
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.mode = tab.dataset.mode as 'quiz' | 'practice';
      el('quiz-panel').classList.toggle('active', state.mode === 'quiz');
      el('practice-panel').classList.toggle('active', state.mode === 'practice');
      if (state.mode === 'quiz') newQuestion();
      else renderPractice();
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
  const notes = filteredNotes();
  if (notes.length < 4) {
    el('quiz-question-text').textContent = '请至少选择4个可用音符的配置';
    el('quiz-options').innerHTML = '';
    return;
  }

  const q = generateQuestion(state.quiz.type, notes);
  if (!q) return;
  state.quiz.question = q;
  state.quiz.answered = false;
  renderQuestion(q);
}

function generateQuestion(type: QuizType, notes: Note[]): QuizQuestion | null {
  const note = notes[Math.floor(Math.random() * notes.length)];

  if (type === 'note-to-fingering') {
    // Show note name (+ play), choose correct fingering
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
    // Show fingering, choose correct note name
    const shownFingering = note.fingerings[Math.floor(Math.random() * note.fingerings.length)];
    const wrongNotes = pickRandom(notes.filter(n => n.name !== note.name), 3);
    const options = [note.name, ...wrongNotes.map(n => n.name)];
    shuffle(options);
    return { note, shownFingering, options, correctIndex: options.indexOf(note.name) };
  }

  if (type === 'staff-to-note') {
    // Show staff without name, choose correct note name
    const wrongNotes = pickRandom(notes.filter(n => n.name !== note.name), 3);
    const options = [note.name, ...wrongNotes.map(n => n.name)];
    shuffle(options);
    return { note, options, correctIndex: options.indexOf(note.name) };
  }

  if (type === 'sound-to-note') {
    // Play sound only, choose correct note name
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
const POS_LABEL = ['', '一', '二', '三'];
const STRING_ORDER: StringName[] = ['G', 'D', 'A', 'E'];

function buildPracticeNotes(): void {
  const allNotes = filteredNotes();
  const palette = el('note-palette');

  const positions = [...state.positions].sort((a, b) => a - b);
  const strings = STRING_ORDER.filter(s => state.strings.includes(s));

  let html = '';
  for (const pos of positions) {
    // Build lookup: "finger-string" → note
    const cell = new Map<string, Note>();
    for (const n of allNotes) {
      for (const f of n.fingerings) {
        if (f.position === pos) cell.set(`${f.finger}-${f.string}`, n);
      }
    }

    const cols = `28px ${strings.map(() => '1fr').join(' ')}`;
    html += `<div class="palette-position">`;
    html += `<div class="palette-pos-label">${POS_LABEL[pos]}把位</div>`;
    html += `<div class="palette-grid" style="grid-template-columns:${cols}">`;

    // Header row: corner + string labels
    html += `<div></div>`;
    for (const str of strings) {
      html += `<div class="palette-grid-str">${str}</div>`;
    }

    // Finger rows: 0 → 4
    for (let finger = 0; finger <= 4; finger++) {
      html += `<div class="palette-grid-finger">${finger === 0 ? '○' : finger}</div>`;
      for (const str of strings) {
        const note = cell.get(`${finger}-${str}`);
        if (note) {
          html += `<button class="note-btn" data-name="${note.name}">${note.name}</button>`;
        } else {
          html += `<div class="palette-grid-empty"></div>`;
        }
      }
    }

    html += `</div></div>`;
  }

  palette.innerHTML = html;

  palette.querySelectorAll<HTMLButtonElement>('.note-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('active')) return;
      const name = btn.dataset.name!;
      const note = allNotes.find(n => n.name === name) ?? null;
      state.practice.note = note;
      palette.querySelectorAll('.note-btn').forEach(b => b.classList.remove('active'));
      palette.querySelectorAll<HTMLButtonElement>('.note-btn').forEach(b => {
        if (b.dataset.name === name) b.classList.add('active');
      });
      renderPractice();
      if (note) playNote(note.name, note.frequency);
    });
  });

  if (state.practice.note) {
    const name = state.practice.note.name;
    palette.querySelectorAll<HTMLButtonElement>('.note-btn').forEach(b => {
      if (b.dataset.name === name) b.classList.add('active');
    });
  }
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
  fingeringsEl.innerHTML = note.fingerings
    .map(f => `<span class="fingering-tag">${fingeringLabel(f)}</span>`)
    .join('');
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
setupConfig();
setupTabs();
setupQuiz();
setupAudioDirPicker();
buildPracticeNotes();
newQuestion();
