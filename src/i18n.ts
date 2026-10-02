// ── i18n ─────────────────────────────────────────────────────────────────────
// Two dictionaries, zh as the source of truth: `en` must carry every key of
// `zh` (the type enforces it). `{name}` placeholders are filled by t().
//
// Static markup is tagged in index.html:
//   data-i18n="key"        → textContent
//   data-i18n-html="key"   → innerHTML (help lists with <b>/<li>)
//   data-i18n-title="key"  → title attribute
//   data-i18n-aria="key"   → aria-label attribute

const zh = {
  // header / tabs
  'tab.scale': '跟音阶',
  'tab.score': '跟乐谱',
  'tab.tuner': '调弦',

  // toolbar
  'tb.key': '调',
  'tb.score': '曲目',
  'tb.scoreBtnTitle': '打开曲库,按文件夹挑谱',
  'tb.metronome': '节拍器',
  'tb.record': '录音',
  'tb.recordTitle': '开着就录下你拉的每一遍;点「↺ 重来」存下这一遍并接着录下一遍,录好的在下面直接回放',
  'tb.drone': '参考音',
  'tb.settings': '更多设置',
  'common.on': '开',
  'common.off': '关',
  'drone.root': '主音',
  'drone.fifth': '主音+五度',

  // score library
  'lib.title': '曲库',
  'lib.samples': '示例',
  'lib.dirBtn': '📁 文件夹',
  'lib.dirTitle': '选一个装乐谱的文件夹,里面的 .musicxml / .mxl 连同子文件夹都会列进曲库,点到哪首才读哪首。再选一次同一个文件夹可以刷新。安卓上若点了没反应,改用右边「选文件」多选。',
  'lib.scanning': '正在读取目录…',
  'lib.scanFailed': '读取文件夹失败',
  'lib.indexed': '已列出 {n} 首',
  'lib.noPermission': '没有这个文件夹的读取权限 — 再点一次这首,在弹窗里选「允许」',
  'lib.loadFailed': '读不到「{title}」:文件可能已移动或删除,重新选一次文件夹刷新曲库',
  'lib.fileBtn': '📄 选文件',
  'lib.fileTitle': '在文件选择器里多选乐谱(安卓平板上用这个)',
  'lib.empty': '曲库为空',
  'lib.pick': '选一首…',
  'lib.emptyHint': '还没有乐谱。点上面「📁 文件夹」,选一个装乐谱的文件夹,里面的 .musicxml / .mxl 连同子目录都会列进来;平板上用「📄 选文件」挑几首。',
  'lib.noteCount': '{n} 音',
  'lib.remove': '从曲库移除',
  'lib.removeAria': '移除 {title}',
  'lib.noScores': '这个文件夹里没有乐谱(.musicxml / .xml / .mxl)',
  'lib.importing': '正在导入 {n} 个乐谱…',
  'lib.importAllFailed': '导入失败:{n} 个文件都解析不了',
  'lib.writeFailed': '曲库写入失败',
  'lib.imported': '已导入 {n} 首',
  'lib.parseFailed': '{n} 首解析失败',
  'lib.total': '曲库共 {n} 首',
  'lib.listSep': ',',
  'lib.deleteFailed': '删除失败',
  'lib.removed': '已移除',
  'lib.removedTitle': '已移除:{title}',

  // settings panel
  'set.metronome': '节拍器',
  'set.accent': '每 N 拍重音',
  'set.countIn': '预备拍',
  'set.countInTitle': '按「开始 / 继续」后原地空打几拍再进入,竖线上会倒数 4·3·2·1。这几拍一定有节拍声,节拍器关着也响。0 = 立刻开始',
  'set.sound': '音色',
  'sound.wood': '木质打点',
  'sound.click': '电子 click',
  'sound.tom': '低音鼓点',
  'sound.hihat': 'Hi-hat',
  'set.judge': '音准判定',
  'set.judgeColor': '判定着色',
  'set.tolerance': '容差 (¢) 绿 / 黄',
  'set.tolGoodTitle': '绿色阈值:误差 ≤ 此值(音分)',
  'set.tolMedTitle': '黄色阈值:误差 ≤ 此值(音分),超出则红色',
  'set.temperament': '音准标准',
  'set.temperamentTitle': '标准=平均律,通用;更协和=纯律,某些音更贴合和声、更干净。不确定就用标准。',
  'temp.equal': '标准',
  'temp.just': '更协和',
  'set.display': '显示',
  'set.range': '音域',
  'set.visibleBeats': '显示拍数',
  'set.unit': '时间单位',
  'unit.beat': '拍',
  'unit.second': '秒',
  'set.drone': '参考音',
  'set.droneRoot': '根音',
  'set.droneRootTitle': '参考长音的音高(拉琴时用它对音准)。跟音阶模式下自动跟随该调主音。',
  'set.device': '设备',
  'set.mic': '麦克风',
  'set.micTitle': '选择收音设备。Mac mini 无内置麦时,可选 iPhone(连续互通麦克风)',
  'set.micHelpTitle': '没有麦克风 / 换设备收音?',
  'set.micHelpAria': '收音帮助',
  'set.latency': '节奏延迟',
  'set.calibrate': '校准延迟',
  'set.calibrateTitle': '播放节拍声测量麦克风延迟,让节奏评分更准(需让麦克风能听到音箱声)',
  'set.language': '语言',
  'help.macTitle': 'Mac(无内置麦)用 iPhone 收音:',
  'help.macSteps':
    '<li>Mac 与 iPhone 登录同一 Apple ID,都打开 Wi-Fi 和蓝牙并靠近(macOS Ventura+、iOS 16+)。</li>' +
    '<li>iPhone:设置 → 通用 → 隔空播放与接力 → 打开「连续互通相机」(这一项同时管麦克风)。</li>' +
    '<li>回到本页点一次「▶ 开始」授权麦克风 —— 「麦克风」下拉会出现"xxx 的 iPhone 麦克风",检测到会自动选中,也可手动选。或在 系统设置 → 声音 → 输入 里固定选 iPhone。</li>' +
    '<li>iPhone 无线收音延迟较大:要看节奏评分,先点一次「校准延迟」(需让 iPhone 能听到电脑音箱的节拍声)。</li>',
  'help.androidTitle': '安卓平板 / 手机:',
  'help.androidSteps':
    '<li>直接用平板浏览器(推荐 Chrome)打开本页,点「▶ 开始」后在弹窗里允许使用麦克风,自带麦克风即可收音。</li>' +
    '<li>外接 USB / 蓝牙麦克风后,可在「麦克风」下拉里切换;蓝牙麦克风延迟大,建议同样先「校准延迟」。</li>' +
    '<li>提示:浏览器只在 https(或 localhost)下允许用麦克风,局域网 IP 直接访问会拿不到权限。</li>',

  // transport
  'btn.start': '▶ 开始',
  'btn.resume': '▶ 继续',
  'btn.pause': '⏸ 暂停',
  'btn.stop': '⏸ 停止',
  'btn.redo': '↺ 重来',
  'btn.redoTitle': '这一遍到此为止:清空轨迹回到第一拍,正在录的话也一并存成一段录音',
  'btn.fullscreen': '全屏 / 退出全屏',
  'btn.fullscreenAria': '全屏',

  // status / errors
  'mic.denied': '浏览器拒绝了麦克风权限 — 点地址栏右侧的图标改为「允许」,再按开始',
  'mic.notFound': '没有找到麦克风 — Mac 可用 iPhone 连续互通收音:⚙ → 设备 → 点 ? 看设置方法',
  'mic.failed': '无法访问麦克风,请检查权限或换一个输入设备',
  'mic.failedShort': '无法访问麦克风,请检查权限或设备',
  'mic.autoIphone': '已自动选择 iPhone 麦克风',
  'mic.default': '系统默认输入',
  'mic.unnamed': '麦克风',
  'mic.switchFailed': '无法切换到该输入设备',
  'canvas.cannotStart': '⚠ 无法开始',
  'status.paused': '已暂停',
  'status.pausedRec': '已暂停 · 录音跟着停住了,点「↺ 重来」就保存这一段',
  'status.rewound': '已回到第一拍,准备好按「继续」',
  'status.noFullscreen': '当前浏览器不支持全屏',

  // recording
  'rec.armed': '已开启录音,点「▶ 开始」就会录下这一遍',
  'rec.micNotReady': '无法录音:麦克风未就绪',
  'rec.unsupported': '当前浏览器不支持录音',
  'rec.saved': '录好了 {dur},在下面可以直接播放',
  'rec.recording': '录音中…',
  'rec.title': '本次录音',
  'rec.clear': '清空',
  'rec.download': '下载这段录音',
  'rec.downloadAria': '下载',
  'rec.delete': '删掉这段录音',
  'rec.deleteAria': '删除',

  // calibration
  'cal.micNotReady': '校准失败:麦克风未就绪',
  'cal.running': '校准中…请保持安静,让节拍声能被麦克风听到',
  'cal.noClick': '没听到节拍声:请调大音量、或让麦克风离音箱近一点再试',
  'cal.done': '已校准:麦克风延迟约 {ms}ms',

  // report
  'rep.tendHigh': '整体偏高 {c}¢,容易拉高',
  'rep.tendLow': '整体偏低 {c}¢,容易拉低',
  'rep.allGood': '音准很稳,继续保持!',
  'rep.worstTitle': '最需要注意',
  'rep.noteHigh': '<b>{name}</b> 平均偏高 {c}¢ · 手指往下挪一点点',
  'rep.noteLow': '<b>{name}</b> 平均偏低 {c}¢ · 手指往上挪一点点',
  'rep.late': '偏晚 {ms}ms',
  'rep.early': '偏早 {ms}ms',
  'rep.onTime': '基本准时',
  'rep.uncalibrated': '(未校准延迟,偏早/晚仅供参考)',
  'rep.rhythm': '节奏(近似):准时 {pct}% · 平均偏差 {ms}ms · {tend}',
  'rep.score': '评分',
  'rep.onset': '起音即准 {pct}%({n} 个音)',
  'rep.slideUp': '常从低处滑上去(平均 {c}¢)',
  'rep.slideDown': '常从高处落下来(平均 {c}¢)',
  'rep.vibrato': '揉弦 {n} 个音 · {hz} Hz · 幅度 ±{w}¢(按摆动中心判音准)',
  'rep.vibSlow': '偏慢',
  'rep.vibFast': '偏快偏紧',
  'rep.vibWide': '偏宽',
  'next.rhythm': '下一步:节奏还不稳,降到 {bpm} BPM、开着节拍器再拉一遍,先求稳再求快。',
  'next.rhythmBtn': '{bpm} BPM + 节拍器 再来',
  'next.onset': '下一步:起音常要「找」,落指前先在心里唱出这个音;降到 {bpm} BPM,给左手留出准备时间。',
  'next.slowerBtn': '降到 {bpm} BPM 再来',
  'next.tendHigh': '下一步:整体偏高,开「主音+五度」参考音,对着长音再拉一遍,听到「拍」(声音一抖一抖)就是没对上。',
  'next.tendLow': '下一步:整体偏低,开「主音+五度」参考音,对着长音再拉一遍,听到「拍」(声音一抖一抖)就是没对上。',
  'next.droneBtn': '开参考音 再来',
  'next.note': '下一步:单练 <b>{name}</b>:对着同名参考音慢慢拉长音,调到声音不再「拍」为止,记住这个手指位置,再放回乐句里。',
  'next.noteBtn': '参考音设为 {name}',
  'next.faster': '下一步:这一遍很稳,提速到 {bpm} BPM 试试。',
  'next.fasterBtn': '{bpm} BPM 再来',
  'rep.bars': '在调 {a}% · 接近 {b}% · 跑调 {c}%',

  // tuner
  'tuner.idle': '按「开始」并拉一个空弦',
  'tuner.play': '拉一个音…',
  'tuner.flat': '偏低 ♭',
  'tuner.inTune': '准',
  'tuner.sharp': '偏高 ♯',
  'tuner.good': '准 ✓',
  'tuner.low': '偏低 {c}¢ · 调紧一点',
  'tuner.high': '偏高 +{c}¢ · 调松一点',
  'tuner.hint': '拉空弦,让指针停在正中间。偏左=音偏低(把弦调紧一点),偏右=音偏高(调松一点)。基准 A4 = 442 Hz。',

  // keys (music.ts)
  'key.major': '{tonic} 大调',
  'key.minor': '{tonic} 小调',
  'key.majorGroup': '大调',
  'key.minorGroup': '小调',
  'key.noAccidentals': '无升降号',

  // parse / storage errors
  'err.dbOpen': 'IndexedDB 打开失败',
  'err.dbRead': '读取曲库失败',
  'err.dbWrite': '写入曲库失败',
  'err.dbAbort': '写入曲库中止',
  'err.dbDelete': '删除失败',
  'err.dbClear': '清空曲库失败',
  'err.mxlInvalid': '不是有效的 .mxl 压缩包',
  'err.mxlCorrupt': '压缩包损坏:{name}',
  'err.mxlMethod': '不支持的压缩方式({m})',
  'err.mxlNoDecompress': '这个浏览器不支持解压 .mxl,请换新版 Chrome / Safari,或导出未压缩的 .musicxml',
  'err.mxlEmpty': '压缩包是空的',
  'err.mxlNoXml': '压缩包里没有找到 MusicXML',
  'err.xmlInvalid': '文件解析失败:不是有效的 MusicXML',
  'err.xmlNoPart': '乐谱里没有找到声部(part)',
  'err.xmlNoNotes': '乐谱里没有可练习的音符',
};

