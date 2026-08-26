#!/usr/bin/env swift
// Violin recording helper — records a chosen mic to 16-bit 44.1kHz mono WAV,
// ready for analyze_performance.py.
//
// usage: swift record.swift [seconds] [output.wav] [--device <name substring>] [--list]
//   - defaults to the BUILT-IN microphone (Bluetooth headset mics like AirPods
//     are low quality and often silent when idle); --device overrides
//   - interactive terminal, no seconds given → records until Enter (or Ctrl-C)
//   - non-interactive (run by a tool), no seconds → defaults to 15s
//   - output defaults to /tmp/violin_recording.wav
//
// NOTE: must run with real microphone access — sandboxed shells record pure
// silence. First run triggers the macOS mic permission prompt for the host app.

import AVFoundation
import CoreAudio
import Foundation

// ---------- CoreAudio device helpers ----------

func propAddr(_ selector: AudioObjectPropertySelector,
              _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}

func allDeviceIDs() -> [AudioDeviceID] {
    var addr = propAddr(kAudioHardwarePropertyDevices)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr,
          size > 0 else { return [] }
    var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == noErr
    else { return [] }
    return ids
}

func hasInput(_ id: AudioDeviceID) -> Bool {
    var addr = propAddr(kAudioDevicePropertyStreamConfiguration, kAudioDevicePropertyScopeInput)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(id, &addr, 0, nil, &size) == noErr, size > 0 else { return false }
    let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { raw.deallocate() }
    guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, raw) == noErr else { return false }
    let abl = UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self))
    return abl.reduce(0) { $0 + Int($1.mNumberChannels) } > 0
}

func deviceName(_ id: AudioDeviceID) -> String {
    var addr = propAddr(kAudioDevicePropertyDeviceNameCFString)
    var name: CFString = "" as CFString
    var size = UInt32(MemoryLayout<CFString>.size)
    let err = withUnsafeMutablePointer(to: &name) { AudioObjectGetPropertyData(id, &addr, 0, nil, &size, $0) }
    return err == noErr ? (name as String) : "device \(id)"
}

func isBuiltIn(_ id: AudioDeviceID) -> Bool {
    var addr = propAddr(kAudioDevicePropertyTransportType)
    var t: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &t) == noErr else { return false }
    return t == kAudioDeviceTransportTypeBuiltIn
}

func defaultInputID() -> AudioDeviceID? {
    var addr = propAddr(kAudioHardwarePropertyDefaultInputDevice)
    var id: AudioDeviceID = 0
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id) == noErr,
          id != 0 else { return nil }
    return id
}

// ---------- args ----------

var duration: Double? = nil
var outPath = "/tmp/violin_recording.wav"
var deviceQuery: String? = nil
var listOnly = false
var it = CommandLine.arguments.dropFirst().makeIterator()
while let arg = it.next() {
    switch arg {
    case "--list": listOnly = true
    case "--device": deviceQuery = it.next()
    default:
        if let d = Double(arg), d > 0 { duration = d } else { outPath = arg }
    }
}

let inputs = allDeviceIDs().filter(hasInput)
let defID = defaultInputID()

if listOnly {
    print("input devices:")
    for id in inputs {
        var tags: [String] = []
        if isBuiltIn(id) { tags.append("built-in") }
        if id == defID { tags.append("system default") }
        let suffix = tags.isEmpty ? "" : "  (\(tags.joined(separator: ", ")))"
        print("  \(deviceName(id))\(suffix)")
    }
    exit(0)
}

var chosen: AudioDeviceID? = nil
if let q = deviceQuery {
    chosen = inputs.first { deviceName($0).lowercased().contains(q.lowercased()) }
    if chosen == nil {
        FileHandle.standardError.write("no input device matching \"\(q)\"; available:\n".data(using: .utf8)!)
        for id in inputs { FileHandle.standardError.write("  \(deviceName(id))\n".data(using: .utf8)!) }
        exit(1)
    }
} else {
    // prefer built-in mic: Bluetooth mics (AirPods etc.) are 16kHz and often
    // deliver pure silence when sitting idle in the case
    chosen = inputs.first(where: isBuiltIn) ?? defID
}
guard let deviceID = chosen else {
    FileHandle.standardError.write("no audio input device found\n".data(using: .utf8)!)
    exit(1)
}

let stdinTTY = isatty(0) != 0
let stdoutTTY = isatty(1) != 0
if duration == nil && !stdinTTY {
    duration = 15
    print("no interactive terminal — recording 15s (pass a number of seconds to change)")
}

// ---------- mic permission ----------

