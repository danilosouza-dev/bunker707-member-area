// As capturas nativas do Live Bunker707 (docs/30 D145), pelo proprio Mac, escritas no stdout em pedacos float32, 48 kHz:
// - `captura voz <nome>`: o microfone escolhido na sala pela captura de voz da Apple (o Isolamento de Voz do Mac vale
//   aqui), sem o ganho automatico, mono. Sem o nome, ou sem um aparelho com esse nome, o microfone padrao do Mac.
// - `captura som`: o som do computador (o que se compartilha junto com a tela), estereo intercalado, sem o som do proprio
//   aplicativo (as vozes da sala nao voltam). Precisa da permissao de Gravacao de tela.
// Param quando o stdin fecha. No stderr, so avisos curtos.
import AVFoundation
import CoreAudio
import Foundation
import ScreenCaptureKit

setvbuf(stdout, nil, _IOFBF, 1 << 16)
let engine = AVAudioEngine()
// So o modo voz toca no microfone (o modo som nunca abre a entrada).
var input: AVAudioInputNode { engine.inputNode }
let out = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 1, interleaved: false)!
var converter: AVAudioConverter?

func say(_ text: String) { FileHandle.standardError.write((text + "\n").data(using: .utf8)!) }

/** O aparelho de entrada com esse nome (o comeco do nome, sem maiusculas), ou nulo. */
func inputDevice(named wanted: String) -> AudioDeviceID? {
  var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr else { return nil }
  var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids) == noErr else { return nil }
  let target = wanted.lowercased().trimmingCharacters(in: .whitespaces)
  for id in ids {
    var streams = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreams, mScope: kAudioDevicePropertyScopeInput, mElement: kAudioObjectPropertyElementMain)
    var count: UInt32 = 0
    if AudioObjectGetPropertyDataSize(id, &streams, 0, nil, &count) != noErr || count == 0 { continue }
    var nameAddress = AudioObjectPropertyAddress(mSelector: kAudioObjectPropertyName, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var name: Unmanaged<CFString>?
    var nameSize = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(id, &nameAddress, 0, nil, &nameSize, &name) == noErr, let text = name?.takeRetainedValue() as String? else { continue }
    if !target.isEmpty && text.lowercased().hasPrefix(target) { return id }
  }
  return nil
}

func startVoice(_ wanted: String) {
do {
  if let device = inputDevice(named: wanted), let unit = input.audioUnit {
    var id = device
    let status = AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &id, UInt32(MemoryLayout<AudioDeviceID>.size))
    say(status == noErr ? "microfone \(wanted)" : "microfone padrao (nao troquei: \(status))")
  } else {
    say("microfone padrao (sem \"\(wanted)\")")
  }
  try input.setVoiceProcessingEnabled(true)
  input.isVoiceProcessingAGCEnabled = false
  if #available(macOS 14.0, *) {
    // Sem abaixar o som dos outros programas (a musica ou o video que se compartilha).
    input.voiceProcessingOtherAudioDuckingConfiguration = AVAudioVoiceProcessingOtherAudioDuckingConfiguration(enableAdvancedDucking: false, duckingLevel: .min)
  }
  let format = input.outputFormat(forBus: 0)
  converter = AVAudioConverter(from: AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: format.sampleRate, channels: 1, interleaved: false)!, to: out)
  say("pronto \(format.sampleRate)")
  input.installTap(onBus: 0, bufferSize: 480, format: format) { buffer, _ in
    guard let data = buffer.floatChannelData, buffer.frameLength > 0, let conv = converter else { return }
    let mono = AVAudioPCMBuffer(pcmFormat: conv.inputFormat, frameCapacity: buffer.frameLength)!
    mono.frameLength = buffer.frameLength
    memcpy(mono.floatChannelData![0], data[0], Int(buffer.frameLength) * 4)
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * 48000 / format.sampleRate) + 16
    let result = AVAudioPCMBuffer(pcmFormat: out, frameCapacity: capacity)!
    var used = false
    var error: NSError?
    conv.convert(to: result, error: &error) { _, status in
      if used { status.pointee = .noDataNow; return nil }
      used = true
      status.pointee = .haveData
      return mono
    }
    if result.frameLength > 0 {
      fwrite(result.floatChannelData![0], 4, Int(result.frameLength), stdout)
      fflush(stdout)
    }
  }
  engine.prepare()
  try engine.start()
} catch {
  say("erro \(error.localizedDescription)")
  exit(1)
}
}