export type MsgKey = keyof typeof zh;

const en: Record<MsgKey, string> = {
  'tab.scale': 'Scales',
  'tab.score': 'Scores',
  'tab.tuner': 'Tuner',

  'tb.key': 'Key',
  'tb.score': 'Piece',
  'tb.scoreBtnTitle': 'Open the library and pick a piece by folder',
  'tb.metronome': 'Metronome',
  'tb.record': 'Record',
  'tb.recordTitle': 'When on, every run-through is recorded; press "↺ Restart" to save this take and start the next. Takes play back below.',
  'tb.drone': 'Drone',
  'tb.settings': 'More settings',
  'common.on': 'On',
  'common.off': 'Off',
  'drone.root': 'Tonic',
  'drone.fifth': 'Tonic + 5th',

  'lib.title': 'Library',
  'lib.samples': 'Samples',
  'lib.dirBtn': '📁 Folder',
  'lib.dirTitle': 'Pick a folder of scores: every .musicxml / .mxl inside, subfolders included, is listed in the library and read only when you open it. Pick the same folder again to refresh. If nothing happens on Android, use "Files" on the right instead.',
  'lib.scanning': 'Reading folder…',
  'lib.scanFailed': 'Could not read the folder',
  'lib.indexed': 'Listed {n}',
  'lib.noPermission': 'No permission to read this folder — tap the piece again and choose "Allow"',
  'lib.loadFailed': 'Cannot read "{title}": the file may have been moved or deleted; pick the folder again to refresh',
  'lib.fileBtn': '📄 Files',
  'lib.fileTitle': 'Multi-select scores in the file picker (use this on Android tablets)',
  'lib.empty': 'Library is empty',
  'lib.pick': 'Pick a piece…',
  'lib.emptyHint': 'No scores yet. Tap "📁 Folder" above and pick a folder of scores — every .musicxml / .mxl inside, subfolders included, is listed; on a tablet use "📄 Files" to pick a few.',
  'lib.noteCount': '{n} notes',
  'lib.remove': 'Remove from library',
  'lib.removeAria': 'Remove {title}',
  'lib.noScores': 'No scores in this folder (.musicxml / .xml / .mxl)',
  'lib.importing': 'Importing {n} scores…',
  'lib.importAllFailed': 'Import failed: none of the {n} files could be parsed',
  'lib.writeFailed': 'Could not save to the library',
  'lib.imported': 'Imported {n}',
  'lib.parseFailed': '{n} failed to parse',
  'lib.total': '{n} in library',
  'lib.listSep': ', ',
  'lib.deleteFailed': 'Delete failed',
  'lib.removed': 'Removed',
  'lib.removedTitle': 'Removed: {title}',

  'set.metronome': 'Metronome',
  'set.accent': 'Accent every N beats',
  'set.countIn': 'Count-in',
  'set.countInTitle': 'After "Start / Resume", click this many beats in place before going on; the playhead counts down 4·3·2·1. These beats always sound, even with the metronome off. 0 = start at once',
  'set.sound': 'Sound',
  'sound.wood': 'Wood block',
  'sound.click': 'Electronic click',
  'sound.tom': 'Low tom',
  'sound.hihat': 'Hi-hat',
  'set.judge': 'Intonation',
  'set.judgeColor': 'Color by accuracy',
  'set.tolerance': 'Tolerance (¢) green / yellow',
  'set.tolGoodTitle': 'Green threshold: error ≤ this many cents',
  'set.tolMedTitle': 'Yellow threshold: error ≤ this many cents; beyond is red',
  'set.temperament': 'Tuning',
  'set.temperamentTitle': 'Standard = equal temperament, the general choice; Pure = just intonation, some notes sit cleaner against the harmony. If unsure, use Standard.',
  'temp.equal': 'Standard',
  'temp.just': 'Pure',
  'set.display': 'Display',
  'set.range': 'Range',
  'set.visibleBeats': 'Beats shown',
  'set.unit': 'Time unit',
  'unit.beat': 'Beats',
  'unit.second': 'Seconds',
  'set.drone': 'Drone',
  'set.droneRoot': 'Root',
  'set.droneRootTitle': 'Pitch of the sustained reference tone (tune against it while playing). Follows the tonic in Scales mode.',
  'set.device': 'Device',
  'set.mic': 'Microphone',
  'set.micTitle': 'Choose the input device. On a Mac mini without a built-in mic, pick the iPhone (Continuity Microphone)',
  'set.micHelpTitle': 'No microphone / using another device?',
  'set.micHelpAria': 'Microphone help',
  'set.latency': 'Rhythm latency',
  'set.calibrate': 'Calibrate',
  'set.calibrateTitle': 'Plays clicks to measure microphone latency so rhythm scoring is more accurate (the mic must hear the speakers)',
  'set.language': 'Language',
  'help.macTitle': 'Mac (no built-in mic) with an iPhone:',
  'help.macSteps':
    '<li>Sign the Mac and iPhone into the same Apple ID, turn on Wi-Fi and Bluetooth on both, and keep them close (macOS Ventura+, iOS 16+).</li>' +
    '<li>iPhone: Settings → General → AirPlay &amp; Continuity → turn on "Continuity Camera" (it also covers the microphone).</li>' +
    '<li>Back here, press "▶ Start" once to grant mic access — the "Microphone" list will show "xxx\'s iPhone Microphone"; it is selected automatically when found, or pick it yourself. Or fix it in System Settings → Sound → Input.</li>' +
    '<li>The wireless iPhone mic has noticeable latency: for rhythm scoring, press "Calibrate" first (the iPhone must hear the computer\'s clicks).</li>',
  'help.androidTitle': 'Android tablet / phone:',
  'help.androidSteps':
    '<li>Open this page in the tablet browser (Chrome recommended), press "▶ Start" and allow the microphone in the prompt — the built-in mic works.</li>' +
    '<li>With a USB / Bluetooth mic attached, switch in the "Microphone" list; Bluetooth mics lag, so "Calibrate" first as well.</li>' +
    '<li>Note: browsers only allow the microphone over https (or localhost); opening via a LAN IP will not get permission.</li>',

  'btn.start': '▶ Start',
  'btn.resume': '▶ Resume',
  'btn.pause': '⏸ Pause',
  'btn.stop': '⏸ Stop',
  'btn.redo': '↺ Restart',
  'btn.redoTitle': 'End this run-through: clear the trail and go back to beat 1; a take in progress is saved too',
  'btn.fullscreen': 'Enter / exit fullscreen',
  'btn.fullscreenAria': 'Fullscreen',

  'mic.denied': 'The browser blocked the microphone — click the icon at the right of the address bar, choose "Allow", then press Start',
  'mic.notFound': 'No microphone found — on a Mac you can use an iPhone via Continuity: ⚙ → Device → ? for steps',
  'mic.failed': 'Cannot access the microphone; check permissions or try another input device',
  'mic.failedShort': 'Cannot access the microphone; check permissions or the device',
  'mic.autoIphone': 'iPhone microphone selected automatically',
  'mic.default': 'System default input',
  'mic.unnamed': 'Microphone',
  'mic.switchFailed': 'Cannot switch to that input device',
  'canvas.cannotStart': '⚠ Cannot start',
  'status.paused': 'Paused',
  'status.pausedRec': 'Paused · recording paused too; press "↺ Restart" to save this take',
  'status.rewound': 'Back at beat 1 — press "Resume" when ready',
  'status.noFullscreen': 'This browser does not support fullscreen',

  'rec.armed': 'Recording on — press "▶ Start" to record this run-through',
  'rec.micNotReady': 'Cannot record: microphone not ready',
  'rec.unsupported': 'This browser does not support recording',
  'rec.saved': 'Recorded {dur} — play it back below',
  'rec.recording': 'Recording…',
  'rec.title': 'Takes',
  'rec.clear': 'Clear',
  'rec.download': 'Download this take',
  'rec.downloadAria': 'Download',
  'rec.delete': 'Delete this take',
  'rec.deleteAria': 'Delete',

  'cal.micNotReady': 'Calibration failed: microphone not ready',
  'cal.running': 'Calibrating… keep quiet and let the mic hear the clicks',
  'cal.noClick': 'No clicks heard: turn the volume up or move the mic closer to the speakers and try again',
  'cal.done': 'Calibrated: microphone latency ≈ {ms}ms',

  'rep.tendHigh': 'Sharp overall by {c}¢ — tends to drift high',
  'rep.tendLow': 'Flat overall by {c}¢ — tends to drift low',
  'rep.allGood': 'Steady intonation — keep it up!',
  'rep.worstTitle': 'Watch these',
  'rep.noteHigh': '<b>{name}</b> sharp by {c}¢ on average · move the finger back a little',
  'rep.noteLow': '<b>{name}</b> flat by {c}¢ on average · move the finger up a little',
  'rep.late': 'late by {ms}ms',
  'rep.early': 'early by {ms}ms',
  'rep.onTime': 'mostly on time',
  'rep.uncalibrated': '(latency not calibrated; early/late is approximate)',
  'rep.rhythm': 'Rhythm (approx.): on time {pct}% · mean deviation {ms}ms · {tend}',
  'rep.score': 'Score',
  'rep.onset': 'Attack in tune {pct}% ({n} notes)',
  'rep.slideUp': 'often slides up into the note ({c}¢ on average)',
  'rep.slideDown': 'often lands sharp and drops ({c}¢ on average)',
  'rep.vibrato': 'Vibrato on {n} notes · {hz} Hz · ±{w}¢ (judged by its centre)',
  'rep.vibSlow': 'slow',
  'rep.vibFast': 'fast and tight',
  'rep.vibWide': 'wide',
  'next.rhythm': 'Next: the pulse is unsteady — drop to {bpm} BPM with the metronome on. Steady first, fast later.',
  'next.rhythmBtn': 'Again at {bpm} BPM + metronome',
  'next.onset': 'Next: notes are often found after landing — hear each note in your head before the finger goes down; drop to {bpm} BPM to give the left hand time.',
  'next.slowerBtn': 'Again at {bpm} BPM',
  'next.tendHigh': 'Next: sharp overall — turn on the tonic + fifth drone and play long notes against it; a beating, wobbling sound means not there yet.',
  'next.tendLow': 'Next: flat overall — turn on the tonic + fifth drone and play long notes against it; a beating, wobbling sound means not there yet.',
  'next.droneBtn': 'Drone on, again',
  'next.note': 'Next: practise <b>{name}</b> alone — slow long notes against a drone on the same note until the beating stops, remember the finger spot, then put it back in the phrase.',
  'next.noteBtn': 'Drone on {name}',
  'next.faster': 'Next: that was steady — try {bpm} BPM.',
  'next.fasterBtn': 'Again at {bpm} BPM',
  'rep.bars': 'In tune {a}% · close {b}% · off {c}%',

  'tuner.idle': 'Press "Start" and bow an open string',
  'tuner.play': 'Play a note…',
  'tuner.flat': 'Flat ♭',
  'tuner.inTune': 'In tune',
  'tuner.sharp': 'Sharp ♯',
  'tuner.good': 'In tune ✓',
  'tuner.low': 'Flat {c}¢ · tighten a little',
  'tuner.high': 'Sharp +{c}¢ · loosen a little',
  'tuner.hint': 'Bow an open string and bring the needle to the center. Left = flat (tighten the string), right = sharp (loosen it). Reference A4 = 442 Hz.',

  'key.major': '{tonic} major',
  'key.minor': '{tonic} minor',
  'key.majorGroup': 'Major',
  'key.minorGroup': 'Minor',
  'key.noAccidentals': 'no sharps or flats',

  'err.dbOpen': 'Could not open IndexedDB',
  'err.dbRead': 'Could not read the library',
  'err.dbWrite': 'Could not write to the library',
  'err.dbAbort': 'Library write aborted',
  'err.dbDelete': 'Delete failed',
  'err.dbClear': 'Could not clear the library',
  'err.mxlInvalid': 'Not a valid .mxl archive',
  'err.mxlCorrupt': 'Archive is corrupt: {name}',
  'err.mxlMethod': 'Unsupported compression method ({m})',
  'err.mxlNoDecompress': 'This browser cannot unpack .mxl — use a recent Chrome / Safari, or export uncompressed .musicxml',
  'err.mxlEmpty': 'The archive is empty',
  'err.mxlNoXml': 'No MusicXML found in the archive',
  'err.xmlInvalid': 'Could not parse the file: not valid MusicXML',
  'err.xmlNoPart': 'No part found in the score',
  'err.xmlNoNotes': 'The score has no playable notes',
};

export type Lang = 'zh' | 'en';
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
];
const DICTS: Record<Lang, Record<MsgKey, string>> = { zh, en };
const LANG_KEY = 'pavlov_cat.lang';

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch { /* */ }
  return /^zh\b/i.test(navigator.language) ? 'zh' : 'en';
}

let lang: Lang = detectLang();
const listeners: (() => void)[] = [];

export function getLang(): Lang { return lang; }

export function t(key: MsgKey, params?: Record<string, string | number>): string {
  const s = DICTS[lang][key] ?? zh[key];
  return params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;
}

/** Fill every data-i18n* tagged element under `root`. */
export function applyI18n(root: ParentNode = document): void {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n as MsgKey); });
  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml as MsgKey); });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle as MsgKey); });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria as MsgKey)); });
}

/** Run `fn` after every language switch, to redraw text built in code. */
export function onLangChange(fn: () => void): void { listeners.push(fn); }

export function setLang(next: Lang): void {
  if (next === lang) return;
  lang = next;
  try { localStorage.setItem(LANG_KEY, next); } catch { /* */ }
  applyI18n();
  for (const fn of listeners) fn();
}