switch AVCaptureDevice.authorizationStatus(for: .audio) {
case .authorized:
    break
case .notDetermined:
    let sem = DispatchSemaphore(value: 0)
    var ok = false
    AVCaptureDevice.requestAccess(for: .audio) { granted in ok = granted; sem.signal() }
    sem.wait()
    if !ok {
        FileHandle.standardError.write("microphone access denied\n".data(using: .utf8)!)
        exit(1)
    }
default:
    FileHandle.standardError.write(
        "microphone access denied — allow your terminal app in System Settings → Privacy & Security → Microphone\n"
            .data(using: .utf8)!)
    exit(1)
}

// ---------- engine ----------

let engine = AVAudioEngine()
let input = engine.inputNode
var devID = deviceID
guard let au = input.audioUnit,
      AudioUnitSetProperty(au, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0,
                           &devID, UInt32(MemoryLayout<AudioDeviceID>.size)) == noErr
else {
    FileHandle.standardError.write("failed to select input device\n".data(using: .utf8)!)
    exit(1)
}
let fmt = input.inputFormat(forBus: 0)
guard fmt.sampleRate > 0, fmt.channelCount > 0 else {
    FileHandle.standardError.write("input device has no usable format (is it connected?)\n".data(using: .utf8)!)
    exit(1)
}

let nativePath = outPath + ".native.wav"
var file: AVAudioFile? = try? AVAudioFile(
    forWriting: URL(fileURLWithPath: nativePath),
    settings: [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVSampleRateKey: fmt.sampleRate,
        AVNumberOfChannelsKey: fmt.channelCount,
        AVLinearPCMBitDepthKey: 16,
        AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false,
    ])
guard file != nil else {
    FileHandle.standardError.write("cannot open output \(nativePath)\n".data(using: .utf8)!)
    exit(1)
}

var lastDb: Float = -160
var maxDb: Float = -160
input.installTap(onBus: 0, bufferSize: 4096, format: fmt) { buf, _ in
    try? file?.write(from: buf)
    if let ch = buf.floatChannelData?[0], buf.frameLength > 0 {
        var s: Float = 0
        for i in 0..<Int(buf.frameLength) { s += ch[i] * ch[i] }
        let rms = (s / Float(buf.frameLength)).squareRoot()
        lastDb = 20 * log10(max(rms, 1e-8))
        maxDb = max(maxDb, lastDb)
    }
}

do { try engine.start() } catch {
    FileHandle.standardError.write("failed to start audio engine: \(error)\n".data(using: .utf8)!)
    exit(1)
}

var stopRequested = false
signal(SIGINT, SIG_IGN)
let sigint = DispatchSource.makeSignalSource(signal: SIGINT, queue: DispatchQueue.global())
sigint.setEventHandler { stopRequested = true }
sigint.resume()

let devLabel = "\(deviceName(deviceID)) (\(Int(fmt.sampleRate))Hz, \(fmt.channelCount)ch)"
if let d = duration {
    print("🎻 recording \(String(format: "%g", d))s from: \(devLabel)")
} else {
    print("🎻 recording from: \(devLabel)   press Enter to stop")
    DispatchQueue.global().async {
        _ = readLine()
        stopRequested = true
    }
}

let start = Date()
var lastLog = 0.0
while !stopRequested {
    let t = Date().timeIntervalSince(start)
    if let d = duration, t >= d { break }
    if stdoutTTY {
        let level = max(0, min(1, (lastDb + 50) / 50))
        let bars = Int(level * 30)
        let meter = String(repeating: "█", count: bars) + String(repeating: "░", count: 30 - bars)
        print(String(format: "\r%6.1fs |%@| %6.1f dB ", t, meter, lastDb), terminator: "")
        fflush(stdout)
    } else if t - lastLog >= 2 {
        print(String(format: "%.0fs  level %.1f dB", t, lastDb))
        lastLog = t
    }
    usleep(100_000)
}
engine.stop()
input.removeTap(onBus: 0)
file = nil  // close the file
if stdoutTTY { print("") }

// convert native rate/channels → 44.1kHz mono 16-bit for the analyzer
let conv = Process()
conv.executableURL = URL(fileURLWithPath: "/usr/bin/afconvert")
conv.arguments = ["-f", "WAVE", "-d", "LEI16@44100", "-c", "1", nativePath, outPath]
try? conv.run()
conv.waitUntilExit()
if conv.terminationStatus == 0 {
    try? FileManager.default.removeItem(atPath: nativePath)
} else {
    print("⚠️ afconvert failed — raw recording kept at \(nativePath)")
}

let secs = Date().timeIntervalSince(start)
print(String(format: "saved %.1fs → %@", secs, outPath))
if maxDb < -40 {
    print(String(format: "⚠️ max level only %.1f dB RMS — near silence. Check the mic (--list to see devices, --device <name> to pick one).", maxDb))
}
print("analyze: python3 .claude/skills/violin-master/scripts/analyze_performance.py \(outPath)")