/* ---- o som do computador ---- */

final class SystemSound: NSObject, SCStreamOutput, SCStreamDelegate {
  var stream: SCStream?

  func start() async {
    do {
      let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
      guard let display = content.displays.first else { say("erro sem tela"); exit(1) }
      // Fora o proprio aplicativo (a janela e os processos dele): as vozes da sala nao voltam para a sala.
      let own = content.applications.filter { $0.bundleIdentifier.hasPrefix("br.com.bunker707.live") }
      let filter = SCContentFilter(display: display, excludingApplications: own, exceptingWindows: [])
      let config = SCStreamConfiguration()
      config.capturesAudio = true
      config.excludesCurrentProcessAudio = true
      config.sampleRate = 48000
      config.channelCount = 2
      // So o som: a imagem minima, uma vez por segundo.
      config.width = 2
      config.height = 2
      config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
      let stream = SCStream(filter: filter, configuration: config, delegate: self)
      try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: DispatchQueue(label: "som"))
      try await stream.startCapture()
      self.stream = stream
      say("pronto som")
    } catch {
      say("erro \(error.localizedDescription)")
      exit(1)
    }
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .audio, let format = CMSampleBufferGetFormatDescription(buffer), let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee else { return }
    let frames = CMSampleBufferGetNumSamples(buffer)
    guard frames > 0 else { return }
    var block: CMBlockBuffer?
    let size = MemoryLayout<AudioBufferList>.size + MemoryLayout<AudioBuffer>.size
    let raw = UnsafeMutableRawPointer.allocate(byteCount: size, alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { raw.deallocate() }
    let abl = raw.bindMemory(to: AudioBufferList.self, capacity: 1)
    guard CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(buffer, bufferListSizeNeededOut: nil, bufferListOut: abl, bufferListSize: size, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: &block) == noErr else { return }
    let buffers = UnsafeMutableAudioBufferListPointer(abl)
    let planar = (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0
    var out = [Float](repeating: 0, count: frames * 2)
    if planar && buffers.count >= 2, let l = buffers[0].mData?.assumingMemoryBound(to: Float.self), let r = buffers[1].mData?.assumingMemoryBound(to: Float.self) {
      for i in 0..<frames { out[i * 2] = l[i]; out[i * 2 + 1] = r[i] }
    } else if let data = buffers[0].mData?.assumingMemoryBound(to: Float.self) {
      let channels = Int(asbd.mChannelsPerFrame)
      for i in 0..<frames { out[i * 2] = data[i * channels]; out[i * 2 + 1] = data[i * channels + min(1, channels - 1)] }
    }
    out.withUnsafeBufferPointer { p in _ = fwrite(p.baseAddress, 4, p.count, stdout) }
    fflush(stdout)
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    say("erro \(error.localizedDescription)")
    exit(1)
  }
}

let mode = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "voz"
let sound = SystemSound()
if mode == "som" {
  Task { await sound.start() }
} else {
  startVoice(CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "")
  // O modo do microfone escolhido na barra do Mac, de 2 em 2 s (para o relatorio).
  Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in
    let mic = AVCaptureDevice.activeMicrophoneMode
    say("modo \(mic == .voiceIsolation ? "isolamento" : mic == .wideSpectrum ? "amplo" : "padrao")")
  }
}
FileHandle.standardInput.readabilityHandler = { handle in
  if handle.availableData.isEmpty { if mode == "som" { exit(0) }; engine.stop(); exit(0) }
}
RunLoop.main.run()
